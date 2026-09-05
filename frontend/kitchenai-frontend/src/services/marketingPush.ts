import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  ensureNotificationPermission,
  isMealLogNotificationSupported,
} from './mealLogNotifications';
import * as api from './api';

const PUSH_TOKEN_STORAGE_KEY = 'expo_push_token_last';
const ANDROID_MARKETING_CHANNEL = 'marketing';

type NotificationsModule = typeof import('expo-notifications');

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (!isMealLogNotificationSupported()) return null;
  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
}

async function ensureMarketingChannel(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_MARKETING_CHANNEL, {
    name: 'News & updates',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200],
    lightColor: '#2E7D32',
    description: 'Product news, tips, and new features',
    sound: 'default',
    enableVibrate: true,
    showBadge: true,
  });
}

function resolveExpoProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

export const MAIN_TAB_SCREENS = {
  Home: true,
  Inventory: true,
  Meals: true,
  Cook: true,
  Shopping: true,
} as const;

export type MainTabScreenName = keyof typeof MAIN_TAB_SCREENS;

export type MarketingPushData = {
  type: 'marketing';
  screen?: MainTabScreenName;
};

export function isMarketingPushData(
  data: Record<string, unknown> | undefined,
): data is MarketingPushData & { screen?: string } {
  return data?.type === 'marketing';
}

export function isMainTabScreen(screen: string): screen is MainTabScreenName {
  return screen in MAIN_TAB_SCREENS;
}

/** Registers Expo push token with backend when permission is granted (native only). */
export async function syncPushTokenWithBackend(): Promise<void> {
  if (!isMealLogNotificationSupported()) return;

  try {
    const Notifications = await loadNotifications();
    if (!Notifications) return;

    const perm = await ensureNotificationPermission();
    if (!perm.granted) {
      console.warn('[push] notification permission not granted — skipping token registration');
      return;
    }

    const projectId = resolveExpoProjectId();
    if (!projectId) {
      console.warn('[push] missing EAS projectId — cannot register push token');
      return;
    }

    await ensureMarketingChannel(Notifications);
    const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResult.data?.trim();
    if (!token) {
      console.warn('[push] getExpoPushTokenAsync returned empty token');
      return;
    }

    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    await api.registerPushToken({ expo_push_token: token, platform });
    await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
    console.log('[push] registered token with backend:', token.slice(0, 28) + '…');
  } catch (err) {
    console.warn('[push] token registration failed:', err);
  }
}

/** Removes the last registered token from backend (e.g. on logout). */
export async function clearPushTokenFromBackend(): Promise<void> {
  const token = (await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY))?.trim();
  if (!token) return;
  try {
    await api.deletePushToken({ expo_push_token: token });
  } catch {
    // Best-effort on logout.
  }
  await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
}
