import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  FlatList,
  RefreshControl,
  Alert,
  Image,
  ScrollView,
  Platform,
} from 'react-native';
import {
  Text,
  Searchbar,
  FAB,
  Portal,
  Modal,
  TextInput,
  Button,
  SegmentedButtons,
  Divider,
  Card,
  Surface,
  ActivityIndicator,
  IconButton,
  Checkbox,
} from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import { InventoryItemCard } from '../components/InventoryItemCard';
import { ExpiringItemCard } from '../components/ExpiringItemCard';
import * as api from '../services/api';
import { InventoryItem, ExpiringItem, ScanResult } from '../types';
import { colors } from '../theme';

type TabValue = 'all' | 'expiring';

export function InventoryScreen() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TabValue>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  // FAB group
  const [fabOpen, setFabOpen] = useState(false);

  // Manual add modal
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [adding, setAdding] = useState(false);

  // Scan modal
  const [scanModalVisible, setScanModalVisible] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedItems, setSelectedItems] = useState<Record<number, boolean>>({});
  const [addingScanned, setAddingScanned] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [inv, exp] = await Promise.all([
        api.fetchInventory(),
        api.fetchExpiringItems(),
      ]);
      setInventory(Array.isArray(inv) ? inv : []);
      setExpiringItems(Array.isArray(exp) ? exp : []);
    } catch (e) {
      console.error('Failed to load inventory:', e);
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

  // ── Manual Add ────────────────────────────────────────────

  const handleAddItem = async () => {
    if (!newName.trim() || !newQty.trim() || !newUnit.trim()) {
      Alert.alert('Missing Fields', 'Please fill in name, quantity, and unit.');
      return;
    }
    setAdding(true);
    try {
      await api.addInventoryItem({
        canonical_name: newName.trim(),
        qty: parseFloat(newQty),
        unit: newUnit.trim(),
        estimated_expiry: newExpiry.trim() || undefined,
      });
      setAddModalVisible(false);
      resetAddForm();
      await loadData();
      Alert.alert('Success', 'Item added to inventory!');
    } catch {
      Alert.alert('Error', 'Could not add item. Check backend connection.');
    } finally {
      setAdding(false);
    }
  };

  const resetAddForm = () => {
    setNewName('');
    setNewQty('');
    setNewUnit('');
    setNewExpiry('');
  };

  // ── Delete ────────────────────────────────────────────────

  const handleDeleteItem = async (item: InventoryItem) => {
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Remove "${item.canonical_name}" from inventory?`)
      : await new Promise<boolean>((resolve) => {
          Alert.alert('Delete Item', `Remove "${item.canonical_name}" from inventory?`, [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
          ]);
        });

    if (!confirmed) return;

    try {
      await api.deleteInventoryItem(item.item_id);
      await loadData();
    } catch {
      Alert.alert('Error', 'Could not delete item.');
    }
  };

  // ── Scan Bill ─────────────────────────────────────────────

  const openScanModal = () => {
    setImageUri(null);
    setScanResult(null);
    setScanning(false);
    setSelectedItems({});
    setAddingScanned(false);
    setScanModalVisible(true);
  };

  const closeScanModal = () => {
    setScanModalVisible(false);
    setImageUri(null);
    setScanResult(null);
    setSelectedItems({});
    setAddingScanned(false);
  };

  const toggleItem = (idx: number) => {
    setSelectedItems((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const selectAll = () => {
    if (!scanResult?.items) return;
    const allSelected = scanResult.items.every((_, i) => selectedItems[i] !== false);
    const next: Record<number, boolean> = {};
    scanResult.items.forEach((_, i) => { next[i] = !allSelected; });
    setSelectedItems(next);
  };

  const handleAddSelectedItems = async () => {
    if (!scanResult?.items) return;
    const toAdd = scanResult.items.filter((_, i) => selectedItems[i] !== false);
    if (toAdd.length === 0) {
      Alert.alert('No Items Selected', 'Please select at least one item to add.');
      return;
    }

    setAddingScanned(true);
    let addedCount = 0;
    const errors: string[] = [];

    for (const item of toAdd) {
      try {
        const shelfDays = item.shelf_life_days || 7;
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + shelfDays);
        const expiryStr = expiry.toISOString().split('T')[0];

        await api.addInventoryItem({
          canonical_name: item.name,
          qty: item.quantity,
          unit: item.unit,
          estimated_expiry: expiryStr,
        });
        addedCount++;
      } catch {
        errors.push(item.name);
      }
    }

    setAddingScanned(false);
    await loadData();

    if (errors.length > 0) {
      Alert.alert('Partially Added', `Added ${addedCount} items. Failed: ${errors.join(', ')}`);
    } else {
      Alert.alert('Success', `Added ${addedCount} items to inventory!`);
    }
    closeScanModal();
  };

  const requestPermission = async (type: 'camera' | 'gallery') => {
    if (type === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera access is needed to scan bills.');
        return false;
      }
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Photo library access is needed.');
        return false;
      }
    }
    return true;
  };

  const pickFromCamera = async () => {
    const ok = await requestPermission('camera');
    if (!ok) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setScanResult(null);
    }
  };

  const pickFromGallery = async () => {
    const ok = await requestPermission('gallery');
    if (!ok) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setScanResult(null);
    }
  };

  const handleScan = async () => {
    if (!imageUri) {
      Alert.alert('No Image', 'Please take a photo or pick one from gallery first.');
      return;
    }
    setScanning(true);
    setScanResult(null);
    setSelectedItems({});
    try {
      const result = await api.scanBillUpload(imageUri);
      setScanResult(result);
      if (result.items && result.items.length > 0) {
        const allSelected: Record<number, boolean> = {};
        result.items.forEach((_, i) => { allSelected[i] = true; });
        setSelectedItems(allSelected);
      }
    } catch (e: any) {
      console.error('Scan error:', e);
      Alert.alert('Scan Failed', e.message || 'Could not scan bill. Please try again.');
    } finally {
      setScanning(false);
    }
  };

  // ── Filtered list ─────────────────────────────────────────

  const filtered = inventory.filter((item) =>
    item.canonical_name.toLowerCase().includes(search.toLowerCase()),
  );

  // ── Render ────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <Searchbar
        placeholder="Search inventory..."
        value={search}
        onChangeText={setSearch}
        style={styles.searchbar}
      />

      <SegmentedButtons
        value={tab}
        onValueChange={(v) => setTab(v as TabValue)}
        buttons={[
          { value: 'all', label: `All (${inventory.length})` },
          { value: 'expiring', label: `Expiring (${expiringItems.length})` },
        ]}
        style={styles.tabs}
      />

      {tab === 'all' ? (
        <FlatList
          data={filtered}
          renderItem={({ item }) => (
            <InventoryItemCard item={item} onDelete={handleDeleteItem} />
          )}
          keyExtractor={(item) => item.item_id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <Text variant="bodyMedium" style={styles.emptyText}>
              {loading ? 'Loading...' : 'No items yet. Tap + to add manually or scan a bill.'}
            </Text>
          }
        />
      ) : (
        <FlatList
          data={expiringItems}
          renderItem={({ item }) => <ExpiringItemCard item={item} />}
          keyExtractor={(item) => item.item_id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <Text variant="bodyMedium" style={styles.emptyText}>
              No expiring items
            </Text>
          }
        />
      )}

      {/* FAB Group — two ways to add items */}
      <Portal>
        <FAB.Group
          open={fabOpen}
          visible
          icon={fabOpen ? 'close' : 'plus'}
          actions={[
            {
              icon: 'pencil-plus',
              label: 'Add Manually',
              onPress: () => setAddModalVisible(true),
              style: { backgroundColor: '#4CAF50' },
              color: '#fff',
            },
            {
              icon: 'camera',
              label: 'Scan & Add',
              onPress: openScanModal,
              style: { backgroundColor: colors.scan },
              color: '#fff',
            },
          ]}
          onStateChange={({ open }) => setFabOpen(open)}
          fabStyle={styles.fab}
        />
      </Portal>

      {/* ── Manual Add Modal ─────────────────────────────────── */}
      <Portal>
        <Modal
          visible={addModalVisible}
          onDismiss={() => setAddModalVisible(false)}
          contentContainerStyle={styles.modal}
        >
          <Text variant="titleLarge" style={styles.modalTitle}>
            Add Item Manually
          </Text>
          <Divider style={styles.modalDivider} />

          <TextInput
            label="Item Name"
            value={newName}
            onChangeText={setNewName}
            mode="outlined"
            style={styles.input}
            placeholder="e.g. Tomato"
          />
          <View style={styles.row}>
            <TextInput
              label="Quantity"
              value={newQty}
              onChangeText={setNewQty}
              mode="outlined"
              style={[styles.input, styles.halfInput]}
              keyboardType="numeric"
              placeholder="e.g. 5"
            />
            <TextInput
              label="Unit"
              value={newUnit}
              onChangeText={setNewUnit}
              mode="outlined"
              style={[styles.input, styles.halfInput]}
              placeholder="e.g. kg"
            />
          </View>
          <TextInput
            label="Expiry Date (optional)"
            value={newExpiry}
            onChangeText={setNewExpiry}
            mode="outlined"
            style={styles.input}
            placeholder="YYYY-MM-DD"
          />

          <View style={styles.modalActions}>
            <Button mode="outlined" onPress={() => setAddModalVisible(false)}>
              Cancel
            </Button>
            <Button mode="contained" onPress={handleAddItem} loading={adding}>
              Add
            </Button>
          </View>
        </Modal>
      </Portal>

      {/* ── Scan Bill Modal ──────────────────────────────────── */}
      <Portal>
        <Modal
          visible={scanModalVisible}
          onDismiss={closeScanModal}
          contentContainerStyle={styles.scanModal}
        >
          <View style={styles.scanModalHeader}>
            <Text variant="titleLarge" style={styles.modalTitle}>
              Scan Grocery Bill
            </Text>
            <IconButton icon="close" size={22} onPress={closeScanModal} />
          </View>
          <Divider style={styles.modalDivider} />

          <ScrollView style={styles.scanModalScroll} showsVerticalScrollIndicator={false}>
            {/* Step 1: Pick image & scan */}
            {!scanResult && (
              <>
                <Text variant="bodyMedium" style={styles.scanDesc}>
                  Take a photo or pick from gallery. We'll extract edible items
                  for you to review before adding to inventory.
                </Text>

                {imageUri && (
                  <Surface style={styles.imageContainer} elevation={1}>
                    <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />
                    <Button
                      mode="text"
                      compact
                      onPress={() => { setImageUri(null); setScanResult(null); }}
                      textColor="#F44336"
                    >
                      Remove
                    </Button>
                  </Surface>
                )}

                <View style={styles.pickRow}>
                  <Button
                    mode="contained"
                    icon="camera"
                    onPress={pickFromCamera}
                    style={styles.pickButton}
                    buttonColor={colors.scan}
                    disabled={scanning}
                  >
                    Camera
                  </Button>
                  <Button
                    mode="contained"
                    icon="image"
                    onPress={pickFromGallery}
                    style={styles.pickButton}
                    buttonColor={colors.scan}
                    disabled={scanning}
                  >
                    Gallery
                  </Button>
                </View>

                <Button
                  mode="contained"
                  icon="magnify-scan"
                  onPress={handleScan}
                  loading={scanning}
                  disabled={scanning || !imageUri}
                  style={styles.scanBtn}
                  contentStyle={{ paddingVertical: 6 }}
                >
                  {scanning ? 'Scanning...' : 'Scan'}
                </Button>

                {scanning && (
                  <View style={styles.scanStatus}>
                    <ActivityIndicator size="large" />
                    <Text variant="bodyMedium" style={styles.scanningText}>
                      Reading your bill...
                    </Text>
                  </View>
                )}
              </>
            )}

            {/* Step 2: Review & confirm items */}
            {scanResult && scanResult.items && scanResult.items.length > 0 && (
              <>
                <Text variant="bodyMedium" style={styles.scanDesc}>
                  Found {scanResult.items.length} edible items. Uncheck any you don't want to add.
                </Text>

                <View style={styles.selectAllRow}>
                  <Button
                    mode="text"
                    compact
                    onPress={selectAll}
                  >
                    {scanResult.items.every((_, i) => selectedItems[i] !== false)
                      ? 'Deselect All'
                      : 'Select All'}
                  </Button>
                  <Text variant="bodySmall" style={{ color: '#666' }}>
                    {Object.values(selectedItems).filter(Boolean).length} of {scanResult.items.length} selected
                  </Text>
                </View>

                {scanResult.items.map((item, idx) => (
                  <Surface key={idx} style={styles.confirmItemRow} elevation={1}>
                    <Checkbox
                      status={selectedItems[idx] !== false ? 'checked' : 'unchecked'}
                      onPress={() => toggleItem(idx)}
                    />
                    <View style={styles.confirmItemInfo}>
                      <Text variant="bodyMedium" style={{ fontWeight: '600', color: '#333' }}>
                        {item.name}
                      </Text>
                      <Text variant="bodySmall" style={{ color: '#666' }}>
                        {item.quantity} {item.unit}
                        {item.shelf_life_days ? `  ·  ~${item.shelf_life_days} day shelf life` : ''}
                      </Text>
                    </View>
                  </Surface>
                ))}

                <View style={styles.confirmActions}>
                  <Button
                    mode="outlined"
                    onPress={() => { setScanResult(null); setSelectedItems({}); }}
                    style={{ flex: 1 }}
                  >
                    Re-scan
                  </Button>
                  <Button
                    mode="contained"
                    onPress={handleAddSelectedItems}
                    loading={addingScanned}
                    disabled={addingScanned || Object.values(selectedItems).filter(Boolean).length === 0}
                    style={{ flex: 1, borderRadius: 12 }}
                  >
                    Add ({Object.values(selectedItems).filter(Boolean).length})
                  </Button>
                </View>
              </>
            )}

            {scanResult && (!scanResult.items || scanResult.items.length === 0) && (
              <View style={styles.scanStatus}>
                <Text variant="bodyMedium" style={{ color: '#999', textAlign: 'center' }}>
                  No edible items found on this bill. Try a clearer photo.
                </Text>
                <Button
                  mode="outlined"
                  onPress={() => { setScanResult(null); setImageUri(null); }}
                  style={{ marginTop: 16 }}
                >
                  Try Again
                </Button>
              </View>
            )}
          </ScrollView>
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  searchbar: {
    margin: 16,
    marginBottom: 8,
  },
  tabs: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  list: {
    padding: 16,
    paddingBottom: 100,
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 40,
    paddingHorizontal: 32,
  },
  fab: {
    backgroundColor: '#4CAF50',
  },

  // Shared modal
  modal: {
    backgroundColor: 'white',
    margin: 20,
    padding: 24,
    borderRadius: 16,
  },
  modalTitle: {
    fontWeight: 'bold',
  },
  modalDivider: {
    marginVertical: 12,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  input: {
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfInput: {
    flex: 1,
  },

  // Scan modal
  scanModal: {
    backgroundColor: 'white',
    margin: 16,
    borderRadius: 16,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  scanModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingLeft: 24,
    paddingRight: 8,
    paddingTop: 16,
  },
  scanModalScroll: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  scanDesc: {
    color: '#666',
    lineHeight: 22,
    marginBottom: 16,
  },
  imageContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: 220,
  },
  pickRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  pickButton: {
    flex: 1,
    borderRadius: 12,
  },
  scanBtn: {
    borderRadius: 12,
    marginBottom: 16,
  },
  scanStatus: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  scanningText: {
    marginTop: 12,
    color: '#666',
  },
  scanResultCard: {
    marginBottom: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  selectAllRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  confirmItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  confirmItemInfo: {
    flex: 1,
    marginLeft: 4,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    marginBottom: 24,
  },
});
