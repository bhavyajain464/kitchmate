import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from 'react-native-paper';
import { ExpiryDateBox } from '../ExpiryDateBox';
import { IngredientNamePicker } from '../IngredientNamePicker';
import { QtyUnitStrip } from '../QtyUnitStrip';
import { CatalogIngredient, ItemCatalog } from '../../types';
import { coerceUnit, resolveCatalogItem, unitsForCatalogItem } from '../../utils/ingredientUnits';
import { palette } from '../../theme';

export type InventoryDraftRow = {
  key: string;
  name: string;
  qty: string;
  unit: string;
  expiry: string;
  ingredientId?: string;
  foodGroup?: string;
  catalog?: ItemCatalog;
};

export const STACKED_ROW_BREAKPOINT = 560;

const SP = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
} as const;

const ACTION_SIZE = 40;
const ACTION_COLUMN = ACTION_SIZE + SP.sm;
const EXPIRY_COLUMN = 136;

type RowActionProps = {
  isLastRow: boolean;
  canAdd: boolean;
  onAdd: () => void;
  onRemove: () => void;
};

function RowActionButton({ isLastRow, canAdd, onAdd, onRemove }: RowActionProps) {
  if (isLastRow) {
    return (
      <Pressable
        onPress={onAdd}
        disabled={!canAdd}
        style={({ pressed }) => [
          styles.rowActionBtn,
          !canAdd && styles.rowActionBtnDisabled,
          pressed && canAdd && styles.rowActionBtnPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Add another row"
        accessibilityState={{ disabled: !canAdd }}
      >
        <Icon
          source="plus"
          size={20}
          color={canAdd ? palette.primary : palette.textMuted}
        />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onRemove}
      style={({ pressed }) => [
        styles.rowActionBtn,
        styles.rowActionBtnRemove,
        pressed && styles.rowActionBtnPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel="Remove row"
    >
      <Icon source="minus" size={20} color={palette.textSecondary} />
    </Pressable>
  );
}

export type InventoryItemRowEditorProps = {
  row: InventoryDraftRow;
  isLastRow: boolean;
  isLastInList: boolean;
  stacked: boolean;
  catalog?: CatalogIngredient[];
  /** When false, hides +/- row actions (edit single item). */
  showRowActions?: boolean;
  /** Shopping rows omit expiry; keeps name + qty/unit layout only. */
  hideExpiry?: boolean;
  /** Focus / open ingredient search when the row mounts (first row in add modal). */
  autoFocusName?: boolean;
  canAdd?: boolean;
  onUpdate: (patch: Partial<Omit<InventoryDraftRow, 'key'>>) => void;
  onAddRow?: () => void;
  onRemoveRow?: () => void;
};

function NameField({
  catalog,
  row,
  onUpdate,
  autoFocus,
  style,
}: {
  catalog?: CatalogIngredient[];
  row: InventoryDraftRow;
  onUpdate: (patch: Partial<Omit<InventoryDraftRow, 'key'>>) => void;
  autoFocus?: boolean;
  style?: object;
}) {
  const pickerCatalog =
    catalog?.length ? catalog : row.catalog ? [row.catalog as CatalogIngredient] : [];

  return (
    <IngredientNamePicker
      catalog={pickerCatalog}
      value={row.name}
      ingredientId={row.ingredientId}
      onChangeText={(name) =>
        onUpdate({ name, ingredientId: undefined, foodGroup: undefined, catalog: undefined })
      }
      onSelect={(pick) =>
        onUpdate({
          name: pick.ingredient_name,
          unit: pick.unit,
          ingredientId: pick.ingredient_id,
          foodGroup: pick.food_group,
          catalog: pick.catalog,
        })
      }
      label="Name"
      placeholder="Search ingredients…"
      compact
      autoFocus={autoFocus}
      style={style}
    />
  );
}

export function InventoryItemRowEditor({
  row,
  isLastRow,
  isLastInList,
  stacked,
  catalog,
  showRowActions = true,
  hideExpiry = false,
  autoFocusName = false,
  canAdd = false,
  onUpdate,
  onAddRow = () => {},
  onRemoveRow = () => {},
}: InventoryItemRowEditorProps) {
  const catalogItem = useMemo(() => {
    if (row.catalog) return row.catalog as CatalogIngredient;
    return resolveCatalogItem(catalog ?? [], row.ingredientId, row.name);
  }, [row.catalog, catalog, row.ingredientId, row.name]);
  const allowedUnits = useMemo(() => unitsForCatalogItem(catalogItem), [catalogItem]);

  useEffect(() => {
    const next = coerceUnit(row.unit, allowedUnits);
    if (next !== row.unit) onUpdate({ unit: next });
  }, [allowedUnits, row.unit, onUpdate]);

  const action = showRowActions ? (
    <RowActionButton
      isLastRow={isLastRow}
      canAdd={canAdd}
      onAdd={onAddRow}
      onRemove={onRemoveRow}
    />
  ) : null;

  const stackedFieldsStyle = showRowActions
    ? [styles.stackedFields, { paddingRight: ACTION_COLUMN }]
    : styles.stackedFields;

  if (stacked) {
    return (
      <View style={[styles.entryCard, isLastInList && styles.entryCardLast]}>
        <View style={styles.stackedRow}>
          <View style={styles.stackedMain}>
            <View style={stackedFieldsStyle}>
              {hideExpiry ? (
                <NameField
                  catalog={catalog}
                  row={row}
                  onUpdate={onUpdate}
                  autoFocus={autoFocusName}
                  style={styles.nameField}
                />
              ) : (
                <View style={styles.identityRow}>
                  <NameField
                    catalog={catalog}
                    row={row}
                    onUpdate={onUpdate}
                    autoFocus={autoFocusName}
                    style={styles.nameField}
                  />
                  <View style={styles.expirySlot}>
                    <ExpiryDateBox
                      value={row.expiry}
                      onChange={(expiry) => onUpdate({ expiry })}
                      compact
                    />
                  </View>
                </View>
              )}

              <QtyUnitStrip
                qty={row.qty}
                unit={row.unit}
                onQtyChange={(qty) => onUpdate({ qty })}
                onUnitChange={(unit) => onUpdate({ unit })}
                allowedUnits={allowedUnits}
              />
            </View>

            {showRowActions ? (
              <View style={styles.stackedActionColumn} pointerEvents="box-none">
                {action}
              </View>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.entryCard, isLastInList && styles.entryCardLast]}>
      <View style={styles.inlineRow}>
        <View style={styles.inlineNameSlot}>
          <NameField
            catalog={catalog}
            row={row}
            onUpdate={onUpdate}
            autoFocus={autoFocusName}
            style={styles.nameField}
          />
        </View>

        <QtyUnitStrip
          qty={row.qty}
          unit={row.unit}
          onQtyChange={(qty) => onUpdate({ qty })}
          onUnitChange={(unit) => onUpdate({ unit })}
          allowedUnits={allowedUnits}
          flexGrow
        />

        {!hideExpiry ? (
          <View style={styles.inlineExpirySlot}>
            <ExpiryDateBox
              value={row.expiry}
              onChange={(expiry) => onUpdate({ expiry })}
              compact
              style={styles.expiryFieldInline}
            />
          </View>
        ) : null}

        {showRowActions ? (
          <View style={styles.inlineActionCell}>{action}</View>
        ) : null}
      </View>
    </View>
  );
}

export const inventoryRowListStyles = StyleSheet.create({
  listDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.border,
    marginBottom: SP.md,
  },
});

const styles = StyleSheet.create({
  entryCard: {
    marginBottom: SP.md,
    paddingBottom: SP.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.borderLight,
  },
  entryCardLast: {
    marginBottom: SP.sm,
    paddingBottom: 0,
    borderBottomWidth: 0,
  },
  stackedRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  stackedMain: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
  },
  stackedFields: {
    gap: SP.sm,
    minWidth: 0,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SP.sm,
  },
  expirySlot: {
    width: EXPIRY_COLUMN,
    flexShrink: 0,
  },
  stackedActionColumn: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: ACTION_COLUMN,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SP.sm,
    width: '100%',
  },
  inlineNameSlot: {
    flex: 1,
    flexShrink: 1,
    minWidth: 88,
  },
  inlineExpirySlot: {
    width: EXPIRY_COLUMN,
    flexShrink: 0,
  },
  expiryFieldInline: {
    width: '100%',
    marginBottom: 0,
  },
  nameField: {
    flex: 1,
    minWidth: 0,
  },
  inlineActionCell: {
    paddingTop: 6,
    justifyContent: 'flex-end',
    alignItems: 'center',
    flexShrink: 0,
  },
  rowActionBtn: {
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    borderRadius: ACTION_SIZE / 2,
    borderWidth: 1.5,
    borderColor: palette.primary,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowActionBtnRemove: {
    borderColor: palette.border,
  },
  rowActionBtnDisabled: {
    borderColor: palette.borderLight,
    backgroundColor: '#FAFAFA',
  },
  rowActionBtnPressed: {
    opacity: 0.75,
  },
});
