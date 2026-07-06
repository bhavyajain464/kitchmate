import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface, Button, Chip } from 'react-native-paper';
import * as api from '../../services/api';
import { CookedLogEntry } from '../../types';
import { LogMealModal } from '../modals/LogMealModal';

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Logged',
  'whatsapp-parsed': 'WhatsApp',
  'cook-reported': 'From cook',
};

type Props = {
  openAddOnMount?: boolean;
  onAddModalOpened?: () => void;
};

export function MealsLogHistorySection({ openAddOnMount, onAddModalOpened }: Props) {
  const [mealHistory, setMealHistory] = useState<CookedLogEntry[]>([]);
  const [addModalVisible, setAddModalVisible] = useState(false);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await api.getCookedHistory();
      setMealHistory(res.entries || []);
    } catch {
      setMealHistory([]);
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (openAddOnMount) {
      setAddModalVisible(true);
      onAddModalOpened?.();
    }
  }, [openAddOnMount, onAddModalOpened]);

  const openAddMeal = () => {
    setAddModalVisible(true);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.historyHeader}>
        <View>
          <Text variant="titleMedium" style={styles.historyTitle}>Recent meals</Text>
          <Text variant="bodySmall" style={styles.historySubtitle}>Last 15 days · anything you ate</Text>
        </View>
        {mealHistory.length > 0 ? (
          <Button mode="contained" icon="plus" compact onPress={openAddMeal} buttonColor="#2E7D32">
            Log meal
          </Button>
        ) : null}
      </View>

      {mealHistory.length === 0 ? (
        <Surface style={styles.historyEmpty} elevation={0}>
          <Text variant="bodySmall" style={styles.historyEmptyText}>
            Log breakfast, lunch, snacks — homemade or restaurant. These feed your weekly diet email.
          </Text>
          <Button mode="outlined" icon="plus" onPress={openAddMeal} textColor="#2E7D32">
            Log your first meal
          </Button>
        </Surface>
      ) : (
        mealHistory.map((entry) => (
          <Surface key={entry.id} style={styles.historyRow} elevation={0}>
            <View style={styles.historyDot} />
            <View style={styles.historyBody}>
              <Text variant="bodyMedium" style={styles.historyName} numberOfLines={2}>
                {entry.dish_name}
              </Text>
              <Text variant="bodySmall" style={styles.historyMeta}>
                {entry.cooked_on}
                {entry.meal_slot ? ` · ${entry.meal_slot}` : ''}
                {entry.notes ? ` · ${entry.notes}` : ''}
              </Text>
            </View>
            {entry.source !== 'manual' ? (
              <Chip compact style={styles.sourceChip} textStyle={styles.sourceChipText}>
                {SOURCE_LABELS[entry.source] || entry.source}
              </Chip>
            ) : null}
          </Surface>
        ))
      )}

      <LogMealModal
        visible={addModalVisible}
        onDismiss={() => setAddModalVisible(false)}
        onLogged={() => void refreshHistory()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 8 },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 12,
  },
  historyTitle: { fontWeight: '700', color: '#333' },
  historySubtitle: { color: '#888', marginTop: 2 },
  historyEmpty: {
    padding: 24,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: '#fff',
    gap: 12,
  },
  historyEmptyText: { color: '#666', textAlign: 'center', lineHeight: 20 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: '#fff',
    gap: 10,
  },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2E7D32' },
  historyBody: { flex: 1 },
  historyName: { fontWeight: '600', color: '#222' },
  historyMeta: { color: '#888', marginTop: 2 },
  sourceChip: { backgroundColor: '#E8F5E9' },
  sourceChipText: { fontSize: 10 },
});
