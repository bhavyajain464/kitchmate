import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  Platform,
  type FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

const END_REACHED_THRESHOLD = 0.35;
const MAX_USER_STEP = 200;

export function getListScrollElement<T>(listRef: RefObject<FlatList<T> | null>): HTMLElement | null {
  const node = listRef.current as unknown as {
    getScrollableNode?: () => HTMLElement | null;
  } | null;
  return node?.getScrollableNode?.() ?? null;
}

/** Scroll a FlatList to the top (Instagram always opens at the top of the feed). */
export function scrollFlatListToTop<T>(listRef: RefObject<FlatList<T> | null>) {
  listRef.current?.scrollToOffset({ offset: 0, animated: false });
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const el = getListScrollElement(listRef);
    if (el) el.scrollTop = 0;
  }
}

type Options<T = unknown> = {
  onLoadMore: () => void | Promise<void>;
  hasMore: boolean;
  loading?: boolean;
  loadingMore?: boolean;
};

/**
 * Instagram-style FlatList pagination: load the next page only when the user
 * scrolls near the bottom. Uses the standard momentum guard so onEndReached
 * does not fire on mount or after programmatic scroll-to-top.
 */
export function useFlatListOnEndReached<T = unknown>({
  onLoadMore,
  hasMore,
  loading = false,
  loadingMore = false,
}: Options<T>) {
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const loadingMoreRef = useRef(loadingMore);
  loadingMoreRef.current = loadingMore;

  const blockedDuringMomentumRef = useRef(true);
  const fetchingRef = useRef(false);

  const resetEndReached = useCallback(() => {
    blockedDuringMomentumRef.current = true;
    fetchingRef.current = false;
  }, []);

  const handleEndReached = useCallback(() => {
    if (blockedDuringMomentumRef.current) return;
    if (!hasMoreRef.current || loadingRef.current || loadingMoreRef.current || fetchingRef.current) {
      return;
    }

    blockedDuringMomentumRef.current = true;
    fetchingRef.current = true;
    void Promise.resolve(onLoadMoreRef.current()).finally(() => {
      fetchingRef.current = false;
    });
  }, []);

  const flatListProps = {
    onEndReachedThreshold: END_REACHED_THRESHOLD,
    onEndReached: handleEndReached,
    onMomentumScrollBegin: () => {
      blockedDuringMomentumRef.current = false;
    },
    onScrollBeginDrag: () => {
      blockedDuringMomentumRef.current = false;
    },
  };

  return { flatListProps, resetEndReached };
}

/**
 * Web FlatList scroll handling (same pattern as InventoryScreen):
 * defeat browser scroll-restore, gate pagination until a real gesture, and
 * load more from scroll position when onEndReached does not fire on wheel.
 */
export function useWebFlatListScroll<T>(
  listRef: RefObject<FlatList<T> | null>,
  onLoadMore: () => void | Promise<void>,
) {
  const userScrolledRef = useRef(false);
  const intendedScrollYRef = useRef(0);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const prev = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = prev;
    };
  }, []);

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

  const resetUserScroll = useCallback(() => {
    userScrolledRef.current = false;
    intendedScrollYRef.current = 0;
  }, []);

  const allowLoadMore = useCallback(() => {
    if (Platform.OS === 'web' && !userScrolledRef.current) return false;
    return true;
  }, []);

  const handleListScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (Platform.OS !== 'web') return;
      if (!userScrolledRef.current) {
        scrollFlatListToTop(listRef);
        intendedScrollYRef.current = 0;
        return;
      }
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      const y = contentOffset.y;
      if (y - intendedScrollYRef.current > MAX_USER_STEP) {
        const el = getListScrollElement(listRef);
        if (el) el.scrollTop = intendedScrollYRef.current;
        return;
      }
      intendedScrollYRef.current = y;
      const distanceFromBottom = contentSize.height - layoutMeasurement.height - y;
      if (distanceFromBottom < layoutMeasurement.height * 0.5) {
        void onLoadMoreRef.current();
      }
    },
    [listRef],
  );

  return { handleListScroll, allowLoadMore, resetUserScroll };
}

/** Web-only contentContainerStyle helper for paginated FlatLists. */
export function webFlatListContentStyle(
  base: object,
  itemCount: number,
): object[] {
  return [
    base,
    itemCount === 0 ? { flexGrow: 1 } : null,
    Platform.OS === 'web' ? ({ overflowAnchor: 'none' } as const) : null,
  ].filter(Boolean) as object[];
}
