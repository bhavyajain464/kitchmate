import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  View,
  ScrollView,
  RefreshControl,
  Pressable,
} from 'react-native';
import {
  Text,
  Surface,
  ActivityIndicator,
  IconButton,
  Icon,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_HEADER } from '../components/TabScreenHeader';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { useScrollToTopOnTabFocus } from '../hooks/useScrollToTopOnTabFocus';
import { useAuth } from '../context/AuthContext';
import { refreshAppliesTo, useAppRefresh } from '../context/AppRefreshContext';
import * as api from '../services/api';
import { ExpiringItem } from '../types';
import { QuickActionsCarousel } from '../components/QuickActionsCarousel';
import { ProfileHeaderButton } from '../components/ProfileHeaderButton';
import { AddInventoryModal } from '../components/modals/AddInventoryModal';
import { LogMealModal } from '../components/modals/LogMealModal';
import { AddShoppingModal } from '../components/modals/AddShoppingModal';
import { palette } from '../theme';
import { MealOfDayCard, MealOfDayMeal } from '../components/MealOfDayCard';
import { todayDateKey } from '../components/meals/WeekPlanCarousel';
import { parseWeekPlanDays, todayMealsFromWeekPlanDays } from '../utils/weekPlan';
import { pantryQtyLabel } from '../utils/inventoryBuckets';
import { TourTarget } from '../components/tour/TourTarget';
import { TabScreenScrollLayout } from '../components/TabScreenScrollLayout';
import { useProductTour } from '../context/ProductTourContext';
import { APP_TOUR_TARGET_IDS } from '../tour/appTourSteps';
import { useTourScreenScroll } from '../hooks/useTourScreenScroll';

function useGreeting(): string {
  const { t } = useTranslation();
  const h = new Date().getHours();
  if (h < 12) return t('greeting.morning');
  if (h < 17) return t('greeting.afternoon');
  return t('greeting.evening');
}

function formatItemName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

const EXPIRING_PREVIEW = 4;

export function HomeScreen({ navigation }: any) {
  const { t } = useTranslation();
  const greeting = useGreeting();
  const expiringDaysLabel = useCallback(
    (days: number) => {
      if (days <= 0) return { text: t('home.today'), urgent: true };
      if (days === 1) return { text: t('home.oneDay'), urgent: true };
      if (days <= 2) return { text: t('home.days', { count: days }), urgent: true };
      return { text: t('home.days', { count: days }), urgent: false };
    },
    [t],
  );
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { contentPaddingBottom } = useTabBarLayout();
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([]);
  const [expiredItems, setExpiredItems] = useState<ExpiringItem[]>([]);
  const [pantryTotal, setPantryTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [inventoryModalOpen, setInventoryModalOpen] = useState(false);
  const [logMealModalOpen, setLogMealModalOpen] = useState(false);
  const [shoppingModalOpen, setShoppingModalOpen] = useState(false);
  const [mealOfDayMeals, setMealOfDayMeals] = useState<MealOfDayMeal[]>([]);
  const [mealOfDayLoading, setMealOfDayLoading] = useState(false);
  const [mealOfDayNotReady, setMealOfDayNotReady] = useState(false);
  const skipMountLoadData = useRef(true);
  const hasMealOfDay = useRef(false);
  const isFocused = useIsFocused();
  const scrollRef = useRef<ScrollView>(null);
  const { setExpiryStepBody } = useProductTour();
  const { rememberTargetOffset } = useTourScreenScroll('Home', scrollRef);
  useScrollToTopOnTabFocus(scrollRef);
  const { version: refreshVersion, scope: refreshScope } = useAppRefresh();
  const loadMealOfDay = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setMealOfDayLoading(true);
    try {
      const res = await api.getWeekPlan();
      const planDays = parseWeekPlanDays(res?.days);
      const withNames = todayMealsFromWeekPlanDays(planDays);
      setMealOfDayMeals(withNames);
      setMealOfDayNotReady(withNames.length === 0);
      hasMealOfDay.current = withNames.length > 0;
    } catch {
      setMealOfDayMeals([]);
      setMealOfDayNotReady(true);
      hasMealOfDay.current = false;
    } finally {
      if (!silent) setMealOfDayLoading(false);
    }
  }, []);

  const loadInventorySummary = useCallback(async () => {
    try {
      const data = await api.fetchInventoryBuckets(['expiring', 'expired']);
      setExpiringItems(data.expiring ?? []);
      setExpiredItems(data.expired ?? []);
      setPantryTotal(data.counts?.total ?? 0);
    } catch {
      setExpiringItems([]);
      setExpiredItems([]);
      setPantryTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    await loadInventorySummary();
    void loadMealOfDay({ silent: hasMealOfDay.current });
  }, [loadInventorySummary, loadMealOfDay]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData]),
  );

  // Inventory changed elsewhere while Home is focused — refresh banners only (not meal-of-day).
  useEffect(() => {
    if (!isFocused) return;
    if (skipMountLoadData.current) {
      skipMountLoadData.current = false;
      return;
    }
    if (!refreshAppliesTo(refreshScope, 'inventory')) return;
    void loadInventorySummary();
  }, [isFocused, loadInventorySummary, refreshVersion, refreshScope]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  useEffect(() => {
    setExpiryStepBody(expiringItems.length > 0 || expiredItems.length > 0);
  }, [expiredItems.length, expiringItems.length, setExpiryStepBody]);

  const firstName = user?.name?.split(' ')[0] || t('greeting.there');

  return (
    <>
    <TabScreenScrollLayout
      scrollRef={scrollRef}
      header={
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <View style={styles.headerTop}>
            <View style={styles.headerText}>
              <Text variant="bodyMedium" style={styles.greeting}>{greeting},</Text>
              <Text variant="headlineMedium" style={styles.heroName}>{firstName}</Text>
            </View>
            <TourTarget
              id={APP_TOUR_TARGET_IDS.profile}
              style={styles.profileTourTarget}
              onLayoutY={(y) => rememberTargetOffset(APP_TOUR_TARGET_IDS.profile, y)}
            >
              <ProfileHeaderButton size={48} />
            </TourTarget>
          </View>
        </View>
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: contentPaddingBottom(16) },
      ]}
    >
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" />
      ) : (
        <>
          <Text variant="titleMedium" style={styles.sectionTitle}>{t('home.quickActions')}</Text>
          <TourTarget
            id={APP_TOUR_TARGET_IDS.quickActions}
            onLayoutY={(y) => rememberTargetOffset(APP_TOUR_TARGET_IDS.quickActions, y)}
          >
            <QuickActionsCarousel
              onAddItem={() => setInventoryModalOpen(true)}
              onMealIdea={() =>
                navigation.navigate('Meals', {
                  openWeekPlanDate: todayDateKey(),
                })
              }
              onLogMeal={() => setLogMealModalOpen(true)}
              onAddToList={() => setShoppingModalOpen(true)}
            />
          </TourTarget>

          <Text variant="titleMedium" style={styles.sectionTitle}>{t('home.mealOfDay')}</Text>
          <TourTarget
            id={APP_TOUR_TARGET_IDS.mealOfDay}
            onLayoutY={(y) => rememberTargetOffset(APP_TOUR_TARGET_IDS.mealOfDay, y)}
          >
            <MealOfDayCard
              meals={mealOfDayMeals}
              loading={mealOfDayLoading}
              notReady={mealOfDayNotReady}
              onPress={() =>
                navigation.navigate('Meals', {
                  openWeekPlanDate: todayDateKey(),
                  returnToTab: 'Home',
                })
              }
            />
          </TourTarget>

          {/* ── Expired + expiring alerts ───────────────────── */}
          {expiredItems.length > 0 || expiringItems.length > 0 ? (
            <TourTarget
              id={APP_TOUR_TARGET_IDS.expiry}
              onLayoutY={(y) => rememberTargetOffset(APP_TOUR_TARGET_IDS.expiry, y)}
            >
              {expiredItems.length > 0 ? (
                <Pressable
                  onPress={() => navigation.navigate('Inventory', { tab: 'expired' })}
                  style={({ pressed }) => [styles.expiredBanner, pressed && styles.expiredBannerPressed]}
                >
                  <View style={styles.expiredBannerIconWrap}>
                    <Icon source="alert-circle-outline" size={22} color={palette.error} />
                  </View>
                  <View style={styles.expiredBannerText}>
                    <Text variant="titleSmall" style={styles.expiredBannerTitle}>
                      ⚠️ {t('home.expiredBanner', { count: expiredItems.length })}
                    </Text>
                    <Text variant="bodySmall" style={styles.expiredBannerSub}>
                      {t('home.tapToReorder')}
                    </Text>
                  </View>
                  <Icon source="chevron-right" size={22} color={palette.error} />
                </Pressable>
              ) : null}

              {expiringItems.length > 0 ? (
                <View
                  style={[
                    styles.expiringSection,
                    expiredItems.length === 0 && styles.expiringSectionStandalone,
                  ]}
                >
                  <Surface style={styles.expiringPanel} elevation={1}>
                  <Pressable
                    onPress={() => navigation.navigate('Inventory', { expiringSoon: true })}
                    style={({ pressed }) => [styles.expiringPanelHeader, pressed && { opacity: 0.92 }]}
                  >
                    <View style={styles.expiringTitleRow}>
                      <View style={styles.expiringIconWrap}>
                        <Icon source="clock-alert-outline" size={20} color="#E65100" />
                      </View>
                      <Text variant="titleSmall" style={styles.expiringPanelTitle}>
                        {t('home.expiringSoon')}
                      </Text>
                      <View style={styles.expiringCountPill}>
                        <Text style={styles.expiringCountText}>{expiringItems.length}</Text>
                      </View>
                    </View>
                    <Icon source="chevron-right" size={22} color="#E65100" />
                  </Pressable>

                  <View style={styles.expiringList}>
                    {expiringItems.slice(0, EXPIRING_PREVIEW).map((item, index, preview) => {
                      const { text: daysText, urgent } = expiringDaysLabel(item.days_until_expiry);
                      const isLast = index === preview.length - 1;
                      return (
                        <Pressable
                          key={item.item_id}
                          onPress={() => navigation.navigate('Inventory', { expiringSoon: true })}
                          style={({ pressed }) => [
                            styles.expiringRow,
                            !isLast && styles.expiringRowBorder,
                            pressed && styles.expiringRowPressed,
                          ]}
                        >
                          <View
                            style={[
                              styles.expiringRowAccent,
                              urgent ? styles.expiringRowAccentUrgent : styles.expiringRowAccentWarn,
                            ]}
                          />
                          <View style={styles.expiringRowBody}>
                            <Text variant="bodyMedium" style={styles.expiringRowName} numberOfLines={1}>
                              {formatItemName(item.canonical_name)}
                            </Text>
                            <Text variant="bodySmall" style={styles.expiringRowQty} numberOfLines={1}>
                              {pantryQtyLabel(item)}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.expiringDaysPill,
                              urgent ? styles.expiringDaysPillUrgent : styles.expiringDaysPillWarn,
                            ]}
                          >
                            <Text
                              style={[
                                styles.expiringDaysText,
                                urgent ? styles.expiringDaysTextUrgent : styles.expiringDaysTextWarn,
                              ]}
                            >
                              {daysText}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>

                  {expiringItems.length > EXPIRING_PREVIEW ? (
                    <Pressable
                      onPress={() => navigation.navigate('Inventory', { expiringSoon: true })}
                      style={({ pressed }) => [styles.expiringMoreBtn, pressed && { opacity: 0.85 }]}
                    >
                      <Text style={styles.expiringMoreText}>
                        +{expiringItems.length - EXPIRING_PREVIEW} more · View all
                      </Text>
                    </Pressable>
                  ) : null}
                </Surface>
                </View>
              ) : null}
            </TourTarget>
          ) : (
            <TourTarget
              id={APP_TOUR_TARGET_IDS.pantryFallback}
              onLayoutY={(y) => rememberTargetOffset(APP_TOUR_TARGET_IDS.pantryFallback, y)}
            >
              {pantryTotal === 0 ? (
                <Pressable
                  onPress={() => navigation.navigate('Inventory')}
                  style={styles.emptyPantry}
                >
                  <Surface style={styles.emptyPantryCard} elevation={1}>
                    <IconButton icon="fridge-outline" size={32} iconColor="#388E3C" style={{ margin: 0 }} />
                    <Text variant="titleSmall" style={styles.emptyPantryTitle}>
                      {t('home.emptyPantryTitle')}
                    </Text>
                    <Text variant="bodySmall" style={styles.emptyPantrySub}>
                      {t('home.emptyPantrySub')}
                    </Text>
                  </Surface>
                </Pressable>
              ) : (
                <View style={styles.pantryTourAnchor} />
              )}
            </TourTarget>
          )}
        </>
      )}

    </TabScreenScrollLayout>

      <AddInventoryModal
        visible={inventoryModalOpen}
        onDismiss={() => setInventoryModalOpen(false)}
      />
      <LogMealModal
        visible={logMealModalOpen}
        onDismiss={() => setLogMealModalOpen(false)}
      />
      <AddShoppingModal
        visible={shoppingModalOpen}
        onDismiss={() => setShoppingModalOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 20,
  },

  // Header
  header: {
    backgroundColor: TAB_HEADER.backgroundColor,
    paddingHorizontal: TAB_HEADER.paddingHorizontal,
    paddingBottom: TAB_HEADER.paddingBottom,
    borderBottomLeftRadius: TAB_HEADER.borderRadius,
    borderBottomRightRadius: TAB_HEADER.borderRadius,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  greeting: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
  },
  heroName: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 28,
    marginTop: 6,
  },
  profileTourTarget: {
    width: 48,
    height: 48,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Sections
  sectionTitle: {
    fontWeight: '700',
    marginLeft: 24,
    marginTop: 24,
    marginBottom: 6,
    color: '#1A1A1A',
  },
  expiringSection: {
    marginHorizontal: 24,
    marginTop: 10,
    marginBottom: 20,
  },
  expiringSectionStandalone: {
    marginTop: 20,
  },
  expiringPanel: {
    borderRadius: 16,
    backgroundColor: '#FFF8E1',
    borderWidth: 1,
    borderColor: '#FFE0B2',
    overflow: 'hidden',
  },
  expiringPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 152, 0, 0.2)',
  },
  expiringTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  expiringIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#FFE0B2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expiringPanelTitle: {
    fontWeight: '800',
    color: '#E65100',
    flex: 1,
  },
  expiringCountPill: {
    backgroundColor: '#FF9800',
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  expiringCountText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  expiringList: {
    backgroundColor: '#fff',
  },
  expiringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingRight: 14,
    paddingLeft: 0,
    backgroundColor: '#fff',
  },
  expiringRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  expiringRowPressed: {
    backgroundColor: '#FFFDE7',
  },
  expiringRowAccent: {
    width: 4,
    alignSelf: 'stretch',
    marginRight: 12,
    borderRadius: 2,
  },
  expiringRowAccentUrgent: {
    backgroundColor: '#FB8C00',
  },
  expiringRowAccentWarn: {
    backgroundColor: '#FFB74D',
  },
  expiringRowBody: {
    flex: 1,
    minWidth: 0,
    marginRight: 10,
  },
  expiringRowName: {
    fontWeight: '700',
    color: '#212121',
  },
  expiringRowQty: {
    color: '#757575',
    marginTop: 2,
  },
  expiringDaysPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  expiringDaysPillUrgent: {
    backgroundColor: '#FFF3E0',
  },
  expiringDaysPillWarn: {
    backgroundColor: '#FFF8E1',
  },
  expiringDaysText: {
    fontSize: 12,
    fontWeight: '800',
  },
  expiringDaysTextUrgent: {
    color: '#EF6C00',
  },
  expiringDaysTextWarn: {
    color: '#E65100',
  },
  expiringMoreBtn: {
    paddingVertical: 11,
    alignItems: 'center',
    backgroundColor: '#FFF3E0',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#FFE0B2',
  },
  expiringMoreText: {
    color: '#E65100',
    fontWeight: '700',
    fontSize: 13,
  },

  // Expired — outline alert (muted; expiring soon stays primary)
  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginTop: 20,
    marginBottom: 0,
    backgroundColor: palette.surface,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: palette.error,
    gap: 4,
  },
  expiredBannerPressed: {
    backgroundColor: palette.errorBg,
    opacity: 0.96,
  },
  expiredBannerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: palette.errorBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  expiredBannerText: {
    flex: 1,
    minWidth: 0,
    marginRight: 4,
  },
  expiredBannerTitle: {
    color: palette.error,
    fontWeight: '700',
    lineHeight: 20,
  },
  expiredBannerSub: {
    color: '#9E4747',
    fontWeight: '500',
    marginTop: 2,
  },

  emptyPantry: {
    marginHorizontal: 24,
    marginTop: 16,
    marginBottom: 20,
  },
  emptyPantryCard: {
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E8F5E9',
  },
  emptyPantryTitle: {
    fontWeight: '700',
    color: '#333',
    marginTop: 4,
  },
  emptyPantrySub: {
    color: '#888',
    marginTop: 4,
    textAlign: 'center',
  },
  pantryTourAnchor: {
    height: 1,
    marginHorizontal: 24,
    marginTop: 16,
    marginBottom: 20,
  },
});
