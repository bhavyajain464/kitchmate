import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { OptimizedImage } from '../OptimizedImage';
import { Button, Card, IconButton, Menu, Modal, Portal, Text } from 'react-native-paper';
import { MealTagPill, mealTagPillRowStyle } from './MealTagPill';
import { BottomSheet } from '../BottomSheet';
import { DishSearchOverlay } from '../DishSearchOverlay';
import type { MealOfDayMeal } from '../MealOfDayCard';
import { DishImage } from '../DishImage';
import { getDishPreviewImageSource } from '../../data/dishImages';
import { formatWeekPlanDayLabel, todayDateKey, type WeekPlanDay } from './WeekPlanCarousel';
import * as api from '../../services/api';
import type { WeekPlanDayResponse } from '../../services/api';
import type { CatalogDishSearchItem } from '../../types';
import { showAppError, showAppInfo, showAppSuccess } from '../../utils/alertMessage';
import { useAppRefresh } from '../../context/AppRefreshContext';
import {
  ingredientsForSelectedPairs,
  mealShopItemsMissing,
} from '../../utils/ingredientPantryMatch';
import { hiddenMajorIngredientCount, majorIngredients } from '../../utils/mealIngredients';
import { palette } from '../../theme';
import { RegenerateMealSheet } from './RegenerateMealSheet';
import type { MealSuggestionCategoryId, MealTypeFilterId } from '../../constants/mealSuggestionCategories';
import { cookNavParams, type CookRouteParams } from '../../navigation/cookParams';

const SLOT_ORDER = ['breakfast', 'lunch', 'dinner'] as const;

const SLOT_LABELS: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: '#388E3C',
  medium: '#689F38',
  hard: '#1B5E20',
};

const SHEET_HORIZONTAL_PAD = 20;
const CARD_HORIZONTAL_PAD = 14;
const MEAL_THUMB_GAP = 12;
const MEAL_THUMB_MIN = 96;
const MEAL_THUMB_MAX = 240;

function mealThumbRatioForRowWidth(rowWidth: number) {
  if (rowWidth >= 720) return 0.38;
  if (rowWidth >= 480) return 0.36;
  return 0.34;
}

function estimatedMealRowWidth(screenWidth: number) {
  return screenWidth - SHEET_HORIZONTAL_PAD * 2 - CARD_HORIZONTAL_PAD * 2;
}

function useMealThumbWidth() {
  const { width: screenWidth } = useWindowDimensions();
  const [rowWidth, setRowWidth] = useState(0);

  const onTopRowLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setRowWidth((prev) => (prev === nextWidth ? prev : nextWidth));
  }, []);

  const effectiveRowWidth = rowWidth > 0 ? rowWidth : estimatedMealRowWidth(screenWidth);

  const thumbWidth = useMemo(() => {
    const ratio = mealThumbRatioForRowWidth(effectiveRowWidth);
    return Math.round(
      Math.min(MEAL_THUMB_MAX, Math.max(MEAL_THUMB_MIN, effectiveRowWidth * ratio)),
    );
  }, [effectiveRowWidth]);

  return { thumbWidth, onTopRowLayout };
}

function DishImagePreviewModal({
  visible,
  dishName,
  dishId,
  onClose,
}: {
  visible: boolean;
  dishName?: string | null;
  dishId?: string | null;
  onClose: () => void;
}) {
  const source = useMemo(
    () => getDishPreviewImageSource(dishId),
    [dishId],
  );

  if (!visible || !source) return null;

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onClose} contentContainerStyle={styles.previewModal}>
        <View style={styles.previewHeader}>
          {dishName ? (
            <Text variant="titleMedium" style={styles.previewTitle} numberOfLines={2}>
              {dishName}
            </Text>
          ) : null}
          <IconButton
            icon="close"
            size={22}
            onPress={onClose}
            accessibilityLabel="Close preview"
          />
        </View>
        <OptimizedImage source={source} style={styles.previewImage} resizeMode="contain" />
      </Modal>
    </Portal>
  );
}

function mealsInOrder(meals: MealOfDayMeal[]): MealOfDayMeal[] {
  const bySlot = new Map<string, MealOfDayMeal>();
  for (const meal of meals) {
    const slot = meal.meal_slot?.toLowerCase();
    if (slot) bySlot.set(slot, meal);
  }
  return SLOT_ORDER.map((slot) => bySlot.get(slot)).filter(Boolean) as MealOfDayMeal[];
}

function combinedMealIngredients(
  ingredients: readonly string[],
  pairsWith: readonly string[],
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const raw of [...ingredients, ...pairsWith]) {
    const item = raw.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function mealsFromDayResponse(res: WeekPlanDayResponse): MealOfDayMeal[] {
  const cat = res.categories?.find((c) => c.id === 'meal_of_day') ?? res.categories?.[0];
  return (cat?.meals ?? []).map((m) => ({
    meal_slot: m.meal_slot,
    dish_id: m.dish_id,
    name: m.name,
    description: m.description,
    ingredients: m.ingredients ?? [],
    ingredient_ids: m.ingredient_ids,
    items_to_order: m.items_to_order,
    pairs_with: m.pairs_with,
    pair_ingredients: m.pair_ingredients,
    cooking_time_mins: m.cooking_time_mins,
    difficulty: m.difficulty,
    why_this_meal: m.why_this_meal,
    star_count: m.star_count,
    user_starred: m.user_starred,
  }));
}

type WeekPlanMealCardProps = {
  meal: MealOfDayMeal;
  slotLabel: string;
  displayIngredients: string[];
  hiddenIngredientCount: number;
  pairsWith: string[];
  selectedPairs: string[];
  shopItems: string[];
  cookProfileReady: boolean;
  changeMenuOpen: boolean;
  refreshing: boolean;
  changeDisabled: boolean;
  addingShopping: boolean;
  cookSendItemCount: number;
  starringDish: string | null;
  onToggleStar: () => void;
  onOpenChangeMenu: () => void;
  onCloseChangeMenu: () => void;
  onRegenerateWithAI: () => void;
  onChooseFromCatalog: () => void;
  onTogglePair: (item: string) => void;
  onAddToShopping: () => void;
  onSendToCook: () => void;
  onPreviewImage: () => void;
  onViewRecipe: () => void;
};

function WeekPlanMealCard({
  meal,
  slotLabel,
  displayIngredients,
  hiddenIngredientCount,
  pairsWith,
  selectedPairs,
  shopItems,
  cookProfileReady,
  changeMenuOpen,
  refreshing,
  changeDisabled,
  addingShopping,
  cookSendItemCount,
  starringDish,
  onToggleStar,
  onOpenChangeMenu,
  onCloseChangeMenu,
  onRegenerateWithAI,
  onChooseFromCatalog,
  onTogglePair,
  onAddToShopping,
  onSendToCook,
  onPreviewImage,
  onViewRecipe,
}: WeekPlanMealCardProps) {
  const { thumbWidth, onTopRowLayout } = useMealThumbWidth();
  const difficulty = meal.difficulty ?? 'easy';
  const canPreviewImage = useMemo(
    () => getDishPreviewImageSource(meal.dish_id) != null,
    [meal.dish_id],
  );

  const changeMenu = (
    <Menu
      visible={changeMenuOpen}
      onDismiss={onCloseChangeMenu}
      anchor={
        <Button
          mode="text"
          compact
          onPress={onOpenChangeMenu}
          loading={refreshing}
          disabled={changeDisabled}
          style={styles.changeBtn}
          labelStyle={styles.changeBtnLabel}
          textColor={palette.primary}
          accessibilityLabel={`Change ${slotLabel}`}
        >
          Change
        </Button>
      }
    >
      <Menu.Item
        title="Regenerate with AI"
        leadingIcon="auto-fix"
        onPress={onRegenerateWithAI}
      />
      <Menu.Item
        title="Choose from catalog"
        leadingIcon="magnify"
        onPress={onChooseFromCatalog}
      />
    </Menu>
  );

  const mealImage = (
    <Pressable
      onPress={onPreviewImage}
      disabled={!canPreviewImage}
      accessibilityRole={canPreviewImage ? 'button' : 'image'}
      accessibilityLabel={
        canPreviewImage
          ? `Preview photo of ${meal.name}`
          : `Photo of ${meal.name}`
      }
      style={({ pressed }) => [pressed && canPreviewImage ? styles.mealThumbPressed : null]}
    >
      <DishImage
        dishId={meal.dish_id}
        dishName={meal.name}
        variant="card"
        width={thumbWidth}
        borderRadius={12}
        style={styles.mealThumb}
      />
    </Pressable>
  );

  return (
    <Card style={styles.mealCard} mode="elevated">
      <Card.Content style={styles.mealCardBody}>
        <View style={styles.slotHeaderRow}>
          <Text variant="labelLarge" style={styles.slotLabel}>{slotLabel}</Text>
          {changeMenu}
        </View>

        <View style={styles.mealFlowWrap} onLayout={onTopRowLayout}>
          <View style={styles.mealTopRow}>
            <View style={styles.mealTextCol}>
              <Text variant="titleMedium" style={styles.mealName}>{meal.name}</Text>
              <View style={styles.metaRow}>
                {meal.cooking_time_mins ? (
                  <View style={styles.metaItem}>
                    <IconButton icon="clock-outline" size={16} iconColor="#888" style={{ margin: 0 }} />
                    <Text variant="bodySmall" style={styles.metaText}>{meal.cooking_time_mins} min</Text>
                  </View>
                ) : null}
                <View style={styles.starWrap}>
                  <IconButton
                    icon={meal.user_starred ? 'star' : 'star-outline'}
                    iconColor={meal.user_starred ? '#F5A623' : '#212121'}
                    size={20}
                    style={styles.starBtn}
                    onPress={onToggleStar}
                    disabled={starringDish === meal.name}
                    loading={starringDish === meal.name}
                    accessibilityLabel={
                      meal.user_starred ? 'Remove your star' : 'Star this dish for everyone'
                    }
                  />
                  <Text variant="labelSmall" style={styles.starCountText}>
                    {meal.star_count ?? 0}
                  </Text>
                </View>
                <View
                  style={[
                    styles.diffBadge,
                    { backgroundColor: (DIFFICULTY_COLORS[difficulty] || '#888') + '18' },
                  ]}
                >
                  <Text
                    style={[
                      styles.diffText,
                      { color: DIFFICULTY_COLORS[difficulty] || '#888' },
                    ]}
                  >
                    {difficulty}
                  </Text>
                </View>
              </View>

              {pairsWith.length > 0 ? (
                <>
                  <Text variant="labelSmall" style={styles.pairsLabel}>
                    Pairs well with
                  </Text>
                  <View style={mealTagPillRowStyle.wrap}>
                    {pairsWith.map((item, i) => {
                      const pairSelected = selectedPairs.includes(item);
                      return (
                        <MealTagPill
                          key={i}
                          label={item}
                          variant="pairs"
                          selected={pairSelected}
                          icon={pairSelected ? 'check' : 'silverware-fork-knife'}
                          onPress={() => onTogglePair(item)}
                        />
                      );
                    })}
                  </View>
                </>
              ) : null}
            </View>
            {mealImage}
          </View>

          {meal.description?.trim() ? (
            <Text variant="bodySmall" style={styles.description}>{meal.description}</Text>
          ) : null}

          {displayIngredients.length > 0 ? (
          <>
            <Text variant="labelSmall" style={styles.ingLabel}>Ingredients</Text>
            <View style={mealTagPillRowStyle.wrap}>
              {displayIngredients.map((ing, i) => (
                <MealTagPill key={i} label={ing} variant="ingredient" />
              ))}
              {hiddenIngredientCount > 0 ? (
                <MealTagPill label={`+${hiddenIngredientCount} more`} variant="ingredient" />
              ) : null}
            </View>
          </>
        ) : null}

        {shopItems.length > 0 ? (
          <>
            <View style={styles.orderHeaderRow}>
              <Text variant="labelSmall" style={styles.orderLabel}>Need to order</Text>
              <Button
                mode="text"
                icon="cart-plus"
                compact
                onPress={onAddToShopping}
                loading={addingShopping}
                disabled={addingShopping}
                style={styles.addListBtn}
                labelStyle={styles.addListBtnLabel}
                contentStyle={styles.addListBtnContent}
                textColor={palette.primary}
              >
                Add to list
              </Button>
            </View>
            <View style={mealTagPillRowStyle.wrap}>
              {shopItems.map((item, i) => (
                <MealTagPill
                  key={i}
                  label={item}
                  variant="order"
                  icon="cart-outline"
                />
              ))}
            </View>
          </>
        ) : null}
        </View>

        <View style={styles.actions}>
          {meal.dish_id ? (
            <Button
              mode="outlined"
              icon="book-open-page-variant"
              compact
              onPress={onViewRecipe}
              style={styles.actionBtn}
              contentStyle={{ paddingVertical: 2 }}
            >
              View recipe
            </Button>
          ) : null}
          <Button
            mode="contained"
            icon="chef-hat"
            compact
            onPress={onSendToCook}
            buttonColor={cookProfileReady ? '#25D366' : '#9E9E9E'}
            disabled={!cookProfileReady}
            style={styles.actionBtn}
            contentStyle={{ paddingVertical: 2 }}
          >
            {cookProfileReady && cookSendItemCount > 1
              ? `Send to cook (${cookSendItemCount} items)`
              : cookProfileReady
                ? 'Send to cook'
                : 'Set up Cook profile'}
          </Button>
        </View>
      </Card.Content>
    </Card>
  );
}

type Props = {
  visible: boolean;
  day: WeekPlanDay | null;
  anchorDate?: string;
  cookProfileReady: boolean;
  onDismiss: () => void;
  onDayUpdated: (day: WeekPlanDay) => void;
  navigation: { navigate: (screen: string, params?: object) => void };
};

export function WeekPlanDaySheet({
  visible,
  day,
  anchorDate,
  cookProfileReady,
  onDismiss,
  onDayUpdated,
  navigation,
}: Props) {
  const { bump } = useAppRefresh();
  const [refreshingSlot, setRefreshingSlot] = useState<string | null>(null);
  const [changeMenuSlot, setChangeMenuSlot] = useState<string | null>(null);
  const [searchSlot, setSearchSlot] = useState<string | null>(null);
  const [addingShoppingSlot, setAddingShoppingSlot] = useState<string | null>(null);
  const [selectedPairsBySlot, setSelectedPairsBySlot] = useState<Record<string, string[]>>({});
  const [inventoryNames, setInventoryNames] = useState<string[]>([]);
  const [inventoryIds, setInventoryIds] = useState<Set<string>>(() => new Set());
  const [previewMeal, setPreviewMeal] = useState<MealOfDayMeal | null>(null);
  const [starringDish, setStarringDish] = useState<string | null>(null);
  const [regenerateSlot, setRegenerateSlot] = useState<string | null>(null);

  useEffect(() => {
    setSelectedPairsBySlot({});
  }, [day?.date]);

  useEffect(() => {
    if (!visible) {
      setPreviewMeal(null);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void api.fetchInventoryBuckets(['active', 'expiring']).then((buckets) => {
      if (!active) return;
      const items = [...(buckets.active ?? []), ...(buckets.expiring ?? [])];
      const names = items
        .map((item) => item.canonical_name.trim())
        .filter(Boolean);
      const ids = new Set(
        items
          .map((item) => item.ingredient_id?.trim())
          .filter((id): id is string => Boolean(id)),
      );
      setInventoryNames(names);
      setInventoryIds(ids);
    }).catch(() => {
      if (active) {
        setInventoryNames([]);
        setInventoryIds(new Set());
      }
    });
    return () => {
      active = false;
    };
  }, [visible, day?.date]);

  const today = anchorDate || todayDateKey();
  const title = day ? formatWeekPlanDayLabel(day.date, today) : 'Day plan';
  const orderedMeals = useMemo(() => (day ? mealsInOrder(day.meals) : []), [day]);

  useEffect(() => {
    setChangeMenuSlot(null);
    if (!visible) {
      setSearchSlot(null);
      setRegenerateSlot(null);
    }
  }, [day?.date, visible]);

  const applyDayResponse = (res: WeekPlanDayResponse, successLabel: string) => {
    if (!day) return;
    onDayUpdated({ date: day.date, meals: mealsFromDayResponse(res) });
    showAppSuccess(successLabel);
  };

  const handleRegenerateWithAI = async (
    mealSlot: string,
    category: MealSuggestionCategoryId,
    userPrompt: string,
    mealType: MealTypeFilterId,
  ) => {
    if (!day || !mealSlot) return;
    setRefreshingSlot(mealSlot);
    try {
      const res = await api.refreshWeekPlanDay(day.date, mealSlot, {
        category,
        userPrompt,
        mealType,
      });
      applyDayResponse(res, `${SLOT_LABELS[mealSlot] ?? mealSlot} updated`);
      setRegenerateSlot(null);
    } catch {
      showAppError('Could not regenerate this meal. Try again.');
    } finally {
      setRefreshingSlot(null);
    }
  };

  const handleSelectCatalogDish = async (dish: CatalogDishSearchItem) => {
    if (!day || !searchSlot) return;
    const slot = searchSlot;
    setSearchSlot(null);
    setRefreshingSlot(slot);
    try {
      const res = await api.setWeekPlanDish(day.date, slot, dish.id);
      applyDayResponse(res, `${SLOT_LABELS[slot] ?? slot} set to ${dish.name}`);
    } catch {
      showAppError('Could not update this meal. Try again.');
    } finally {
      setRefreshingSlot(null);
    }
  };

  const handleAddToShopping = async (meal: MealOfDayMeal, items: string[]) => {
    if (!items.length) {
      showAppInfo('Everything for this meal is already in your pantry.');
      return;
    }
    const slot = meal.meal_slot ?? 'meal';
    setAddingShoppingSlot(slot);
    try {
      await api.addBulkShoppingItems(
        items.map((name) => ({ name, qty: 0, unit: 'pcs' })),
      );
      showAppSuccess(`Added ${items.length} item${items.length === 1 ? '' : 's'} to shopping list`);
      bump('shopping');
    } catch {
      showAppError('Could not add to shopping list.');
    } finally {
      setAddingShoppingSlot(null);
    }
  };

  const togglePairSelection = (slot: string, item: string) => {
    setSelectedPairsBySlot((prev) => {
      const current = new Set(prev[slot] ?? []);
      if (current.has(item)) {
        current.delete(item);
      } else {
        current.add(item);
      }
      return { ...prev, [slot]: Array.from(current) };
    });
  };

  const cookSendItemCount = (slot: string) => 1 + (selectedPairsBySlot[slot]?.length ?? 0);

  const toggleStar = async (meal: MealOfDayMeal) => {
    if (!day || !meal.name?.trim()) return;

    setStarringDish(meal.name);
    try {
      const res = await api.starDish(meal.name);
      const slot = meal.meal_slot?.toLowerCase() ?? '';
      const meals = day.meals.map((m) =>
        m.meal_slot?.toLowerCase() === slot
          ? { ...m, star_count: res.star_count, user_starred: res.user_starred }
          : m,
      );
      onDayUpdated({ ...day, meals });
    } catch {
      showAppError('Could not update star.');
    } finally {
      setStarringDish(null);
    }
  };

  const cookItemsForMeal = (meal: MealOfDayMeal) => {
    const slot = meal.meal_slot?.toLowerCase() ?? '';
    const pairs = selectedPairsBySlot[slot] ?? [];
    return [meal.name, ...pairs].map((x) => x.trim()).filter(Boolean);
  };

  const navigateToCook = (params: CookRouteParams) => {
    onDismiss();
    navigation.navigate('Cook', cookNavParams(params));
  };

  const handleViewRecipe = (meal: MealOfDayMeal) => {
    if (!meal.dish_id?.trim()) return;
    navigateToCook({
      mode: 'cooking',
      dishId: meal.dish_id,
      dishName: meal.name,
    });
  };

  const handleSendToCook = (meal: MealOfDayMeal) => {
    if (!cookProfileReady) {
      showAppInfo('Add your cook profile with a WhatsApp number on the Cook tab first.');
      navigateToCook({ mode: 'cook', dishItems: cookItemsForMeal(meal), dishName: meal.name });
      return;
    }
    navigateToCook({
      mode: 'cook',
      dishItems: cookItemsForMeal(meal),
      dishName: meal.name,
    });
  };

  return (
    <>
    <BottomSheet
      visible={visible && searchSlot === null}
      onDismiss={onDismiss}
      title={title}
      subtitle={day?.date}
      scrollable
      maxHeightRatio={0.92}
    >
      {!day || !orderedMeals.length ? (
        <Text variant="bodyMedium" style={styles.empty}>
          No meals planned for this day yet.
        </Text>
      ) : (
        orderedMeals.map((meal) => {
          const slot = meal.meal_slot?.toLowerCase() ?? '';
          const slotLabel = SLOT_LABELS[slot] ?? slot;
          const ingredients = meal.ingredients ?? [];
          const pairsWith = meal.pairs_with?.filter((s) => s.trim()) ?? [];
          const selectedPairs = selectedPairsBySlot[slot] ?? [];
          const pairIngredientLines = ingredientsForSelectedPairs(
            selectedPairs,
            meal.pair_ingredients,
          );
          const allIngredients = combinedMealIngredients(ingredients, pairIngredientLines);
          const displayIngredients = majorIngredients(allIngredients);
          const hiddenIngredientCount = hiddenMajorIngredientCount(allIngredients);
          const shopItems = mealShopItemsMissing(meal, inventoryNames, selectedPairs, inventoryIds);

          return (
            <WeekPlanMealCard
              key={`${day.date}-${slot}`}
              meal={meal}
              slotLabel={slotLabel}
              displayIngredients={displayIngredients}
              hiddenIngredientCount={hiddenIngredientCount}
              pairsWith={pairsWith}
              selectedPairs={selectedPairs}
              shopItems={shopItems}
              cookProfileReady={cookProfileReady}
              changeMenuOpen={changeMenuSlot === slot}
              refreshing={refreshingSlot === slot}
              changeDisabled={refreshingSlot !== null}
              addingShopping={addingShoppingSlot === slot}
              cookSendItemCount={cookSendItemCount(slot)}
              starringDish={starringDish}
              onToggleStar={() => void toggleStar(meal)}
              onOpenChangeMenu={() => setChangeMenuSlot(slot)}
              onCloseChangeMenu={() => setChangeMenuSlot(null)}
              onRegenerateWithAI={() => {
                setChangeMenuSlot(null);
                setRegenerateSlot(slot);
              }}
              onChooseFromCatalog={() => {
                setChangeMenuSlot(null);
                setSearchSlot(slot);
              }}
              onTogglePair={(item) => togglePairSelection(slot, item)}
              onAddToShopping={() => void handleAddToShopping(meal, shopItems)}
              onSendToCook={() => handleSendToCook(meal)}
              onPreviewImage={() => setPreviewMeal(meal)}
              onViewRecipe={() => handleViewRecipe(meal)}
            />
          );
        })
      )}
    </BottomSheet>

    <DishSearchOverlay
      visible={searchSlot !== null}
      mealSlot={searchSlot ?? undefined}
      onClose={() => setSearchSlot(null)}
      onSelect={(dish) => void handleSelectCatalogDish(dish)}
    />

    <RegenerateMealSheet
      visible={regenerateSlot !== null}
      mealSlot={regenerateSlot ?? ''}
      loading={regenerateSlot !== null && refreshingSlot === regenerateSlot}
      onDismiss={() => {
        if (refreshingSlot === regenerateSlot) return;
        setRegenerateSlot(null);
      }}
      onSelectCategory={(category, userPrompt, mealType) => {
        if (!regenerateSlot) return;
        void handleRegenerateWithAI(regenerateSlot, category, userPrompt, mealType);
      }}
    />

    <DishImagePreviewModal
      visible={previewMeal != null}
      dishName={previewMeal?.name}
      dishId={previewMeal?.dish_id}
      onClose={() => setPreviewMeal(null)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  empty: { color: '#888', textAlign: 'center', paddingVertical: 24 },
  mealCard: { marginBottom: 14, borderRadius: 16, overflow: 'hidden' },
  mealCardBody: { paddingVertical: 14 },
  slotHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  mealFlowWrap: {
    width: '100%',
  },
  mealTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: MEAL_THUMB_GAP,
  },
  mealTextCol: {
    flex: 1,
    minWidth: 0,
  },
  mealThumb: {
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  mealThumbPressed: {
    opacity: 0.85,
  },
  changeBtn: {
    margin: 0,
    marginRight: -8,
  },
  changeBtnLabel: {
    fontWeight: '700',
    fontSize: 14,
  },
  slotLabel: { color: palette.primary, fontWeight: '700' },
  mealName: { fontWeight: '700', color: '#333', marginBottom: 4 },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginBottom: 0,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  metaText: { color: '#888' },
  starWrap: { flexDirection: 'row', alignItems: 'center' },
  starBtn: { margin: 0, width: 28, height: 28 },
  starCountText: { color: '#555', fontWeight: '700', minWidth: 14, marginLeft: -4 },
  diffBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  diffText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  description: { color: '#666', marginTop: 8, marginBottom: 4, lineHeight: 18 },
  ingLabel: { color: '#333', fontWeight: '700', marginTop: 8, marginBottom: 6 },
  pairsLabel: { color: '#333', fontWeight: '700', marginTop: 8, marginBottom: 6 },
  orderHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 8,
    marginBottom: 6,
  },
  orderLabel: { color: '#E65100', fontWeight: '700' },
  addListBtn: { margin: 0, minWidth: 0 },
  addListBtnLabel: { fontSize: 12, lineHeight: 16, marginVertical: 0 },
  addListBtnContent: { paddingHorizontal: 2, paddingVertical: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  actionBtn: { borderRadius: 10 },
  previewModal: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: 16,
    paddingBottom: 12,
    maxWidth: 560,
    width: '92%',
    alignSelf: 'center',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    paddingTop: 4,
  },
  previewTitle: {
    flex: 1,
    fontWeight: '700',
    color: '#333',
  },
  previewImage: {
    width: '100%',
    aspectRatio: 1.5,
    backgroundColor: '#EEF2EE',
  },
});
