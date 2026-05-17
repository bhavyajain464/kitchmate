import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export async function pickBillImageFromGallery(): Promise<string | null> {
  const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (!existing.granted) {
    const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!requested.granted) {
      Alert.alert('Permission Required', 'Photo library access is needed.');
      return null;
    }
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.8,
    allowsEditing: true,
  });

  if (result.canceled || !result.assets[0]) return null;
  return result.assets[0].uri;
}

/** Web-only fallback; mobile uses in-app camera via expo-camera. */
export async function pickBillImageFromCameraWeb(): Promise<string | null> {
  const existing = await ImagePicker.getCameraPermissionsAsync();
  if (!existing.granted) {
    const requested = await ImagePicker.requestCameraPermissionsAsync();
    if (!requested.granted) {
      Alert.alert('Permission Required', 'Camera access is needed to scan bills.');
      return null;
    }
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.8,
    allowsEditing: true,
  });

  if (result.canceled || !result.assets[0]) return null;
  return result.assets[0].uri;
}
