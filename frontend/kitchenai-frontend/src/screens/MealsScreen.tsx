import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, ScrollView } from 'react-native';
import { SegmentedButtons } from 'react-native-paper';
import { MealsHistoryDietTab } from '../components/meals/MealsHistoryDietTab';
import { MealsLogHistorySection } from '../components/meals/MealsLogHistorySection';
import { WeekPlanCarousel, todayDateKey, type WeekPlanDay } from '../components/meals/WeekPlanCarousel';
import { WeekPlanDaySheet } from '../components/meals/WeekPlanDaySheet';
import { parseWeekPlanDays } from '../utils/weekPlan';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { useScrollToTopOnTabFocus } from '../hooks/useScrollToTopOnTabFocus';
import type { MainTabParamList } from '../navigation/types';
import * as api from '../services/api';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { TabScreenHeader } from '../components/TabScreenHeader';
import { TabScreenScrollLayout } from '../components/TabScreenScrollLayout';
import { TourTarget } from '../components/tour/TourTarget';
import { useProductTour } from '../context/ProductTourContext';
import { userFacingError } from '../utils/userFacingError';
import { APP_TOUR_TARGET_IDS } from '../tour/appTourSteps';
import { useTourScreenScroll } from '../hooks/useTourScreenScroll';

const MEALS_TABS = [
  { value: 'plan', label: 'Meal planning', icon: 'calendar-week' },
  { value: 'diet', label: 'Diet', icon: 'chart-line' },
] as const;

type MealsTab = (typeof MEALS_TABS)[number]['value'];

const TAB_BAR_PAD = 18;
/** Pinned segmented tab row below the green header (padding + control height). */
const MEALS_STICKY_TAB_CHROME = 56;

type MealsRouteParams = {
  openLog?: boolean;
  generateCategory?: string;
  openWeekPlanDate?: string;
  returnToTab?: keyof MainTabParamList;
};

export function MealsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ Meals: MealsRouteParams }, 'Meals'>>();
  const { contentPaddingBottom } = useTabBarLayout();
  const scrollRef = useRef<ScrollView>(null);
  const [stickyTabHeight, setStickyTabHeight] = useState(MEALS_STICKY_TAB_CHROME);
  const { rememberTargetOffset } = useTourScreenScroll('Meals', scrollRef, {
    fixedChromeExtra: stickyTabHeight,
  });
  const { isTourActive, activeStepId, requestTargetRemeasure } = useProductTour();
  useScrollToTopOnTabFocus(scrollRef);
  const [mealsTab, setMealsTab] = useState<MealsTab>('plan');
  const [openLogFromNotification, setOpenLogFromNotification] = useState(false);
  const [cookProfileReady, setCookProfileReady] = useState(false);
  const [weekPlanDays, setWeekPlanDays] = useState<WeekPlanDay[]>([]);
  const [weekPlanLoading, setWeekPlanLoading] = useState(false);
  const [weekPlanError, setWeekPlanError] = useState<string | null>(null);
  const [weekPlanAnchor, setWeekPlanAnchor] = useState(todayDateKey());
  const [selectedPlanDate, setSelectedPlanDate] = useState(todayDateKey());
  const [sheetDate, setSheetDate] = useState<string | null>(null);

  const loadWeekPlan = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setWeekPlanLoading(true);
    setWeekPlanError(null);
    try {
      const res = await api.getWeekPlan();
      const today = todayDateKey();
      if (!res?.days?.length) {
        setWeekPlanDays([]);
        setSelectedPlanDate(today);
        setWeekPlanError('Your meal plan is not ready yet. Try again in a moment.');
        return;
      }
      const days = parseWeekPlanDays(res.days);
      setWeekPlanDays(days);
      setWeekPlanAnchor(res.anchor_date || today);
      setSelectedPlanDate((prev) => {
        if (days.some((day) => day.date === prev)) return prev;
        return days.find((day) => day.date === today)?.date ?? days[0]?.date ?? today;
      });
    } catch (e: unknown) {
      setWeekPlanDays([]);
      setWeekPlanError(userFacingError(e, 'Could not load meal plan.'));
    } finally {
      if (!silent) setWeekPlanLoading(false);
    }
  }, []);

  const refreshCookProfileReady = useCallback(() => {
    void api.fetchCookProfile()
      .then((p) => setCookProfileReady(Boolean(p.configured && p.phone_number?.trim())))
      .catch(() => setCookProfileReady(false));
  }, []);

  const openWeekPlanDay = useCallback(async (date: string) => {
    setMealsTab('plan');
    setSelectedPlanDate(date);
    if (!weekPlanDays.length) {
      await loadWeekPlan();
    }
    setSheetDate(date);
  }, [weekPlanDays.length, loadWeekPlan]);

  useEffect(() => {
    if (route.params?.openLog) {
      setMealsTab('plan');
      setOpenLogFromNotification(true);
      navigation.setParams({ openLog: undefined });
    }
  }, [route.params?.openLog, navigation]);

  useEffect(() => {
    const planDate = route.params?.openWeekPlanDate;
    if (planDate) {
      navigation.setParams({ openWeekPlanDate: undefined });
      void openWeekPlanDay(planDate);
      return;
    }

    if (route.params?.generateCategory) {
      navigation.setParams({ generateCategory: undefined });
      void openWeekPlanDay(todayDateKey());
    }
  }, [route.params?.openWeekPlanDate, route.params?.generateCategory, navigation, openWeekPlanDay]);

  const onMealsTourStep = isTourActive && activeStepId === 'meals-week-plan';
  const showPlanTab = mealsTab === 'plan' || onMealsTourStep;

  useFocusEffect(
    useCallback(() => {
      if (!showPlanTab) return undefined;
      void loadWeekPlan({ silent: weekPlanDays.length > 0 });
      refreshCookProfileReady();
      return undefined;
    }, [showPlanTab, loadWeekPlan, refreshCookProfileReady, weekPlanDays.length]),
  );

  useEffect(() => {
    if (onMealsTourStep) {
      setMealsTab('plan');
    }
  }, [onMealsTourStep]);

  useEffect(() => {
    if (!onMealsTourStep || weekPlanLoading) return;
    requestTargetRemeasure(APP_TOUR_TARGET_IDS.mealsWeekPlan);
  }, [onMealsTourStep, weekPlanLoading, weekPlanDays.length, requestTargetRemeasure]);

  const sheetDay = weekPlanDays.find((d) => d.date === sheetDate) ?? null;

  const handleDayPress = useCallback((date: string) => {
    setSheetDate(date);
  }, []);

  const handleSheetDayUpdated = useCallback((updated: WeekPlanDay) => {
    setWeekPlanDays((prev) =>
      prev.map((d) => (d.date === updated.date ? updated : d)),
    );
  }, []);

  return (
    <TabScreenScrollLayout
      scrollRef={scrollRef}
      header={
        <TabScreenHeader
          title={mealsTab === 'diet' ? t('meals.dietTitle') : t('meals.planningTitle')}
        />
      }
      sticky={
        <View
          style={styles.tabBar}
          onLayout={(event) => setStickyTabHeight(event.nativeEvent.layout.height)}
        >
          <SegmentedButtons
            value={mealsTab}
            onValueChange={(v) => {
              if (onMealsTourStep) return;
              setMealsTab(v as MealsTab);
            }}
            buttons={MEALS_TABS.map((t) => ({
              value: t.value,
              label: t.label,
              icon: t.icon,
              style: mealsTab === t.value ? styles.tabBtnActive : styles.tabBtn,
            }))}
            style={styles.segmented}
          />
        </View>
      }
      contentContainerStyle={[styles.scrollContent, { paddingBottom: contentPaddingBottom() }]}
    >
      {showPlanTab ? (
        <>
          <TourTarget
            id={APP_TOUR_TARGET_IDS.mealsWeekPlan}
            onLayoutY={(y) => rememberTargetOffset(APP_TOUR_TARGET_IDS.mealsWeekPlan, y)}
          >
            <WeekPlanCarousel
              days={weekPlanDays}
              selectedDate={selectedPlanDate}
              onSelectDate={setSelectedPlanDate}
              onDayPress={handleDayPress}
              loading={weekPlanLoading}
              error={weekPlanError}
              anchorDate={weekPlanAnchor}
            />
          </TourTarget>

          <WeekPlanDaySheet
            visible={sheetDate !== null}
            day={sheetDay}
            anchorDate={weekPlanAnchor}
            cookProfileReady={cookProfileReady}
            onDismiss={() => setSheetDate(null)}
            onDayUpdated={handleSheetDayUpdated}
            navigation={navigation}
          />

          <MealsLogHistorySection
            openAddOnMount={openLogFromNotification}
            onAddModalOpened={() => setOpenLogFromNotification(false)}
          />
        </>
      ) : (
        <MealsHistoryDietTab />
      )}

      <View style={{ height: 32 }} />
    </TabScreenScrollLayout>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingBottom: 24 },
  tabBar: { paddingHorizontal: TAB_BAR_PAD, paddingTop: 12, paddingBottom: 4, backgroundColor: '#FAFAFA' },
  segmented: { backgroundColor: '#fff' },
  tabBtn: { backgroundColor: '#fff' },
  tabBtnActive: { backgroundColor: '#E8F5E9' },
});
