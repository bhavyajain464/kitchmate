import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { NavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import {
  addMealLogNotificationResponseListener,
  getLastNotificationResponse,
  isMealLogNotificationResponse,
  isMealLogNotificationSupported,
  syncMealLogReminders,
} from '../services/mealLogNotifications';
import {
  isMainTabScreen,
  isMarketingPushData,
  syncPushTokenWithBackend,
} from '../services/marketingPush';

type Props = {
  navigationRef: React.RefObject<NavigationContainerRef<RootStackParamList> | null>;
  children: React.ReactNode;
};

export function MealLogNotificationProvider({ navigationRef, children }: Props) {
  const handledIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isMealLogNotificationSupported()) return;

    const syncNotifications = () => {
      void syncMealLogReminders();
      void syncPushTokenWithBackend();
    };

    syncNotifications();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncNotifications();
    });

    const openMealLog = () => {
      const nav = navigationRef.current;
      if (!nav?.isReady()) return;
      nav.navigate('MainTabs', { screen: 'Meals', params: { openLog: true } });
    };

    const openMarketingScreen = (screen: string) => {
      const nav = navigationRef.current;
      if (!nav?.isReady()) return;
      if (!isMainTabScreen(screen)) {
        nav.navigate('MainTabs', { screen: 'Home' });
        return;
      }
      switch (screen) {
        case 'Inventory':
          nav.navigate('MainTabs', { screen: 'Inventory', params: {} });
          break;
        case 'Meals':
          nav.navigate('MainTabs', { screen: 'Meals', params: {} });
          break;
        case 'Cook':
          nav.navigate('MainTabs', { screen: 'Cook', params: {} });
          break;
        case 'Shopping':
          nav.navigate('MainTabs', { screen: 'Shopping' });
          break;
        default:
          nav.navigate('MainTabs', { screen: 'Home' });
      }
    };

    const handleResponse = (response: import('expo-notifications').NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handledIds.current.has(id)) return;
      handledIds.current.add(id);

      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      if (isMealLogNotificationResponse(data)) {
        openMealLog();
        return;
      }
      if (isMarketingPushData(data) && typeof data.screen === 'string') {
        openMarketingScreen(data.screen);
        return;
      }
      if (isMarketingPushData(data)) {
        openMarketingScreen('Home');
      }
    };

    let sub: { remove: () => void } | null = null;
    let cancelled = false;

    void (async () => {
      sub = await addMealLogNotificationResponseListener(handleResponse);
      if (cancelled) {
        sub?.remove();
        return;
      }
      const last = await getLastNotificationResponse();
      if (last) handleResponse(last);
    })();

    return () => {
      cancelled = true;
      sub?.remove();
      appStateSub.remove();
    };
  }, [navigationRef]);

  return <>{children}</>;
}
