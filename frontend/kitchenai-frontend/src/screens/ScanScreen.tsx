import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, Image, Alert, Platform } from 'react-native';
import { Text, Button, Card, Surface, ActivityIndicator } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import * as api from '../services/api';
import { ScanResult } from '../types';
import { colors } from '../theme';

export function ScanScreen() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);

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
        Alert.alert('Permission Required', 'Photo library access is needed to select bills.');
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
      setResult(null);
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
      setResult(null);
    }
  };

  const handleScan = async () => {
    if (!imageUri) {
      Alert.alert('No Image', 'Please take a photo or pick one from gallery first.');
      return;
    }
    setScanning(true);
    setResult(null);

    try {
      const scanResult = await api.scanBillUpload(imageUri);
      setResult(scanResult);
      const addedCount = scanResult.added_to_inventory?.length || 0;
      const itemCount = scanResult.items?.length || 0;
      Alert.alert(
        'Bill Scanned!',
        `Found ${itemCount} items, added ${addedCount} to inventory with estimated expiry dates.`,
      );
    } catch (e: any) {
      console.error('Scan error:', e);
      Alert.alert('Scan Failed', e.message || 'Could not scan bill. Please try again.');
    } finally {
      setScanning(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card} mode="elevated">
        <Card.Content>
          <Text variant="titleLarge" style={styles.title}>
            Scan Grocery Bill
          </Text>
          <Text variant="bodyMedium" style={styles.description}>
            Take a photo of your grocery bill or pick one from gallery. Gemini AI
            will extract items and add them to your inventory.
          </Text>

          {/* Image Preview */}
          {imageUri && (
            <Surface style={styles.imageContainer} elevation={1}>
              <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />
              <Button
                mode="text"
                compact
                onPress={() => {
                  setImageUri(null);
                  setResult(null);
                }}
                textColor="#F44336"
              >
                Remove
              </Button>
            </Surface>
          )}

          {/* Pick Buttons */}
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
            icon="text-recognition"
            onPress={handleScan}
            loading={scanning}
            disabled={scanning || !imageUri}
            style={styles.scanButton}
            contentStyle={styles.scanButtonContent}
          >
            Scan with Gemini AI
          </Button>
        </Card.Content>
      </Card>

      {/* Results */}
      {scanning && (
        <Surface style={styles.resultCard} elevation={1}>
          <ActivityIndicator size="large" />
          <Text variant="bodyMedium" style={styles.scanningText}>
            Analyzing bill with Gemini AI...
          </Text>
        </Surface>
      )}

      {result && (
        <Card style={styles.resultCard} mode="elevated">
          <Card.Content>
            <Text variant="titleMedium" style={styles.resultTitle}>
              Scan Results
            </Text>

            {result.items && result.items.length > 0 && (
              <View style={styles.resultSection}>
                <Text variant="labelLarge">Items Found ({result.items.length}):</Text>
                {result.items.map((item, idx) => (
                  <View key={idx} style={styles.resultItemRow}>
                    <Text variant="bodyMedium" style={styles.resultItemName}>
                      {item.name}
                    </Text>
                    <Text variant="bodySmall" style={styles.resultItem}>
                      {item.quantity} {item.unit}
                      {item.shelf_life_days ? ` · expires in ~${item.shelf_life_days} days` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {result.added_to_inventory && result.added_to_inventory.length > 0 && (
              <View style={styles.resultSection}>
                <Text variant="labelLarge" style={styles.addedLabel}>
                  Added to Inventory ({result.added_to_inventory.length}):
                </Text>
                {result.added_to_inventory.map((item, idx) => (
                  <View key={idx} style={styles.resultItemRow}>
                    <Text variant="bodyMedium" style={styles.resultItemName}>
                      {item.action === 'updated' ? '↑' : '+'} {item.name}
                    </Text>
                    <Text variant="bodySmall" style={styles.resultItem}>
                      {item.quantity} {item.unit} · {item.action}
                      {item.estimated_expiry ? ` · expiry: ${item.estimated_expiry}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {result.errors && result.errors.length > 0 && (
              <View style={styles.resultSection}>
                <Text variant="labelLarge" style={styles.errorLabel}>
                  Errors ({result.errors.length}):
                </Text>
                {result.errors.map((err, idx) => (
                  <Text key={idx} variant="bodySmall" style={styles.errorText}>
                    {err}
                  </Text>
                ))}
              </View>
            )}
          </Card.Content>
        </Card>
      )}
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
    paddingBottom: 32,
  },
  card: {
    marginBottom: 16,
  },
  title: {
    fontWeight: 'bold',
    marginBottom: 8,
  },
  description: {
    color: '#666',
    lineHeight: 22,
    marginBottom: 20,
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
    height: 250,
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
  scanButton: {
    borderRadius: 12,
  },
  scanButtonContent: {
    paddingVertical: 6,
  },
  resultCard: {
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  scanningText: {
    marginTop: 12,
    color: '#666',
  },
  resultTitle: {
    fontWeight: 'bold',
    marginBottom: 12,
  },
  resultSection: {
    marginBottom: 12,
  },
  resultItemRow: {
    marginLeft: 12,
    marginTop: 8,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  resultItemName: {
    fontWeight: '600',
    color: '#333',
  },
  resultItem: {
    color: '#666',
    marginTop: 2,
  },
  addedLabel: {
    color: '#4CAF50',
  },
  errorLabel: {
    color: '#F44336',
  },
  errorText: {
    color: '#D32F2F',
    marginLeft: 12,
    marginTop: 4,
  },
});
