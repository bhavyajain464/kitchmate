import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import * as api from '../../services/api';
import { ExpiryDateBox } from '../ExpiryDateBox';
import { BottomSheet, bottomSheetInput, bottomSheetPrimaryBtn } from '../BottomSheet';
import { palette } from '../../theme';

const MEAL_SLOTS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snack', label: 'Snack' },
] as const;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Props = {
  visible: boolean;
  onDismiss: () => void;
  onLogged?: () => void;
};

export function LogMealModal({ visible, onDismiss, onLogged }: Props) {
  const [dishName, setDishName] = useState('');
  const [mealSlot, setMealSlot] = useState('');
  const [cookedOn, setCookedOn] = useState(todayISO);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDishName('');
    setMealSlot('');
    setCookedOn(todayISO());
    setNotes('');
    setError(null);
  }, [visible]);

  const handleSubmit = async () => {
    const name = dishName.trim();
    if (!name) {
      setError('Enter what you ate.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.logCookedDish({
        dish_name: name,
        meal_slot: mealSlot || undefined,
        source: 'manual',
        notes: notes.trim() || undefined,
        cooked_on: cookedOn.trim() || todayISO(),
      });
      onDismiss();
      onLogged?.();
    } catch {
      setError('Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      dismissDisabled={saving}
      title="Log a meal"
      subtitle="Any dish — homemade or restaurant."
      footer={(
        <Button
          mode="contained"
          onPress={() => void handleSubmit()}
          loading={saving}
          disabled={saving}
          buttonColor={palette.primary}
          style={bottomSheetPrimaryBtn.button}
          contentStyle={bottomSheetPrimaryBtn.content}
          labelStyle={bottomSheetPrimaryBtn.label}
        >
          Save meal
        </Button>
      )}
    >
      <TextInput
        label="What did you eat?"
        value={dishName}
        onChangeText={setDishName}
        mode="outlined"
        style={bottomSheetInput}
        placeholder="e.g. Poha, office canteen thali"
        outlineColor={palette.border}
        activeOutlineColor={palette.primary}
      />

      <Text variant="labelMedium" style={styles.slotLabel}>Meal (optional)</Text>
      <View style={styles.slotRow}>
        {MEAL_SLOTS.map((slot) => {
          const selected = mealSlot === slot.id;
          return (
            <Pressable
              key={slot.id}
              onPress={() => setMealSlot(selected ? '' : slot.id)}
              style={({ pressed }) => [
                styles.slotPill,
                selected && styles.slotPillSelected,
                pressed && styles.slotPillPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.slotPillText, selected && styles.slotPillTextSelected]}>
                {slot.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ExpiryDateBox
        label="Date"
        value={cookedOn}
        onChange={setCookedOn}
        fullWidth
        allowPastDates
        accessibilityLabel="Set meal date"
      />

      <TextInput
        label="Notes (optional)"
        value={notes}
        onChangeText={setNotes}
        mode="outlined"
        style={bottomSheetInput}
        multiline
        outlineColor={palette.border}
        activeOutlineColor={palette.primary}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  slotLabel: { marginBottom: 8, color: palette.textSecondary },
  slotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  slotPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: palette.primaryContainer,
  },
  slotPillSelected: {
    backgroundColor: palette.primaryDark,
  },
  slotPillPressed: {
    opacity: 0.88,
  },
  slotPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.primaryDark,
  },
  slotPillTextSelected: {
    color: '#fff',
    fontWeight: '700',
  },
  error: { color: palette.error, marginBottom: 8 },
});
