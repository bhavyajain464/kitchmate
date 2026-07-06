import { useCallback, useEffect, useRef } from 'react';
import {
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';
import { scrollViewToTop } from './useScrollToTopOnTabFocus';

const MAX_USER_STEP = 200;

function getScrollEl(scrollRef: React.RefObject<ScrollView | null>): HTMLElement | null {
  const node = scrollRef.current as unknown as {
    getScrollableNode?: () => HTMLElement | null;
  } | null;
  return node?.getScrollableNode?.() ?? null;
}

/**
 * Web-only guard for ScrollViews inside modals/sheets. Mirrors InventoryScreen:
 * hold at the top until a real user gesture, and cancel the browser's automatic
 * scroll-restore jumps when content height grows.
 */
export function useWebScrollViewGuard(
  scrollRef: React.RefObject<ScrollView | null>,
  active: boolean,
) {
  const userScrolledRef = useRef(false);
  const intendedScrollYRef = useRef(0);

  const scrollToTop = useCallback(() => {
    scrollViewToTop(scrollRef, false);
  }, [scrollRef]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !active) return;
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
  }, [active]);

  useEffect(() => {
    if (!active) {
      userScrolledRef.current = false;
      intendedScrollYRef.current = 0;
      return;
    }
    userScrolledRef.current = false;
    intendedScrollYRef.current = 0;
    scrollToTop();
    if (Platform.OS === 'web') {
      requestAnimationFrame(() => scrollToTop());
    }
  }, [active, scrollToTop]);

  const handleContentSizeChange = useCallback(() => {
    if (Platform.OS !== 'web' || !active || userScrolledRef.current) return;
    scrollToTop();
  }, [active, scrollToTop]);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (Platform.OS !== 'web' || !active) return;
      const y = e.nativeEvent.contentOffset.y;
      if (!userScrolledRef.current) {
        scrollToTop();
        intendedScrollYRef.current = 0;
        return;
      }
      if (y - intendedScrollYRef.current > MAX_USER_STEP) {
        const el = getScrollEl(scrollRef);
        if (el) el.scrollTop = intendedScrollYRef.current;
        return;
      }
      intendedScrollYRef.current = y;
    },
    [active, scrollRef, scrollToTop],
  );

  return { handleScroll, handleContentSizeChange };
}
