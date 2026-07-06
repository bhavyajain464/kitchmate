import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, IconButton, Text, TextInput } from 'react-native-paper';
import { DishImage } from './DishImage';
import { DishRecipeSheet } from './DishRecipeSheet';
import { TourTarget } from './tour/TourTarget';
import { useProductTour } from '../context/ProductTourContext';
import { APP_TOUR_TARGET_IDS } from '../tour/appTourSteps';
import { DISH_RECIPE_PAGE_SIZE, fetchDishRecipePage } from '../services/api';
import type { DishRecipeSummary } from '../types';
import { palette } from '../theme';
import { scrollFlatListToTop, useFlatListOnEndReached, useWebFlatListScroll, webFlatListContentStyle } from '../utils/infiniteScroll';
import { userFacingError } from '../utils/userFacingError';

type Props = {
  intentToken?: number;
  initialSearch?: string;
  expandDishId?: string;
  contentPaddingBottom?: number;
  /** Product tour: switch to cooking mode and highlight the recipes list. */
  tourRecipesStep?: boolean;
  /** Called once after a navigation-driven search/expand is applied. */
  onIntentConsumed?: () => void;
};

const THUMB_SIZE = 72;

function formatTime(summary: DishRecipeSummary) {
  const mins = summary.total_time_minutes ?? summary.cook_time_minutes ?? summary.prep_time_minutes;
  if (mins == null || mins <= 0) return null;
  return `${mins} min`;
}

function metaLine(item: DishRecipeSummary) {
  return [
    formatTime(item),
    item.ingredient_count > 0 ? `${item.ingredient_count} ingredients` : null,
    item.step_count > 0 ? `${item.step_count} steps` : null,
  ].filter(Boolean).join(' · ');
}

function RecipeRow({
  item,
  onPress,
}: {
  item: DishRecipeSummary;
  onPress: () => void;
}) {
  const subtitle = metaLine(item);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <DishImage
        dishId={item.dish_id}
        dishName={item.dish_name || item.title}
        variant="thumb"
        width={THUMB_SIZE}
        borderRadius={10}
        style={styles.thumb}
        accessibilityLabel={`Photo of ${item.dish_name || item.title}`}
      />
      <View style={styles.rowBody}>
        <Text variant="titleSmall" style={styles.rowTitle} numberOfLines={2}>
          {item.dish_name || item.title}
        </Text>
        {subtitle ? (
          <Text variant="bodySmall" style={styles.rowMeta} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <IconButton
        icon="chevron-right"
        size={20}
        iconColor="#9E9E9E"
        style={styles.chevron}
      />
    </Pressable>
  );
}

export function CookingRecipesPanel({
  intentToken = 0,
  initialSearch = '',
  expandDishId = '',
  contentPaddingBottom = 24,
  tourRecipesStep = false,
  onIntentConsumed,
}: Props) {
  const { requestTargetRemeasure } = useProductTour();
  const appliedIntentToken = useRef(0);
  const requestGen = useRef(0);
  const nextOffsetRef = useRef(0);
  const resetEndReachedRef = useRef<() => void>(() => {});
  const resetUserScrollRef = useRef<() => void>(() => {});
  const listRef = useRef<FlatList<DishRecipeSummary>>(null);
  const loadPageRef = useRef<(offset: number, append: boolean) => Promise<void>>(async () => {});

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [summaries, setSummaries] = useState<DishRecipeSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedDish, setSelectedDish] = useState<DishRecipeSummary | null>(null);

  useEffect(() => {
    if (!intentToken || intentToken <= appliedIntentToken.current) return;
    appliedIntentToken.current = intentToken;

    const q = initialSearch.trim();
    const id = expandDishId.trim();
    if (q) {
      setSearch(q);
      setDebouncedSearch(q);
    }
    if (id) {
      setSelectedDish({
        dish_id: id,
        dish_name: q || id,
        title: q || id,
        ingredient_count: 0,
        step_count: 0,
      });
    }
    onIntentConsumed?.();
  }, [intentToken, initialSearch, expandDishId, onIntentConsumed]);

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
      setLoadError('');
      nextOffsetRef.current = 0;
      resetEndReachedRef.current();
      resetUserScrollRef.current();
    }
    try {
      const page = await fetchDishRecipePage({
        q: debouncedSearch,
        offset,
        limit: DISH_RECIPE_PAGE_SIZE,
      });
      if (gen !== requestGen.current) return;
      setSummaries((prev) => (append ? [...prev, ...page.items] : page.items));
      nextOffsetRef.current = offset + page.items.length;
      setTotal(page.total);
      setHasMore(page.has_more);
    } catch (err) {
      if (gen !== requestGen.current) return;
      if (!append) {
        setSummaries([]);
        setTotal(0);
        setHasMore(false);
      }
      setLoadError(userFacingError(err, 'Could not load recipes.'));
    } finally {
      if (gen === requestGen.current) {
        setLoading(false);
        setLoadingMore(false);
        if (!append) {
          requestAnimationFrame(() => scrollFlatListToTop(listRef));
        }
      }
    }
  }, [debouncedSearch]);

  useEffect(() => {
    void loadPage(0, false);
  }, [loadPage]);

  useEffect(() => {
    if (!tourRecipesStep || loading) return;
    requestTargetRemeasure(APP_TOUR_TARGET_IDS.cookRecipesList);
  }, [tourRecipesStep, loading, summaries.length, requestTargetRemeasure]);

  const loadPageMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    await loadPage(nextOffsetRef.current, true);
  }, [loadingMore, hasMore, loadPage]);

  const allowLoadMoreRef = useRef(() => true);
  const loadPageMoreRef = useRef(loadPageMore);
  loadPageMoreRef.current = loadPageMore;

  const { handleListScroll, allowLoadMore, resetUserScroll } = useWebFlatListScroll(
    listRef,
    () => {
      if (!allowLoadMoreRef.current()) return;
      void loadPageMoreRef.current();
    },
  );
  allowLoadMoreRef.current = allowLoadMore;
  resetUserScrollRef.current = resetUserScroll;

  const loadMore = useCallback(async () => {
    if (!allowLoadMore()) return;
    await loadPageMore();
  }, [allowLoadMore, loadPageMore]);

  const { flatListProps, resetEndReached } = useFlatListOnEndReached({
    onLoadMore: loadMore,
    hasMore,
    loading,
    loadingMore,
  });
  resetEndReachedRef.current = resetEndReached;

  const emptyLabel = useMemo(() => {
    if (debouncedSearch) return `No recipes match "${debouncedSearch}".`;
    return 'No recipes imported yet.';
  }, [debouncedSearch]);

  const listHeader = total > 0 ? (
    <Text variant="labelMedium" style={styles.countLabel}>
      {total} recipe{total === 1 ? '' : 's'}
    </Text>
  ) : null;

  const listFooter = loadingMore ? (
    <ActivityIndicator color={palette.primary} style={styles.footerLoader} />
  ) : null;

  const listContentStyle = useMemo(
    () => webFlatListContentStyle({ paddingBottom: contentPaddingBottom }, summaries.length),
    [contentPaddingBottom, summaries.length],
  );

  return (
    <TourTarget id={APP_TOUR_TARGET_IDS.cookRecipesList} style={styles.wrap}>
      <TextInput
        mode="outlined"
        placeholder="Search dishes with recipes"
        value={search}
        onChangeText={setSearch}
        left={<TextInput.Icon icon="magnify" />}
        style={styles.search}
        outlineColor="#E0E0E0"
        activeOutlineColor={palette.primary}
        outlineStyle={{ borderRadius: 12 }}
        dense
      />

      <View style={styles.listSlot}>
      {loading ? (
        <ActivityIndicator color={palette.primary} style={styles.loader} />
      ) : loadError ? (
        <Text variant="bodyMedium" style={styles.error}>{loadError}</Text>
      ) : summaries.length === 0 ? (
        <Text variant="bodyMedium" style={styles.empty}>{emptyLabel}</Text>
      ) : (
        <FlatList
          ref={listRef}
          data={summaries}
          keyExtractor={(item) => item.dish_id}
          style={styles.listFlex}
          contentContainerStyle={listContentStyle}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={summaries.length > 0}
          onScroll={handleListScroll}
          scrollEventThrottle={16}
          {...flatListProps}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          renderItem={({ item }) => (
            <RecipeRow item={item} onPress={() => setSelectedDish(item)} />
          )}
        />
      )}
      </View>

      <DishRecipeSheet
        visible={selectedDish != null}
        dishId={selectedDish?.dish_id}
        dishName={selectedDish?.dish_name || selectedDish?.title}
        onDismiss={() => setSelectedDish(null)}
      />
    </TourTarget>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0, paddingHorizontal: 16, paddingTop: 4 },
  search: { marginBottom: 10, backgroundColor: '#fff' },
  listSlot: { flex: 1, minHeight: 0 },
  listFlex: { flex: 1, minHeight: 0 },
  loader: { marginTop: 32 },
  footerLoader: { marginVertical: 16 },
  error: { color: '#C62828', textAlign: 'center', marginTop: 24, lineHeight: 22 },
  empty: { color: palette.textSecondary, textAlign: 'center', marginTop: 24 },
  countLabel: { color: '#888', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8F5E9',
    padding: 10,
    marginBottom: 10,
  },
  rowPressed: { opacity: 0.92 },
  thumb: { flexShrink: 0 },
  rowBody: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 2 },
  rowTitle: { fontWeight: '700', color: '#1A1A1A', lineHeight: 20 },
  rowMeta: { color: '#888' },
  chevron: { margin: 0, width: 28, height: 28 },
});
