import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, ScrollView, RefreshControl, Alert } from 'react-native';
import { Text, Card, Button, Divider } from 'react-native-paper';
import { ShoppingListItemCard, LowStockItemCard } from '../components/ShoppingListItemCard';
import * as api from '../services/api';
import {
  ShoppingListItem,
  LowStockItem,
  ProcurementSummary,
  PreMarketPingResponse,
} from '../types';

export function ShoppingScreen() {
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [summary, setSummary] = useState<ProcurementSummary | null>(null);
  const [pingResult, setPingResult] = useState<PreMarketPingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      const result = await api.fetchProcurementSummary();
      setSummary(result);
    } catch {
      setSummary(null);
    }
  }, []);

  const loadLowStock = useCallback(async () => {
    try {
      const items = await api.fetchLowStockItems();
      setLowStockItems(items);
    } catch {
      setLowStockItems([]);
    }
  }, []);

  useEffect(() => {
    loadSummary();
    loadLowStock();
  }, [loadSummary, loadLowStock]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadSummary(), loadLowStock()]);
    setRefreshing(false);
  }, [loadSummary, loadLowStock]);

  const handleGenerateShoppingList = async () => {
    setLoading(true);
    try {
      const result = await api.generateShoppingList();
      setShoppingList(result.items || []);
      Alert.alert(
        'Shopping List',
        `Generated ${result.total_items} items (${result.low_stock_count} low stock, ${result.expiring_count} expiring)`,
      );
    } catch {
      Alert.alert('Failed', 'Could not generate shopping list.');
    } finally {
      setLoading(false);
    }
  };

  const handlePreMarketPing = async () => {
    setLoading(true);
    try {
      const result = await api.sendPreMarketPing();
      setPingResult(result);
      Alert.alert(
        result.sent ? 'Ping Sent' : 'Ping Not Sent',
        result.message,
      );
    } catch {
      Alert.alert('Failed', 'Could not send pre-market ping.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Summary Card */}
      {summary && (
        <Card style={styles.summaryCard} mode="elevated">
          <Card.Content>
            <Text variant="titleLarge" style={styles.cardTitle}>
              Procurement Summary
            </Text>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text variant="headlineMedium" style={styles.summaryValue}>
                  {summary.low_stock_count}
                </Text>
                <Text variant="labelSmall" style={styles.summaryLabel}>
                  Low Stock
                </Text>
              </View>
              <View style={styles.summaryItem}>
                <Text variant="headlineMedium" style={[styles.summaryValue, { color: '#FF9800' }]}>
                  {summary.expiring_count}
                </Text>
                <Text variant="labelSmall" style={styles.summaryLabel}>
                  Expiring
                </Text>
              </View>
            </View>
            <Text variant="bodySmall" style={styles.recommendation}>
              {summary.recommendation}
            </Text>
          </Card.Content>
        </Card>
      )}

      {/* Actions */}
      <Card style={styles.card} mode="elevated">
        <Card.Content>
          <Text variant="titleMedium" style={styles.cardTitle}>
            Actions
          </Text>

          <View style={styles.buttonGroup}>
            <Button
              mode="contained"
              icon="clipboard-list"
              onPress={handleGenerateShoppingList}
              loading={loading}
              disabled={loading}
              style={styles.actionBtn}
              contentStyle={styles.actionBtnContent}
            >
              Generate Shopping List
            </Button>

            <Button
              mode="contained"
              icon="cellphone-message"
              onPress={handlePreMarketPing}
              loading={loading}
              disabled={loading}
              buttonColor="#2196F3"
              style={styles.actionBtn}
              contentStyle={styles.actionBtnContent}
            >
              Pre-Market Ping to Cook
            </Button>
          </View>
        </Card.Content>
      </Card>

      {/* Ping Result */}
      {pingResult && (
        <Card
          style={[styles.card, { backgroundColor: pingResult.sent ? '#E8F5E9' : '#FFF3E0' }]}
          mode="contained"
        >
          <Card.Content>
            <Text variant="labelLarge" style={{ color: pingResult.sent ? '#1B5E20' : '#E65100' }}>
              {pingResult.sent ? 'Pre-Market Ping Sent' : 'Ping Not Sent'}
            </Text>
            <Text variant="bodySmall">{pingResult.message}</Text>
            {pingResult.items_included && pingResult.items_included.length > 0 && (
              <Text variant="bodySmall" style={styles.pingItems}>
                Items: {pingResult.items_included.join(', ')}
              </Text>
            )}
          </Card.Content>
        </Card>
      )}

      <Divider style={styles.divider} />

      {/* Shopping List */}
      {shoppingList.length > 0 && (
        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Shopping List ({shoppingList.length} items)
          </Text>
          {shoppingList.map((item) => (
            <ShoppingListItemCard key={item.item_id} item={item} />
          ))}
        </View>
      )}

      {/* Low Stock Items */}
      {lowStockItems.length > 0 && (
        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Low Stock Items ({lowStockItems.length})
          </Text>
          {lowStockItems.map((item, idx) => (
            <LowStockItemCard key={`${item.name}-${idx}`} item={item} />
          ))}
        </View>
      )}

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  content: {
    padding: 16,
  },
  summaryCard: {
    marginBottom: 16,
  },
  card: {
    marginBottom: 16,
  },
  cardTitle: {
    fontWeight: 'bold',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryValue: {
    fontWeight: 'bold',
    color: '#F44336',
  },
  summaryLabel: {
    color: '#666',
    marginTop: 2,
  },
  recommendation: {
    color: '#795548',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  buttonGroup: {
    gap: 10,
  },
  actionBtn: {
    borderRadius: 12,
  },
  actionBtnContent: {
    paddingVertical: 4,
  },
  pingItems: {
    color: '#555',
    marginTop: 4,
  },
  divider: {
    marginBottom: 16,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontWeight: 'bold',
    marginBottom: 8,
  },
  bottomSpacer: {
    height: 24,
  },
});
