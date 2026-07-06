import { useCallback, useEffect, useRef } from 'react';
import { Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProductTour } from '../context/ProductTourContext';
import type { TourTab } from '../tour/appTourSteps';
import { APP_TOUR_TARGET_IDS } from '../tour/appTourSteps';
import { FIXED_TAB_HEADER_BODY } from '../tour/measureTargetRect';

const TAB_BAR_ESTIMATE = 100;
const TARGET_HEIGHT_ESTIMATE = 140;

type TourScreenScrollOptions = {
  /** Extra pinned UI below the green header (e.g. Cook composer, Meals tab bar). */
  fixedChromeExtra?: number;
};

function scrollListToY(scrollRef: React.RefObject<any>, y: number) {
  const node = scrollRef.current;
  if (!node) return;

  if (typeof node.scrollToOffset === 'function') {
    node.scrollToOffset({ offset: y, animated: false });
    return;
  }

  node.scrollTo?.({ y, animated: false });
}

function waitFrames(count = 2): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function useTourScreenScroll(
  tab: TourTab,
  scrollRef?: React.RefObject<any>,
  options?: TourScreenScrollOptions,
) {
  const insets = useSafeAreaInsets();
  const fixedChromeExtra = options?.fixedChromeExtra ?? 0;
  const targetScrollOffsets = useRef<Record<string, number>>({});
  const { registerScrollToTarget } = useProductTour();

  const rememberTargetOffset = useCallback((targetId: string, y: number) => {
    targetScrollOffsets.current[targetId] = y;
  }, []);

  const scrollToTarget = useCallback(
    async (targetId: string) => {
      if (!scrollRef?.current) {
        await waitFrames(1);
        return;
      }

      const scrollToY = (y: number) => {
        scrollListToY(scrollRef, y);
      };

      if (
        targetId === APP_TOUR_TARGET_IDS.profile ||
        targetId === APP_TOUR_TARGET_IDS.inventoryToolbar ||
        targetId === APP_TOUR_TARGET_IDS.cookComposer ||
        targetId === APP_TOUR_TARGET_IDS.cookRecipesList ||
        targetId === APP_TOUR_TARGET_IDS.mealsWeekPlan ||
        targetId === APP_TOUR_TARGET_IDS.shoppingSuggestions
      ) {
        scrollToY(0);
        await waitFrames(2);
        return;
      }

      const offset = targetScrollOffsets.current[targetId];
      if (offset == null) {
        scrollToY(0);
        await waitFrames(1);
        return;
      }

      const viewportH = Dimensions.get('window').height;
      const fixedHeaderHeight = insets.top + FIXED_TAB_HEADER_BODY + fixedChromeExtra;
      const scrollViewportH = viewportH - TAB_BAR_ESTIMATE - fixedHeaderHeight;
      const targetScreenTop = fixedHeaderHeight + offset;

      if (targetScreenTop + TARGET_HEIGHT_ESTIMATE <= viewportH - TAB_BAR_ESTIMATE) {
        scrollToY(0);
      } else {
        scrollToY(Math.max(0, offset - scrollViewportH * 0.35));
      }

      await waitFrames(2);
    },
    [fixedChromeExtra, insets.top, scrollRef],
  );

  useEffect(() => {
    registerScrollToTarget(tab, scrollToTarget);
    return () => registerScrollToTarget(tab, null);
  }, [registerScrollToTarget, scrollToTarget, tab]);

  return { rememberTargetOffset };
}
