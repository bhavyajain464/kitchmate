import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  View,
  RefreshControl,
  FlatList,
  Platform,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import {
  Text,
  Searchbar,
  SegmentedButtons,
  IconButton,
  Menu,
  ActivityIndicator,
} from 'react-native-paper';
import {
  useRoute,
  useNavigation,
  useIsFocused,
  RouteProp,
} from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { FilterPill, FilterPillRow } from '../components/FilterPill';
import { InventoryListItem } from '../components/inventory/InventoryListItem';
import { EditInventoryItemSheet } from '../components/inventory/EditInventoryItemSheet';
import type { InventoryMenuAction } from '../components/inventory/InventoryItemActionsSheet';
import { AddInventoryModal } from '../components/modals/AddInventoryModal';
import { ScanBillBottomSheet } from '../components/modals/ScanBillBottomSheet';
import * as api from '../services/api';
import { InventoryItem, ExpiringItem, InventoryFoodGroup } from '../types';
import {
  foodGroupLabel,
} from '../constants/inventoryFoodGroups';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { useEntitlements } from '../context/EntitlementsContext';
import { usePlanUpgrade } from '../hooks/usePlanUpgrade';
import { showUpgradeMessage } from '../utils/upgrade';
import { showAppError } from '../utils/alertMessage';
import { TabScreenHeader, TabScreenToolbarRow } from '../components/TabScreenHeader';
import { useAppRefresh, refreshAppliesTo } from '../context/AppRefreshContext';
import type { MainTabParamList } from '../navigation/types';
import { useUndoSnackbar } from '../hooks/useUndoSnackbar';
import { TourTarget } from '../components/tour/TourTarget';
import { APP_TOUR_TARGET_IDS } from '../tour/appTourSteps';
import { useTourScreenScroll } from '../hooks/useTourScreenScroll';
import { useProductTour } from '../context/ProductTourContext';
import { scrollFlatListToTop, getListScrollElement, useFlatListOnEndReached } from '../utils/infiniteScroll';
import { keyboardAwareScrollViewProps } from '../utils/keyboardAvoidance';

type TabValue = 'all' | 'expired';

const INVENTORY_GRID_COLUMNS = 3;
const INVENTORY_GRID_GAP = 6;
const INVENTORY_GRID_PAD = 10;

type PantryItem = InventoryItem | ExpiringItem;

type PantryListEntry<T> = { item: T; index: number };

type PendingPantryListEntry = { item: PantryItem; index: number };

type PendingPantryRemove = {
  list?: PendingPantryListEntry;
};

type PendingPantryExpire = {
  list?: PendingPantryListEntry;
  addedExpired: PantryListEntry<ExpiringItem>;
};

type PendingPantryAddToShopping = PendingPantryRemove & {
  name: string;
  qty: number;
  unit: string;
};

function yesterdayExpiryIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toExpiredPreview(item: InventoryItem | ExpiringItem): ExpiringItem {
  const estimated_expiry = yesterdayExpiryIso();
  return {
    item_id: item.item_id,
    ingredient_id: item.ingredient_id,
    canonical_name: item.canonical_name,
    qty: item.qty,
    unit: item.unit,
    food_group: item.food_group,
    display_qty: item.display_qty,
    catalog: item.catalog,
    estimated_expiry,
    days_until_expiry: -1,
    updated_at: 'updated_at' in item ? item.updated_at : undefined,
  };
}

export function InventoryScreen() {
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const { contentPaddingBottom } = useTabBarLayout();
  const { isTourActive, activeStepId, requestTargetRemeasure } = useProductTour();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList, 'Inventory'>>();
  const route = useRoute<RouteProp<MainTabParamList, 'Inventory'>>();
  const { entitlements, canBillScan } = useEntitlements();
  const { startUpgrade } = usePlanUpgrade();
  const [listItems, setListItems] = useState<PantryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({});
  const [bucketCounts, setBucketCounts] = useState({ active: 0, expiring: 0, expired: 0, total: 0 });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [tab, setTab] = useState<TabValue>(() =>
    route.params?.tab === 'expired' ? 'expired' : 'all',
  );
  const [expiringSoonFilter, setExpiringSoonFilter] = useState(false);
  const [foodGroups, setFoodGroups] = useState<InventoryFoodGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [expiredGroupFilter, setExpiredGroupFilter] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const { show: showSnack, showUndo, cancelCommit, undoSnackbar } = useUndoSnackbar();
  const pendingPantryRemovesRef = useRef<Map<string, PendingPantryRemove>>(new Map());
  const pendingPantryExpiresRef = useRef<Map<string, PendingPantryExpire>>(new Map());
  const pendingPantryAddToShoppingRef = useRef<Map<string, PendingPantryAddToShopping>>(new Map());

  const listItemsRef = useRef(listItems);
  listItemsRef.current = listItems;
  const requestGen = useRef(0);
  const nextOffsetRef = useRef(0);
  const resetEndReachedRef = useRef<() => void>(() => {});
  /** Stable per-category totals for filter pills — not narrowed by expiring/search/group filters. */
  const inStockPillCountsRef = useRef<Record<string, number>>({});
  const expiredPillCountsRef = useRef<Record<string, number>>({});

  const [addMenuVisible, setAddMenuVisible] = useState(false);

  // Manual add bottom sheet
  const [addModalVisible, setAddModalVisible] = useState(false);

  const [editItem, setEditItem] = useState<PantryItem | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [scanSheetVisible, setScanSheetVisible] = useState(false);

  const inventoryScrollRef = useRef<FlatList<PantryItem>>(null);
  useTourScreenScroll('Inventory', inventoryScrollRef, { fixedChromeExtra: 130 });
  const skipFilterScrollReset = useRef(true);
  const skipExpiredFilterScrollReset = useRef(true);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const isFocused = useIsFocused();
  const { version: refreshVersion, scope: refreshScope, bump } = useAppRefresh();

  useEffect(
    () => {
      if (Platform.OS !== 'web' || typeof window === 'undefined') return;
      const prev = window.history.scrollRestoration;
      window.history.scrollRestoration = 'manual';
      return () => {
        window.history.scrollRestoration = prev;
      };
    },
    [],
  );

  // Web only: the browser restores this list's inner scroll-div position after the
  // content grows back to its previous height. That dumped users deep into the list
  // on first load (and the restore scroll triggered onEndReached, auto-loading every
  // page to rebuild that height). window scroll-restoration above only covers the
  // window itself, not this overflow div. Gate on a real user gesture: until the user
  // scrolls/touches, snap the list back to the top on every scroll event (see
  // handleListScrollWeb), which defeats the restore whenever it lands — independent of
  // how long the data fetch takes — and keeps onEndReached from auto-loading.
  const userScrolledRef = useRef(false);
  // Last scroll offset we accept as user-driven. Used to cancel the browser's stuck
  // scroll-restore, which force-jumps the list to the bottom whenever content grows.
  const intendedScrollYRef = useRef(0);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const markScrolled = () => {
      userScrolledRef.current = true;
    };
    window.addEventListener('wheel', markScrolled, { passive: true });
    window.addEventListener('touchstart', markScrolled, { passive: true });
    window.addEventListener('keydown', markScrolled);
    return () => {
      window.removeEventListener('wheel', markScrolled);
      window.removeEventListener('touchstart', markScrolled);
      window.removeEventListener('keydown', markScrolled);
    };
  }, []);


  const restorePantryEntries = useCallback((pending: PendingPantryRemove) => {
    if (!pending.list) return;
    const { item, index } = pending.list;
    setListItems((prev) => {
      if (prev.some((i) => i.item_id === item.item_id)) return prev;
      const list = [...prev];
      list.splice(Math.min(index, list.length), 0, item);
      return list;
    });
  }, []);

  const optimisticallyRemovePantryItem = useCallback((itemId: string): PendingPantryRemove => {
    const list = listItemsRef.current;
    const index = list.findIndex((i) => i.item_id === itemId);
    const captured: PendingPantryRemove = {};
    if (index >= 0) captured.list = { item: list[index], index };
    setListItems((prev) => prev.filter((i) => i.item_id !== itemId));
    return captured;
  }, []);

  const commitPantryRemove = useCallback(
    (itemId: string) => {
      const pending = pendingPantryRemovesRef.current.get(itemId);
      if (!pending) return;
      pendingPantryRemovesRef.current.delete(itemId);
      void api.deleteInventoryItem(itemId).catch(() => {
        restorePantryEntries(pending);
        showAppError('Could not remove item.');
      });
    },
    [restorePantryEntries],
  );

  const flushPendingPantryRemoves = useCallback(() => {
    const itemIds = [...pendingPantryRemovesRef.current.keys()];
    if (itemIds.length === 0) return;
    itemIds.forEach((itemId) => commitPantryRemove(itemId));
    cancelCommit();
  }, [commitPantryRemove, cancelCommit]);

  const restorePantryExpire = useCallback((pending: PendingPantryExpire) => {
    if (pending.list) {
      restorePantryEntries({ list: pending.list });
    }
  }, [restorePantryEntries]);

  const optimisticallyExpirePantryItem = useCallback((item: PantryItem): PendingPantryExpire => {
    const itemId = item.item_id;
    const list = listItemsRef.current;
    const index = list.findIndex((i) => i.item_id === itemId);
    const source = index >= 0 ? list[index] : item;
    const preview = toExpiredPreview(source);
    const captured: PendingPantryExpire = {
      addedExpired: { item: preview, index: 0 },
    };
    if (index >= 0) captured.list = { item: list[index], index };
    setListItems((prev) => prev.filter((i) => i.item_id !== itemId));
    return captured;
  }, []);

  const commitPantryExpire = useCallback(
    (itemId: string) => {
      const pending = pendingPantryExpiresRef.current.get(itemId);
      if (!pending) return;
      pendingPantryExpiresRef.current.delete(itemId);
      void api.expireInventoryItem(itemId).then(() => bump('inventory')).catch(() => {
        restorePantryExpire(pending);
        showAppError('Could not mark as expired.');
      });
    },
    [restorePantryExpire, bump],
  );

  const flushPendingPantryExpires = useCallback(() => {
    const itemIds = [...pendingPantryExpiresRef.current.keys()];
    if (itemIds.length === 0) return;
    itemIds.forEach((itemId) => commitPantryExpire(itemId));
    cancelCommit();
  }, [commitPantryExpire, cancelCommit]);

  const commitPantryAddToShopping = useCallback(
    (itemId: string) => {
      const pending = pendingPantryAddToShoppingRef.current.get(itemId);
      if (!pending) return;
      pendingPantryAddToShoppingRef.current.delete(itemId);
      void (async () => {
        try {
          await api.addShoppingItem(pending.name, pending.qty, pending.unit);
          await api.deleteInventoryItem(itemId);
          bump('inventory');
        } catch {
          restorePantryEntries(pending);
          showAppError('Could not add to shopping list.');
        }
      })();
    },
    [restorePantryEntries, bump],
  );

  const flushPendingPantryAddToShopping = useCallback(() => {
    const itemIds = [...pendingPantryAddToShoppingRef.current.keys()];
    if (itemIds.length === 0) return;
    itemIds.forEach((itemId) => commitPantryAddToShopping(itemId));
    cancelCommit();
  }, [commitPantryAddToShopping, cancelCommit]);

  const flushPendingPantryActions = useCallback(() => {
    flushPendingPantryRemoves();
    flushPendingPantryExpires();
    flushPendingPantryAddToShopping();
  }, [flushPendingPantryRemoves, flushPendingPantryExpires, flushPendingPantryAddToShopping]);

  const scrollListToTop = useCallback(() => {
    // Offset 0 is always valid, so this lands at the top deterministically
    // even when the list shrinks under us (e.g. a reset back to page 1).
    // The extra rAF pass re-pins the top after the shorter content lays out.
    scrollFlatListToTop(inventoryScrollRef);
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => scrollFlatListToTop(inventoryScrollRef));
    }
  }, []);

  // No scroll-to-top on plain tab focus: like Instagram/YouTube we keep the user's
  // scroll position when switching away and back. Re-tapping the active tab (tabPress
  // handler below) is the explicit "jump to top" gesture.

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const loadPage = useCallback(async (offset: number, append: boolean) => {
    const gen = ++requestGen.current;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      nextOffsetRef.current = 0;
      resetEndReachedRef.current();
    }
    const isExpiredTab = tabRef.current === 'expired';
    try {
      const page = await api.fetchInventoryPage({
        include: isExpiredTab ? ['expired'] : ['active', 'expiring'],
        q: debouncedSearch,
        foodGroup: isExpiredTab ? expiredGroupFilter : groupFilter,
        expiringOnly: !isExpiredTab && expiringSoonFilter,
        offset,
      });
      if (gen !== requestGen.current) return;
      setListItems((prev) => (append ? [...prev, ...page.items] : page.items));
      if (!append) scrollListToTop();
      nextOffsetRef.current = offset + page.items.length;
      setTotal(page.total);
      setHasMore(page.has_more);
      const incomingGroupCounts = page.group_counts ?? {};
      const pillCountsFiltered = isExpiredTab
        ? Boolean(expiredGroupFilter || debouncedSearch)
        : Boolean(expiringSoonFilter || groupFilter || debouncedSearch);
      const pillCountsCache = isExpiredTab ? expiredPillCountsRef : inStockPillCountsRef;
      if (!pillCountsFiltered) {
        pillCountsCache.current = incomingGroupCounts;
        setGroupCounts(incomingGroupCounts);
      } else if (Object.keys(pillCountsCache.current).length > 0) {
        setGroupCounts(pillCountsCache.current);
      } else {
        pillCountsCache.current = incomingGroupCounts;
        setGroupCounts(incomingGroupCounts);
      }
      setBucketCounts(page.counts);
    } catch (e) {
      if (gen !== requestGen.current) return;
      console.error('Failed to load inventory:', e);
      if (!append) {
        setListItems([]);
        setTotal(0);
        setHasMore(false);
        inStockPillCountsRef.current = {};
        expiredPillCountsRef.current = {};
        setGroupCounts({});
      }
    } finally {
      if (gen !== requestGen.current) return;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [debouncedSearch, groupFilter, expiredGroupFilter, expiringSoonFilter, scrollListToTop]);

  const loadData = useCallback(async () => {
    await loadPage(0, false);
  }, [loadPage]);

  const loadMore = useCallback(async () => {
    // On web, onEndReached / the browser's scroll-restore can fire on first load
    // before any real interaction and pull every page at once, defeating pagination.
    // Only fetch the next page after the user has actually scrolled.
    if (Platform.OS === 'web' && !userScrolledRef.current) return;
    if (loadingMore || !hasMore) return;
    await loadPage(nextOffsetRef.current, true);
  }, [loadingMore, hasMore, loadPage]);

  // Web scroll handler. Before the first real gesture: snap back to the top (defeats
  // the browser's scroll-restore). After it: drive pagination off the scroll position,
  // because mouse-wheel scrolling on web does not emit the momentum/drag events that
  // the FlatList onEndReached guard relies on, so onEndReached never fires here.
  const handleListScrollWeb = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (Platform.OS !== 'web') return;
      // Before the first real gesture, hold the list at the top (defeats the restore
      // landing us mid-list on load).
      if (!userScrolledRef.current) {
        scrollFlatListToTop(inventoryScrollRef);
        intendedScrollYRef.current = 0;
        return;
      }
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      const y = contentOffset.y;
      // Real wheel/touch scrolling moves the offset in small per-event steps (~tens of
      // px). The browser's stuck scroll-restore force-jumps hundreds of px in a single
      // event to pull the list to the bottom as content grows, which then cascades
      // loadMore. Cancel those unsolicited downward jumps by snapping back.
      const MAX_USER_STEP = 200;
      if (y - intendedScrollYRef.current > MAX_USER_STEP) {
        const el = getListScrollElement(inventoryScrollRef);
        if (el) el.scrollTop = intendedScrollYRef.current;
        return;
      }
      intendedScrollYRef.current = y;
      const distanceFromBottom = contentSize.height - layoutMeasurement.height - y;
      if (distanceFromBottom < layoutMeasurement.height * 0.5) {
        void loadMore();
      }
    },
    [loadMore],
  );

  const { flatListProps, resetEndReached } = useFlatListOnEndReached({
    onLoadMore: loadMore,
    hasMore,
    loading,
    loadingMore,
  });
  resetEndReachedRef.current = resetEndReached;

  // Reload when tab, search, or filters change.
  useEffect(() => {
    void loadPage(0, false);
  }, [tab, debouncedSearch, groupFilter, expiredGroupFilter, expiringSoonFilter, loadPage]);

  useEffect(() => {
    void api.fetchInventoryFoodGroups()
      .then((groups) => setFoodGroups(Array.isArray(groups) ? groups : []))
      .catch(() => setFoodGroups([]));
  }, []);

  useEffect(() => {
    if (isTourActive && activeStepId?.startsWith('inventory-')) {
      setTab('all');
    }
  }, [isTourActive, activeStepId]);

  useEffect(() => {
    if (!isTourActive || activeStepId !== 'inventory-toolbar' || loading) return;
    requestTargetRemeasure(APP_TOUR_TARGET_IDS.inventoryToolbar);
  }, [activeStepId, isTourActive, loading, requestTargetRemeasure]);

  // Reload only when the data actually changed (add / edit / scan / expire bumps
  // the refresh version), not on every tab focus. Reloading on plain focus used to
  // discard the loaded pages and the scroll position. We track the last handled
  // version so a focus toggle alone never triggers a reload.
  const lastHandledRefreshRef = useRef(refreshVersion);
  useEffect(() => {
    if (!isFocused) return;
    if (refreshVersion === lastHandledRefreshRef.current) return;
    lastHandledRefreshRef.current = refreshVersion;
    if (!refreshAppliesTo(refreshScope, 'inventory')) return;
    void loadData();
  }, [isFocused, refreshVersion, refreshScope, loadData]);

  // Deep links from Home (expired banner / expiring soon). Use primitive deps only —
  // `route.params` object identity changes every render on web and caused setParams loops.
  useEffect(() => {
    const tabParam = route.params?.tab;
    const expiringSoonParam = route.params?.expiringSoon;
    if (tabParam !== 'expired' && !expiringSoonParam) return;

    if (tabParam === 'expired') {
      setTab('expired');
      setExpiringSoonFilter(false);
      setExpiredGroupFilter(null);
    } else if (expiringSoonParam) {
      setTab('all');
      setExpiringSoonFilter(true);
    }

    navigation.setParams({ tab: undefined, expiringSoon: undefined });
  }, [route.params?.tab, route.params?.expiringSoon, navigation]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // Re-tapping the already-focused tab jumps back to the top and reloads page 1
  // (standard tab-bar behavior). Fires only when this tab is already active.
  useEffect(() => {
    const unsub = navigation.addListener('tabPress', () => {
      if (!navigation.isFocused()) return;
      scrollListToTop();
      void loadData();
    });
    return unsub;
  }, [navigation, scrollListToTop, loadData]);

  const openEditItem = useCallback((item: PantryItem) => {
    setEditItem(item);
  }, []);

  const performExpire = useCallback(
    (item: PantryItem) => {
      const itemId = item.item_id;
      flushPendingPantryActions();

      const captured = optimisticallyExpirePantryItem(item);
      pendingPantryExpiresRef.current.set(itemId, captured);

      showUndo(
        `"${item.canonical_name}" marked as expired.`,
        async () => {
          const pending = pendingPantryExpiresRef.current.get(itemId);
          if (!pending) return;
          pendingPantryExpiresRef.current.delete(itemId);
          restorePantryExpire(pending);
        },
        () => commitPantryExpire(itemId),
      );
    },
    [
      flushPendingPantryActions,
      optimisticallyExpirePantryItem,
      showUndo,
      restorePantryExpire,
      commitPantryExpire,
    ],
  );

  /** Item used up or cleared from pantry (not expired, not shopping). */
  const performRemoveFromPantry = useCallback(
    (item: PantryItem) => {
      const itemId = item.item_id;
      flushPendingPantryActions();

      const captured = optimisticallyRemovePantryItem(itemId);
      if (!captured.list) return;

      pendingPantryRemovesRef.current.set(itemId, captured);

      showUndo(
        `"${item.canonical_name}" removed from pantry.`,
        async () => {
          const pending = pendingPantryRemovesRef.current.get(itemId);
          if (!pending) return;
          pendingPantryRemovesRef.current.delete(itemId);
          restorePantryEntries(pending);
        },
        () => commitPantryRemove(itemId),
      );
    },
    [
      flushPendingPantryActions,
      optimisticallyRemovePantryItem,
      showUndo,
      restorePantryEntries,
      commitPantryRemove,
    ],
  );

  const performAddToShopping = useCallback(
    (item: ExpiringItem) => {
      const itemId = item.item_id;
      flushPendingPantryActions();

      const captured = optimisticallyRemovePantryItem(itemId);
      if (!captured.list) return;

      pendingPantryAddToShoppingRef.current.set(itemId, {
        ...captured,
        name: item.canonical_name,
        qty: item.qty,
        unit: item.unit,
      });

      showUndo(
        `"${item.canonical_name}" added to shopping list.`,
        async () => {
          const pending = pendingPantryAddToShoppingRef.current.get(itemId);
          if (!pending) return;
          pendingPantryAddToShoppingRef.current.delete(itemId);
          restorePantryEntries(pending);
        },
        () => commitPantryAddToShopping(itemId),
      );
    },
    [
      flushPendingPantryActions,
      optimisticallyRemovePantryItem,
      showUndo,
      restorePantryEntries,
      commitPantryAddToShopping,
    ],
  );

  const buildInStockMenu = useCallback(
    (item: PantryItem): InventoryMenuAction[] => [
      {
        key: 'edit',
        label: 'Edit',
        icon: 'pencil-outline',
        onPress: () => openEditItem(item),
      },
      {
        key: 'expire',
        label: 'Mark as expired',
        icon: 'clock-alert-outline',
        onPress: () => void performExpire(item),
      },
      {
        key: 'remove',
        label: 'Remove from pantry',
        icon: 'check-circle-outline',
        onPress: () => void performRemoveFromPantry(item),
      },
    ],
    [openEditItem, performExpire, performRemoveFromPantry],
  );

  const buildExpiredMenu = useCallback(
    (item: ExpiringItem): InventoryMenuAction[] => [
      {
        key: 'edit',
        label: 'Edit',
        icon: 'pencil-outline',
        onPress: () => openEditItem(item),
      },
      {
        key: 'shopping',
        label: 'Add to shopping list',
        icon: 'cart-plus',
        onPress: () => void performAddToShopping(item),
      },
      {
        key: 'remove',
        label: 'Remove from pantry',
        icon: 'check-circle-outline',
        onPress: () => void performRemoveFromPantry(item),
      },
    ],
    [openEditItem, performAddToShopping, performRemoveFromPantry],
  );

  const handleSaveEdit = async (patch: Parameters<typeof api.updateInventoryItem>[1]) => {
    if (!editItem) return;
    setEditSaving(true);
    try {
      await api.updateInventoryItem(editItem.item_id, patch);
      await loadData();
      const label = patch.canonical_name ?? editItem.canonical_name;
      showSnack(`"${label}" updated`);
      setEditItem(null);
    } catch {
      showAppError('Could not save changes.');
    } finally {
      setEditSaving(false);
    }
  };

  const openScanSheet = () => {
    if (!canBillScan) {
      showUpgradeMessage(
        entitlements?.bill_scans_used != null
          ? `You've used all ${entitlements.bill_scan_limit} free bill scans for today.`
          : 'Daily bill scan limit reached on the free plan.',
        startUpgrade,
      );
      return;
    }
    setScanSheetVisible(true);
  };

  // ── Filter pills (counts from backend) ─────────────────────

  const groupMeta = useMemo(
    () => [...foodGroups].sort((a, b) => a.sort - b.sort),
    [foodGroups],
  );

  const groupFilterOptions = useMemo(() => {
    return [...groupMeta]
      .filter((g) => (groupCounts[g.id] ?? 0) > 0)
      .sort((a, b) => a.sort - b.sort);
  }, [groupMeta, groupCounts]);

  const expiredGroupFilterOptions = useMemo(() => {
    return [...groupMeta]
      .filter((g) => (groupCounts[g.id] ?? 0) > 0)
      .sort((a, b) => a.sort - b.sort);
  }, [groupMeta, groupCounts]);

  useEffect(() => {
    if (groupFilter && (groupCounts[groupFilter] ?? 0) === 0) {
      setGroupFilter(null);
    }
  }, [groupFilter, groupCounts]);

  useEffect(() => {
    if (expiredGroupFilter && (groupCounts[expiredGroupFilter] ?? 0) === 0) {
      setExpiredGroupFilter(null);
    }
  }, [expiredGroupFilter, groupCounts]);

  useEffect(() => {
    if (bucketCounts.expiring === 0 && expiringSoonFilter) {
      setExpiringSoonFilter(false);
    }
  }, [bucketCounts.expiring, expiringSoonFilter]);

  // User changed filter pills (skip first run on mount).
  useLayoutEffect(() => {
    if (tab !== 'all') return;
    if (skipFilterScrollReset.current) {
      skipFilterScrollReset.current = false;
      return;
    }
    scrollListToTop();
  }, [groupFilter, expiringSoonFilter, tab, scrollListToTop]);

  useLayoutEffect(() => {
    if (tab !== 'expired') return;
    if (skipExpiredFilterScrollReset.current) {
      skipExpiredFilterScrollReset.current = false;
      return;
    }
    scrollListToTop();
  }, [expiredGroupFilter, tab, scrollListToTop]);

  const listBottomPad = contentPaddingBottom(24);
  const gridCellWidth = useMemo(() => {
    const inner = windowWidth - INVENTORY_GRID_PAD * 2 - INVENTORY_GRID_GAP * (INVENTORY_GRID_COLUMNS - 1);
    return Math.floor(inner / INVENTORY_GRID_COLUMNS);
  }, [windowWidth]);

  const gridCellStyle = useMemo(
    () => ({ width: gridCellWidth, marginBottom: INVENTORY_GRID_GAP }),
    [gridCellWidth],
  );

  const listFooter = loadingMore ? (
    <ActivityIndicator color="#2E7D32" style={styles.footerLoader} />
  ) : null;

  const renderInStockItem = useCallback(
    ({ item }: { item: PantryItem }) => (
      <View style={gridCellStyle}>
        <InventoryListItem
          variant="grid"
          kind="in_stock"
          item={item}
          menuActions={buildInStockMenu(item)}
          onSwipeLeft={() => void performExpire(item)}
          onSwipeRight={() => void performRemoveFromPantry(item)}
        />
      </View>
    ),
    [gridCellStyle, buildInStockMenu, performExpire, performRemoveFromPantry],
  );

  const renderExpiredItem = useCallback(
    ({ item }: { item: PantryItem }) => (
      <View style={gridCellStyle}>
        <InventoryListItem
          variant="grid"
          kind="expired"
          item={item as ExpiringItem}
          menuActions={buildExpiredMenu(item as ExpiringItem)}
          onSwipeLeft={() => void performAddToShopping(item as ExpiringItem)}
          onSwipeRight={() => void performRemoveFromPantry(item)}
        />
      </View>
    ),
    [gridCellStyle, buildExpiredMenu, performAddToShopping, performRemoveFromPantry],
  );

  const inStockEmpty = (
    <Text variant="bodyMedium" style={styles.emptyText}>
      {loading
        ? 'Loading...'
        : groupFilter
          ? 'No items in this group.'
          : expiringSoonFilter
            ? 'No items expiring soon — you\'re in good shape!'
            : debouncedSearch
              ? `No items match "${debouncedSearch}".`
              : 'No items yet. Use + next to search to add or scan a bill.'}
    </Text>
  );

  const expiredEmpty = (
    <Text variant="bodyMedium" style={styles.emptyText}>
      {loading
        ? 'Loading...'
        : expiredGroupFilter
          ? 'No expired items in this group.'
          : debouncedSearch
            ? `No expired items match "${debouncedSearch}".`
            : 'No expired items — great job managing your kitchen!'}
    </Text>
  );

  const inventoryListKey = `inventory-list-${groupFilter ?? 'all'}-${expiringSoonFilter ? 'expiring' : 'all'}`;

  const expiredListKey = `expired-list-${expiredGroupFilter ?? 'all'}`;

  // ── Render ────────────────────────────────────────────────

  const listContentStyle = useMemo(
    () => [
      styles.list,
      listItems.length === 0 && styles.listContentGrow,
      { paddingBottom: listBottomPad },
      Platform.OS === 'web' ? ({ overflowAnchor: 'none' } as const) : null,
    ],
    [listItems.length, listBottomPad],
  );

  const expiredListContentStyle = listContentStyle;

  return (
    <View style={styles.container}>
      <TabScreenHeader
        title={t('inventory.title')}
      />

      <TourTarget id={APP_TOUR_TARGET_IDS.inventoryToolbar}>
        <TabScreenToolbarRow>
          <Searchbar
            placeholder={t('inventory.searchPlaceholder')}
            value={search}
            onChangeText={setSearch}
            style={styles.searchbarInRow}
            inputStyle={styles.searchInput}
            iconColor="#2E7D32"
            elevation={2}
          />
          <Menu
            visible={addMenuVisible}
            onDismiss={() => setAddMenuVisible(false)}
            anchor={
              <IconButton
                icon="plus"
                mode="contained"
                containerColor="#2E7D32"
                iconColor="#fff"
                size={22}
                onPress={() => setAddMenuVisible(true)}
                style={styles.searchAddBtn}
                accessibilityLabel="Add inventory item"
              />
            }
            anchorPosition="bottom"
          >
            <Menu.Item
              leadingIcon="pencil-plus"
              title={t('inventory.addManually')}
              onPress={() => {
                setAddMenuVisible(false);
                setAddModalVisible(true);
              }}
            />
            <Menu.Item
              leadingIcon="camera"
              title="Scan & Add"
              onPress={() => {
                setAddMenuVisible(false);
                openScanSheet();
              }}
            />
          </Menu>
        </TabScreenToolbarRow>
      </TourTarget>

      <SegmentedButtons
        value={tab}
        onValueChange={(v) => {
          setTab(v as TabValue);
          scrollListToTop();
        }}
        buttons={[
          { value: 'all', label: 'In stock' },
          { value: 'expired', label: 'Expired' },
        ]}
        style={styles.tabs}
      />

      {tab === 'all' && (
        <View style={styles.tabBody}>
          <FilterPillRow style={styles.filterPillRow}>
            <FilterPill
              key="all"
              label={`All (${bucketCounts.active + bucketCounts.expiring})`}
              selected={groupFilter === null && !expiringSoonFilter}
              onPress={() => {
                setGroupFilter(null);
                setExpiringSoonFilter(false);
              }}
            />
            {bucketCounts.expiring > 0 ? (
              <FilterPill
                key="expiring"
                label={`Expiring Soon (${bucketCounts.expiring})`}
                selected={expiringSoonFilter}
                onPress={() => {
                  if (expiringSoonFilter) {
                    setExpiringSoonFilter(false);
                  } else {
                    setGroupFilter(null);
                    setExpiringSoonFilter(true);
                  }
                }}
              />
            ) : null}
            {groupFilterOptions.map((g) => {
              const count = groupCounts[g.id] ?? 0;
              const selected = groupFilter === g.id;
              return (
                <FilterPill
                  key={g.id}
                  label={`${foodGroupLabel(g.id, groupMeta)} (${count})`}
                  selected={selected}
                  onPress={() => {
                    if (selected) {
                      setGroupFilter(null);
                    } else {
                      setExpiringSoonFilter(false);
                      setGroupFilter(g.id);
                    }
                  }}
                />
              );
            })}
          </FilterPillRow>
          <View style={styles.carouselListSeparator} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <View style={styles.listSlot}>
            <FlatList
              key={inventoryListKey}
              ref={inventoryScrollRef}
              data={listItems}
              numColumns={INVENTORY_GRID_COLUMNS}
              keyExtractor={(item) => item.item_id}
              renderItem={renderInStockItem}
              style={styles.listFlex}
              contentContainerStyle={listContentStyle}
              columnWrapperStyle={listItems.length > 0 ? styles.gridRow : undefined}
              showsVerticalScrollIndicator={false}
              {...keyboardAwareScrollViewProps}
              scrollEnabled={listItems.length > 0 || !loading}
              onScroll={handleListScrollWeb}
              scrollEventThrottle={16}
              ListEmptyComponent={inStockEmpty}
              ListFooterComponent={listFooter}
              {...flatListProps}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            />
          </View>
        </View>
      )}

      {tab === 'expired' && (
        <View style={styles.tabBody}>
          <FilterPillRow style={styles.filterPillRow}>
            <FilterPill
              key="all"
              label={`All (${bucketCounts.expired})`}
              selected={expiredGroupFilter === null}
              onPress={() => setExpiredGroupFilter(null)}
            />
            {expiredGroupFilterOptions.map((g) => {
              const count = groupCounts[g.id] ?? 0;
              const selected = expiredGroupFilter === g.id;
              return (
                <FilterPill
                  key={g.id}
                  label={`${foodGroupLabel(g.id, groupMeta)} (${count})`}
                  selected={selected}
                  onPress={() => setExpiredGroupFilter(selected ? null : g.id)}
                />
              );
            })}
          </FilterPillRow>
          <View style={styles.carouselListSeparator} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <View style={styles.listSlot}>
            <FlatList
              key={expiredListKey}
              ref={inventoryScrollRef}
              data={listItems}
              numColumns={INVENTORY_GRID_COLUMNS}
              keyExtractor={(item) => item.item_id}
              renderItem={renderExpiredItem}
              style={styles.listFlex}
              contentContainerStyle={expiredListContentStyle}
              columnWrapperStyle={listItems.length > 0 ? styles.gridRow : undefined}
              showsVerticalScrollIndicator={false}
              {...keyboardAwareScrollViewProps}
              scrollEnabled={listItems.length > 0 || !loading}
              onScroll={handleListScrollWeb}
              scrollEventThrottle={16}
              ListEmptyComponent={expiredEmpty}
              ListFooterComponent={listFooter}
              {...flatListProps}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            />
          </View>
        </View>
      )}

      {addModalVisible ? (
        <AddInventoryModal
          visible
          onDismiss={() => setAddModalVisible(false)}
        />
      ) : null}

      {editItem ? (
        <EditInventoryItemSheet
          visible
          item={editItem}
          onDismiss={() => !editSaving && setEditItem(null)}
          onSave={handleSaveEdit}
          saving={editSaving}
        />
      ) : null}

      {scanSheetVisible ? (
        <ScanBillBottomSheet
          visible
          onDismiss={() => setScanSheetVisible(false)}
          groupMeta={groupMeta}
        />
      ) : null}

      {undoSnackbar}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  searchbarInRow: {
    flex: 1,
    minWidth: 0,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: '#fff',
  },
  searchAddBtn: {
    margin: 0,
    width: 48,
    height: 48,
    borderRadius: 14,
  },
  searchInput: {
    minHeight: 20,
  },
  tabs: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  tabBody: {
    flex: 1,
    minHeight: 0,
  },
  filterPillRow: {
    marginBottom: 0,
  },
  carouselListSeparator: {
    height: 6,
    backgroundColor: '#EBEBEB',
    marginTop: 6,
  },
  listSlot: {
    flex: 1,
    minHeight: 0,
  },
  listFlex: {
    flex: 1,
    minHeight: 0,
  },
  footerLoader: {
    marginVertical: 16,
    alignSelf: 'center',
  },
  list: {
    paddingTop: 8,
    paddingHorizontal: INVENTORY_GRID_PAD,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: INVENTORY_GRID_GAP,
  },
  gridRow: {
    columnGap: INVENTORY_GRID_GAP,
  },
  listContentGrow: {
    flexGrow: 1,
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 40,
    paddingHorizontal: 32,
  },
  // Shared modal
  modal: {
    backgroundColor: 'white',
    margin: 20,
    padding: 24,
    borderRadius: 16,
  },
  modalTitle: {
    fontWeight: 'bold',
  },
  modalDivider: {
    marginVertical: 12,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  input: {
    marginBottom: 12,
  },
  halfInput: {
    flex: 1,
  },

});
