import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { FilterPill, FilterPillRow } from '../FilterPill';
import { AppConfirmDialog } from '../AppConfirmDialog';
import { AdminFeedbackBanner } from './AdminFeedbackBanner';
import {
  deletePanelPairAlias,
  listPanelPairAliases,
  registerPanelPairAlias,
  type PanelPairAlias,
} from '../../services/api';
import { palette } from '../../theme';
import { userFacingError } from '../../utils/userFacingError';

export function AdminAliasesSection() {
  const [aliases, setAliases] = useState<PanelPairAlias[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');

  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'dish' | 'ingredient'>('dish');
  const [targetId, setTargetId] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleteLabel, setDeleteLabel] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadAliases = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await listPanelPairAliases();
      setAliases(rows);
    } catch (e) {
      setError(userFacingError(e, 'Could not load aliases.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAliases();
  }, [loadAliases]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return aliases;
    return aliases.filter(
      (row) =>
        row.label.toLowerCase().includes(q) ||
        row.target_id.toLowerCase().includes(q) ||
        row.target_kind.toLowerCase().includes(q),
    );
  }, [aliases, search]);

  const handleRegister = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await registerPanelPairAlias({
        label: label.trim(),
        target_kind: kind,
        target_id: targetId.trim(),
      });
      setSuccess(`Added alias "${label.trim()}" → ${kind}:${targetId.trim()}`);
      setLabel('');
      setTargetId('');
      await loadAliases();
    } catch (e) {
      setError(userFacingError(e, 'Could not save alias.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteLabel) return;
    setDeleting(true);
    setError('');
    setSuccess('');
    try {
      await deletePanelPairAlias(deleteLabel);
      setSuccess(`Removed alias "${deleteLabel}"`);
      setDeleteLabel(null);
      await loadAliases();
    } catch (e) {
      setError(userFacingError(e, 'Could not delete alias.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.lead}>
        Map shorthand labels (like <Text style={styles.code}>tea</Text> or{' '}
        <Text style={styles.code}>roti</Text>) to a dish or ingredient id used in pairs_with fields.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add alias</Text>
        <TextInput
          label="Shorthand label"
          value={label}
          onChangeText={setLabel}
          mode="outlined"
          placeholder="tea"
          autoCapitalize="none"
          style={styles.input}
        />
        <Text style={styles.fieldLabel}>Points to</Text>
        <FilterPillRow style={styles.pillRow}>
          <FilterPill
            label="Dish"
            icon="food"
            selected={kind === 'dish'}
            onPress={() => setKind('dish')}
          />
          <FilterPill
            label="Ingredient"
            icon="basket-outline"
            selected={kind === 'ingredient'}
            onPress={() => setKind('ingredient')}
          />
        </FilterPillRow>
        <TextInput
          label={`${kind === 'dish' ? 'Dish' : 'Ingredient'} id`}
          value={targetId}
          onChangeText={setTargetId}
          mode="outlined"
          placeholder={kind === 'dish' ? 'masala-chai' : 'tea'}
          autoCapitalize="none"
          style={styles.input}
        />
        <Button
          mode="contained"
          icon="plus"
          onPress={() => void handleRegister()}
          loading={saving}
          disabled={!label.trim() || !targetId.trim()}
        >
          Save alias
        </Button>
      </View>

      <View style={styles.card}>
        <View style={styles.listHeader}>
          <Text style={styles.cardTitle}>Existing aliases</Text>
          <Text style={styles.countBadge}>{aliases.length}</Text>
        </View>
        <TextInput
          label="Search"
          value={search}
          onChangeText={setSearch}
          mode="outlined"
          left={<TextInput.Icon icon="magnify" />}
          style={styles.input}
          placeholder="Label or target id"
        />

        {loading ? (
          <ActivityIndicator style={styles.loader} color={palette.primary} />
        ) : filtered.length === 0 ? (
          <Text style={styles.empty}>
            {search.trim() ? 'No aliases match your search.' : 'No aliases yet — add one above.'}
          </Text>
        ) : (
          <View style={styles.list}>
            {filtered.slice(0, 100).map((row) => (
              <View key={row.label} style={styles.row}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <View style={styles.rowMeta}>
                    <View style={[styles.kindChip, row.target_kind === 'dish' ? styles.dishChip : styles.ingChip]}>
                      <Text style={styles.kindChipText}>{row.target_kind}</Text>
                    </View>
                    <Text style={styles.targetId}>{row.target_id}</Text>
                  </View>
                </View>
                <Button
                  mode="text"
                  textColor={palette.error}
                  compact
                  onPress={() => setDeleteLabel(row.label)}
                >
                  Remove
                </Button>
              </View>
            ))}
            {filtered.length > 100 ? (
              <Text style={styles.muted}>Showing first 100 of {filtered.length} matches.</Text>
            ) : null}
          </View>
        )}
      </View>

      {error ? <AdminFeedbackBanner message={error} tone="error" onDismiss={() => setError('')} /> : null}
      {success ? (
        <AdminFeedbackBanner message={success} tone="success" onDismiss={() => setSuccess('')} />
      ) : null}

      <AppConfirmDialog
        visible={Boolean(deleteLabel)}
        title="Remove alias?"
        message={`Delete "${deleteLabel}"? Existing dishes won't be changed automatically.`}
        confirmLabel="Remove"
        destructive
        loading={deleting}
        onDismiss={() => setDeleteLabel(null)}
        onConfirm={() => void handleDelete()}
      />
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
  code: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: palette.primaryDark,
    fontWeight: '600',
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.borderLight,
    padding: 16,
    gap: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.text,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.textSecondary,
  },
  input: {
    backgroundColor: palette.surface,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countBadge: {
    backgroundColor: palette.primaryContainer,
    color: palette.primaryDark,
    fontWeight: '700',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  loader: {
    marginVertical: 20,
  },
  empty: {
    color: palette.textMuted,
    textAlign: 'center',
    paddingVertical: 16,
  },
  list: {
    gap: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.borderLight,
    gap: 8,
  },
  rowMain: {
    flex: 1,
    gap: 4,
  },
  rowLabel: {
    fontWeight: '700',
    color: palette.text,
    fontSize: 15,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  kindChip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  dishChip: {
    backgroundColor: palette.primaryContainer,
  },
  ingChip: {
    backgroundColor: palette.warningBg,
  },
  kindChipText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: palette.textSecondary,
  },
  targetId: {
    color: palette.textMuted,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  muted: {
    color: palette.textMuted,
    fontSize: 12,
    marginTop: 8,
  },
  pillRow: {
    marginHorizontal: 0,
    marginBottom: 0,
  },
});
