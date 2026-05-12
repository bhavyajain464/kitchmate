import React from 'react';
import { ActivityIndicator, View, StyleSheet, Text as RNText, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../context/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { InventoryScreen } from '../screens/InventoryScreen';
import { MealsScreen } from '../screens/MealsScreen';
import { CookScreen } from '../screens/CookScreen';
import { ShoppingScreen } from '../screens/ShoppingScreen';

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
    },
  },
};

const TAB_ICONS: Record<string, { focused: string; default: string }> = {
  Home: { focused: '🏠', default: '🏡' },
  Inventory: { focused: '📦', default: '📋' },
  Meals: { focused: '🍽️', default: '🍴' },
  Cook: { focused: '👨‍🍳', default: '🧑‍🍳' },
  Shopping: { focused: '🛒', default: '🛍️' },
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

  if (loading) {
    return <LoadingScreen />;
  }

  if (!token) {
    return <LoginScreen />;
  }

  return (
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
          headerStyle: styles.header,
          headerTintColor: '#fff',
          headerTitleStyle: styles.headerTitle,
        })}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: 'Kitchen AI' }}
        />
        <Tab.Screen
          name="Inventory"
          component={InventoryScreen}
          options={{ title: 'Inventory' }}
        />
        <Tab.Screen
          name="Meals"
          component={MealsScreen}
          options={{ title: 'Smart Meals', headerStyle: { backgroundColor: '#FF9800' } }}
        />
        <Tab.Screen
          name="Cook"
          component={CookScreen}
          options={{ title: 'Cook & WhatsApp' }}
        />
        <Tab.Screen
          name="Shopping"
          component={ShoppingScreen}
          options={{ title: 'Shopping' }}
        />
      </Tab.Navigator>
    </NavigationContainer>
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
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    paddingBottom: 4,
    paddingTop: 4,
    height: 60,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  header: {
    backgroundColor: '#4CAF50',
  },
  headerTitle: {
    fontWeight: 'bold',
    color: '#fff',
  },
});
