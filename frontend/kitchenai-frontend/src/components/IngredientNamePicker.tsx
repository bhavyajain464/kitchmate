import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput as RNTextInput,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { IngredientSearchOverlay } from './IngredientSearchOverlay';
import { CatalogIngredient, ItemCatalog } from '../types';
import { useIngredientSearch } from '../hooks/useIngredientSearch';
import { defaultUnitForCatalogItem, resolveCatalogItem, toItemCatalog } from '../utils/ingredientUnits';
import {
  MAX_INLINE_OPTIONS,
  OPTION_MIN_HEIGHT,
  filterCatalog,
} from '../utils/ingredientSearch';
import { normalizeUnit } from '../utils/units';
import { palette } from '../theme';

const COMPACT_HEIGHT = 40;
const FULLSCREEN_BREAKPOINT = 1024;

export type IngredientPick = {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  food_group?: string;
  /** Snapshot for per-ingredient unit pills when catalog is not preloaded. */
  catalog?: ItemCatalog;
};

type Props = {
  /** Optional legacy full catalog; when omitted, search uses GET /ingredients?q= */
  catalog?: CatalogIngredient[];
  value: string;
  ingredientId?: string;
  onChangeText: (text: string) => void;
  onSelect: (pick: IngredientPick) => void;
  label?: string;
  placeholder?: string;
  compact?: boolean;
  style?: ViewStyle;
  /** Opens keyboard / full-screen search when mounted (e.g. first row in add modal). */
  autoFocus?: boolean;
};

function BorderFieldLabel({ label }: { label: string }) {
  return (
    <View style={styles.borderLabelWrap} pointerEvents="none">
      <Text variant="labelSmall" style={styles.borderLabel}>
        {label}
      </Text>
    </View>
  );
}

function formatUnits(item: CatalogIngredient): string {
  return (item.units?.length ? item.units : [item.default_unit])
    .map((u) => normalizeUnit(u))
    .join(' · ');
}

export function IngredientNamePicker({
  catalog = [],
  value,
  ingredientId,
  onChangeText,
  onSelect,
  label = 'Name',
  placeholder = 'Search ingredients…',
  compact = false,
  style,
  autoFocus = false,
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const useFullScreenSearch =
    Platform.OS !== 'web' || windowWidth < FULLSCREEN_BREAKPOINT;

  const [open, setOpen] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [query, setQuery] = useState(value);
  const inputRef = useRef<RNTextInput>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const didAutoFocus = useRef(false);

  const selected = useMemo(
    () => resolveCatalogItem(catalog, ingredientId, value),
    [catalog, ingredientId, value],
  );

  const displayValue = selected?.name ?? value;

  useEffect(() => {
    if (!open && !overlayVisible) setQuery(selected?.name ?? value ?? '');
  }, [open, overlayVisible, selected?.name, value]);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  useEffect(() => {
    if (!autoFocus) {
      didAutoFocus.current = false;
      return;
    }
    if (didAutoFocus.current) return;
    didAutoFocus.current = true;
    const timer = setTimeout(() => {
      if (useFullScreenSearch) {
        setOverlayVisible(true);
      } else {
        inputRef.current?.focus();
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [autoFocus, useFullScreenSearch]);

  const useRemoteSearch = catalog.length === 0;
  const searchEnabled = useRemoteSearch && (open || overlayVisible);
  const { results: remoteResults, loading: remoteLoading } = useIngredientSearch(query, searchEnabled);

  const options = useMemo(() => {
    if (useRemoteSearch) return remoteResults.slice(0, MAX_INLINE_OPTIONS);
    return filterCatalog(catalog, query, MAX_INLINE_OPTIONS);
  }, [useRemoteSearch, remoteResults, catalog, query]);

  const showDropdown = open && !useFullScreenSearch && (useRemoteSearch || catalog.length > 0);

  const applyPick = (item: CatalogIngredient) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    const unit = defaultUnitForCatalogItem(item);
    setQuery(item.name);
    onChangeText(item.name);
    setOpen(false);
    setOverlayVisible(false);
    onSelect({
      ingredient_id: item.ingredient_id,
      ingredient_name: item.name,
      unit,
      food_group: item.food_group,
      catalog: toItemCatalog(item),
    });
  };

  const openSearch = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    if (useFullScreenSearch) {
      setOverlayVisible(true);
      return;
    }
    inputRef.current?.focus();
    setOpen(true);
  };

  const handleFocus = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setOpen(true);
  };

  const handleBlur = () => {
    blurTimer.current = setTimeout(() => {
      setOpen(false);
      setQuery(selected?.name ?? value ?? '');
    }, 180);
  };

  const fieldBox = (
    <View style={[styles.nameBox, compact && styles.nameBoxCompact, (open || overlayVisible) && styles.nameBoxOpen]}>
      <BorderFieldLabel label={label} />
      {useFullScreenSearch ? (
        <View style={[styles.namePressable, compact && styles.namePressableCompact]}>
          <Text
            style={[
              styles.namePressableText,
              compact && styles.namePressableTextCompact,
              !displayValue && styles.namePlaceholder,
            ]}
            numberOfLines={1}
          >
            {displayValue || placeholder}
          </Text>
        </View>
      ) : (
        <RNTextInput
          ref={inputRef}
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            onChangeText(text);
            setOpen(true);
          }}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={[styles.nameInput, compact && styles.nameInputCompact]}
          placeholder={placeholder}
          placeholderTextColor={palette.textMuted}
          autoCapitalize="words"
          returnKeyType="next"
        />
      )}
      <View style={styles.chevron} pointerEvents="none">
        <Icon
          source={open || overlayVisible ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={palette.textMuted}
        />
      </View>
    </View>
  );

  return (
    <>
      <View
        style={[
          styles.fieldRoot,
          compact && styles.fieldRootCompact,
          open && !useFullScreenSearch && styles.fieldRootOpen,
          style,
        ]}
      >
        {useFullScreenSearch ? (
          <Pressable
            onPress={openSearch}
            accessibilityRole="button"
            accessibilityLabel={`${label}, ${displayValue || placeholder}`}
          >
            {fieldBox}
          </Pressable>
        ) : (
          fieldBox
        )}

        {showDropdown ? (
          <View style={styles.dropdown}>
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {remoteLoading ? (
                <Text style={styles.empty}>Searching…</Text>
              ) : options.length === 0 ? (
                <Text style={styles.empty}>
                  {useRemoteSearch
                    ? (query.trim() ? 'No ingredients match' : 'No suggestions')
                    : 'No ingredients match'}
                </Text>
              ) : (
                options.map((item) => {
                  const active = selected?.ingredient_id === item.ingredient_id;
                  return (
                    <Pressable
                      key={item.ingredient_id}
                      onPress={() => applyPick(item)}
                      style={[styles.option, active && styles.optionActive]}
                    >
                      <Text style={styles.optionName} numberOfLines={2}>
                        {item.name}
                      </Text>
                      <Text style={styles.optionMeta}>{formatUnits(item)}</Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        ) : null}
      </View>

      {useFullScreenSearch ? (
        <IngredientSearchOverlay
          visible={overlayVisible}
          catalog={catalog}
          remoteSearch={useRemoteSearch}
          initialQuery={query || displayValue}
          selectedId={selected?.ingredient_id}
          title="Search ingredients"
          onClose={() => setOverlayVisible(false)}
          onSelect={applyPick}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  fieldRoot: {
    marginBottom: 12,
    paddingTop: 6,
    zIndex: 1,
  },
  fieldRootCompact: {
    marginBottom: 0,
    paddingTop: 6,
  },
  fieldRootOpen: {
    zIndex: 30,
  },
  borderLabelWrap: {
    position: 'absolute',
    top: -9,
    left: 8,
    zIndex: 4,
    elevation: 4,
  },
  borderLabel: {
    color: palette.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: '#fff',
    paddingHorizontal: 4,
    lineHeight: 14,
  },
  nameBox: {
    width: '100%',
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: palette.border,
    backgroundColor: '#fff',
    justifyContent: 'center',
    overflow: 'visible',
  },
  nameBoxCompact: {
    height: COMPACT_HEIGHT,
    borderRadius: 10,
  },
  nameBoxOpen: {
    borderColor: palette.primary,
  },
  nameInput: {
    flex: 1,
    height: '100%',
    fontSize: 16,
    fontWeight: '500',
    color: palette.text,
    paddingHorizontal: 12,
    paddingRight: 34,
    paddingVertical: 0,
  },
  nameInputCompact: {
    fontSize: 14,
    paddingHorizontal: 10,
    paddingRight: 30,
  },
  namePressable: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingRight: 34,
  },
  namePressableCompact: {
    paddingHorizontal: 10,
    paddingRight: 30,
  },
  namePressableText: {
    fontSize: 16,
    fontWeight: '500',
    color: palette.text,
  },
  namePressableTextCompact: {
    fontSize: 14,
  },
  namePlaceholder: {
    color: palette.textMuted,
    fontWeight: '400',
  },
  chevron: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  dropdown: {
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: '#fff',
    overflow: 'hidden',
    maxHeight: 280,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  list: { maxHeight: 280 },
  option: {
    minHeight: OPTION_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  optionActive: { backgroundColor: 'rgba(245, 158, 11, 0.12)' },
  optionName: {
    color: palette.text,
    flex: 1,
    paddingRight: 8,
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 20,
  },
  optionMeta: { color: palette.textMuted, fontSize: 13 },
  empty: { color: palette.textMuted, fontSize: 13, padding: 16 },
});
