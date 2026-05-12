import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, FlatList, ScrollView, RefreshControl } from 'react-native';
import { Text, Button, Surface, Divider, Avatar, ActivityIndicator } from 'react-native-paper';
import { useAuth } from '../context/AuthContext';
import { StatCard } from '../components/StatCard';
import { ExpiringItemCard } from '../components/ExpiringItemCard';
import * as api from '../services/api';
import { InventoryItem, ExpiringItem } from '../types';

export function HomeScreen({ navigation }: any) {
  const { user, signOut } = useAuth();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [inv, exp] = await Promise.all([
        api.fetchInventory().catch(() => []),
        api.fetchExpiringItems().catch(() => []),
      ]);
      setInventory(inv || []);
      setExpiringItems(exp || []);
    } catch {
      setInventory([]);
      setExpiringItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* User Header */}
      <Surface style={styles.userHeader} elevation={2}>
        <View style={styles.userRow}>
          <Avatar.Text
            size={44}
            label={user?.name?.charAt(0).toUpperCase() || 'U'}
            style={styles.avatar}
          />
          <View style={styles.userInfo}>
            <Text variant="titleMedium" style={styles.userName}>
              {user?.name || 'User'}
            </Text>
            <Text variant="bodySmall" style={styles.userEmail}>
              {user?.email || ''}
            </Text>
          </View>
          <Button mode="outlined" compact onPress={signOut} textColor="#666">
            Logout
          </Button>
        </View>
      </Surface>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <StatCard value={inventory.length} label="In Stock" />
        <StatCard value={expiringItems.length} label="Expiring" color="#FF9800" />
        <StatCard value="5" label="Meal Categories" color="#2196F3" />
      </View>

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text variant="titleMedium" style={styles.sectionTitle}>
          Quick Actions
        </Text>
        <View style={styles.actionsRow}>
          <Button
            mode="contained"
            icon="package-variant"
            onPress={() => navigation.navigate('Inventory')}
            style={styles.actionBtn}
            compact
          >
            Inventory
          </Button>
          <Button
            mode="contained"
            icon="food"
            onPress={() => navigation.navigate('Meals')}
            style={styles.actionBtn}
            buttonColor="#FF9800"
            compact
          >
            Meals
          </Button>
          <Button
            mode="contained"
            icon="cart"
            onPress={() => navigation.navigate('Shopping')}
            style={styles.actionBtn}
            buttonColor="#2196F3"
            compact
          >
            Shopping
          </Button>
        </View>
      </View>

      <Divider style={styles.divider} />

      {/* Expiring Items */}
      {expiringItems.length > 0 && (
        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Expiring Soon
          </Text>
          <Text variant="bodySmall" style={styles.sectionSubtitle}>
            Use these items first
          </Text>
          <FlatList
            data={expiringItems}
            renderItem={({ item }) => <ExpiringItemCard item={item} horizontal />}
            keyExtractor={(item) => item.item_id}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.horizontalList}
          />
        </View>
      )}

      <Divider style={styles.divider} />

      {/* Recent Inventory Preview */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Inventory
          </Text>
          <Button
            mode="text"
            compact
            onPress={() => navigation.navigate('Inventory')}
          >
            View All
          </Button>
        </View>
        {loading ? (
          <ActivityIndicator style={{ marginVertical: 20 }} />
        ) : inventory.length === 0 ? (
          <Surface style={styles.inventoryPreview} elevation={1}>
            <Text variant="bodyMedium" style={{ color: '#999', textAlign: 'center', width: '100%' }}>
              No items yet. Scan a bill or add items manually.
            </Text>
          </Surface>
        ) : (
          inventory.slice(0, 5).map((item) => (
            <Surface key={item.item_id} style={styles.inventoryPreview} elevation={1}>
              <Text variant="bodyMedium" style={styles.previewName}>
                {item.canonical_name}
              </Text>
              <Text variant="bodySmall" style={styles.previewQty}>
                {item.qty} {item.unit}
              </Text>
            </Surface>
          ))
        )}
      </View>

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  userHeader: {
    backgroundColor: '#4CAF50',
    padding: 16,
    paddingTop: 8,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  userInfo: {
    flex: 1,
    marginLeft: 12,
  },
  userName: {
    color: '#fff',
    fontWeight: 'bold',
  },
  userEmail: {
    color: 'rgba(255,255,255,0.8)',
  },
  statsRow: {
    flexDirection: 'row',
    padding: 16,
    gap: 8,
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontWeight: 'bold',
    marginBottom: 4,
  },
  sectionSubtitle: {
    color: '#666',
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
  },
  divider: {
    marginVertical: 8,
    marginHorizontal: 16,
  },
  horizontalList: {
    marginTop: 4,
  },
  inventoryPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: '#fff',
  },
  previewName: {
    fontWeight: '500',
  },
  previewQty: {
    color: '#666',
  },
  bottomSpacer: {
    height: 24,
  },
});
