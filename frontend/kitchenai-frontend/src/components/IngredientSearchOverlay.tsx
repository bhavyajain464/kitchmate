import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import type { CatalogIngredient } from '../types';
import { useIngredientSearch } from '../hooks/useIngredientSearch';
import {
  MAX_FULLSCREEN_OPTIONS,
  OPTION_MIN_HEIGHT,
  filterCatalog,
} from '../utils/ingredientSearch';
import { normalizeUnit } from '../utils/units';
import { palette } from '../theme';
import { keyboardAvoidingBehavior } from '../utils/keyboardAvoidance';

type Props = {
  visible: boolean;
  catalog?: CatalogIngredient[];
  /** When true (default if catalog empty), search via GET /ingredients?q= */
  remoteSearch?: boolean;
  initialQuery?: string;
  selectedId?: string;
  title?: string;
  onClose: () => void;
  onSelect: (item: CatalogIngredient) => void;
};

export function IngredientSearchOverlay({
  visible,
  catalog = [],
  remoteSearch,
  initialQuery = '',
  selectedId,
  title = 'Search ingredients',
  onClose,
  onSelect,
}: Props) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<RNTextInput>(null);
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    if (!visible) return;
    setQuery(initialQuery);
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [visible, initialQuery]);

  const useRemote = remoteSearch ?? catalog.length === 0;
  const { results: remoteResults, loading: remoteLoading } = useIngredientSearch(query, visible && useRemote);

  const options = useMemo(() => {
    if (useRemote) return remoteResults.slice(0, MAX_FULLSCREEN_OPTIONS);
    return filterCatalog(catalog, query, MAX_FULLSCREEN_OPTIONS);
  }, [useRemote, remoteResults, catalog, query]);

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
            {title}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.searchWrap}>
          <RNTextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            style={styles.searchInput}
            placeholder="Type to search…"
            placeholderTextColor={palette.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        <FlatList
          data={options}
          keyExtractor={(item) => item.ingredient_id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom, 16) },
          ]}
          ListEmptyComponent={(
            <Text style={styles.empty}>
              {remoteLoading
                ? 'Searching…'
                : useRemote
                  ? (query.trim() ? 'No ingredients match' : 'No suggestions')
                  : 'No ingredients match'}
            </Text>
          )}
          renderItem={({ item }) => {
            const active = selectedId === item.ingredient_id;
            const units = (item.units?.length ? item.units : [item.default_unit])
              .map((u) => normalizeUnit(u))
              .join(' · ');
            return (
              <Pressable
                onPress={() => onSelect(item)}
                style={({ pressed }) => [
                  styles.row,
                  active && styles.rowActive,
                  pressed && styles.rowPressed,
                ]}
              >
                <Text style={styles.rowName} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.rowMeta}>{units}</Text>
              </Pressable>
            );
          }}
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
  listContent: {
    flexGrow: 1,
  },
  row: {
    minHeight: OPTION_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.borderLight,
  },
  rowActive: {
    backgroundColor: palette.primaryContainer,
  },
  rowPressed: {
    backgroundColor: palette.background,
  },
  rowName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: palette.text,
    paddingRight: 12,
    lineHeight: 22,
  },
  rowMeta: {
    fontSize: 13,
    color: palette.textMuted,
    flexShrink: 0,
  },
  empty: {
    color: palette.textMuted,
    fontSize: 15,
    textAlign: 'center',
    padding: 24,
  },
});
