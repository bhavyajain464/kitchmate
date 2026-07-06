import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppLanguage } from './types';
import { isAppLanguage } from './types';

const APP_LANGUAGE_KEY = 'app_language';

export async function loadSavedAppLanguage(): Promise<AppLanguage | null> {
  const raw = await AsyncStorage.getItem(APP_LANGUAGE_KEY);
  if (!raw || !isAppLanguage(raw)) return null;
  return raw;
}

export async function saveAppLanguage(lang: AppLanguage): Promise<void> {
  await AsyncStorage.setItem(APP_LANGUAGE_KEY, lang);
}
