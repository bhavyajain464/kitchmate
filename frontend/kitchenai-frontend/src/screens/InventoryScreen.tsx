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
  Snackbar,
  Menu,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BillCameraModal } from '../components/BillCameraModal';
import { InventoryItemCard } from '../components/InventoryItemCard';
import { pickBillImageFromCameraWeb, pickBillImageFromGallery } from '../utils/billImagePicker';
import * as api from '../services/api';
import { InventoryItem, ExpiringItem, ScanResult } from '../types';
import { colors, layout } from '../theme';

type TabValue = 'all' | 'expired';

export function InventoryScreen() {
  const insets = useSafeAreaInsets();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([]);
  const [expiredItems, setExpiredItems] = useState<ExpiringItem[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TabValue>('all');
  const [expiringSoonFilter, setExpiringSoonFilter] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const [snackMsg, setSnackMsg] = useState('');
  const [snackVisible, setSnackVisible] = useState(false);

  // FAB group (native) / FAB menu (web — avoids nested <button> hydration warning)
  const [fabOpen, setFabOpen] = useState(false);
  const [webMenuVisible, setWebMenuVisible] = useState(false);

  // Manual add modal
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [adding, setAdding] = useState(false);

  // Edit expiry modal
  const [editTarget, setEditTarget] = useState<InventoryItem | ExpiringItem | null>(null);
  const [editExpiry, setEditExpiry] = useState('');
  const [savingExpiry, setSavingExpiry] = useState(false);

  // Scan modal
  const [scanModalVisible, setScanModalVisible] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedItems, setSelectedItems] = useState<Record<number, boolean>>({});
  const [addingScanned, setAddingScanned] = useState(false);
  const [cameraModalVisible, setCameraModalVisible] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [inv, exp, expd] = await Promise.all([
        api.fetchInventory(),
        api.fetchExpiringItems(),
        api.fetchExpiredItems(),
      ]);
      setInventory(Array.isArray(inv) ? inv : []);
      setExpiringItems(Array.isArray(exp) ? exp : []);
      setExpiredItems(Array.isArray(expd) ? expd : []);
    } catch (e) {
      console.error('Failed to load inventory:', e);
      setInventory([]);
      setExpiringItems([]);
      setExpiredItems([]);
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

  const showSnack = (msg: string) => {
    setSnackMsg(msg);
    setSnackVisible(true);
  };

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

  // ── Edit Expiry ──────────────────────────────────────────────

  const openEditExpiry = (item: InventoryItem | ExpiringItem) => {
    setEditTarget(item);
    setEditExpiry(item.estimated_expiry ? item.estimated_expiry.slice(0, 10) : '');
  };

  const closeEditExpiry = () => {
    setEditTarget(null);
    setEditExpiry('');
    setSavingExpiry(false);
  };

  const handleSaveExpiry = async () => {
    if (!editTarget) return;
    const trimmed = editExpiry.trim();
    if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      Alert.alert('Invalid Date', 'Use YYYY-MM-DD or leave blank to clear.');
      return;
    }
    setSavingExpiry(true);
    try {
      await api.updateInventoryItem(editTarget.item_id, {
        canonical_name: editTarget.canonical_name,
        qty: editTarget.qty,
        unit: editTarget.unit,
        estimated_expiry: trimmed || undefined,
        is_manual: 'is_manual' in editTarget ? editTarget.is_manual : true,
      });
      await loadData();
      showSnack(trimmed ? `Expiry updated for "${editTarget.canonical_name}"` : `Expiry cleared for "${editTarget.canonical_name}"`);
      closeEditExpiry();
    } catch {
      Alert.alert('Error', 'Could not update expiry.');
    } finally {
      setSavingExpiry(false);
    }
  };

  // ── Mark as Expired ──────────────────────────────────────────

  const handleExpireItem = async (item: InventoryItem) => {
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Mark "${item.canonical_name}" as expired?`)
      : await new Promise<boolean>((resolve) => {
          Alert.alert('Mark Expired', `Move "${item.canonical_name}" to expired items?`, [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Expire', style: 'destructive', onPress: () => resolve(true) },
          ]);
        });

    if (!confirmed) return;

    try {
      await api.expireInventoryItem(item.item_id);
      await loadData();
      showSnack(`"${item.canonical_name}" moved to expired`);
    } catch {
      Alert.alert('Error', 'Could not mark item as expired.');
    }
  };

  // ── Expired → Shopping ────────────────────────────────────

  const handleAddToShopping = async (item: ExpiringItem) => {
    try {
      await api.addShoppingItem(item.canonical_name, item.qty, item.unit);
      showSnack(`"${item.canonical_name}" added to shopping list`);
    } catch {
      Alert.alert('Error', 'Could not add to shopping list.');
    }
  };

  const handleDeleteExpired = async (item: ExpiringItem) => {
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Remove expired "${item.canonical_name}" from inventory?`)
      : await new Promise<boolean>((resolve) => {
          Alert.alert('Remove Expired', `Remove "${item.canonical_name}" from inventory?`, [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Remove', style: 'destructive', onPress: () => resolve(true) },
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
    setCameraModalVisible(false);
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

  const applyPickedImage = (uri: string) => {
    setImageUri(uri);
    setScanResult(null);
  };

  const pickFromCamera = () => {
    if (Platform.OS === 'web') {
      void (async () => {
        const uri = await pickBillImageFromCameraWeb();
        if (uri) applyPickedImage(uri);
      })();
      return;
    }
    setCameraModalVisible(true);
  };

  const pickFromGallery = async () => {
    const uri = await pickBillImageFromGallery();
    if (uri) applyPickedImage(uri);
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
        result.items.forEach((_: any, i: number) => { allSelected[i] = true; });
        setSelectedItems(allSelected);
      }
    } catch (e: any) {
      console.error('Scan error:', e);
      Alert.alert('Scan Failed', e.message || 'Could not scan bill. Please try again.');
    } finally {
      setScanning(false);
    }
  };

  // ── Filtered lists ──────────────────────────────────────────

  const searchLower = search.toLowerCase();

  const expiringIds = new Set(expiringItems.map((e) => e.item_id));

  const filteredInventory = inventory
    .filter((item) => item.canonical_name.toLowerCase().includes(searchLower))
    .filter((item) => !expiringSoonFilter || expiringIds.has(item.item_id));

  const filteredExpired = expiredItems.filter((item) =>
    item.canonical_name.toLowerCase().includes(searchLower),
  );

  // ── Render ────────────────────────────────────────────────

  const renderExpiredCard = ({ item }: { item: ExpiringItem }) => (
    <Card style={styles.expiredCard} mode="elevated">
      <Card.Content style={styles.expiredContent}>
        <View style={styles.expiredInfo}>
          <Text variant="titleSmall" style={styles.expiredName}>{item.canonical_name}</Text>
          <Text variant="bodySmall" style={styles.expiredQty}>{item.qty} {item.unit}</Text>
          <Text variant="labelSmall" style={styles.expiredDays}>
            Expired {Math.abs(item.days_until_expiry)} day{Math.abs(item.days_until_expiry) !== 1 ? 's' : ''} ago
          </Text>
        </View>
        <View style={styles.expiredActions}>
          <IconButton
            icon="calendar-edit"
            iconColor="#2196F3"
            size={22}
            onPress={() => openEditExpiry(item)}
            style={styles.actionBtn}
          />
          <IconButton
            icon="cart-plus"
            iconColor="#4CAF50"
            size={22}
            onPress={() => handleAddToShopping(item)}
            style={styles.actionBtn}
          />
          <IconButton
            icon="delete-outline"
            iconColor="#F44336"
            size={22}
            onPress={() => handleDeleteExpired(item)}
            style={styles.actionBtn}
          />
        </View>
      </Card.Content>
    </Card>
  );

  const listContentStyle = [styles.list, { paddingBottom: layout.tabBarHeight + insets.bottom + 96 }];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text variant="headlineSmall" style={styles.headerTitle}>
          Inventory
        </Text>
        <Text variant="bodyMedium" style={styles.headerSub}>
          {loading
            ? 'Loading your kitchen…'
            : `${inventory.length} in stock · ${expiringItems.length} expiring soon · ${expiredItems.length} expired`}
        </Text>
        <Text variant="labelSmall" style={styles.headerHint}>
          Search and switch tabs below · tap + to add manually or scan a bill
        </Text>
      </View>

      <Searchbar
        placeholder="Search items…"
        value={search}
        onChangeText={setSearch}
        style={styles.searchbar}
        inputStyle={styles.searchInput}
        iconColor="#4CAF50"
        elevation={2}
      />

      <SegmentedButtons
        value={tab}
        onValueChange={(v) => setTab(v as TabValue)}
        buttons={[
          { value: 'all', label: `Items (${inventory.length})` },
          { value: 'expired', label: `Expired (${expiredItems.length})` },
        ]}
        style={styles.tabs}
      />

      {tab === 'all' && (
        <>
          <View style={styles.filterRow}>
            <Button
              mode={expiringSoonFilter ? 'contained' : 'outlined'}
              icon="clock-alert-outline"
              compact
              onPress={() => setExpiringSoonFilter(!expiringSoonFilter)}
              buttonColor={expiringSoonFilter ? '#FF9800' : undefined}
              textColor={expiringSoonFilter ? '#fff' : '#FF9800'}
              style={styles.filterChip}
              disabled={expiringItems.length === 0}
            >
              Expiring Soon ({expiringItems.length})
            </Button>
          </View>
          <FlatList
            data={filteredInventory}
            renderItem={({ item }) => (
              <InventoryItemCard
                item={item}
                onExpire={handleExpireItem}
                onEditExpiry={openEditExpiry}
              />
            )}
            keyExtractor={(item) => item.item_id}
            contentContainerStyle={listContentStyle}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={
              <Text variant="bodyMedium" style={styles.emptyText}>
                {loading
                  ? 'Loading...'
                  : expiringSoonFilter
                    ? 'No items expiring soon — you\'re in good shape!'
                    : 'No items yet. Tap + to add manually or scan a bill.'}
              </Text>
            }
          />
        </>
      )}

      {tab === 'expired' && (
        <FlatList
          data={filteredExpired}
          renderItem={renderExpiredCard}
          keyExtractor={(item) => item.item_id}
          contentContainerStyle={listContentStyle}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={
            expiredItems.length > 0 ? (
              <Surface style={styles.expiredBanner} elevation={0}>
                <IconButton icon="alert-circle" iconColor="#F44336" size={20} style={{ margin: 0 }} />
                <Text variant="bodySmall" style={styles.expiredBannerText}>
                  Showing items expired in the last 7 days. Tap the calendar to extend, cart to re-order, or trash to remove. Items older than 7 days are auto-deleted.
                </Text>
              </Surface>
            ) : null
          }
          ListEmptyComponent={
            <Text variant="bodyMedium" style={styles.emptyText}>
              No expired items — great job managing your kitchen!
            </Text>
          }
        />
      )}

      {/* FAB — two ways to add items.
          On native we use FAB.Group (renders as Views).
          On web we use FAB + Menu — FAB.Group emits nested <button> on RNW,
          which produces a React DOM hydration warning. */}
      {Platform.OS === 'web' ? (
        <View
          style={[
            styles.webFabWrap,
            { bottom: layout.tabBarHeight + insets.bottom + 16 },
          ]}
          pointerEvents="box-none"
        >
          <Menu
            visible={webMenuVisible}
            onDismiss={() => setWebMenuVisible(false)}
            anchor={
              <FAB
                icon="plus"
                style={styles.fab}
                color="#fff"
                onPress={() => setWebMenuVisible(true)}
              />
            }
            anchorPosition="top"
          >
            <Menu.Item
              leadingIcon="pencil-plus"
              title="Add Manually"
              onPress={() => {
                setWebMenuVisible(false);
                setAddModalVisible(true);
              }}
            />
            <Menu.Item
              leadingIcon="camera"
              title="Scan & Add"
              onPress={() => {
                setWebMenuVisible(false);
                openScanModal();
              }}
            />
          </Menu>
        </View>
      ) : (
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
            style={{ paddingBottom: layout.tabBarHeight + insets.bottom + 8 }}
          />
        </Portal>
      )}

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

      {/* ── Edit Expiry Modal ────────────────────────────────── */}
      <Portal>
        <Modal
          visible={editTarget !== null}
          onDismiss={closeEditExpiry}
          contentContainerStyle={styles.modal}
        >
          <Text variant="titleLarge" style={styles.modalTitle}>
            {editTarget ? `Update expiry — ${editTarget.canonical_name}` : 'Update expiry'}
          </Text>
          <Divider style={styles.modalDivider} />

          <Text variant="bodySmall" style={{ color: '#666', marginBottom: 12 }}>
            Set a new date (YYYY-MM-DD), or leave blank to clear and let AI re-estimate.
          </Text>

          <TextInput
            label="Expiry Date"
            value={editExpiry}
            onChangeText={setEditExpiry}
            mode="outlined"
            style={styles.input}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
          />

          <View style={styles.modalActions}>
            <Button mode="outlined" onPress={closeEditExpiry} disabled={savingExpiry}>
              Cancel
            </Button>
            <Button mode="contained" onPress={handleSaveExpiry} loading={savingExpiry}>
              Save
            </Button>
          </View>
        </Modal>
      </Portal>

      <BillCameraModal
        visible={cameraModalVisible}
        onClose={() => setCameraModalVisible(false)}
        onCaptured={applyPickedImage}
      />

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

            {scanResult && scanResult.items && scanResult.items.length > 0 && (
              <>
                <Text variant="bodyMedium" style={styles.scanDesc}>
                  Found {scanResult.items.length} edible items. Uncheck any you don't want to add.
                </Text>

                <View style={styles.selectAllRow}>
                  <Button mode="text" compact onPress={selectAll}>
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

      <Snackbar
        visible={snackVisible}
        onDismiss={() => setSnackVisible(false)}
        duration={2500}
        action={{ label: 'OK', onPress: () => setSnackVisible(false) }}
      >
        {snackMsg}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  header: {
    backgroundColor: '#2E7D32',
    paddingHorizontal: 20,
    paddingBottom: 22,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerTitle: {
    color: '#fff',
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  headerSub: {
    color: 'rgba(255,255,255,0.92)',
    marginTop: 6,
    lineHeight: 22,
  },
  headerHint: {
    color: 'rgba(255,255,255,0.75)',
    marginTop: 10,
  },
  searchbar: {
    marginHorizontal: 16,
    marginTop: -10,
    marginBottom: 8,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: '#fff',
  },
  searchInput: {
    minHeight: 20,
  },
  tabs: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  filterRow: {
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  filterChip: {
    alignSelf: 'flex-start',
    borderColor: '#FF9800',
    borderRadius: 20,
  },
  list: {
    padding: 16,
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
  webFabWrap: {
    position: 'absolute',
    right: 16,
  },

  // Expired tab
  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF3E0',
    borderRadius: 12,
    padding: 8,
    paddingRight: 16,
    marginBottom: 12,
  },
  expiredBannerText: {
    flex: 1,
    color: '#E65100',
  },
  expiredCard: {
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#F44336',
  },
  expiredContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  expiredInfo: {
    flex: 1,
    gap: 2,
  },
  expiredName: {
    fontWeight: '600',
  },
  expiredQty: {
    color: '#666',
  },
  expiredDays: {
    color: '#F44336',
    fontWeight: '600',
    marginTop: 2,
  },
  expiredActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    margin: 0,
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
