import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Icon } from 'react-native-paper';
import { useAuth } from '../context/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { LandingScreen } from '../screens/LandingScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { ForceUpdateScreen } from '../screens/ForceUpdateScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { InventoryScreen } from '../screens/InventoryScreen';
import { MealsScreen } from '../screens/MealsScreen';
import { CookScreen } from '../screens/CookScreen';
import { ShoppingScreen } from '../screens/ShoppingScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import * as api from '../services/api';
import { checkForceUpdate } from '../utils/appUpdate';
import { setDishImagesCdnBase } from '../data/dishImageConfig';
import { WhatsAppShareProvider } from '../components/WhatsAppShareHandler';
import { EntitlementsProvider } from '../context/EntitlementsContext';
import { AppRefreshProvider } from '../context/AppRefreshContext';
import { UpgradePaywallProvider, useUpgradePaywall } from '../context/UpgradePaywallContext';
import { MealLogNotificationProvider } from '../context/MealLogNotificationContext';
import { ProductTourProvider } from '../context/ProductTourContext';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { syncWebPathForAuthState } from '../navigation/webHomePath';
import { isAdminWebPlatform } from '../navigation/adminPath';
import { AdminPanelGate } from '../navigation/AdminPanelGate';
import { palette } from '../theme';
import { TourTarget } from '../components/tour/TourTarget';
import { APP_TOUR_TARGET_IDS } from '../tour/appTourSteps';
import type { MainTabParamList, PublicStackParamList, RootStackParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();
const PublicStack = createNativeStackNavigator<PublicStackParamList>();

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const webOrigin = Platform.OS === 'web' ? window.location.origin : 'kitchenai://';

const publicLinking = {
  prefixes: [webOrigin],
  config: {
    screens: {
      Landing: '',
      Login: 'login',
    },
  },
};

const appLinking = {
  prefixes: [webOrigin, 'kitchenai://'],
  config: {
    screens: {
      MainTabs: {
        screens: {
          Home: 'app',
          Inventory: 'inventory',
          Meals: 'meals',
          Cook: 'cook',
          Shopping: 'shopping',
        },
      },
      Profile: 'profile',
    },
  },
};

const TAB_ICONS: Record<keyof MainTabParamList, string> = {
  Home: 'home-outline',
  Inventory: 'clipboard-list-outline',
  Meals: 'silverware-fork-knife',
  Cook: 'pot-steam-outline',
  Shopping: 'cart-outline',
};

function TabBarIcon({ name, color }: { name: keyof MainTabParamList; color: string }) {
  return <Icon source={TAB_ICONS[name]} size={22} color={color} />;
}

function LoadingScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.loading,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <ActivityIndicator size="large" color="#2E7D32" />
    </View>
  );
}

function MainTabNavigator() {
  const { tabBarStyle } = useTabBarLayout();
  const { t } = useTranslation();

  return (
    <Tab.Navigator
      tabBar={(props) => (
        <TourTarget id={APP_TOUR_TARGET_IDS.tabBar}>
          <BottomTabBar {...props} />
        </TourTarget>
      )}
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color }) => (
          <TabBarIcon name={route.name as keyof MainTabParamList} color={color} />
        ),
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle,
        tabBarLabelStyle: styles.tabLabel,
        headerShown: false,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: t('tabs.home') }} />
      <Tab.Screen name="Inventory" component={InventoryScreen} options={{ title: t('tabs.inventory') }} />
      <Tab.Screen name="Meals" component={MealsScreen} options={{ title: t('tabs.meals') }} />
      <Tab.Screen name="Cook" component={CookScreen} options={{ title: t('tabs.cook') }} />
      <Tab.Screen name="Shopping" component={ShoppingScreen} options={{ title: t('tabs.shopping') }} />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainTabs" component={MainTabNavigator} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
    </Stack.Navigator>
  );
}

function PublicNavigator() {
  return (
    <PublicStack.Navigator screenOptions={{ headerShown: false }}>
      <PublicStack.Screen name="Landing" component={LandingScreen} />
      <PublicStack.Screen name="Login" component={LoginScreen} />
    </PublicStack.Navigator>
  );
}

function AuthenticatedAppTree() {
  const { paywallVisible } = useUpgradePaywall();

  return (
    <ProductTourProvider paywallVisible={paywallVisible}>
      <AppRefreshProvider>
        <WhatsAppShareProvider>
          <MealLogNotificationProvider navigationRef={navigationRef}>
            <NavigationContainer ref={navigationRef} linking={appLinking}>
              <RootNavigator />
            </NavigationContainer>
          </MealLogNotificationProvider>
        </WhatsAppShareProvider>
      </AppRefreshProvider>
    </ProductTourProvider>
  );
}

export function AppNavigator() {
  const { token, loading } = useAuth();
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [checkingOnboarding, setCheckingOnboarding] = useState(false);
  const [forceUpdate, setForceUpdate] = useState<{ required: boolean; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.fetchAppConfig().then((config) => {
      if (cancelled) return;
      if (config.dish_images_cdn_url?.trim()) {
        setDishImagesCdnBase(config.dish_images_cdn_url);
      }
    }).catch(() => {});
    checkForceUpdate().then(result => {
      if (!cancelled) setForceUpdate(result);
    });
    api.setOnUpdateRequired(message => {
      setForceUpdate({ required: true, message });
    });
    return () => {
      cancelled = true;
      api.setOnUpdateRequired(null);
    };
  }, []);

  const checkOnboarding = useCallback(async () => {
    if (!token) return;
    setCheckingOnboarding(true);
    try {
      const res = await api.getOnboardingStatus();
      setOnboardingDone(res.onboarding_done);
    } catch {
      setOnboardingDone(true);
    } finally {
      setCheckingOnboarding(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      checkOnboarding();
    } else {
      setOnboardingDone(null);
    }
  }, [token, checkOnboarding]);

  const sessionReady = !loading && (!token || (!checkingOnboarding && onboardingDone !== null));
  const hasAppSession = Boolean(token && onboardingDone !== false);

  useEffect(() => {
    if (!sessionReady) return;
    syncWebPathForAuthState(hasAppSession);
  }, [sessionReady, hasAppSession]);

  if (forceUpdate === null) {
    return <LoadingScreen />;
  }

  if (forceUpdate.required) {
    return <ForceUpdateScreen message={forceUpdate.message} />;
  }

  if (!sessionReady) {
    return <LoadingScreen />;
  }

  if (isAdminWebPlatform()) {
    return <AdminPanelGate />;
  }

  if (!token) {
    if (Platform.OS === 'web') {
      return (
        <NavigationContainer linking={publicLinking}>
          <PublicNavigator />
        </NavigationContainer>
      );
    }
    return <LoginScreen />;
  }

  if (onboardingDone === false) {
    return <OnboardingScreen onComplete={() => setOnboardingDone(true)} />;
  }

  return (
    <EntitlementsProvider>
    <UpgradePaywallProvider>
    <AuthenticatedAppTree />
    </UpgradePaywallProvider>
    </EntitlementsProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: -2,
  },
});
