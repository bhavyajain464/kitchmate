import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  TextInput as RNTextInput,
  View,
} from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DishImage } from './DishImage';
import { MAX_DISH_SEARCH_RESULTS, DISH_ROW_MIN_HEIGHT } from '../utils/dishSearch';
import { fetchDishesCatalog } from '../services/api';
import type { CatalogDishSearchItem } from '../types';
import { palette } from '../theme';
import { keyboardAvoidingBehavior } from '../utils/keyboardAvoidance';

type Props = {
  visible: boolean;
  mealSlot?: string;
  title?: string;
  onClose: () => void;
  onSelect: (dish: CatalogDishSearchItem) => void;
};

const SLOT_LABELS: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

export function DishSearchOverlay({
  visible,
  mealSlot,
  title,
  onClose,
  onSelect,
}: Props) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<RNTextInput>(null);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<CatalogDishSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [visible, mealSlot]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      void fetchDishesCatalog({
        q: query,
        mealSlot,
        limit: MAX_DISH_SEARCH_RESULTS,
      })
        .then((items) => {
          if (!active) return;
          setOptions(items ?? []);
        })
        .catch(() => {
          if (!active) return;
          setOptions([]);
          setError('Could not load dishes. Try again.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, query.trim() ? 200 : 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [visible, query, mealSlot]);

  const headerTitle = useMemo(
    () => title ?? (mealSlot ? `Choose ${SLOT_LABELS[mealSlot] ?? mealSlot} dish` : 'Choose a dish'),
    [title, mealSlot],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.root, { paddingTop: insets.top }]}
        behavior={keyboardAvoidingBehavior()}
      >
        <View style={styles.header}>
          <IconButton icon="close" size={24} onPress={onClose} accessibilityLabel="Close search" />
          <Text variant="titleMedium" style={styles.headerTitle}>
            {headerTitle}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.searchWrap}>
          <RNTextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            style={styles.searchInput}
            placeholder="Search dishes…"
            placeholderTextColor={palette.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={palette.primary} />
          </View>
        ) : null}

        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : null}

        <FlatList
          data={options}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom, 16) },
          ]}
          ListEmptyComponent={(
            !loading ? <Text style={styles.empty}>No dishes match</Text> : null
          )}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onSelect(item)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <DishImage
                dishId={item.id}
                dishName={item.name}
                variant="card"
                width={44}
                borderRadius={10}
                accessibilityLabel={item.name}
              />
              <View style={styles.rowCopy}>
                <Text style={styles.rowName} numberOfLines={2}>
                  {item.name}
                </Text>
                {item.cook_time_mins > 0 ? (
                  <Text style={styles.rowMeta}>{item.cook_time_mins} min</Text>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '700',
    color: palette.text,
  },
  headerSpacer: {
    width: 48,
  },
  searchWrap: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.borderLight,
  },
  searchInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: palette.border,
    backgroundColor: palette.background,
    paddingHorizontal: 14,
    fontSize: 17,
    color: palette.text,
  },
  loadingWrap: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  error: {
    textAlign: 'center',
    color: '#C62828',
    paddingHorizontal: 16,
    paddingBottom: 8,
    fontSize: 14,
  },
  listContent: {
    flexGrow: 1,
  },
  row: {
    minHeight: DISH_ROW_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.borderLight,
  },
  rowPressed: {
    backgroundColor: palette.background,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: palette.text,
    lineHeight: 22,
  },
  rowMeta: {
    fontSize: 13,
    color: palette.textMuted,
    flexShrink: 0,
  },
  empty: {
    textAlign: 'center',
    color: palette.textMuted,
    paddingVertical: 32,
    fontSize: 15,
  },
});
