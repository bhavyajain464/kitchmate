import React, { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Divider, Text, TextInput } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import {
  deletePanelPairAlias,
  listPanelPairAliases,
  registerPanelPairAlias,
  upsertPanelDish,
  type PanelPairAlias,
} from '../services/api';
import { palette } from '../theme';
import { userFacingError } from '../utils/userFacingError';

export function AdminPanelScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [aliases, setAliases] = useState<PanelPairAlias[]>([]);
  const [loadingAliases, setLoadingAliases] = useState(true);
  const [aliasError, setAliasError] = useState('');
  const [aliasSuccess, setAliasSuccess] = useState('');

  const [pairLabel, setPairLabel] = useState('');
  const [pairKind, setPairKind] = useState<'dish' | 'ingredient'>('dish');
  const [pairTargetId, setPairTargetId] = useState('');
  const [savingAlias, setSavingAlias] = useState(false);

  const [dishId, setDishId] = useState('');
  const [dishName, setDishName] = useState('');
  const [dishIngredients, setDishIngredients] = useState('');
  const [dishPairsWith, setDishPairsWith] = useState('');
  const [savingDish, setSavingDish] = useState(false);
  const [dishError, setDishError] = useState('');
  const [dishSuccess, setDishSuccess] = useState('');

  const loadAliases = useCallback(async () => {
    setLoadingAliases(true);
    setAliasError('');
    try {
      const rows = await listPanelPairAliases();
      setAliases(rows);
    } catch (e) {
      setAliasError(userFacingError(e, 'Failed to load aliases.'));
    } finally {
      setLoadingAliases(false);
    }
  }, []);

  useEffect(() => {
    void loadAliases();
  }, [loadAliases]);

  const handleRegisterAlias = async () => {
    setSavingAlias(true);
    setAliasError('');
    setAliasSuccess('');
    try {
      await registerPanelPairAlias({
        label: pairLabel.trim(),
        target_kind: pairKind,
        target_id: pairTargetId.trim(),
      });
      setAliasSuccess(`Registered "${pairLabel.trim()}" → ${pairTargetId.trim()}`);
      setPairLabel('');
      setPairTargetId('');
      await loadAliases();
    } catch (e) {
      setAliasError(userFacingError(e, 'Failed to register alias.'));
    } finally {
      setSavingAlias(false);
    }
  };

  const handleDeleteAlias = async (label: string) => {
    setAliasError('');
    setAliasSuccess('');
    try {
      await deletePanelPairAlias(label);
      setAliasSuccess(`Deleted "${label}"`);
      await loadAliases();
    } catch (e) {
      setAliasError(userFacingError(e, 'Failed to delete alias.'));
    }
  };

  const handleUpsertDish = async () => {
    setSavingDish(true);
    setDishError('');
    setDishSuccess('');
    try {
      const ingredients = dishIngredients
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const pairsWith = dishPairsWith
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const id = await upsertPanelDish({
        id: dishId.trim() || undefined,
        name: dishName.trim(),
        ingredients,
        pairs_with: pairsWith,
        effort: 'low',
        diet: 'vegetarian',
      });
      setDishSuccess(`Saved dish "${id}"`);
      if (!dishId.trim()) setDishId(id);
    } catch (e) {
      setDishError(userFacingError(e, 'Failed to save dish.'));
    } finally {
      setSavingDish(false);
    }
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 32,
          paddingLeft: Math.max(insets.left, 16),
          paddingRight: Math.max(insets.right, 16),
        },
      ]}
    >
      <View style={styles.header}>
        <View>
          <Text variant="headlineSmall" style={styles.title}>
            Catalog ops
          </Text>
          <Text style={styles.subtitle}>{user?.email ?? 'Signed in'}</Text>
        </View>
        <Button mode="outlined" onPress={() => void signOut()} compact>
          Sign out
        </Button>
      </View>

      <Text style={styles.sectionTitle}>Pair label aliases</Text>
      <Text style={styles.hint}>
        Map shorthand pairs_with labels (e.g. tea, roti) to a dish or ingredient id.
      </Text>

      {loadingAliases ? (
        <ActivityIndicator style={styles.loader} color={palette.primary} />
      ) : (
        <View style={styles.card}>
          {aliases.length === 0 ? (
            <Text style={styles.muted}>No aliases yet.</Text>
          ) : (
            aliases.slice(0, 80).map((row) => (
              <View key={row.label} style={styles.aliasRow}>
                <View style={styles.aliasText}>
                  <Text style={styles.aliasLabel}>{row.label}</Text>
                  <Text style={styles.muted}>
                    {row.target_kind}:{row.target_id}
                  </Text>
                </View>
                <Button
                  mode="text"
                  textColor={palette.error}
                  compact
                  onPress={() => void handleDeleteAlias(row.label)}
                >
                  Delete
                </Button>
              </View>
            ))
          )}
          {aliases.length > 80 ? (
            <Text style={styles.muted}>Showing first 80 of {aliases.length} aliases.</Text>
          ) : null}
        </View>
      )}

      <View style={styles.card}>
        <TextInput
          label="Label"
          value={pairLabel}
          onChangeText={setPairLabel}
          mode="outlined"
          style={styles.input}
          placeholder="tea"
        />
        <TextInput
          label="Target kind (dish or ingredient)"
          value={pairKind}
          onChangeText={(v) => setPairKind(v === 'ingredient' ? 'ingredient' : 'dish')}
          mode="outlined"
          style={styles.input}
        />
        <TextInput
          label="Target id"
          value={pairTargetId}
          onChangeText={setPairTargetId}
          mode="outlined"
          style={styles.input}
          placeholder="masala-chai"
        />
        <Button
          mode="contained"
          onPress={() => void handleRegisterAlias()}
          loading={savingAlias}
          disabled={!pairLabel.trim() || !pairTargetId.trim()}
        >
          Register alias
        </Button>
        {aliasError ? <Text style={styles.error}>{aliasError}</Text> : null}
        {aliasSuccess ? <Text style={styles.success}>{aliasSuccess}</Text> : null}
      </View>

      <Divider style={styles.divider} />

      <Text style={styles.sectionTitle}>Register dish</Text>
      <Text style={styles.hint}>Upsert a catalog dish and its ingredient lines.</Text>

      <View style={styles.card}>
        <TextInput
          label="Dish id (optional — slug from name if empty)"
          value={dishId}
          onChangeText={setDishId}
          mode="outlined"
          style={styles.input}
          placeholder="masala-chai"
        />
        <TextInput
          label="Name"
          value={dishName}
          onChangeText={setDishName}
          mode="outlined"
          style={styles.input}
          placeholder="Masala Chai"
        />
        <TextInput
          label="Ingredients (comma-separated)"
          value={dishIngredients}
          onChangeText={setDishIngredients}
          mode="outlined"
          style={styles.input}
          placeholder="tea, milk, ginger, cardamom, sugar"
        />
        <TextInput
          label="Pairs with (comma-separated, optional)"
          value={dishPairsWith}
          onChangeText={setDishPairsWith}
          mode="outlined"
          style={styles.input}
          placeholder="plain-roti"
        />
        <Button
          mode="contained"
          onPress={() => void handleUpsertDish()}
          loading={savingDish}
          disabled={!dishName.trim() || !dishIngredients.trim()}
        >
          Save dish
        </Button>
        {dishError ? <Text style={styles.error}>{dishError}</Text> : null}
        {dishSuccess ? <Text style={styles.success}>{dishSuccess}</Text> : null}
      </View>

      {Platform.OS === 'web' ? (
        <Text style={styles.footerNote}>
          This panel is not linked in the app. Bookmark this URL if you need it again.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
    gap: 12,
  },
  title: {
    color: palette.text,
    fontWeight: '700',
  },
  subtitle: {
    color: palette.textMuted,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: palette.text,
    marginBottom: 4,
  },
  hint: {
    color: palette.textSecondary,
    marginBottom: 12,
    lineHeight: 20,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.borderLight,
    padding: 16,
    marginBottom: 16,
    gap: 10,
  },
  input: {
    backgroundColor: palette.surface,
  },
  aliasRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.borderLight,
    gap: 8,
  },
  aliasText: {
    flex: 1,
  },
  aliasLabel: {
    fontWeight: '600',
    color: palette.text,
  },
  muted: {
    color: palette.textMuted,
    fontSize: 13,
  },
  loader: {
    marginVertical: 24,
  },
  divider: {
    marginVertical: 8,
  },
  error: {
    color: palette.error,
    marginTop: 4,
  },
  success: {
    color: palette.primary,
    marginTop: 4,
  },
  footerNote: {
    color: palette.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 24,
  },
});
