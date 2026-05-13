import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  RefreshControl,
  Alert,
  Platform,
  Pressable,
} from 'react-native';
import {
  Text,
  TextInput,
  IconButton,
  Chip,
  Surface,
  Portal,
  Dialog,
  Button,
  ActivityIndicator,
} from 'react-native-paper';
import * as api from '../services/api';

interface ShoppingItem {
  id: string;
  name: string;
  qty: number;
  unit: string;
  bought: boolean;
  created_at: string;
}

const QUICK_UNITS = ['pcs', 'kg', 'g', 'L', 'ml', 'pack'];

export function ShoppingScreen() {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [newUnit, setNewUnit] = useState('pcs');
  const [adding, setAdding] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ShoppingItem | null>(null);

  const loadItems = useCallback(async () => {
    try {
      const res = await api.getShoppingItems();
      const all: ShoppingItem[] = res.items || [];
      setItems(all.filter((i) => !i.bought));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadItems();
    setRefreshing(false);
  }, [loadItems]);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const item = await api.addShoppingItem(name, parseFloat(newQty) || 1, newUnit);
      setItems((prev) => [item, ...prev]);
      setNewName('');
      setNewQty('1');
    } catch {
      const msg = 'Could not add item.';
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Error', msg);
    } finally {
      setAdding(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    setItems((prev) => prev.filter((item) => item.id !== id));
    try {
      await api.deleteShoppingItem(id);
    } catch {
      await loadItems();
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text variant="headlineSmall" style={styles.headerTitle}>Shopping List</Text>
            <Text variant="bodyMedium" style={styles.headerSub}>
              {items.length > 0
                ? `${items.length} item${items.length !== 1 ? 's' : ''} to buy`
                : 'Nothing to buy yet'}
            </Text>
          </View>
          {items.length > 0 && (
            <Surface style={styles.countBadge} elevation={0}>
              <Text style={styles.countText}>{items.length}</Text>
            </Surface>
          )}
        </View>
      </View>

      {/* Add Item */}
      <Surface style={styles.addCard} elevation={2}>
        <Text variant="titleSmall" style={styles.addLabel}>Add Item</Text>
        <View style={styles.addRow}>
          <TextInput
            mode="outlined"
            placeholder="Item name"
            value={newName}
            onChangeText={setNewName}
            style={styles.nameInput}
            dense
            outlineColor="#E0E0E0"
            activeOutlineColor="#2196F3"
            outlineStyle={{ borderRadius: 12 }}
            onSubmitEditing={handleAdd}
            left={<TextInput.Icon icon="basket-plus-outline" color="#bbb" />}
          />
          <TextInput
            mode="outlined"
            placeholder="Qty"
            value={newQty}
            onChangeText={setNewQty}
            keyboardType="numeric"
            style={styles.qtyInput}
            dense
            outlineColor="#E0E0E0"
            activeOutlineColor="#2196F3"
            outlineStyle={{ borderRadius: 12 }}
          />
          <IconButton
            icon="plus-circle"
            iconColor={newName.trim() ? '#2196F3' : '#ccc'}
            size={34}
            onPress={handleAdd}
            disabled={adding || !newName.trim()}
            style={{ margin: 0 }}
          />
        </View>
        <View style={styles.unitRow}>
          {QUICK_UNITS.map((u) => (
            <Pressable key={u} onPress={() => setNewUnit(u)}>
              <Surface
                style={[styles.unitPill, newUnit === u && styles.unitPillActive]}
                elevation={0}
              >
                <Text style={[styles.unitPillText, newUnit === u && styles.unitPillTextActive]}>{u}</Text>
              </Surface>
            </Pressable>
          ))}
        </View>
        <Text variant="bodySmall" style={styles.autoHint}>
          Items auto-remove when added to inventory
        </Text>
      </Surface>

      {/* Items */}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" />
      ) : items.length > 0 ? (
        <View style={styles.listWrap}>
          {items.map((item, idx) => (
            <Surface key={item.id} style={styles.itemCard} elevation={1}>
              <View style={styles.itemRow}>
                <View style={styles.itemNum}>
                  <Text style={styles.itemNumText}>{idx + 1}</Text>
                </View>
                <View style={styles.itemInfo}>
                  <Text variant="bodyLarge" style={styles.itemName}>{item.name}</Text>
                  <Text variant="bodySmall" style={styles.itemQty}>{item.qty} {item.unit}</Text>
                </View>
                <Pressable onPress={() => setDeleteTarget(item)} hitSlop={10}>
                  <IconButton icon="close-circle-outline" iconColor="#E57373" size={22} style={{ margin: 0 }} />
                </Pressable>
              </View>
            </Surface>
          ))}
        </View>
      ) : (
        <Surface style={styles.emptyCard} elevation={1}>
          <IconButton icon="cart-check" iconColor="#ccc" size={44} style={{ margin: 0 }} />
          <Text variant="titleMedium" style={styles.emptyTitle}>All caught up!</Text>
          <Text variant="bodyMedium" style={styles.emptySub}>
            Add items you need to buy. They'll be removed when you add them to inventory.
          </Text>
        </Surface>
      )}

      <View style={{ height: 32 }} />

      {/* Delete Dialog */}
      <Portal>
        <Dialog visible={!!deleteTarget} onDismiss={() => setDeleteTarget(null)} style={styles.dialog}>
          <Dialog.Title>Remove item?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              Remove <Text style={{ fontWeight: '700' }}>{deleteTarget?.name}</Text> ({deleteTarget?.qty} {deleteTarget?.unit}) from your shopping list?
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteTarget(null)}>Cancel</Button>
            <Button textColor="#F44336" onPress={confirmDelete}>Remove</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  scrollContent: { paddingBottom: 24 },

  header: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: '#fff', fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  countBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countText: { color: '#fff', fontWeight: '800', fontSize: 18 },

  addCard: {
    marginHorizontal: 20,
    marginTop: -12,
    borderRadius: 18,
    backgroundColor: '#fff',
    padding: 16,
  },
  addLabel: { fontWeight: '700', color: '#333', marginBottom: 10 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameInput: { flex: 1, backgroundColor: '#fff' },
  qtyInput: { width: 60, backgroundColor: '#fff' },
  unitRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  unitPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F5F5F5',
  },
  unitPillActive: {
    backgroundColor: '#E3F2FD',
    borderColor: '#2196F3',
    borderWidth: 1,
  },
  unitPillText: { fontSize: 12, color: '#888', fontWeight: '600' },
  unitPillTextActive: { color: '#1976D2' },
  autoHint: { color: '#bbb', marginTop: 10, fontSize: 11, fontStyle: 'italic' },

  listWrap: { paddingHorizontal: 20, marginTop: 16, gap: 8 },
  itemCard: {
    borderRadius: 14,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  itemNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  itemNumText: { color: '#1976D2', fontWeight: '700', fontSize: 13 },
  itemInfo: { flex: 1 },
  itemName: { fontWeight: '600', color: '#333' },
  itemQty: { color: '#888', marginTop: 2 },

  emptyCard: {
    marginHorizontal: 20,
    marginTop: 24,
    borderRadius: 20,
    backgroundColor: '#fff',
    padding: 32,
    alignItems: 'center',
  },
  emptyTitle: { fontWeight: '700', color: '#888', marginTop: 12 },
  emptySub: { color: '#bbb', marginTop: 6, textAlign: 'center', lineHeight: 20 },

  dialog: { borderRadius: 16 },
});
