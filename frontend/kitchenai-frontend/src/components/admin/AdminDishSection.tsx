import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { AdminFeedbackBanner } from './AdminFeedbackBanner';
import { upsertPanelDish } from '../../services/api';
import { palette } from '../../theme';
import { userFacingError } from '../../utils/userFacingError';

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function AdminDishSection() {
  const [dishId, setDishId] = useState('');
  const [dishName, setDishName] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [pairsWith, setPairsWith] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const id = await upsertPanelDish({
        id: dishId.trim() || undefined,
        name: dishName.trim(),
        ingredients: splitCsv(ingredients),
        pairs_with: splitCsv(pairsWith),
        effort: 'low',
        diet: 'vegetarian',
      });
      setSuccess(`Saved dish "${id}" to the catalog.`);
      if (!dishId.trim()) setDishId(id);
    } catch (e) {
      setError(userFacingError(e, 'Could not save dish.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.lead}>
        Add or update a dish in the catalog. Ingredient names should match the ingredient catalog where possible.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Dish details</Text>

        <TextInput
          label="Dish id (optional)"
          value={dishId}
          onChangeText={setDishId}
          mode="outlined"
          placeholder="masala-chai"
          autoCapitalize="none"
          style={styles.input}
        />
        <Text style={styles.helper}>
          Leave blank to auto-generate a slug from the dish name.
        </Text>

        <TextInput
          label="Display name"
          value={dishName}
          onChangeText={setDishName}
          mode="outlined"
          placeholder="Masala Chai"
          style={styles.input}
        />

        <TextInput
          label="Key ingredients"
          value={ingredients}
          onChangeText={setIngredients}
          mode="outlined"
          placeholder="tea, milk, ginger, cardamom, sugar"
          multiline
          style={styles.input}
        />
        <Text style={styles.helper}>Comma-separated list.</Text>

        <TextInput
          label="Pairs with (optional)"
          value={pairsWith}
          onChangeText={setPairsWith}
          mode="outlined"
          placeholder="plain-roti, biscuit"
          multiline
          style={styles.input}
        />
        <Text style={styles.helper}>
          Dish ids or shorthand aliases (e.g. tea, roti) separated by commas.
        </Text>

        <Button
          mode="contained"
          icon="content-save"
          onPress={() => void handleSave()}
          loading={saving}
          disabled={!dishName.trim() || !ingredients.trim()}
          style={styles.saveBtn}
        >
          Save dish
        </Button>
      </View>

      <View style={styles.tipCard}>
        <Text style={styles.tipTitle}>Quick tips</Text>
        <Text style={styles.tipItem}>• Use kebab-case ids like <Text style={styles.code}>dal-tadka</Text></Text>
        <Text style={styles.tipItem}>• Register aliases first if pairs_with uses shorthand labels</Text>
        <Text style={styles.tipItem}>• Changes apply to meal suggestions and cook flows immediately</Text>
      </View>

      {error ? <AdminFeedbackBanner message={error} tone="error" onDismiss={() => setError('')} /> : null}
      {success ? (
        <AdminFeedbackBanner message={success} tone="success" onDismiss={() => setSuccess('')} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 16,
  },
  lead: {
    color: palette.textSecondary,
    lineHeight: 22,
    fontSize: 15,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.borderLight,
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.text,
    marginBottom: 4,
  },
  input: {
    backgroundColor: palette.surface,
  },
  helper: {
    color: palette.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: -4,
  },
  saveBtn: {
    marginTop: 4,
    borderRadius: 12,
  },
  tipCard: {
    backgroundColor: palette.primaryContainerLight,
    borderRadius: 14,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: palette.primarySoft,
  },
  tipTitle: {
    fontWeight: '700',
    color: palette.primaryDark,
    fontSize: 14,
  },
  tipItem: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  code: {
    fontWeight: '700',
    color: palette.primaryDark,
  },
});
