import React, { useEffect, useMemo, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Button } from 'react-native-paper';
import * as api from '../../services/api';
import { DEFAULT_UNIT } from '../UnitPillSelector';
import {
  InventoryItemRowEditor,
  inventoryRowListStyles,
  STACKED_ROW_BREAKPOINT,
  type InventoryDraftRow,
} from '../inventory/InventoryItemRowEditor';
import { parseShoppingQtyInput } from '../../utils/shoppingFormat';
import { BottomSheet, bottomSheetPrimaryBtn } from '../BottomSheet';
import { showAppError, showAppSuccess } from '../../utils/alertMessage';
import { useAppRefresh } from '../../context/AppRefreshContext';
import { palette } from '../../theme';
import type { ItemCatalog } from '../../types';

type DraftRow = {
  key: string;
  name: string;
  qty: string;
  unit: string;
  ingredientId?: string;
  catalog?: ItemCatalog;
};

let draftRowCounter = 0;

function newDraftRow(unit = DEFAULT_UNIT): DraftRow {
  draftRowCounter += 1;
  return { key: `row-${draftRowCounter}`, name: '', qty: '', unit };
}

function initialDraftRows(count = 1): DraftRow[] {
  return Array.from({ length: count }, () => newDraftRow());
}

function isRowAddable(row: DraftRow): boolean {
  const name = row.name.trim();
  const qty = parseShoppingQtyInput(row.qty);
  return name.length > 0 && qty > 0;
}

function toEditorRow(row: DraftRow): InventoryDraftRow {
  return {
    key: row.key,
    name: row.name,
    qty: row.qty,
    unit: row.unit,
    expiry: '',
    ingredientId: row.ingredientId,
    catalog: row.catalog,
  };
}

type Props = {
  visible: boolean;
  onDismiss: () => void;
  onAdded?: () => void;
};

export function AddShoppingModal({ visible, onDismiss, onAdded }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const stackedRows = windowWidth < STACKED_ROW_BREAKPOINT;
  const [draftRows, setDraftRows] = useState<DraftRow[]>(initialDraftRows);
  const [saving, setSaving] = useState(false);
  const { bump } = useAppRefresh();

  useEffect(() => {
    if (!visible) return;
    setDraftRows(initialDraftRows());
  }, [visible]);

  const filledRows = useMemo(
    () =>
      draftRows
        .map((row) => ({
          name: row.name.trim(),
          qty: parseShoppingQtyInput(row.qty),
          unit: row.unit || DEFAULT_UNIT,
        }))
        .filter((row) => row.name.length > 0 && row.qty > 0),
    [draftRows],
  );

  const updateDraftRow = (key: string, patch: Partial<Omit<DraftRow, 'key'>>) => {
    setDraftRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const addDraftRow = () => {
    setDraftRows((prev) => {
      const last = prev[prev.length - 1];
      if (!last || !isRowAddable(last)) return prev;
      return [...prev, newDraftRow()];
    });
  };

  const removeDraftRow = (key: string) => {
    setDraftRows((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((row) => row.key !== key);
    });
  };

  const handleDismiss = () => {
    if (saving) return;
    onDismiss();
  };

  const handleSubmit = async () => {
    if (!filledRows.length || saving) return;
    setSaving(true);
    try {
      if (filledRows.length === 1) {
        await api.addShoppingItem(filledRows[0].name, filledRows[0].qty, filledRows[0].unit);
      } else {
        await api.addBulkShoppingItems(filledRows);
      }
      const count = filledRows.length;
      onDismiss();
      showAppSuccess(count === 1 ? 'Added to shopping list' : `Added ${count} items to your list`);
      bump('shopping');
    } catch {
      showAppError('Could not add items.');
    } finally {
      setSaving(false);
    }
  };

  const submitLabel = 'Save to list';

  const sheetTitle = 'Add to list';

  return (
    <BottomSheet
      visible={visible}
      onDismiss={handleDismiss}
      dismissDisabled={saving}
      scrollable
      title={sheetTitle}
      maxHeightRatio={0.92}
      footer={(
        <Button
          mode="contained"
          onPress={() => void handleSubmit()}
          loading={saving}
          disabled={!filledRows.length || saving}
          buttonColor={palette.primary}
          style={bottomSheetPrimaryBtn.button}
          contentStyle={bottomSheetPrimaryBtn.content}
          labelStyle={bottomSheetPrimaryBtn.label}
        >
          {submitLabel}
        </Button>
      )}
    >
      <View style={inventoryRowListStyles.listDivider} />

      {draftRows.map((row, index) => (
        <InventoryItemRowEditor
          key={row.key}
          row={toEditorRow(row)}
          isLastRow={index === draftRows.length - 1}
          isLastInList={index === draftRows.length - 1}
          stacked={stackedRows}
          hideExpiry
          showRowActions
          autoFocusName={index === 0}
          canAdd={isRowAddable(row)}
          onUpdate={(patch) => {
            const { expiry: _expiry, foodGroup: _foodGroup, ...shoppingPatch } = patch;
            updateDraftRow(row.key, shoppingPatch);
          }}
          onAddRow={addDraftRow}
          onRemoveRow={() => removeDraftRow(row.key)}
        />
      ))}
    </BottomSheet>
  );
}
