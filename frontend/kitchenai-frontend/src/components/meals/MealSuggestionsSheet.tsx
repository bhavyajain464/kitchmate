import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  IconButton,
  Text,
  TextInput,
} from 'react-native-paper';
import { BottomSheet } from '../BottomSheet';
import { FilterPill } from '../FilterPill';
import { MealTagPill, mealTagPillRowStyle } from './MealTagPill';
import { DishImage } from '../DishImage';
import { cookNavParams, type CookRouteParams } from '../../navigation/cookParams';
import { showAppError, showAppInfo, showAppSuccess } from '../../utils/alertMessage';
import { hiddenMajorIngredientCount, majorIngredients } from '../../utils/mealIngredients';
import {
  ingredientsForSelectedPairs,
  mealShopItemsMissing,
} from '../../utils/ingredientPantryMatch';
import { useAppRefresh } from '../../context/AppRefreshContext';
import { palette } from '../../theme';
import * as api from '../../services/api';

export interface SmartMeal {
  meal_slot?: string;
  dish_id?: string;
  name: string;
  description: string;
  ingredients: string[];
  ingredient_ids?: string[];
  items_to_order?: string[];
  cooking_time_mins: number;
  difficulty: string;
  why_this_meal: string;
  pairs_with?: string[];
  pair_ingredients?: Record<string, { ingredient_id: string; name: string }[] | string[]>;
  nutrition_notes?: string;
  star_count?: number;
  user_starred?: boolean;
}

export interface MealCategoryResult {
  id: string;
  title: string;
  description: string;
  meals: SmartMeal[];
}

const MEAL_TYPE_FILTERS = [
  { id: 'lunch_dinner', label: 'Main', icon: 'weather-sunset' },
  { id: 'breakfast', label: 'Breakfast', icon: 'weather-sunny' },
  { id: 'snack', label: 'Snack', icon: 'cookie-outline' },
  { id: 'dessert', label: 'Dessert', icon: 'cupcake' },
  { id: 'all', label: 'Any', icon: 'silverware-variant' },
] as const;

const COMPACT_FILTER_PILL = {
  paddingHorizontal: 10,
  paddingVertical: 5,
} as const;

export type MealTypeFilterId = (typeof MEAL_TYPE_FILTERS)[number]['id'];

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: '#388E3C',
  medium: '#689F38',
  hard: '#1B5E20',
};

const SLOT_LABELS: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
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

function combinedMealIngredients(
  ingredients: readonly string[],
  pairLines: readonly string[],
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const raw of [...ingredients, ...pairLines]) {
    const item = raw.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function IngredientPills({
  items,
  hiddenCount,
}: {
  items: string[];
  hiddenCount: number;
}) {
  if (!items.length && hiddenCount <= 0) return null;
  return (
    <View style={mealTagPillRowStyle.wrap}>
      {items.map((ing, i) => (
        <MealTagPill key={`${ing}-${i}`} label={ing} variant="ingredient" />
      ))}
      {hiddenCount > 0 ? (
        <MealTagPill label={`+${hiddenCount} more`} variant="ingredient" />
      ) : null}
    </View>
  );
}

type MealCardDetailsProps = {
  description?: string;
  displayIngredients: string[];
  hiddenIngredientCount: number;
  shopItems: string[];
  addingToShopping: boolean;
  shoppingDisabled: boolean;
  onAddToShopping: () => void;
};

function MealCardDetails({
  description,
  displayIngredients,
  hiddenIngredientCount,
  shopItems,
  addingToShopping,
  shoppingDisabled,
  onAddToShopping,
}: MealCardDetailsProps) {
  return (
    <>
      {description?.trim() ? (
        <Text variant="bodySmall" style={styles.description}>{description}</Text>
      ) : null}

      {displayIngredients.length > 0 ? (
        <>
          <Text variant="labelSmall" style={styles.ingLabel}>Ingredients</Text>
          <IngredientPills
            items={displayIngredients}
            hiddenCount={hiddenIngredientCount}
          />
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
              loading={addingToShopping}
              disabled={shoppingDisabled}
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
    </>
  );
}

type MealSuggestionCardProps = {
  meal: SmartMeal;
  idx: number;
  cookProfileReady: boolean;
  starringDish: string | null;
  selectedPairs: string[];
  cookSendItemCount: number;
  shopItems: string[];
  addingToShopping: boolean;
  shoppingDisabled: boolean;
  onToggleStar: (idx: number) => void;
  onTogglePair: (idx: number, item: string) => void;
  onAddToShopping: (meal: SmartMeal, idx: number) => void;
  onSendToCook: (meal: SmartMeal, idx: number) => void;
  onViewRecipe: (meal: SmartMeal) => void;
};

function MealSuggestionCard({
  meal,
  idx,
  cookProfileReady,
  starringDish,
  selectedPairs,
  cookSendItemCount,
  shopItems,
  addingToShopping,
  shoppingDisabled,
  onToggleStar,
  onTogglePair,
  onAddToShopping,
  onSendToCook,
  onViewRecipe,
}: MealSuggestionCardProps) {
  const { thumbWidth, onTopRowLayout } = useMealThumbWidth();
  const pairsWith = meal.pairs_with?.filter((s) => s.trim()) ?? [];
  const pairIngredientLines = ingredientsForSelectedPairs(
    selectedPairs,
    meal.pair_ingredients,
  );
  const allIngredients = combinedMealIngredients(meal.ingredients ?? [], pairIngredientLines);
  const displayIngredients = majorIngredients(allIngredients);
  const hiddenIngredientCount = hiddenMajorIngredientCount(allIngredients);

  const mealDetails = (
    <MealCardDetails
      description={meal.description}
      displayIngredients={displayIngredients}
      hiddenIngredientCount={hiddenIngredientCount}
      shopItems={shopItems}
      addingToShopping={addingToShopping}
      shoppingDisabled={shoppingDisabled}
      onAddToShopping={() => onAddToShopping(meal, idx)}
    />
  );

  const mealHeader = (
    <>
      {meal.meal_slot ? (
        <Text variant="labelLarge" style={styles.mealSlotLabel}>
          {SLOT_LABELS[meal.meal_slot] ?? meal.meal_slot}
        </Text>
      ) : null}
      <Text variant="titleMedium" style={styles.mealName}>{meal.name}</Text>

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <IconButton icon="clock-outline" size={16} iconColor="#888" style={{ margin: 0 }} />
          <Text variant="bodySmall" style={styles.metaText}>{meal.cooking_time_mins} min</Text>
        </View>
        <View style={styles.starWrap}>
          <IconButton
            icon={meal.user_starred ? 'star' : 'star-outline'}
            iconColor={meal.user_starred ? '#F5A623' : '#212121'}
            size={20}
            style={styles.starBtn}
            onPress={() => onToggleStar(idx)}
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
            { backgroundColor: (DIFFICULTY_COLORS[meal.difficulty] || '#888') + '18' },
          ]}
        >
          <Text
            style={[
              styles.diffText,
              { color: DIFFICULTY_COLORS[meal.difficulty] || '#888' },
            ]}
          >
            {meal.difficulty}
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
                  onPress={() => onTogglePair(idx, item)}
                />
              );
            })}
          </View>
        </>
      ) : null}
    </>
  );

  const mealImage = (
    <DishImage
      dishId={meal.dish_id}
      dishName={meal.name}
      variant="card"
      width={thumbWidth}
      borderRadius={12}
      style={styles.mealThumb}
      accessibilityLabel={`Photo of ${meal.name}`}
    />
  );

  return (
    <Card style={styles.mealCard} mode="elevated">
      <Card.Content style={styles.mealCardBody}>
        <View style={styles.mealFlowWrap} onLayout={onTopRowLayout}>
          <View style={styles.mealTopRow}>
            <View style={styles.mealTextCol}>
              {mealHeader}
            </View>
            {mealImage}
          </View>
          {mealDetails}
        </View>

        {meal.nutrition_notes ? (
          <View style={styles.mealBelowThumb}>
            <Text variant="bodySmall" style={styles.nutritionText}>{meal.nutrition_notes}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          {meal.dish_id ? (
            <Button
              mode="outlined"
              icon="book-open-page-variant"
              compact
              onPress={() => onViewRecipe(meal)}
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
            onPress={() => onSendToCook(meal, idx)}
            style={styles.actionBtn}
            buttonColor={cookProfileReady ? '#25D366' : '#9E9E9E'}
            contentStyle={{ paddingVertical: 2 }}
            disabled={!cookProfileReady}
          >
            {cookProfileReady
              ? cookSendItemCount > 1
                ? `Send to Cook (${cookSendItemCount} items)`
                : 'Send to Cook'
              : 'Set up Cook profile'}
          </Button>
        </View>
      </Card.Content>
    </Card>
  );
}

function MealTypePicker({
  value,
  onChange,
}: {
  value: MealTypeFilterId;
  onChange: (id: MealTypeFilterId) => void;
}) {
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.mealTypePillsScroll}
      contentContainerStyle={styles.mealTypePillsContent}
    >
      {MEAL_TYPE_FILTERS.map((opt) => (
        <FilterPill
          key={opt.id}
          label={opt.label}
          icon={opt.icon}
          selected={value === opt.id}
          onPress={() => onChange(opt.id)}
          style={COMPACT_FILTER_PILL}
        />
      ))}
    </ScrollView>
  );
}

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  loading: boolean;
  error: string | null;
  result: MealCategoryResult | null;
  userPrompt: string;
  onUserPromptChange: (value: string) => void;
  mealTypeFilter: MealTypeFilterId;
  onMealTypeFilterChange: (id: MealTypeFilterId) => void;
  onRegenerate: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  cookProfileReady: boolean;
  navigation: { navigate: (screen: string, params?: object) => void };
  onResultChange: (result: MealCategoryResult | null) => void;
};

export function MealSuggestionsSheet({
  visible,
  title,
  subtitle,
  loading,
  error,
  result,
  userPrompt,
  onUserPromptChange,
  mealTypeFilter,
  onMealTypeFilterChange,
  onRegenerate,
  onRetry,
  onDismiss,
  cookProfileReady,
  navigation,
  onResultChange,
}: Props) {
  const { bump } = useAppRefresh();
  const [selectedPairsByMeal, setSelectedPairsByMeal] = useState<Record<number, string[]>>({});
  const [starringDish, setStarringDish] = useState<string | null>(null);
  const [addingShoppingIdx, setAddingShoppingIdx] = useState<number | null>(null);
  const [inventoryNames, setInventoryNames] = useState<string[]>([]);
  const [inventoryIds, setInventoryIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setSelectedPairsByMeal({});
  }, [result]);

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
  }, [visible, result]);

  const togglePairSelection = (mealIndex: number, item: string) => {
    setSelectedPairsByMeal((prev) => {
      const current = new Set(prev[mealIndex] ?? []);
      if (current.has(item)) {
        current.delete(item);
      } else {
        current.add(item);
      }
      return { ...prev, [mealIndex]: Array.from(current) };
    });
  };

  const cookSendItemCount = (mealIndex: number) =>
    1 + (selectedPairsByMeal[mealIndex]?.length ?? 0);

  const toggleStar = async (mealIndex: number) => {
    const meal = result?.meals?.[mealIndex];
    if (!meal?.name?.trim()) return;

    setStarringDish(meal.name);
    try {
      const res = await api.starDish(meal.name);
      if (!result) return;
      const meals = [...result.meals];
      meals[mealIndex] = {
        ...meals[mealIndex],
        star_count: res.star_count,
        user_starred: res.user_starred,
      };
      onResultChange({ ...result, meals });
    } catch {
      showAppError('Could not update star.');
    } finally {
      setStarringDish(null);
    }
  };

  const cookItemsForMeal = (meal: SmartMeal, mealIndex: number) => {
    const pairs = selectedPairsByMeal[mealIndex] ?? [];
    return [meal.name, ...pairs].map((x) => x.trim()).filter(Boolean);
  };

  const navigateToCook = (params: CookRouteParams) => {
    onDismiss();
    navigation.navigate('Cook', cookNavParams(params));
  };

  const openCookingRecipe = (meal: SmartMeal) => {
    if (!meal.dish_id?.trim()) return;
    navigateToCook({
      mode: 'cooking',
      dishId: meal.dish_id,
      dishName: meal.name,
    });
  };

  const sendToCook = (meal: SmartMeal, mealIndex: number) => {
    navigateToCook({
      mode: 'cook',
      dishItems: cookItemsForMeal(meal, mealIndex),
      dishName: meal.name,
    });
  };

  const addToShopping = async (meal: SmartMeal, mealIndex: number) => {
    const selectedPairs = selectedPairsByMeal[mealIndex] ?? [];
    const items = mealShopItemsMissing(meal, inventoryNames, selectedPairs, inventoryIds);
    if (!items.length) {
      showAppInfo('Everything for this meal is already in your pantry.');
      return;
    }
    setAddingShoppingIdx(mealIndex);
    try {
      await api.addBulkShoppingItems(
        items.map((name) => ({ name, qty: 0, unit: 'pcs' })),
      );
      showAppSuccess(`Added ${items.length} item${items.length === 1 ? '' : 's'} to shopping list`);
      bump('shopping');
    } catch {
      showAppError('Could not add to shopping list.');
    } finally {
      setAddingShoppingIdx(null);
    }
  };

  return (
    <>
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={title}
      subtitle={subtitle}
      scrollable
      maxHeightRatio={0.92}
      dismissDisabled={loading}
    >
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#2E7D32" />
          <Text variant="titleSmall" style={styles.loadingText}>
            Finding {title} ideas...
          </Text>
          <Text variant="bodySmall" style={styles.loadingSub}>
            Analyzing your inventory & preferences
          </Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <IconButton icon="alert-circle" iconColor="#C62828" size={32} style={{ margin: 0 }} />
          <Text variant="bodyMedium" style={styles.errorText}>{error}</Text>
          <View style={styles.errorActions}>
            <Button mode="contained" compact onPress={onRetry} buttonColor="#C62828">
              Retry
            </Button>
          </View>
        </View>
      ) : result ? (
        <>
          <View style={styles.controlsPanel}>
            <TextInput
              mode="outlined"
              placeholder="What are you in the mood for?"
              value={userPrompt}
              onChangeText={onUserPromptChange}
              onSubmitEditing={onRegenerate}
              returnKeyType="search"
              style={styles.preferenceInput}
              outlineColor="#E0E0E0"
              activeOutlineColor="#2E7D32"
              outlineStyle={{ borderRadius: 10 }}
              dense
            />

            <MealTypePicker value={mealTypeFilter} onChange={onMealTypeFilterChange} />
          </View>

          {result.meals?.map((meal, idx) => {
            const selectedPairs = selectedPairsByMeal[idx] ?? [];
            const shopItems = mealShopItemsMissing(meal, inventoryNames, selectedPairs, inventoryIds);
            return (
            <MealSuggestionCard
              key={idx}
              meal={meal}
              idx={idx}
              cookProfileReady={cookProfileReady}
              starringDish={starringDish}
              selectedPairs={selectedPairs}
              cookSendItemCount={cookSendItemCount(idx)}
              shopItems={shopItems}
              addingToShopping={addingShoppingIdx === idx}
              shoppingDisabled={addingShoppingIdx !== null}
              onToggleStar={(i) => void toggleStar(i)}
              onTogglePair={togglePairSelection}
              onAddToShopping={(m, i) => void addToShopping(m, i)}
              onSendToCook={sendToCook}
              onViewRecipe={(m) => openCookingRecipe(m)}
            />
            );
          })}
        </>
      ) : null}
    </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 12,
  },
  loadingText: { marginTop: 16, fontWeight: '600', color: '#333' },
  loadingSub: { marginTop: 6, color: '#999', textAlign: 'center' },
  errorText: { color: '#C62828', marginTop: 8, textAlign: 'center' },
  errorActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  controlsPanel: {
    backgroundColor: '#F5F7F5',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E4EAE4',
  },
  preferenceInput: {
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  mealTypePillsScroll: {
    width: '100%',
  },
  mealTypePillsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 1,
  },
  mealCard: { marginBottom: 14, borderRadius: 16, overflow: 'hidden' },
  mealCardBody: { paddingVertical: 14 },
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
  mealBelowThumb: {
    width: '100%',
  },
  mealSlotLabel: { color: '#2E7D32', fontWeight: '700', marginBottom: 6 },
  mealName: { fontWeight: '700', color: '#333', marginBottom: 4 },
  starWrap: { flexDirection: 'row', alignItems: 'center' },
  starBtn: { margin: 0, width: 28, height: 28 },
  starCountText: { color: '#555', fontWeight: '700', minWidth: 14, marginLeft: -4 },
  diffBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  diffText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginBottom: 0,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  metaText: { color: '#888' },
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
  nutritionText: { color: '#666', fontStyle: 'italic', marginBottom: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  actionBtn: { borderRadius: 10 },
});
