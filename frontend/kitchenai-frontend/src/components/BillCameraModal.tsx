import React, { useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { IconButton, Text, Button, ActivityIndicator } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type BillCameraModalProps = {
  visible: boolean;
  onClose: () => void;
  onCaptured: (uri: string) => void;
};

export function BillCameraModal({ visible, onClose, onCaptured }: BillCameraModalProps) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);

  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (photo?.uri) {
        onCaptured(photo.uri);
        onClose();
      }
    } catch (e) {
      console.error('Camera capture failed:', e);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {!permission?.granted ? (
          <View style={[styles.permissionBox, { paddingTop: insets.top + 24 }]}>
            <Text variant="titleMedium" style={styles.permissionTitle}>
              Camera access needed
            </Text>
            <Text variant="bodyMedium" style={styles.permissionDesc}>
              Allow camera access to photograph grocery bills.
            </Text>
            <Button mode="contained" onPress={requestPermission} style={styles.permissionBtn}>
              Allow Camera
            </Button>
            <Button mode="text" onPress={onClose}>
              Cancel
            </Button>
          </View>
        ) : (
          <>
            <CameraView ref={cameraRef} style={styles.camera} facing="back" />
            <View style={[styles.controls, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
              <IconButton icon="close" iconColor="#fff" size={28} onPress={onClose} />
              <IconButton
                icon="camera"
                iconColor="#fff"
                size={36}
                containerColor="#2E7D32"
                onPress={handleCapture}
                disabled={capturing}
              />
              <View style={styles.spacer} />
            </View>
            {capturing && (
              <View style={styles.capturingOverlay}>
                <ActivityIndicator size="large" color="#fff" />
              </View>
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  controls: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  spacer: {
    width: 48,
  },
  permissionBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#fff',
  },
  permissionTitle: {
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  permissionDesc: {
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  permissionBtn: {
    marginBottom: 8,
    minWidth: 200,
  },
  capturingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
