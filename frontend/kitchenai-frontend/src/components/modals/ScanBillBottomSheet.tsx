import React, { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { OptimizedImage } from '../OptimizedImage';
import {
  ActivityIndicator,
  Button,
  Checkbox,
  Icon,
  Surface,
  Text,
} from 'react-native-paper';
import { BottomSheet, bottomSheetPrimaryBtn } from '../BottomSheet';
import { foodGroupLabel } from '../../constants/inventoryFoodGroups';
import type { InventoryFoodGroup } from '../../types';
import { useAppRefresh } from '../../context/AppRefreshContext';
import { useEntitlements } from '../../context/EntitlementsContext';
import { usePlanUpgrade } from '../../hooks/usePlanUpgrade';
import * as api from '../../services/api';
import { UpgradeRequiredError } from '../../services/api';
import type { ScanResult } from '../../types';
import { colors, palette } from '../../theme';
import {
  pickBillFileFromDevice,
  pickBillImageFromCameraWeb,
  type BillScanPick,
  isPdfBillPick,
} from '../../utils/billImagePicker';
import { BILL_SCAN_ALERT_MESSAGE, BILL_SCAN_ALERT_TITLE } from '../../utils/billScanMessage';
import { userFacingError } from '../../utils/userFacingError';
import { showAppAlert, showAppInfo, showAppSuccess } from '../../utils/alertMessage';
import { showUpgradeMessage } from '../../utils/upgrade';

type Props = {
  visible: boolean;
  onDismiss: () => void;
  onAdded?: () => void;
  groupMeta: InventoryFoodGroup[];
};

type BillCameraModalComponent = React.ComponentType<{
  visible: boolean;
  onClose: () => void;
  onCaptured: (pick: BillScanPick) => void;
}>;

export function ScanBillBottomSheet({ visible, onDismiss, onAdded, groupMeta }: Props) {
  const { entitlements, canBillScan, refresh: refreshEntitlements } = useEntitlements();
  const { startUpgrade } = usePlanUpgrade();
  const { bump } = useAppRefresh();

  const [billPick, setBillPick] = useState<BillScanPick | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedItems, setSelectedItems] = useState<Record<number, boolean>>({});
  const [addingScanned, setAddingScanned] = useState(false);
  const [cameraModalVisible, setCameraModalVisible] = useState(false);
  const [BillCameraModal, setBillCameraModal] = useState<BillCameraModalComponent | null>(null);

  useEffect(() => {
    if (!cameraModalVisible || BillCameraModal) return;
    void import('../BillCameraModal').then(mod => {
      setBillCameraModal(() => mod.BillCameraModal);
    });
  }, [cameraModalVisible, BillCameraModal]);

  const resetState = useCallback(() => {
    setBillPick(null);
    setScanResult(null);
    setScanning(false);
    setSelectedItems({});
    setAddingScanned(false);
    setCameraModalVisible(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    resetState();
  }, [visible, resetState]);

  const handleDismiss = () => {
    if (scanning || addingScanned) return;
    resetState();
    onDismiss();
  };

  const toggleItem = (idx: number) => {
    setSelectedItems((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const selectAll = () => {
    if (!scanResult?.items) return;
    const allSelected = scanResult.items.every((_, i) => selectedItems[i] !== false);
    const next: Record<number, boolean> = {};
    scanResult.items.forEach((_, i) => {
      next[i] = !allSelected;
    });
    setSelectedItems(next);
  };

  const applyBillPick = (pick: BillScanPick) => {
    setBillPick(pick);
    setScanResult(null);
  };

  const pickFromCamera = () => {
    if (Platform.OS === 'web') {
      void (async () => {
        const pick = await pickBillImageFromCameraWeb();
        if (pick) applyBillPick(pick);
      })();
      return;
    }
    setCameraModalVisible(true);
  };

  const pickFromFile = async () => {
    const pick = await pickBillFileFromDevice();
    if (pick) applyBillPick(pick);
  };

  const handleScan = async () => {
    if (!billPick) {
      showAppInfo('Take a photo with the camera or upload an image/PDF first.');
      return;
    }
    if (!canBillScan) {
      showUpgradeMessage('Free plan includes 2 bill scans per day (camera or upload).', startUpgrade);
      return;
    }
    setScanning(true);
    setScanResult(null);
    setSelectedItems({});
    try {
      const result = await api.scanBillUpload(billPick.uri, billPick.mimeType);
      setScanResult(result);
      await refreshEntitlements();
      if (result.items && result.items.length > 0) {
        const allSelected: Record<number, boolean> = {};
        result.items.forEach((_, i) => {
          allSelected[i] = true;
        });
        setSelectedItems(allSelected);
      }
    } catch (e: unknown) {
      console.error('Scan error:', e);
      if (e instanceof UpgradeRequiredError) {
        showUpgradeMessage(e.message, startUpgrade);
        void refreshEntitlements();
      } else {
        const message = userFacingError(e, BILL_SCAN_ALERT_MESSAGE);
        showAppAlert(BILL_SCAN_ALERT_TITLE, message);
      }
    } finally {
      setScanning(false);
    }
  };

  const handleAddSelectedItems = async () => {
    if (!scanResult?.items) return;
    const toAdd = scanResult.items.filter((_, i) => selectedItems[i] !== false);
    if (toAdd.length === 0) {
      showAppInfo('Select at least one item to add.');
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
          food_group: item.food_group,
        });
        addedCount++;
      } catch {
        errors.push(item.name);
      }
    }

    setAddingScanned(false);
    bump('inventory');

    if (errors.length > 0) {
      showAppInfo(`Added ${addedCount} items. Some failed: ${errors.join(', ')}`);
    } else {
      showAppSuccess(`Added ${addedCount} items to inventory.`);
    }
    handleDismiss();
  };

  const selectedCount = Object.values(selectedItems).filter(Boolean).length;
  const hasConfirmList =
    Boolean(scanResult?.items && scanResult.items.length > 0);

  const sheetSubtitle = !scanResult && entitlements && !entitlements.is_pro
    ? `Free plan: ${entitlements.bill_scans_remaining} of ${entitlements.bill_scan_limit} bill scans left today`
    : undefined;

  const footer = hasConfirmList ? (
    <View style={styles.confirmFooter}>
      <Button
        mode="outlined"
        onPress={() => {
          setScanResult(null);
          setSelectedItems({});
        }}
        disabled={addingScanned}
        textColor={palette.primary}
        style={styles.footerBtn}
        contentStyle={styles.footerBtnContent}
        labelStyle={styles.footerBtnLabel}
      >
        Re-scan
      </Button>
      <Button
        mode="contained"
        onPress={() => void handleAddSelectedItems()}
        loading={addingScanned}
        disabled={addingScanned || selectedCount === 0}
        buttonColor={palette.primary}
        style={styles.footerBtn}
        contentStyle={styles.footerBtnContent}
        labelStyle={styles.footerBtnLabel}
      >
        Add ({selectedCount})
      </Button>
    </View>
  ) : !scanResult && billPick && !scanning ? (
    <Button
      mode="contained"
      icon="magnify-scan"
      onPress={() => void handleScan()}
      loading={scanning}
      disabled={scanning}
      buttonColor={colors.scan}
      style={bottomSheetPrimaryBtn.button}
      contentStyle={bottomSheetPrimaryBtn.content}
      labelStyle={bottomSheetPrimaryBtn.label}
    >
      Scan
    </Button>
  ) : null;

  return (
    <>
      {BillCameraModal ? (
        <BillCameraModal
          visible={cameraModalVisible}
          onClose={() => setCameraModalVisible(false)}
          onCaptured={applyBillPick}
        />
      ) : null}

      <BottomSheet
        visible={visible}
        onDismiss={handleDismiss}
        dismissDisabled={scanning || addingScanned}
        title="Scan Grocery Bill"
        subtitle={sheetSubtitle}
        maxHeightRatio={0.92}
        footer={footer}
      >
        {!scanResult && (
          <>
            <Text variant="bodyMedium" style={styles.desc}>
              Snap a photo or upload an image or PDF of your grocery bill. Videos are not supported.
            </Text>

            {billPick && (
              <Surface style={styles.imageContainer} elevation={1}>
                {isPdfBillPick(billPick) ? (
                  <View style={styles.pdfPreview}>
                    <Icon source="file-pdf-box" size={48} color="#C62828" />
                    <Text variant="bodyMedium" style={styles.pdfName} numberOfLines={2}>
                      {billPick.name || 'Bill PDF'}
                    </Text>
                  </View>
                ) : (
                  <OptimizedImage source={{ uri: billPick.uri }} style={styles.image} resizeMode="contain" />
                )}
                <Button
                  mode="text"
                  compact
                  onPress={() => {
                    setBillPick(null);
                    setScanResult(null);
                  }}
                  textColor="#F44336"
                  disabled={scanning}
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
                icon="file-upload"
                onPress={() => void pickFromFile()}
                style={styles.pickButton}
                buttonColor={colors.scan}
                disabled={scanning}
              >
                Upload
              </Button>
            </View>

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

        {hasConfirmList && scanResult?.items && (
          <>
            <Text variant="bodyMedium" style={styles.desc}>
              {scanResult.message ||
                `Found ${scanResult.items.length} recognized ingredients. Uncheck any you don't want to add.`}
            </Text>
            {scanResult.skipped && scanResult.skipped.length > 0 && (
              <Text variant="bodySmall" style={styles.skippedNote}>
                Skipped {scanResult.skipped.length} line
                {scanResult.skipped.length === 1 ? '' : 's'} not in our ingredient list.
              </Text>
            )}

            <View style={styles.selectAllRow}>
              <Button mode="text" compact onPress={selectAll}>
                {scanResult.items.every((_, i) => selectedItems[i] !== false)
                  ? 'Deselect All'
                  : 'Select All'}
              </Button>
              <Text variant="bodySmall" style={styles.selectedCount}>
                {selectedCount} of {scanResult.items.length} selected
              </Text>
            </View>

            {scanResult.items.map((item, idx) => (
              <Surface key={idx} style={styles.confirmItemRow} elevation={1}>
                <Checkbox
                  status={selectedItems[idx] !== false ? 'checked' : 'unchecked'}
                  onPress={() => toggleItem(idx)}
                />
                <View style={styles.confirmItemInfo}>
                  <Text variant="bodyMedium" style={styles.confirmItemName}>
                    {item.name}
                  </Text>
                  <Text variant="bodySmall" style={styles.confirmItemMeta}>
                    {item.quantity} {item.unit}
                    {item.food_group ? `  ·  ${foodGroupLabel(item.food_group, groupMeta)}` : ''}
                    {item.shelf_life_days ? `  ·  ~${item.shelf_life_days} day shelf life` : ''}
                  </Text>
                </View>
              </Surface>
            ))}
          </>
        )}

        {scanResult && (!scanResult.items || scanResult.items.length === 0) && (
          <View style={styles.scanStatus}>
            <Text variant="bodyMedium" style={styles.emptyResult}>
              {scanResult.skipped && scanResult.skipped.length > 0
                ? 'No recognized ingredients on this bill. Try a clearer photo or add items manually.'
                : 'No edible items found on this bill. Try a clearer photo.'}
            </Text>
            <Button
              mode="outlined"
              onPress={() => {
                setScanResult(null);
                setBillPick(null);
              }}
              style={styles.tryAgainBtn}
            >
              Try Again
            </Button>
          </View>
        )}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  desc: {
    color: palette.textSecondary,
    lineHeight: 22,
    marginBottom: 12,
  },
  skippedNote: {
    color: palette.textSecondary,
    marginBottom: 12,
    fontStyle: 'italic',
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
    height: 200,
  },
  pdfPreview: {
    width: '100%',
    minHeight: 120,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pdfName: {
    color: '#444',
    textAlign: 'center',
    fontWeight: '600',
  },
  pickRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  pickButton: {
    flex: 1,
    borderRadius: 12,
  },
  scanStatus: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  scanningText: {
    marginTop: 12,
    color: palette.textSecondary,
  },
  selectAllRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  selectedCount: {
    color: palette.textSecondary,
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
  confirmItemName: {
    fontWeight: '600',
    color: palette.text,
  },
  confirmItemMeta: {
    color: palette.textSecondary,
  },
  confirmFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  footerBtn: {
    flex: 1,
    borderRadius: 12,
    minHeight: 52,
  },
  footerBtnContent: {
    height: 52,
    paddingVertical: 0,
  },
  footerBtnLabel: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
    marginVertical: 0,
  },
  emptyResult: {
    color: palette.textMuted,
    textAlign: 'center',
  },
  tryAgainBtn: {
    marginTop: 16,
    borderRadius: 12,
  },
});
