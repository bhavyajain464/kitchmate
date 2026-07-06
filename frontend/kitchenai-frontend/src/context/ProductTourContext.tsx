import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { InteractionManager, StyleSheet, View } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { ProductTourOverlay } from '../components/tour/ProductTourOverlay';
import { APP_TOUR_STEPS, APP_TOUR_TARGET_IDS, type AppTourStep, type TourTab } from '../tour/appTourSteps';
import { isValidTargetRect, type TargetRect } from '../tour/measureTargetRect';
import { isAppTourCompleted, markAppTourCompleted } from '../utils/productTourStorage';
import { navigationRef } from '../navigation/AppNavigator';

export type { TargetRect };

type MeasureTarget = () => Promise<TargetRect | null>;

type ScrollToTargetFn = (targetId: string) => Promise<void>;

type StartTourOptions = {
  force?: boolean;
};

type ProductTourContextValue = {
  overlayHostRef: RefObject<View | null>;
  registerTarget: (id: string, measure: MeasureTarget) => void;
  unregisterTarget: (id: string) => void;
  registerScrollToTarget: (tab: TourTab, fn: ScrollToTargetFn | null) => void;
  startTour: (tourId?: 'app' | 'home', options?: StartTourOptions) => Promise<void>;
  requestAutoStartTour: () => void;
  setExpiryStepBody: (hasExpiryAlerts: boolean) => void;
  requestTargetRemeasure: (targetId: string) => void;
  isTourActive: boolean;
  activeTargetId: string | null;
  activeStepId: string | null;
};

/** Loaded week-plan carousel is taller than the loading placeholder. */
const MEALS_WEEK_PLAN_MIN_HEIGHT = 140;
/** Recipes list grows after the first page loads. */
const COOK_RECIPES_LIST_MIN_HEIGHT = 120;

const ProductTourContext = createContext<ProductTourContextValue | null>(null);

type ProductTourProviderProps = {
  children: React.ReactNode;
  paywallVisible: boolean;
};

function tourLog(message: string, detail?: unknown) {
  if (detail !== undefined) {
    console.warn(`[product-tour] ${message}`, detail);
    return;
  }
  console.warn(`[product-tour] ${message}`);
}

async function waitUntilNavigationReady(timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (navigationRef.isReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return navigationRef.isReady();
}

function getTopRouteName(): string | undefined {
  if (!navigationRef.isReady()) return undefined;
  const current = navigationRef.getCurrentRoute();
  if (current?.name) return current.name;
  const state = navigationRef.getState();
  if (!state?.routes?.length) return undefined;
  return state.routes[state.index ?? 0]?.name;
}

function getCurrentTab(): TourTab | null {
  if (!navigationRef.isReady()) return null;
  const state = navigationRef.getState();
  if (!state?.routes?.length) return null;
  const mainRoute = state.routes[state.index ?? 0];
  if (!mainRoute || mainRoute.name !== 'MainTabs') return null;
  const tabState = mainRoute.state;
  if (!tabState?.routes?.length || tabState.index == null) return 'Home';
  const tabRoute = tabState.routes[tabState.index];
  return (tabRoute?.name as TourTab) ?? 'Home';
}

async function navigateToTab(tab: TourTab): Promise<void> {
  if (!(await waitUntilNavigationReady())) {
    tourLog('navigateToTab skipped — navigation not ready', tab);
    return;
  }
  const current = getCurrentTab();
  if (current === tab) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    return;
  }

  switch (tab) {
    case 'Home':
      navigationRef.navigate('MainTabs', { screen: 'Home' });
      break;
    case 'Inventory':
      navigationRef.navigate('MainTabs', { screen: 'Inventory', params: {} });
      break;
    case 'Meals':
      navigationRef.navigate('MainTabs', { screen: 'Meals', params: {} });
      break;
    case 'Cook':
      navigationRef.navigate('MainTabs', { screen: 'Cook', params: {} });
      break;
    case 'Shopping':
      navigationRef.navigate('MainTabs', { screen: 'Shopping' });
      break;
  }

  await new Promise((resolve) => setTimeout(resolve, tab === 'Home' ? 420 : 560));
}

async function ensureTourStartsOnHome(
  scrollHandlers: Map<TourTab, ScrollToTargetFn>,
): Promise<void> {
  const ready = await waitUntilNavigationReady();
  if (!ready) {
    tourLog('ensureTourStartsOnHome — navigation not ready, continuing on current screen');
    return;
  }

  const topName = getTopRouteName();
  tourLog('ensureTourStartsOnHome', { topName });

  try {
    if (topName === 'Profile') {
      navigationRef.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [
            {
              name: 'MainTabs',
              state: {
                index: 0,
                routes: [{ name: 'Home' }],
              },
            },
          ],
        }),
      );
    } else {
      navigationRef.navigate('MainTabs', { screen: 'Home' });
    }
  } catch (err) {
    tourLog('ensureTourStartsOnHome navigation failed', err);
  }

  await new Promise((resolve) => setTimeout(resolve, 420));

  const homeScroll = scrollHandlers.get('Home');
  if (homeScroll) {
    try {
      await homeScroll(APP_TOUR_TARGET_IDS.profile);
    } catch (err) {
      tourLog('ensureTourStartsOnHome scroll failed', err);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 150));
}

export function ProductTourProvider({ children, paywallVisible }: ProductTourProviderProps) {
  const overlayHostRef = useRef<View>(null);
  const targetsRef = useRef<Map<string, MeasureTarget>>(new Map());
  const scrollHandlersRef = useRef<Map<TourTab, ScrollToTargetFn>>(new Map());
  const pendingAutoStartRef = useRef(false);
  const pendingStartOptionsRef = useRef<StartTourOptions | undefined>(undefined);
  const measureGenerationRef = useRef(0);

  const [visible, setVisible] = useState(false);
  const [stepReady, setStepReady] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [dynamicStepBodies, setDynamicStepBodies] = useState<Record<string, string>>({});

  const steps = APP_TOUR_STEPS;
  const currentStep: AppTourStep | null = visible ? steps[stepIndex] ?? null : null;

  const resolveTargetId = useCallback((step: AppTourStep): string | null => {
    if (!step.targetId) return null;
    if (targetsRef.current.has(step.targetId)) return step.targetId;
    if (step.fallbackTargetId && targetsRef.current.has(step.fallbackTargetId)) {
      return step.fallbackTargetId;
    }
    return step.targetId;
  }, []);

  const activeTargetId = currentStep ? resolveTargetId(currentStep) : null;
  const activeStepId = currentStep?.id ?? null;

  const waitForTargetRegistration = useCallback(async (
    targetId: string,
    generation: number,
    tab: TourTab,
  ) => {
    const attempts = tab === 'Home' ? 24 : 40;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (generation !== measureGenerationRef.current) return false;
      if (targetsRef.current.has(targetId)) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return targetsRef.current.has(targetId);
  }, []);

  const measureTarget = useCallback(async (targetId: string | null): Promise<TargetRect | null> => {
    if (!targetId) return null;
    const measure = targetsRef.current.get(targetId);
    if (!measure) return null;

    await new Promise<void>((resolve) => {
      InteractionManager.runAfterInteractions(() => resolve());
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 40 * attempt));
      }

      const rect = await measure();
      if (rect && rect.width >= 8 && rect.height >= 8) {
        return rect;
      }
    }

    return measure();
  }, []);

  const settleTargetRect = useCallback(async (
    targetId: string,
    generation: number,
  ): Promise<TargetRect | null> => {
    const isWeekPlan = targetId === APP_TOUR_TARGET_IDS.mealsWeekPlan;
    const isCookRecipesList = targetId === APP_TOUR_TARGET_IDS.cookRecipesList;
    const isAnimatedTarget = isWeekPlan || isCookRecipesList;
    const attempts = isAnimatedTarget ? 16 : 1;
    const delayMs = isAnimatedTarget ? 75 : 0;
    const minHeight = isWeekPlan
      ? MEALS_WEEK_PLAN_MIN_HEIGHT
      : isCookRecipesList
        ? COOK_RECIPES_LIST_MIN_HEIGHT
        : 0;
    let best: TargetRect | null = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (generation !== measureGenerationRef.current) return best;

      const rect = await measureTarget(targetId);
      if (isValidTargetRect(rect)) {
        if (!best || rect.height >= best.height) {
          best = rect;
        }
        if (isAnimatedTarget && rect.height >= minHeight) {
          break;
        }
      }

      if (attempt < attempts - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return best;
  }, [measureTarget]);

  const requestTargetRemeasure = useCallback((targetId: string) => {
    if (!visible || activeTargetId !== targetId || !stepReady) return;

    const generation = measureGenerationRef.current;
    void (async () => {
      const rect = await settleTargetRect(targetId, generation);
      if (generation !== measureGenerationRef.current) return;
      if (isValidTargetRect(rect)) {
        setTargetRect(rect);
      }
    })();
  }, [activeTargetId, settleTargetRect, stepReady, visible]);

  const refreshTargetRect = useCallback(async (index: number) => {
    const generation = ++measureGenerationRef.current;
    setStepReady(false);
    setTargetRect(null);

    const step = steps[index];
    if (!step) {
      setStepReady(true);
      return;
    }

    await navigateToTab(step.tab);
    if (generation !== measureGenerationRef.current) return;

    const targetId = resolveTargetId(step);
    if (!targetId) {
      setStepReady(true);
      return;
    }

    const registered = await waitForTargetRegistration(targetId, generation, step.tab);
    if (generation !== measureGenerationRef.current) return;

    const scrollFn = scrollHandlersRef.current.get(step.tab);
    if (scrollFn && registered) {
      await scrollFn(targetId);
    }
    if (generation !== measureGenerationRef.current) return;

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    let rect = registered ? await settleTargetRect(targetId, generation) : null;
    if ((!rect || !isValidTargetRect(rect)) && step.fallbackTargetId) {
      await waitForTargetRegistration(step.fallbackTargetId, generation, step.tab);
      rect = await settleTargetRect(step.fallbackTargetId, generation);
    }
    if (generation !== measureGenerationRef.current) return;

    setTargetRect(isValidTargetRect(rect) ? rect : null);
    setStepReady(true);
    tourLog('step ready', { stepId: step.id, targetId, hasRect: isValidTargetRect(rect) });
  }, [resolveTargetId, settleTargetRect, steps, waitForTargetRegistration]);

  const finishTour = useCallback(async () => {
    setVisible(false);
    setStepReady(false);
    setStepIndex(0);
    setTargetRect(null);
    await navigateToTab('Home');
    await markAppTourCompleted();
  }, []);

  const startTourInternal = useCallback(async (options?: StartTourOptions) => {
    if (!options?.force) {
      const completed = await isAppTourCompleted();
      if (completed) {
        tourLog('start skipped — tour already completed (use force to replay)');
        return;
      }
    }

    tourLog('starting tour', { force: Boolean(options?.force) });
    await ensureTourStartsOnHome(scrollHandlersRef.current);

    setDynamicStepBodies({});
    setStepIndex(0);
    setTargetRect(null);
    setStepReady(false);
    setVisible(true);
  }, []);

  const startTour = useCallback(async (_tourId?: 'app' | 'home', options?: StartTourOptions) => {
    if (paywallVisible && !options?.force) {
      tourLog('start deferred — paywall visible');
      pendingAutoStartRef.current = true;
      pendingStartOptionsRef.current = options;
      return;
    }
    await startTourInternal(options);
  }, [paywallVisible, startTourInternal]);

  const requestAutoStartTour = useCallback(() => {
    pendingAutoStartRef.current = true;
    void startTour('app');
  }, [startTour]);

  useEffect(() => {
    if (paywallVisible || !pendingAutoStartRef.current) return;
    pendingAutoStartRef.current = false;
    const options = pendingStartOptionsRef.current;
    pendingStartOptionsRef.current = undefined;
    void startTourInternal(options);
  }, [paywallVisible, startTourInternal]);

  useEffect(() => {
    if (!visible) return;
    void refreshTargetRect(stepIndex);
  }, [stepIndex, visible, refreshTargetRect]);

  const setExpiryStepBody = useCallback((hasExpiryAlerts: boolean) => {
    setDynamicStepBodies((prev) => {
      const body = hasExpiryAlerts
        ? 'Expired and expiring items show up here — tap to reorder or use them before they go bad.'
        : 'Your pantry summary lives here. Add items or scan a bill from Inventory.';
      if (prev.expiry === body) return prev;
      return { ...prev, expiry: body };
    });
  }, []);

  const registerTarget = useCallback((id: string, measure: MeasureTarget) => {
    targetsRef.current.set(id, measure);
    if (!visible || activeTargetId !== id || !stepReady) return;

    const generation = measureGenerationRef.current;
    void (async () => {
      const rect = await measureTarget(id);
      if (generation !== measureGenerationRef.current) return;
      if (isValidTargetRect(rect)) {
        setTargetRect(rect);
      }
    })();
  }, [activeTargetId, measureTarget, stepReady, visible]);

  const unregisterTarget = useCallback((id: string) => {
    targetsRef.current.delete(id);
  }, []);

  const registerScrollToTarget = useCallback((tab: TourTab, fn: ScrollToTargetFn | null) => {
    if (fn) {
      scrollHandlersRef.current.set(tab, fn);
    } else {
      scrollHandlersRef.current.delete(tab);
    }
  }, []);

  const nextStep = useCallback(async () => {
    if (stepIndex >= steps.length - 1) {
      await finishTour();
      return;
    }
    setStepIndex(stepIndex + 1);
  }, [finishTour, stepIndex, steps.length]);

  const skipTour = useCallback(async () => {
    await finishTour();
  }, [finishTour]);

  const overlayStep = useMemo(() => {
    if (!currentStep) return null;
    const bodyOverride = dynamicStepBodies[currentStep.id];
    if (!bodyOverride) return currentStep;
    return { ...currentStep, body: bodyOverride };
  }, [currentStep, dynamicStepBodies]);

  const value = useMemo<ProductTourContextValue>(
    () => ({
      overlayHostRef,
      registerTarget,
      unregisterTarget,
      registerScrollToTarget,
      startTour,
      requestAutoStartTour,
      setExpiryStepBody,
      requestTargetRemeasure,
      isTourActive: visible,
      activeTargetId,
      activeStepId,
    }),
    [
      activeStepId,
      activeTargetId,
      registerScrollToTarget,
      registerTarget,
      requestAutoStartTour,
      requestTargetRemeasure,
      setExpiryStepBody,
      startTour,
      unregisterTarget,
      visible,
    ],
  );

  return (
    <ProductTourContext.Provider value={value}>
      <View ref={overlayHostRef} style={styles.host} collapsable={false}>
        {children}
        <ProductTourOverlay
          visible={visible && stepReady}
          step={overlayStep}
          stepIndex={stepIndex}
          stepCount={steps.length}
          targetRect={targetRect}
          onNext={() => void nextStep()}
          onSkip={() => void skipTour()}
        />
      </View>
    </ProductTourContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
});

export function useProductTour() {
  const ctx = useContext(ProductTourContext);
  if (!ctx) {
    throw new Error('useProductTour must be used within ProductTourProvider');
  }
  return ctx;
}

export type { TourTab };
