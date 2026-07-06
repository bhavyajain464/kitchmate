import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  View,
  ScrollView,
  RefreshControl,
  useWindowDimensions,
  Platform,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import {
  Text,
  IconButton,
  Surface,
  Button,
  ActivityIndicator,
  Icon,
} from 'react-native-paper';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from '../navigation/types';
import * as api from '../services/api';
import { CommercePartner, OrderSuggestItem, OrderSuggestResponse, UserShoppingItem } from '../types';
import { OrderOnlineSheet } from '../components/OrderOnlineSheet';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { TabScreenHeader } from '../components/TabScreenHeader';
import { TourTarget } from '../components/tour/TourTarget';
import { useProductTour } from '../context/ProductTourContext';
import { APP_TOUR_TARGET_IDS } from '../tour/appTourSteps';
import { useTourScreenScroll } from '../hooks/useTourScreenScroll';
import { showAppError, showAppSuccess } from '../utils/alertMessage';
import { AddShoppingModal } from '../components/modals/AddShoppingModal';
import { EditShoppingItemSheet } from '../components/shopping/EditShoppingItemSheet';
import { ShoppingListItem } from '../components/shopping/ShoppingListItem';
import { SuggestOrderCarousel } from '../components/shopping/SuggestOrderCarousel';
import type { InventoryMenuAction } from '../components/inventory/InventoryItemActionsSheet';
import { useAppRefresh, refreshAppliesTo } from '../context/AppRefreshContext';
import { useUndoSnackbar } from '../hooks/useUndoSnackbar';
import { restoreListEntries } from '../utils/restoreListEntries';
import { writeOrderSuggestionsCache } from '../utils/orderSuggestionsCache';

/** Server-side suggestion pool size (matches backend OrderSuggestCacheSize). */
const SUGGEST_CACHE_SIZE = 12;
/** How many suggestions to show at once in the UI. */
const SUGGEST_DISPLAY_LIMIT = 5;

const SHOPPING_GRID_COLUMNS = 3;
const SHOPPING_GRID_GAP = 6;
const SHOPPING_GRID_PAD = 10;

type ShoppingListEntry = { item: UserShoppingItem; index: number };

type PendingShoppingBatch = {
  entries: ShoppingListEntry[];
  ids: string[];
};

export function ShoppingScreen() {
  const { t } = useTranslation();
  const { contentPaddingBottom } = useTabBarLayout();
  const { width: screenWidth } = useWindowDimensions();
  const gridCellWidth = useMemo(() => {
    const inner = screenWidth - SHOPPING_GRID_PAD * 2 - SHOPPING_GRID_GAP * (SHOPPING_GRID_COLUMNS - 1);
    return Math.floor(inner / SHOPPING_GRID_COLUMNS);
  }, [screenWidth]);

  const gridCellStyle = useMemo(
    () => ({ width: gridCellWidth, marginBottom: SHOPPING_GRID_GAP }),
    [gridCellWidth],
  );

  const [items, setItems] = useState<UserShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const { rememberTargetOffset } = useTourScreenScroll('Shopping', scrollRef);
  const { isTourActive, activeStepId, requestTargetRemeasure } = useProductTour();
  const onShoppingSuggestionsStep = isTourActive && activeStepId === 'shopping-suggestions';
  const requestGen = useRef(0);
  const nextOffsetRef = useRef(0);
  // Web: same scroll handling as Inventory. userScrolledRef gates pagination until a
  // real gesture; intendedScrollYRef lets us cancel the browser's stuck scroll-restore
  // that force-jumps the list to the bottom as content grows.
  const userScrolledRef = useRef(false);
  const intendedScrollYRef = useRef(0);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editItem, setEditItem] = useState<UserShoppingItem | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  const { showUndo, cancelCommit, undoSnackbar } = useUndoSnackbar({
    undoFailedMessage: 'Could not undo.',
  });
  const pendingShoppingDeletesRef = useRef<Map<string, PendingShoppingBatch>>(new Map());
  const pendingShoppingPurchasesRef = useRef<Map<string, PendingShoppingBatch>>(new Map());

  const [orderSuggestions, setOrderSuggestions] = useState<OrderSuggestItem[]>([]);
  const [orderSuggestFailed, setOrderSuggestFailed] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);
  const [addingSuggest, setAddingSuggest] = useState<string | null>(null);
  const [orderPartners, setOrderPartners] = useState<CommercePartner[]>([]);
  const [commerceEnabled, setCommerceEnabled] = useState(false);
  const [orderSheetVisible, setOrderSheetVisible] = useState(false);
  const lastSuggestNamesRef = useRef<string[]>([]);
  const skipMountLoadSuggestions = useRef(true);
  const skipFocusSuggestionsRef = useRef(true);
  const isFocused = useIsFocused();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList, 'Shopping'>>();
  const { version: refreshVersion, scope: refreshScope, bump } = useAppRefresh();

  const selectedList = useMemo(
    () => items.filter((i) => selectedIds[i.id]),
    [items, selectedIds],
  );

  const loadPage = useCallback(async (offset: number, append: boolean) => {
    const gen = ++requestGen.current;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      nextOffsetRef.current = 0;
    }
    try {
      const page = await api.fetchShoppingPage({ offset });
      if (gen !== requestGen.current) return;
      setItems((prev) => (append ? [...prev, ...page.items] : page.items));
      nextOffsetRef.current = offset + page.items.length;
      setHasMore(page.has_more);
    } catch {
      if (gen !== requestGen.current) return;
      if (!append) {
        setItems([]);
        setHasMore(false);
      }
    } finally {
      if (gen !== requestGen.current) return;
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Page-1 reload. Keeps the name used by refresh / focus / edit callers.
  const loadItems = useCallback(async () => {
    await loadPage(0, false);
  }, [loadPage]);

  const loadMore = useCallback(async () => {
    if (Platform.OS === 'web' && !userScrolledRef.current) return;
    if (loadingMore || !hasMore) return;
    await loadPage(nextOffsetRef.current, true);
  }, [loadingMore, hasMore, loadPage]);

  // Mark a real user gesture (web only) so pagination/scroll-restore handling can tell
  // genuine scrolling apart from the browser's automatic scroll-restore.
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

  const getScrollEl = useCallback((): HTMLElement | null => {
    const node = scrollRef.current as unknown as {
      getScrollableNode?: () => HTMLElement | null;
    } | null;
    return node?.getScrollableNode?.() ?? null;
  }, []);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      const y = contentOffset.y;
      if (Platform.OS === 'web') {
        // Hold at the top until the first real gesture (defeats restore landing us
        // mid-list on load).
        if (!userScrolledRef.current) {
          const el = getScrollEl();
          if (el) el.scrollTop = 0;
          scrollRef.current?.scrollTo({ y: 0, animated: false });
          intendedScrollYRef.current = 0;
          return;
        }
        // Cancel the browser's unsolicited large downward jumps (real scrolling moves
        // only tens of px per event; the restore jumps hundreds).
        const MAX_USER_STEP = 200;
        if (y - intendedScrollYRef.current > MAX_USER_STEP) {
          const el = getScrollEl();
          if (el) el.scrollTop = intendedScrollYRef.current;
          return;
        }
        intendedScrollYRef.current = y;
      }
      const distanceFromBottom = contentSize.height - layoutMeasurement.height - y;
      if (distanceFromBottom < layoutMeasurement.height * 0.5) {
        void loadMore();
      }
    },
    [getScrollEl, loadMore],
  );

  const applyOrderSuggestResponse = useCallback((data: OrderSuggestResponse) => {
    if (data.source === 'error') {
      setOrderSuggestions([]);
      setOrderSuggestFailed(true);
      lastSuggestNamesRef.current = [];
      return;
    }
    const pool = (Array.isArray(data.items) ? data.items : []).slice(0, SUGGEST_CACHE_SIZE);
    setOrderSuggestions(pool);
    setOrderSuggestFailed(false);
    lastSuggestNamesRef.current = pool.map((s) => s.name.trim()).filter(Boolean);
    void writeOrderSuggestionsCache({ ...data, items: pool }, lastSuggestNamesRef.current);
  }, []);

  const refillSuggestionPool = useCallback(async () => {
    setOrderLoading(true);
    try {
      const data = await api.getOrderSuggestions();
      applyOrderSuggestResponse(data);
    } catch {
      setOrderSuggestions([]);
      setOrderSuggestFailed(true);
      lastSuggestNamesRef.current = [];
    } finally {
      setOrderLoading(false);
    }
  }, [applyOrderSuggestResponse]);

  const loadOrderSuggestions = refillSuggestionPool;

  // Initial load: list first, then suggestions — one loader visible at a time.
  useEffect(() => {
    void (async () => {
      await loadItems();
      await loadOrderSuggestions();
    })();
  }, [loadItems, loadOrderSuggestions]);

  // Order suggestions refresh on return visits only (initial load is in the mount effect above).
  useFocusEffect(
    useCallback(() => {
      if (skipFocusSuggestionsRef.current) {
        skipFocusSuggestionsRef.current = false;
        return;
      }
      void loadOrderSuggestions();
    }, [loadOrderSuggestions]),
  );

  useEffect(() => {
    if (!onShoppingSuggestionsStep || orderLoading) return;
    requestTargetRemeasure(APP_TOUR_TARGET_IDS.shoppingSuggestions);
  }, [onShoppingSuggestionsStep, orderLoading, requestTargetRemeasure]);

  useEffect(() => {
    if (!isTourActive || activeStepId !== 'shopping-list' || loading) return;
    requestTargetRemeasure(APP_TOUR_TARGET_IDS.shoppingList);
  }, [activeStepId, isTourActive, loading, requestTargetRemeasure]);

  // Commerce surface is server-controlled (COMMERCE_ENABLED + partner list). Client has no store URLs.
  useEffect(() => {
    let active = true;
    void api.getCommercePartners().then((res) => {
      if (!active) return;
      const on = Boolean(res.enabled) && Array.isArray(res.partners) && res.partners.length > 0;
      setCommerceEnabled(on);
      setOrderPartners(on ? res.partners : []);
    });
    return () => {
      active = false;
    };
  }, []);

  // Reload the list only when the data actually changed (add / edit / purchase /
  // delete bump the refresh version), not on every focus. A focus toggle alone never
  // reloads, so loaded pages + scroll position persist across tab switches.
  const lastHandledRefreshRef = useRef(refreshVersion);
  useEffect(() => {
    if (!isFocused) return;
    if (refreshVersion === lastHandledRefreshRef.current) return;
    lastHandledRefreshRef.current = refreshVersion;
    if (!refreshAppliesTo(refreshScope, 'shopping')) return;
    void loadItems();
  }, [isFocused, loadItems, refreshVersion, refreshScope]);

  // Inventory or shopping list changed elsewhere while this tab is focused.
  useEffect(() => {
    if (!isFocused) return;
    if (skipMountLoadSuggestions.current) {
      skipMountLoadSuggestions.current = false;
      return;
    }
    if (!refreshAppliesTo(refreshScope, ['shopping', 'inventory'])) return;
    void loadOrderSuggestions();
  }, [isFocused, loadOrderSuggestions, refreshVersion, refreshScope]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadItems();
    await loadOrderSuggestions();
    setRefreshing(false);
  }, [loadItems, loadOrderSuggestions]);

  // Re-tapping the already-focused tab jumps back to the top and reloads page 1
  // (standard tab-bar behavior). Fires only when this tab is already active.
  useEffect(() => {
    const unsub = navigation.addListener('tabPress', () => {
      if (!navigation.isFocused()) return;
      const el = getScrollEl();
      if (el) el.scrollTop = 0;
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      void loadItems();
    });
    return unsub;
  }, [navigation, getScrollEl, loadItems]);

  const displaySuggestions = useMemo(
    () => orderSuggestions.filter((s) => s.name.trim()).slice(0, SUGGEST_DISPLAY_LIMIT),
    [orderSuggestions],
  );

  const addSuggestionToList = async (suggestion: OrderSuggestItem) => {
    const key = suggestion.name.trim().toLowerCase();
    setAddingSuggest(key);
    try {
      await api.addShoppingItem(suggestion.name, suggestion.qty, suggestion.unit);
      await loadItems();
      await refillSuggestionPool();
      showAppSuccess(`"${suggestion.name}" added to your list`);
    } catch {
      showAppError('Could not add item to list.');
    } finally {
      setAddingSuggest(null);
    }
  };

  const addAllSuggestions = async () => {
    if (displaySuggestions.length === 0) return;
    setAddingSuggest('__all__');
    try {
      await api.addBulkShoppingItems(
        displaySuggestions.map((s) => ({ name: s.name, qty: s.qty, unit: s.unit })),
      );
      await loadItems();
      await refillSuggestionPool();
      showAppSuccess(`Added ${displaySuggestions.length} item${displaySuggestions.length !== 1 ? 's' : ''} to your list`);
    } catch {
      showAppError('Could not add suggestions.');
    } finally {
      setAddingSuggest(null);
    }
  };

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds({});
  };

  const restoreShoppingEntries = useCallback((entries: ShoppingListEntry[]) => {
    setItems((prev) => restoreListEntries(prev, entries, (i) => i.id));
  }, []);

  const captureShoppingEntries = useCallback((ids: string[]) => {
    let entries: ShoppingListEntry[] = [];
    setItems((prev) => {
      entries = ids
        .map((id) => {
          const index = prev.findIndex((i) => i.id === id);
          const item = prev[index];
          return index >= 0 && item ? { item, index } : null;
        })
        .filter((x): x is ShoppingListEntry => x != null);
      if (entries.length === 0) return prev;
      const idSet = new Set(ids);
      return prev.filter((i) => !idSet.has(i.id));
    });
    return entries;
  }, []);

  const commitShoppingDelete = useCallback((batchId: string) => {
    const pending = pendingShoppingDeletesRef.current.get(batchId);
    if (!pending) return;
    pendingShoppingDeletesRef.current.delete(batchId);
    void api.bulkDeleteShoppingItems(pending.ids).then(() => {
      bump('shopping');
    }).catch(() => {
      restoreShoppingEntries(pending.entries);
      showAppError('Could not remove items.');
    });
  }, [restoreShoppingEntries, bump]);

  const commitShoppingPurchase = useCallback(
    (batchId: string) => {
      const pending = pendingShoppingPurchasesRef.current.get(batchId);
      if (!pending) return;
      pendingShoppingPurchasesRef.current.delete(batchId);
      void api.purchaseShoppingItems(pending.ids).then(() => {
        bump('shopping');
      }).catch(() => {
        restoreShoppingEntries(pending.entries);
        showAppError('Could not add to inventory.');
      });
    },
    [restoreShoppingEntries, bump],
  );

  const flushPendingShoppingDeletes = useCallback(() => {
    const batchIds = [...pendingShoppingDeletesRef.current.keys()];
    if (batchIds.length === 0) return;
    batchIds.forEach((batchId) => commitShoppingDelete(batchId));
    cancelCommit();
  }, [commitShoppingDelete, cancelCommit]);

  const flushPendingShoppingPurchases = useCallback(() => {
    const batchIds = [...pendingShoppingPurchasesRef.current.keys()];
    if (batchIds.length === 0) return;
    batchIds.forEach((batchId) => commitShoppingPurchase(batchId));
    cancelCommit();
  }, [commitShoppingPurchase, cancelCommit]);

  const flushPendingShoppingActions = useCallback(() => {
    flushPendingShoppingDeletes();
    flushPendingShoppingPurchases();
  }, [flushPendingShoppingDeletes, flushPendingShoppingPurchases]);

  const scheduleRemoveFromList = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;

      flushPendingShoppingActions();

      const batchId = `${Date.now()}-del-${ids.join(',')}`;
      const entries = captureShoppingEntries(ids);

      if (entries.length === 0) return;

      exitSelection();

      const idsToDelete = entries.map((e) => e.item.id);
      pendingShoppingDeletesRef.current.set(batchId, {
        entries,
        ids: idsToDelete,
      });

      const msg =
        entries.length === 1
          ? `"${entries[0].item.name}" removed.`
          : `${entries.length} items removed.`;

      showUndo(
        msg,
        async () => {
          const pending = pendingShoppingDeletesRef.current.get(batchId);
          if (!pending) return;
          pendingShoppingDeletesRef.current.delete(batchId);
          restoreShoppingEntries(pending.entries);
        },
        () => commitShoppingDelete(batchId),
      );
    },
    [
      flushPendingShoppingActions,
      captureShoppingEntries,
      commitShoppingDelete,
      showUndo,
      restoreShoppingEntries,
    ],
  );

  const scheduleAddToInventory = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;

      flushPendingShoppingActions();

      const batchId = `${Date.now()}-buy-${ids.join(',')}`;
      const entries = captureShoppingEntries(ids);

      if (entries.length === 0) return;

      exitSelection();

      const idsToPurchase = entries.map((e) => e.item.id);
      pendingShoppingPurchasesRef.current.set(batchId, {
        entries,
        ids: idsToPurchase,
      });

      const msg =
        entries.length === 1
          ? `"${entries[0].item.name}" added to inventory`
          : `${entries.length} items added to inventory`;

      showUndo(
        msg,
        async () => {
          const pending = pendingShoppingPurchasesRef.current.get(batchId);
          if (!pending) return;
          pendingShoppingPurchasesRef.current.delete(batchId);
          restoreShoppingEntries(pending.entries);
        },
        () => commitShoppingPurchase(batchId),
      );
    },
    [
      flushPendingShoppingActions,
      captureShoppingEntries,
      commitShoppingPurchase,
      showUndo,
      restoreShoppingEntries,
    ],
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  };

  const selectAll = () => {
    const next: Record<string, boolean> = {};
    items.forEach((i) => {
      next[i.id] = true;
    });
    setSelectedIds(next);
  };

  const openAddModal = () => {
    setAddModalVisible(true);
  };

  const openEditItem = useCallback((item: UserShoppingItem) => {
    setEditItem(item);
  }, []);

  const buildShoppingMenu = useCallback(
    (item: UserShoppingItem): InventoryMenuAction[] => [
      {
        key: 'edit',
        label: 'Edit',
        icon: 'pencil-outline',
        onPress: () => openEditItem(item),
      },
      {
        key: 'inventory',
        label: 'Add to inventory',
        icon: 'fridge-outline',
        onPress: () => scheduleAddToInventory([item.id]),
      },
      {
        key: 'remove',
        label: 'Remove from list',
        icon: 'delete-outline',
        destructive: true,
        onPress: () => scheduleRemoveFromList([item.id]),
      },
    ],
    [openEditItem, scheduleAddToInventory, scheduleRemoveFromList],
  );

  const handleSaveEdit = async (patch: { name: string; qty: number; unit: string }) => {
    if (!editItem) return;
    setEditSaving(true);
    try {
      const updated = await api.updateShoppingItem(editItem.id, patch);
      setItems((prev) => prev.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));
      setEditItem(null);
      showAppSuccess('Shopping list updated');
      bump('shopping');
    } catch {
      showAppError('Could not update item.');
    } finally {
      setEditSaving(false);
    }
  };

  const renderItem = (item: UserShoppingItem, idx: number) => {
    const selected = Boolean(selectedIds[item.id]);

    return (
      <View key={item.id} style={gridCellStyle}>
        <ShoppingListItem
          variant="grid"
          item={item}
          index={idx}
          selectionMode={selectionMode}
          selected={selected}
          menuActions={buildShoppingMenu(item)}
          onToggleSelect={() => toggleSelect(item.id)}
          onEnterSelection={() => {
            setSelectionMode(true);
            setSelectedIds({ [item.id]: true });
          }}
        />
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <TabScreenHeader
        title={t('shopping.title')}
      />
      <ScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: contentPaddingBottom(selectionMode ? 88 : 24) },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        <TourTarget
          id={APP_TOUR_TARGET_IDS.shoppingSuggestions}
          onLayoutY={(y) => rememberTargetOffset(APP_TOUR_TARGET_IDS.shoppingSuggestions, y)}
        >
        <Surface style={styles.suggestCard} elevation={0}>
          <View style={styles.suggestHeader}>
            <View style={styles.suggestTitleRow}>
              <View style={styles.suggestIconWrap}>
                <Icon source="lightbulb-on-outline" size={17} color="#81C784" />
              </View>
              <View style={styles.suggestTitleText}>
                <Text variant="labelLarge" style={styles.suggestTitle}>
                  Suggested to order
                  {displaySuggestions.length > 0 ? ` (${displaySuggestions.length})` : ''}
                </Text>
              </View>
            </View>
            {displaySuggestions.length > 1 ? (
              <Button
                mode="text"
                icon="cart-plus"
                compact
                onPress={() => void addAllSuggestions()}
                loading={addingSuggest === '__all__'}
                disabled={addingSuggest != null || orderLoading}
                style={styles.suggestAddAllHeader}
                labelStyle={styles.suggestAddAllLabel}
                textColor="#81C784"
              >
                Add all
              </Button>
            ) : null}
          </View>

          {loading ? null : orderLoading ? (
            <ActivityIndicator style={styles.suggestLoader} size="small" color="#2E7D32" />
          ) : displaySuggestions.length > 0 ? (
            <SuggestOrderCarousel
              suggestions={displaySuggestions}
              addingKey={addingSuggest}
              onAdd={addSuggestionToList}
            />
          ) : (
            <Text variant="bodySmall" style={styles.suggestEmpty}>
              {orderSuggestFailed
                ? 'Suggestions unavailable right now.'
                : orderSuggestions.length > 0
                  ? 'All suggested items are already on your list or in your pantry.'
                  : 'Nothing to suggest right now.'}
            </Text>
          )}
        </Surface>
        </TourTarget>

        <TourTarget
          id={APP_TOUR_TARGET_IDS.shoppingList}
          onLayoutY={(y) => rememberTargetOffset(APP_TOUR_TARGET_IDS.shoppingList, y)}
        >
        <Text variant="labelLarge" style={styles.listSectionTitle}>Your list</Text>

        {!loading ? (
          <View style={styles.listToolbar}>
            <View style={styles.listToolbarLeft}>
              {items.length > 0 ? (
                selectionMode ? (
                  <>
                    <Button mode="text" compact onPress={exitSelection}>
                      Cancel
                    </Button>
                    <Button mode="text" compact onPress={selectAll}>
                      All
                    </Button>
                  </>
                ) : (
                  <Button
                    mode="text"
                    compact
                    icon="checkbox-multiple-marked"
                    onPress={() => setSelectionMode(true)}
                  >
                    Select
                  </Button>
                )
              ) : null}
            </View>
            {!selectionMode ? (
              <Button
                mode="contained"
                onPress={openAddModal}
                buttonColor="#2E7D32"
                style={styles.listAddBtn}
                contentStyle={styles.listAddBtnContent}
                labelStyle={styles.listAddBtnLabel}
              >
                Add
              </Button>
            ) : null}
          </View>
        ) : null}

        {!loading && items.length > 0 && !selectionMode && commerceEnabled ? (
          <Button
            mode="contained-tonal"
            icon="cart-arrow-right"
            onPress={() => setOrderSheetVisible(true)}
            style={styles.orderOnlineBtn}
            textColor="#1B5E20"
          >
            Order this list online
          </Button>
        ) : null}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} size="large" />
        ) : items.length > 0 ? (
          <View style={styles.listWrap}>
            <View style={styles.grid}>
              {items.map(renderItem)}
            </View>
            {loadingMore ? (
              <ActivityIndicator color="#2E7D32" style={styles.footerLoader} />
            ) : null}
          </View>
        ) : (
          <Surface style={styles.emptyCard} elevation={1}>
            <IconButton icon="cart-outline" iconColor="#2E7D32" size={44} style={{ margin: 0 }} />
            <Text variant="titleMedium" style={styles.emptyTitle}>Your list is empty</Text>
            <Text variant="bodyMedium" style={styles.emptySub}>
              Tap <Text style={styles.emptyAddHint}>Add</Text> on the right to build your list. When you buy
              something, move it to inventory — we&apos;ll estimate expiry for you.
            </Text>
          </Surface>
        )}
        </TourTarget>

        <View style={{ height: 32 }} />
      </ScrollView>

      {selectionMode && selectedList.length > 0 ? (
        <Surface
          style={[styles.selectionBar, { paddingBottom: contentPaddingBottom(8) }]}
          elevation={4}
        >
          <Text variant="labelLarge" style={styles.selectionCount}>
            {selectedList.length} selected
          </Text>
          <View style={styles.selectionActions}>
            <Button
              mode="contained"
              icon="fridge-outline"
              onPress={() => scheduleAddToInventory(selectedList.map((i) => i.id))}
              buttonColor="#2E7D32"
              compact
            >
              To inventory
            </Button>
            <Button
              mode="outlined"
              icon="delete-outline"
              textColor="#F44336"
              onPress={() => scheduleRemoveFromList(selectedList.map((i) => i.id))}
              compact
            >
              Remove
            </Button>
          </View>
        </Surface>
      ) : null}

      <AddShoppingModal
        visible={addModalVisible}
        onDismiss={() => setAddModalVisible(false)}
      />

      <EditShoppingItemSheet
        visible={editItem !== null}
        item={editItem}
        onDismiss={() => !editSaving && setEditItem(null)}
        onSave={handleSaveEdit}
        saving={editSaving}
      />

      <OrderOnlineSheet
        visible={orderSheetVisible}
        onClose={() => setOrderSheetVisible(false)}
        items={items}
        partners={orderPartners}
        source="shopping_list"
      />

      {undoSnackbar}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
  container: { flex: 1 },
  scrollContent: { paddingBottom: 24 },

  suggestCard: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 14,
    backgroundColor: '#FCFDFC',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(129, 199, 132, 0.2)',
  },
  suggestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 6,
  },
  suggestTitleRow: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 5, minWidth: 0 },
  suggestIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F1F8F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestTitleText: { flex: 1 },
  suggestTitle: { fontWeight: '600', color: '#5A5A5A', fontSize: 13 },
  suggestLoader: { marginVertical: 8 },
  suggestAddAllHeader: { borderRadius: 8, flexShrink: 0, marginRight: -4 },
  suggestAddAllLabel: { fontSize: 12, fontWeight: '600', marginVertical: 0 },
  suggestEmpty: { color: '#999', marginTop: 4, lineHeight: 18 },
  listSectionTitle: {
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 0,
    color: '#1A1A1A',
    fontWeight: '700',
  },
  listToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 4,
    minHeight: 44,
  },
  listToolbarLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  listAddBtn: {
    borderRadius: 10,
    minWidth: 96,
    alignSelf: 'center',
  },
  listAddBtnContent: {
    height: 40,
    paddingHorizontal: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listAddBtnLabel: {
    fontWeight: '700',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0,
    marginVertical: 0,
    marginHorizontal: 0,
    textAlign: 'center',
    includeFontPadding: false,
  },

  listWrap: { paddingHorizontal: SHOPPING_GRID_PAD, marginTop: 8 },
  footerLoader: { marginVertical: 16, alignSelf: 'center' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: SHOPPING_GRID_GAP,
  },
  orderOnlineBtn: { marginTop: 4, marginBottom: 8, marginHorizontal: 20, borderRadius: 12 },

  selectionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  selectionCount: { color: '#333', marginBottom: 8 },
  selectionActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },

  emptyCard: {
    marginHorizontal: 20,
    marginTop: 24,
    borderRadius: 20,
    backgroundColor: '#fff',
    padding: 32,
    alignItems: 'center',
  },
  emptyTitle: { fontWeight: '700', color: '#555', marginTop: 12 },
  emptySub: { color: '#999', marginTop: 6, textAlign: 'center', lineHeight: 20 },
  emptyAddHint: { fontWeight: '700', color: '#2E7D32' },
});
