import React, { useState, useEffect, useCallback } from 'react';
import { ActivityIndicator, View, StyleSheet, Text as RNText, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../context/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { InventoryScreen } from '../screens/InventoryScreen';
import { MealsScreen } from '../screens/MealsScreen';
import { CookScreen } from '../screens/CookScreen';
import { ShoppingScreen } from '../screens/ShoppingScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import * as api from '../services/api';
import { WhatsAppShareProvider } from '../components/WhatsAppShareHandler';

const Tab = createBottomTabNavigator();

const linking = {
  prefixes: [Platform.OS === 'web' ? window.location.origin : 'kitchenai://'],
  config: {
    screens: {
      Home: '',
      Inventory: 'inventory',
      Meals: 'meals',
      Cook: 'cook',
      Shopping: 'shopping',
      Profile: 'profile',
    },
  },
};

const TAB_ICONS: Record<string, { focused: string; default: string }> = {
  Home: { focused: '🏠', default: '🏡' },
  Inventory: { focused: '📦', default: '📋' },
  Meals: { focused: '🍽️', default: '🍴' },
  Cook: { focused: '👨‍🍳', default: '🧑‍🍳' },
  Shopping: { focused: '🛒', default: '🛍️' },
  Profile: { focused: '👤', default: '👤' },
};

function EmojiIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons = TAB_ICONS[name] || { focused: '📱', default: '📱' };
  return (
    <RNText style={styles.emojiIcon}>
      {focused ? icons.focused : icons.default}
    </RNText>
  );
}

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color="#4CAF50" />
    </View>
  );
}

export function AppNavigator() {
  const { token, loading } = useAuth();
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [checkingOnboarding, setCheckingOnboarding] = useState(false);

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

  if (loading || (token && (checkingOnboarding || onboardingDone === null))) {
    return <LoadingScreen />;
  }

  if (!token) {
    return <LoginScreen />;
  }

  if (onboardingDone === false) {
    return <OnboardingScreen onComplete={() => setOnboardingDone(true)} />;
  }

  return (
    <WhatsAppShareProvider>
    <NavigationContainer linking={linking}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused }) => (
            <EmojiIcon name={route.name} focused={focused} />
          ),
          tabBarActiveTintColor: '#4CAF50',
          tabBarInactiveTintColor: '#999',
          tabBarStyle: styles.tabBar,
          tabBarLabelStyle: styles.tabLabel,
          headerShown: false,
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Home' }} />
        <Tab.Screen name="Inventory" component={InventoryScreen} options={{ title: 'Inventory' }} />
        <Tab.Screen name="Meals" component={MealsScreen} options={{ title: 'Meals' }} />
        <Tab.Screen name="Cook" component={CookScreen} options={{ title: 'Cook' }} />
        <Tab.Screen name="Shopping" component={ShoppingScreen} options={{ title: 'Shopping' }} />
        <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
      </Tab.Navigator>
    </NavigationContainer>
    </WhatsAppShareProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
  },
  emojiIcon: {
    fontSize: 22,
  },
  tabBar: {
    backgroundColor: '#fff',
    borderTopWidth: 0,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    paddingBottom: 6,
    paddingTop: 6,
    height: 64,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
});
