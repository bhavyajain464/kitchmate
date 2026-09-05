import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, Platform } from 'react-native';
import { OptimizedImage } from '../components/OptimizedImage';
import { Text, Button, Card, Surface, ActivityIndicator, Icon } from 'react-native-paper';
import { BillCameraModal } from '../components/BillCameraModal';
import * as api from '../services/api';
import { ScanResult } from '../types';
import { colors } from '../theme';
import {
  pickBillFileFromDevice,
  pickBillImageFromCameraWeb,
  type BillScanPick,
  isPdfBillPick,
} from '../utils/billImagePicker';
import { useEntitlements } from '../context/EntitlementsContext';
import { usePlanUpgrade } from '../hooks/usePlanUpgrade';
import { showUpgradeMessage } from '../utils/upgrade';
import { UpgradeRequiredError } from '../services/api';
import { showAppAlert } from '../utils/alertMessage';
import { BILL_SCAN_ALERT_MESSAGE, BILL_SCAN_ALERT_TITLE } from '../utils/billScanMessage';
import { userFacingError } from '../utils/userFacingError';
import { showAppInfo, showAppSuccess } from '../utils/alertMessage';

export function ScanScreen() {
  const { canBillScan, refresh: refreshEntitlements } = useEntitlements();
  const { startUpgrade } = usePlanUpgrade();
  const [billPick, setBillPick] = useState<BillScanPick | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [cameraModalVisible, setCameraModalVisible] = useState(false);

  const applyBillPick = (pick: BillScanPick) => {
    setBillPick(pick);
    setResult(null);
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
    setResult(null);

    try {
      const scanResult = await api.scanBillUpload(billPick.uri, billPick.mimeType);
      await refreshEntitlements();
      setResult(scanResult);
      const addedCount = scanResult.added_to_inventory?.length || 0;
      const itemCount = scanResult.items?.length || 0;
      showAppSuccess(
        `Found ${itemCount} items, added ${addedCount} to inventory.`,
      );
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

  return (
    <>
    <BillCameraModal
      visible={cameraModalVisible}
      onClose={() => setCameraModalVisible(false)}
      onCaptured={applyBillPick}
    />
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card} mode="elevated">
        <Card.Content>
          <Text variant="titleLarge" style={styles.title}>
            Scan Grocery Bill
          </Text>
          <Text variant="bodyMedium" style={styles.description}>
            Take a photo or upload an image or PDF of your bill. Videos are not supported.
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
                  setResult(null);
                }}
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
              icon="file-upload"
              onPress={pickFromFile}
              style={styles.pickButton}
              buttonColor={colors.scan}
              disabled={scanning}
            >
              Upload
            </Button>
          </View>

          <Button
            mode="contained"
            icon="text-recognition"
            onPress={handleScan}
            loading={scanning}
            disabled={scanning || !billPick}
            style={styles.scanButton}
            contentStyle={styles.scanButtonContent}
          >
            Scan Bill
          </Button>
        </Card.Content>
      </Card>

      {scanning && (
        <Surface style={styles.resultCard} elevation={1}>
          <ActivityIndicator size="large" />
          <Text variant="bodyMedium" style={styles.scanningText}>
            Reading your bill...
          </Text>
        </Surface>
      )}

      {result && result.items && result.items.length > 0 && (
        <Surface style={styles.resultCard} elevation={1}>
          <Text variant="titleMedium" style={styles.resultTitle}>
            Found {result.items.length} items
          </Text>
          {result.items.map((item, idx) => (
            <Text key={idx} variant="bodyMedium" style={styles.resultItem}>
              • {item.name} — {item.quantity} {item.unit}
            </Text>
          ))}
        </Surface>
      )}
    </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },
  content: { padding: 16, paddingBottom: 32 },
  card: { borderRadius: 16, marginBottom: 16 },
  title: { fontWeight: '700', color: '#333', marginBottom: 8 },
  description: { color: '#666', lineHeight: 22, marginBottom: 16 },
  imageContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  image: { width: '100%', height: 220 },
  pdfPreview: {
    width: '100%',
    minHeight: 120,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pdfName: { color: '#444', textAlign: 'center', fontWeight: '600' },
  pickRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  pickButton: { flex: 1, borderRadius: 12 },
  scanButton: { borderRadius: 12, backgroundColor: colors.scan },
  scanButtonContent: { paddingVertical: 6 },
  resultCard: {
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#fff',
    marginBottom: 16,
  },
  scanningText: { marginTop: 12, color: '#666' },
  resultTitle: { fontWeight: '700', marginBottom: 12, alignSelf: 'flex-start' },
  resultItem: { color: '#555', marginBottom: 4, alignSelf: 'flex-start' },
});
