import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, FlatList, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import AsyncStorage from '@react-native-async-storage/async-storage';

// API base URL - adjust based on your backend
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.0.116:8080/api/v1';

// Google OAuth configuration
WebBrowser.maybeCompleteAuthSession();

// Get client IDs from environment variables
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '208103249970-5j9v2282v0f9r0d8859shqmnurpc93lp.apps.googleusercontent.com';
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '208103249970-5j9v2282v0f9r0d8859shqmnurpc93lp.apps.googleusercontent.com';
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '208103249970-5j9v2282v0f9r0d8859shqmnurpc93lp.apps.googleusercontent.com';

// Log client IDs for debugging (remove in production)
console.log('Google OAuth Client IDs:', {
  web: GOOGLE_WEB_CLIENT_ID,
  ios: GOOGLE_IOS_CLIENT_ID,
  android: GOOGLE_ANDROID_CLIENT_ID
});

interface InventoryItem {
  item_id: string;
  canonical_name: string;
  qty: number;
  unit: string;
  estimated_expiry?: string;
  is_manual: boolean;
}

interface ExpiringItem {
  item_id: string;
  canonical_name: string;
  qty: number;
  unit: string;
  estimated_expiry: string;
  days_until_expiry: number;
}

// Week 4: Rescue Meal Interfaces
interface RescueMealSuggestion {
  meal_id: string;
  meal_name: string;
  description: string;
  ingredients: Array<{
    name: string;
    quantity: number;
    unit: string;
  }>;
  cooking_time: number;
  priority_score: number;
  reason: string;
  can_cook: boolean;
  cook_name?: string;
}

interface RescueMealResponse {
  suggestions: RescueMealSuggestion[];
  expiring_items: ExpiringItem[];
  cook_skills: string[];
  user_preferences?: {
    preferred_cuisines: string[];
    dietary_restrictions: string[];
  };
}

// Week 5: Procurement Interfaces
interface LowStockItem {
  name: string;
  current_qty: number;
  unit: string;
  min_qty: number;
  recommended_qty: number;
  priority: number; // 1=critical, 2=low, 3=ok
}

interface ShoppingListItem {
  item_id: string;
  name: string;
  quantity: number;
  unit: string;
  reason: string; // "low_stock" or "expiring_soon"
  priority: number;
}

interface ShoppingListResponse {
  items: ShoppingListItem[];
  total_items: number;
  generated_at: string;
  low_stock_count: number;
  expiring_count: number;
}

interface PreMarketPingRequest {
  language: string;
  test_mode: boolean;
  include_all: boolean;
}

interface PreMarketPingResponse {
  sent: boolean;
  message: string;
  items_included: string[];
  error?: string;
}

interface ProcurementSummary {
  low_stock_count: number;
  expiring_count: number;
  recent_lists: any[];
  generated_at: string;
  recommendation: string;
}

// Auth Interfaces
interface AuthUser {
  user_id: string;
  google_id: string;
  email: string;
  name: string;
  picture_url: string;
}

interface AuthSession {
  token: string;
  expires_at: string;
  user: AuthUser;
  provider: string;
}

export default function App() {
  // Auth State
  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID,
  });
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // App State
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [whatsappSending, setWhatsappSending] = useState(false);
  const [whatsappResult, setWhatsappResult] = useState<any>(null);
  // Week 4: Rescue Meal State
  const [rescueMealLoading, setRescueMealLoading] = useState(false);
  const [rescueMealResult, setRescueMealResult] = useState<RescueMealResponse | null>(null);
  const [rescueMealError, setRescueMealError] = useState<string | null>(null);
  
  // Week 5: Procurement State
  const [procurementLoading, setProcurementLoading] = useState(false);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
  const [procurementSummary, setProcurementSummary] = useState<ProcurementSummary | null>(null);
  const [preMarketPingResult, setPreMarketPingResult] = useState<PreMarketPingResponse | null>(null);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  useEffect(() => {
    if (response?.type === 'success') {
      const { authentication } = response;
      if (authentication?.idToken) {
        handleGoogleSignIn(authentication.idToken);
      }
    }
  }, [response]);

  useEffect(() => {
    if (authToken) {
      fetchInventory();
      fetchExpiringItems();
    }
  }, [authToken]);

  const fetchInventory = async () => {
    try {
      const response = await authFetch(`${API_BASE_URL}/inventory`);
      const data = await response.json();
      setInventory(data);
    } catch (error) {
      console.error('Error fetching inventory:', error);
      // For demo purposes, show sample data
      setInventory([
        {
          item_id: '1',
          canonical_name: 'Milk',
          qty: 1.5,
          unit: 'liters',
          estimated_expiry: '2026-05-10',
          is_manual: false,
        },
        {
          item_id: '2',
          canonical_name: 'Tomato',
          qty: 5,
          unit: 'pieces',
          estimated_expiry: '2026-05-12',
          is_manual: false,
        },
        {
          item_id: '3',
          canonical_name: 'Paneer',
          qty: 200,
          unit: 'grams',
          estimated_expiry: '2026-05-09',
          is_manual: false,
        },
      ]);
    }
    setLoading(false);
  };

  const fetchExpiringItems = async () => {
    try {
      const response = await authFetch(`${API_BASE_URL}/inventory/expiring`);
      const data = await response.json();
      setExpiringItems(data);
    } catch (error) {
      console.error('Error fetching expiring items:', error);
      // Sample data for demo
      setExpiringItems([
        {
          item_id: '1',
          canonical_name: 'Milk',
          qty: 1.5,
          unit: 'liters',
          estimated_expiry: '2026-05-10',
          days_until_expiry: 3,
        },
        {
          item_id: '3',
          canonical_name: 'Paneer',
          qty: 200,
          unit: 'grams',
          estimated_expiry: '2026-05-09',
          days_until_expiry: 2,
        },
      ]);
    }
  };

  // Authentication functions
  const checkAuthStatus = async () => {
    try {
      setAuthLoading(true);
      const storedToken = await AsyncStorage.getItem('authToken');
      const storedUser = await AsyncStorage.getItem('authUser');
      
      if (storedToken && storedUser) {
        setAuthToken(storedToken);
        setAuthUser(JSON.parse(storedUser));
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleSignIn = async (idToken: string) => {
    try {
      setAuthLoading(true);
      
      // Send Google ID token to backend for verification
      const response = await fetch(`${API_BASE_URL}/auth/google-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id_token: idToken,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.token && result.user) {
        // Store auth data
        await AsyncStorage.setItem('authToken', result.token);
        await AsyncStorage.setItem('authUser', JSON.stringify(result.user));
        
        // Update state
        setAuthToken(result.token);
        setAuthUser(result.user);
        
        Alert.alert('Success', 'Signed in successfully!');
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (error) {
      console.error('Error during Google sign-in:', error);
      Alert.alert(
        'Sign In Failed',
        'Could not sign in with Google. Please try again.'
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      // Clear stored auth data
      await AsyncStorage.removeItem('authToken');
      await AsyncStorage.removeItem('authUser');
      
      // Update state
      setAuthToken(null);
      setAuthUser(null);
      
      Alert.alert('Signed Out', 'You have been signed out.');
    } catch (error) {
      console.error('Error during logout:', error);
    }
  };

  // Helper function for authenticated API calls
  const authFetch = async (url: string, options: RequestInit = {}) => {
    const headers = {
      ...options.headers,
      ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
    };
    
    return fetch(url, {
      ...options,
      headers,
    });
  };

  const handleAddItem = () => {
    Alert.alert('Add Item', 'This would open a form to add new inventory item');
  };

  const handleScanBill = async () => {
    setScanning(true);
    setScanResult(null);
    
    try {
      // For now, use the test endpoint since we don't have actual image data
      const response = await fetch(`${API_BASE_URL}/bill/scan/test`, {
        method: 'GET',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      setScanResult(result);
      
      // Refresh inventory to show newly added items
      fetchInventory();
      fetchExpiringItems();
      
      Alert.alert(
        'Bill Scanned Successfully!',
        `Found ${result.items?.length || 0} items and added ${result.added?.length || 0} to inventory.`
      );
    } catch (error) {
      console.error('Error scanning bill:', error);
      Alert.alert(
        'Scan Failed',
        'Could not scan bill. Please try again or check backend connection.'
      );
    } finally {
      setScanning(false);
    }
  };

  const handleSendToCook = () => {
    Alert.alert('Send to Cook', 'Menu sent to cook via WhatsApp');
  };

  // WhatsApp integration functions (Week 3)
  const handleSendWhatsAppMessage = async () => {
    setWhatsappSending(true);
    setWhatsappResult(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/whatsapp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone_number: '+919876543210', // Test number
          message: 'Hello from Kitchen AI! This is a test message.',
          language: 'hindi',
          test_mode: true,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      setWhatsappResult(result);
      
      Alert.alert(
        'WhatsApp Message Sent!',
        `Message sent successfully. Status: ${result.status || 'unknown'}`
      );
    } catch (error) {
      console.error('Error sending WhatsApp message:', error);
      Alert.alert(
        'WhatsApp Send Failed',
        'Could not send message. Please check backend connection.'
      );
    } finally {
      setWhatsappSending(false);
    }
  };

  const handleSendMealSuggestion = async () => {
    setWhatsappSending(true);
    setWhatsappResult(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/whatsapp/send-meal-suggestion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          meal_name: 'Paneer Butter Masala',
          ingredients: [
            { name: 'Paneer', quantity: 200, unit: 'grams' },
            { name: 'Tomato', quantity: 3, unit: 'pieces' },
            { name: 'Cream', quantity: 100, unit: 'ml' },
          ],
          cooking_time: 30,
          language: 'hindi',
          test_mode: true,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      setWhatsappResult(result);
      
      Alert.alert(
        'Meal Suggestion Sent!',
        `Meal suggestion sent to cook via WhatsApp.`
      );
    } catch (error) {
      console.error('Error sending meal suggestion:', error);
      Alert.alert(
        'Send Failed',
        'Could not send meal suggestion. Please check backend connection.'
      );
    } finally {
      setWhatsappSending(false);
    }
  };

  const handleSendDailyMenu = async () => {
    setWhatsappSending(true);
    setWhatsappResult(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/whatsapp/send-daily-menu`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          meals: [
            { name: 'Paneer Butter Masala', cooking_time: 30 },
            { name: 'Dal Tadka', cooking_time: 25 },
            { name: 'Jeera Rice', cooking_time: 20 },
          ],
          language: 'hindi',
          test_mode: true,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      setWhatsappResult(result);
      
      Alert.alert(
        'Daily Menu Sent!',
        `Daily menu sent to cook via WhatsApp.`
      );
    } catch (error) {
      console.error('Error sending daily menu:', error);
      Alert.alert(
        'Send Failed',
        'Could not send daily menu. Please check backend connection.'
      );
    } finally {
      setWhatsappSending(false);
    }
  };

  const handleTestWhatsAppIntegration = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/whatsapp/test`);
      const result = await response.json();
      Alert.alert(
        'WhatsApp Test Result',
        `Status: ${result.status}\nMessage: ${result.message}`
      );
    } catch (error) {
      console.error('Error testing WhatsApp:', error);
      Alert.alert(
        'Test Failed',
        'Could not test WhatsApp integration.'
      );
    }
  };

  // Week 4: Rescue Meal Functions
  const handleGetRescueMealSuggestions = async () => {
    setRescueMealLoading(true);
    setRescueMealResult(null);
    setRescueMealError(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/rescue-meal/suggestions?max_suggestions=3&language=english`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result: RescueMealResponse = await response.json();
      setRescueMealResult(result);
      
      Alert.alert(
        'Rescue Meal Suggestions Generated!',
        `Found ${result.suggestions.length} meal suggestions based on ${result.expiring_items.length} expiring items.`
      );
    } catch (error) {
      console.error('Error fetching rescue meal suggestions:', error);
      setRescueMealError('Could not fetch rescue meal suggestions. Please check backend connection.');
      Alert.alert(
        'Rescue Meal Failed',
        'Could not generate rescue meal suggestions. Please try again.'
      );
    } finally {
      setRescueMealLoading(false);
    }
  };

  const handleTestRescueMeal = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/rescue-meal/test`);
      const result = await response.json();
      Alert.alert(
        'Rescue Meal Test Result',
        `Status: ${result.status}\nMessage: ${result.message}\nSuggestions: ${result.suggestions?.length || 0}`
      );
    } catch (error) {
      console.error('Error testing rescue meal:', error);
      Alert.alert(
        'Test Failed',
        'Could not test rescue meal endpoint.'
      );
    }
  };

  const handleGetSimpleRescueMeal = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/rescue-meal/simple`);
      const result = await response.json();
      Alert.alert(
        'Simple Rescue Meal',
        `Suggestion: ${result.suggestion || 'No suggestion available'}`
      );
    } catch (error) {
      console.error('Error fetching simple rescue meal:', error);
      Alert.alert(
        'Failed',
        'Could not fetch simple rescue meal suggestion.'
      );
    }
  };

  // Week 5: Procurement API Functions
  const fetchLowStockItems = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/procurement/low-stock`);
      const result = await response.json();
      setLowStockItems(result.low_stock_items || []);
      return result.low_stock_items || [];
    } catch (error) {
      console.error('Error fetching low stock items:', error);
      // Sample data for demo
      const sampleItems: LowStockItem[] = [
        { name: 'Milk', current_qty: 0.3, unit: 'liters', min_qty: 0.5, recommended_qty: 2.0, priority: 1 },
        { name: 'Tomato', current_qty: 2, unit: 'pieces', min_qty: 3, recommended_qty: 10.0, priority: 1 },
        { name: 'Rice', current_qty: 0.3, unit: 'kg', min_qty: 0.5, recommended_qty: 5.0, priority: 2 },
      ];
      setLowStockItems(sampleItems);
      return sampleItems;
    }
  };

  const generateShoppingList = async () => {
    setProcurementLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/procurement/shopping-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          include_low_stock: true,
          include_expiring: true,
          max_items: 15,
        }),
      });
      const result: ShoppingListResponse = await response.json();
      setShoppingList(result.items || []);
      Alert.alert(
        'Shopping List Generated',
        `Generated ${result.total_items} items (${result.low_stock_count} low stock, ${result.expiring_count} expiring)`
      );
    } catch (error) {
      console.error('Error generating shopping list:', error);
      Alert.alert(
        'Shopping List Failed',
        'Could not generate shopping list. Please check backend connection.'
      );
    } finally {
      setProcurementLoading(false);
    }
  };

  const fetchProcurementSummary = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/procurement/summary`);
      const result: ProcurementSummary = await response.json();
      setProcurementSummary(result);
      return result;
    } catch (error) {
      console.error('Error fetching procurement summary:', error);
      // Sample data for demo
      const sampleSummary: ProcurementSummary = {
        low_stock_count: 3,
        expiring_count: 2,
        recent_lists: [],
        generated_at: new Date().toISOString(),
        recommendation: '⚠️ 3 items are critically low. Consider shopping soon.',
      };
      setProcurementSummary(sampleSummary);
      return sampleSummary;
    }
  };

  const sendPreMarketPing = async () => {
    setProcurementLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/procurement/pre-market-ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: 'en',
          test_mode: true,
          include_all: false,
        } as PreMarketPingRequest),
      });
      const result: PreMarketPingResponse = await response.json();
      setPreMarketPingResult(result);
      Alert.alert(
        result.sent ? 'Pre-Market Ping Sent' : 'Pre-Market Ping Not Sent',
        result.message
      );
    } catch (error) {
      console.error('Error sending pre-market ping:', error);
      Alert.alert(
        'Pre-Market Ping Failed',
        'Could not send pre-market ping to cook.'
      );
    } finally {
      setProcurementLoading(false);
    }
  };

  // Render functions for procurement
  const renderLowStockItem = ({ item }: { item: LowStockItem }) => (
    <View style={[styles.itemCard, item.priority === 1 ? styles.criticalItem : styles.lowStockItem]}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemName}>{item.name}</Text>
        <Text style={styles.itemQty}>{item.current_qty} {item.unit}</Text>
      </View>
      <Text style={styles.itemExpiry}>
        Minimum: {item.min_qty} {item.unit} • Recommended: {item.recommended_qty} {item.unit}
      </Text>
      <Text style={styles.alertText}>
        {item.priority === 1 ? '🚨 Critical' : '⚠️ Low Stock'}
      </Text>
    </View>
  );

  const renderShoppingListItem = ({ item }: { item: ShoppingListItem }) => (
    <View style={[styles.itemCard, item.priority === 1 ? styles.criticalItem : styles.lowStockItem]}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemName}>{item.name}</Text>
        <Text style={styles.itemQty}>{item.quantity} {item.unit}</Text>
      </View>
      <Text style={styles.itemExpiry}>
        Reason: {item.reason === 'low_stock' ? 'Low Stock' : 'Expiring Soon'}
      </Text>
    </View>
  );

  const renderInventoryItem = ({ item }: { item: InventoryItem }) => (
    <View style={styles.itemCard}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemName}>{item.canonical_name}</Text>
        <Text style={styles.itemQty}>{item.qty} {item.unit}</Text>
      </View>
      {item.estimated_expiry && (
        <Text style={styles.itemExpiry}>
          Expires: {item.estimated_expiry}
        </Text>
      )}
      <Text style={styles.itemType}>
        {item.is_manual ? 'Manual Entry' : 'Auto-scanned'}
      </Text>
    </View>
  );

  const renderExpiringItem = ({ item }: { item: ExpiringItem }) => (
    <View style={[styles.itemCard, item.days_until_expiry <= 1 ? styles.expiringSoon : null]}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemName}>{item.canonical_name}</Text>
        <Text style={styles.itemQty}>{item.qty} {item.unit}</Text>
      </View>
      <Text style={styles.itemExpiry}>
        Expires in {item.days_until_expiry} day{item.days_until_expiry !== 1 ? 's' : ''}
      </Text>
      <Text style={styles.alertText}>
        {item.days_until_expiry <= 1 ? '⚠️ Use Today!' : 'Use Soon'}
      </Text>
    </View>
  );

  // Week 4: Render rescue meal suggestion
  const renderRescueMealSuggestion = ({ item }: { item: RescueMealSuggestion }) => (
    <View style={[styles.itemCard, item.can_cook ? styles.canCookMeal : styles.cannotCookMeal]}>
      <View style={styles.itemHeader}>
        <Text style={styles.mealName}>{item.meal_name}</Text>
        <Text style={styles.mealScore}>Score: {item.priority_score.toFixed(1)}</Text>
      </View>
      <Text style={styles.mealDescription}>{item.description}</Text>
      <Text style={styles.mealInfo}>
        ⏱️ {item.cooking_time} min • {item.can_cook ? '👨‍🍳 Can cook' : '⚠️ Need recipe'}
        {item.cook_name && ` • Cook: ${item.cook_name}`}
      </Text>
      <Text style={styles.mealReason}>{item.reason}</Text>
      <View style={styles.ingredientsContainer}>
        <Text style={styles.ingredientsTitle}>Ingredients:</Text>
        {item.ingredients.slice(0, 3).map((ing, idx) => (
          <Text key={idx} style={styles.ingredient}>
            • {ing.name} ({ing.quantity} {ing.unit})
          </Text>
        ))}
        {item.ingredients.length > 3 && (
          <Text style={styles.moreIngredients}>+ {item.ingredients.length - 3} more</Text>
        )}
      </View>
    </View>
  );

  // Show loading while checking auth status
  if (authLoading) {
    return (
      <View style={styles.container}>
        <StatusBar style="auto" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.loadingText}>Checking authentication...</Text>
        </View>
      </View>
    );
  }

  // Show login screen if not authenticated
  if (!authToken) {
    return (
      <ScrollView style={styles.container}>
        <StatusBar style="auto" />
        
        <View style={styles.header}>
          <Text style={styles.title}>🍳 Kitchen AI</Text>
          <Text style={styles.subtitle}>Smart Kitchen Management System</Text>
        </View>

        <View style={styles.authContainer}>
          <Text style={styles.authTitle}>Sign In Required</Text>
          <Text style={styles.authDescription}>
            Please sign in with your Google account to access the Kitchen AI dashboard.
          </Text>
          
          <TouchableOpacity
            style={styles.googleSignInButton}
            onPress={() => promptAsync()}
            disabled={!request}
          >
            <Text style={styles.googleSignInButtonText}>Sign in with Google</Text>
          </TouchableOpacity>
          
          <Text style={styles.authNote}>
            You'll be redirected to Google to sign in securely.
          </Text>
        </View>
      </ScrollView>
    );
  }

  // Main app content for authenticated users
  return (
    <ScrollView style={styles.container}>
      <StatusBar style="auto" />
      
      {/* User profile header */}
      <View style={styles.userHeader}>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{authUser?.name || 'User'}</Text>
          <Text style={styles.userEmail}>{authUser?.email || ''}</Text>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.header}>
        <Text style={styles.title}>🍳 Kitchen AI</Text>
        <Text style={styles.subtitle}>Smart Kitchen Management System</Text>
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{inventory.length}</Text>
          <Text style={styles.statLabel}>Items in Stock</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{expiringItems.length}</Text>
          <Text style={styles.statLabel}>Expiring Soon</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>3</Text>
          <Text style={styles.statLabel}>Meal Ideas</Text>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
        </View>
        <View style={styles.actionsContainer}>
          <TouchableOpacity style={styles.actionButton} onPress={handleScanBill}>
            <Text style={styles.actionButtonText}>📸 Scan Bill</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={handleAddItem}>
            <Text style={styles.actionButtonText}>➕ Add Item</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={handleSendToCook}>
            <Text style={styles.actionButtonText}>📱 Send to Cook</Text>
          </TouchableOpacity>
        </View>
      </View>

      {expiringItems.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>🚨 Expiring Soon</Text>
            <Text style={styles.sectionSubtitle}>Use these items first</Text>
          </View>
          <FlatList
            data={expiringItems}
            renderItem={renderExpiringItem}
            keyExtractor={(item) => item.item_id}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.horizontalList}
          />
        </View>
      )}

      {/* Week 2: Bill Scanning Feature */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🧾 Scan Grocery Bill (Week 2)</Text>
          <Text style={styles.sectionSubtitle}>AI-powered bill scanning with Gemini</Text>
        </View>
        
        <View style={styles.billScanCard}>
          <Text style={styles.billScanDescription}>
            Take a photo of your grocery bill and let AI automatically add items to inventory.
          </Text>
          
          <TouchableOpacity
            style={[styles.scanButton, scanning && styles.scanButtonDisabled]}
            onPress={handleScanBill}
            disabled={scanning}
          >
            {scanning ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Text style={styles.scanButtonIcon}>📸</Text>
                <Text style={styles.scanButtonText}>Scan Bill with AI</Text>
              </>
            )}
          </TouchableOpacity>
          
          {scanResult && (
            <View style={styles.scanResult}>
              <Text style={styles.scanResultTitle}>Scan Results:</Text>
              <Text style={styles.scanResultText}>
                Found {scanResult.items?.length || 0} items, added {scanResult.added?.length || 0} to inventory.
              </Text>
              {scanResult.errors && scanResult.errors.length > 0 && (
                <Text style={styles.scanErrorText}>
                  {scanResult.errors.length} errors occurred.
                </Text>
              )}
            </View>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>📦 Current Inventory</Text>
          <Text style={styles.sectionSubtitle}>{inventory.length} items</Text>
        </View>
        <FlatList
          data={inventory}
          renderItem={renderInventoryItem}
          keyExtractor={(item) => item.item_id}
          scrollEnabled={false}
        />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>👨‍🍳 Cook Profile & WhatsApp (Week 3)</Text>
          <Text style={styles.sectionSubtitle}>AI-powered communication bridge</Text>
        </View>
        <View style={styles.cookCard}>
          <Text style={styles.cookName}>Ramesh (Cook)</Text>
          <Text style={styles.cookInfo}>Languages: Hindi, Kannada</Text>
          <Text style={styles.cookInfo}>Dishes Known: 12</Text>
          <Text style={styles.cookStatus}>✅ Available Today</Text>
          
          <View style={styles.whatsappButtonsContainer}>
            <TouchableOpacity
              style={[styles.whatsappButton, whatsappSending && styles.whatsappButtonDisabled]}
              onPress={handleSendWhatsAppMessage}
              disabled={whatsappSending}
            >
              <Text style={styles.whatsappButtonIcon}>💬</Text>
              <Text style={styles.whatsappButtonText}>Send Test Message</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.whatsappButton, whatsappSending && styles.whatsappButtonDisabled]}
              onPress={handleSendMealSuggestion}
              disabled={whatsappSending}
            >
              <Text style={styles.whatsappButtonIcon}>🍛</Text>
              <Text style={styles.whatsappButtonText}>Send Meal Suggestion</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.whatsappButton, whatsappSending && styles.whatsappButtonDisabled]}
              onPress={handleSendDailyMenu}
              disabled={whatsappSending}
            >
              <Text style={styles.whatsappButtonIcon}>📋</Text>
              <Text style={styles.whatsappButtonText}>Send Daily Menu</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.whatsappTestButton}
              onPress={handleTestWhatsAppIntegration}
            >
              <Text style={styles.whatsappTestButtonText}>Test WhatsApp Integration</Text>
            </TouchableOpacity>
          </View>
          
          {whatsappResult && (
            <View style={styles.whatsappResult}>
              <Text style={styles.whatsappResultTitle}>WhatsApp Result:</Text>
              <Text style={styles.whatsappResultText}>
                Status: {whatsappResult.status || 'unknown'}
                {whatsappResult.message_id && `\nMessage ID: ${whatsappResult.message_id}`}
                {whatsappResult.translated && `\nTranslated: ${whatsappResult.translated ? 'Yes' : 'No'}`}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Week 4: Rescue Meal Suggestions */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🍽️ Rescue Meal Suggestions (Week 4)</Text>
          <Text style={styles.sectionSubtitle}>AI-powered meal ideas using expiring items + cook skills</Text>
        </View>
        
        <View style={styles.rescueMealCard}>
          <Text style={styles.rescueMealDescription}>
            Generate meal suggestions based on items expiring soon and your cook's skills.
            The AI considers expiry dates, cook expertise, and your preferences.
          </Text>
          
          <View style={styles.rescueMealButtonsContainer}>
            <TouchableOpacity
              style={[styles.rescueMealButton, rescueMealLoading && styles.rescueMealButtonDisabled]}
              onPress={handleGetRescueMealSuggestions}
              disabled={rescueMealLoading}
            >
              {rescueMealLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Text style={styles.rescueMealButtonIcon}>🤖</Text>
                  <Text style={styles.rescueMealButtonText}>Generate Rescue Meals</Text>
                </>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.rescueMealTestButton}
              onPress={handleTestRescueMeal}
            >
              <Text style={styles.rescueMealTestButtonText}>Test Rescue Meal API</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.rescueMealSimpleButton}
              onPress={handleGetSimpleRescueMeal}
            >
              <Text style={styles.rescueMealSimpleButtonText}>Get Simple Suggestion</Text>
            </TouchableOpacity>
          </View>
          
          {rescueMealError && (
            <View style={styles.rescueMealError}>
              <Text style={styles.rescueMealErrorTitle}>Error:</Text>
              <Text style={styles.rescueMealErrorText}>{rescueMealError}</Text>
            </View>
          )}
          
          {rescueMealResult && (
            <View style={styles.rescueMealResult}>
              <View style={styles.rescueMealResultHeader}>
                <Text style={styles.rescueMealResultTitle}>
                  🎯 Found {rescueMealResult.suggestions.length} meal suggestions
                </Text>
                <Text style={styles.rescueMealResultSubtitle}>
                  Based on {rescueMealResult.expiring_items.length} expiring items
                  {rescueMealResult.cook_skills.length > 0 && ` • Cook skills: ${rescueMealResult.cook_skills.join(', ')}`}
                </Text>
              </View>
              
              <FlatList
                data={rescueMealResult.suggestions}
                renderItem={renderRescueMealSuggestion}
                keyExtractor={(item) => item.meal_id}
                scrollEnabled={false}
                style={styles.rescueMealList}
              />
              
              {rescueMealResult.user_preferences && (
                <View style={styles.userPrefsCard}>
                  <Text style={styles.userPrefsTitle}>User Preferences:</Text>
                  <Text style={styles.userPrefsText}>
                    Cuisines: {rescueMealResult.user_preferences.preferred_cuisines?.join(', ') || 'None'}
                    {'\n'}
                    Dietary Restrictions: {rescueMealResult.user_preferences.dietary_restrictions?.join(', ') || 'None'}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>

      {/* Week 5: Intelligent Procurement */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🛒 Intelligent Procurement (Week 5)</Text>
          <Text style={styles.sectionSubtitle}>Smart shopping lists & pre-market notifications to cook</Text>
        </View>
        
        <View style={styles.procurementCard}>
          <Text style={styles.rescueMealDescription}>
            Automatically detect low stock items, generate smart shopping lists, and send pre-market
            notifications to your cook via WhatsApp before you go shopping.
          </Text>
          
          <View style={styles.procurementButtonsContainer}>
            <TouchableOpacity
              style={styles.procurementButton}
              onPress={generateShoppingList}
              disabled={procurementLoading}
            >
              {procurementLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Text style={styles.procurementButtonIcon}>📝</Text>
                  <Text style={styles.procurementButtonText}>Generate Shopping List</Text>
                </>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.procurementPingButton}
              onPress={sendPreMarketPing}
              disabled={procurementLoading}
            >
              {procurementLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Text style={styles.procurementButtonIcon}>📱</Text>
                  <Text style={styles.procurementPingButtonText}>Send Pre-Market Ping to Cook</Text>
                </>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.rescueMealTestButton}
              onPress={fetchLowStockItems}
            >
              <Text style={styles.rescueMealTestButtonText}>Check Low Stock Items</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.rescueMealSimpleButton}
              onPress={fetchProcurementSummary}
            >
              <Text style={styles.rescueMealSimpleButtonText}>Get Procurement Summary</Text>
            </TouchableOpacity>
          </View>
          
          {preMarketPingResult && (
            <View style={[styles.whatsappResult, { marginTop: 16 }]}>
              <Text style={styles.whatsappResultTitle}>
                {preMarketPingResult.sent ? '✅ Pre-Market Ping Sent' : '⚠️ Pre-Market Ping Not Sent'}
              </Text>
              <Text style={styles.whatsappResultText}>
                {preMarketPingResult.message}
                {preMarketPingResult.items_included && preMarketPingResult.items_included.length > 0 &&
                  `\nItems included: ${preMarketPingResult.items_included.join(', ')}`}
                {preMarketPingResult.error && `\nError: ${preMarketPingResult.error}`}
              </Text>
            </View>
          )}
          
          {lowStockItems.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.sectionSubtitle}>Low Stock Items ({lowStockItems.length})</Text>
              <FlatList
                data={lowStockItems}
                renderItem={renderLowStockItem}
                keyExtractor={(item, index) => `${item.name}-${index}`}
                scrollEnabled={false}
                style={{ marginTop: 8 }}
              />
            </View>
          )}
          
          {shoppingList.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.sectionSubtitle}>Generated Shopping List ({shoppingList.length} items)</Text>
              <FlatList
                data={shoppingList}
                renderItem={renderShoppingListItem}
                keyExtractor={(item) => item.item_id}
                scrollEnabled={false}
                style={{ marginTop: 8 }}
              />
            </View>
          )}
          
          {procurementSummary && (
            <View style={[styles.userPrefsCard, { marginTop: 16 }]}>
              <Text style={styles.userPrefsTitle}>Procurement Summary:</Text>
              <Text style={styles.userPrefsText}>
                Low Stock Items: {procurementSummary.low_stock_count}
                {'\n'}
                Expiring Soon: {procurementSummary.expiring_count}
                {'\n'}
                Recommendation: {procurementSummary.recommendation}
                {'\n'}
                Last Updated: {new Date(procurementSummary.generated_at).toLocaleTimeString()}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Kitchen AI • Bengaluru Edition</Text>
        <Text style={styles.footerSubtext}>AI-powered kitchen management</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    backgroundColor: '#4CAF50',
    padding: 24,
    paddingTop: 48,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    marginTop: -40,
  },
  statCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  section: {
    padding: 16,
  },
  sectionHeader: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    backgroundColor: '#2196F3',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 4,
  },
  actionButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  horizontalList: {
    paddingVertical: 8,
  },
  itemCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  itemQty: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  itemExpiry: {
    fontSize: 14,
    color: '#FF9800',
    marginBottom: 4,
  },
  itemType: {
    fontSize: 12,
    color: '#999',
  },
  expiringSoon: {
    borderLeftWidth: 4,
    borderLeftColor: '#FF5252',
  },
  alertText: {
    fontSize: 12,
    color: '#FF5252',
    fontWeight: '600',
    marginTop: 4,
  },
  cookCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  cookName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  cookInfo: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  cookStatus: {
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '600',
    marginTop: 8,
  },
  footer: {
    padding: 24,
    alignItems: 'center',
    backgroundColor: '#f1f1f1',
    marginTop: 16,
  },
  footerText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  // Bill scanning styles
  billScanCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  billScanDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  scanButton: {
    backgroundColor: '#9C27B0',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButtonDisabled: {
    backgroundColor: '#B39DDB',
  },
  scanButtonIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  scanButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  scanResult: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#F3E5F5',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#9C27B0',
  },
  scanResultTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7B1FA2',
    marginBottom: 4,
  },
  scanResultText: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
  },
  scanErrorText: {
    fontSize: 13,
    color: '#D32F2F',
    marginTop: 4,
    fontWeight: '500',
  },
  // WhatsApp integration styles (Week 3)
  whatsappButtonsContainer: {
    marginTop: 16,
    gap: 8,
  },
  whatsappButton: {
    backgroundColor: '#25D366',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  whatsappButtonDisabled: {
    backgroundColor: '#A0D9A0',
  },
  whatsappButtonIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  whatsappButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  whatsappTestButton: {
    backgroundColor: '#128C7E',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  whatsappTestButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  whatsappResult: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#25D366',
  },
  whatsappResultTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1B5E20',
    marginBottom: 4,
  },
  whatsappResultText: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
  },
  // Week 4: Rescue Meal Styles
  rescueMealCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  rescueMealDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  rescueMealButtonsContainer: {
    gap: 8,
  },
  rescueMealButton: {
    backgroundColor: '#FF9800',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rescueMealButtonDisabled: {
    backgroundColor: '#FFCC80',
  },
  rescueMealButtonIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  rescueMealButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  rescueMealTestButton: {
    backgroundColor: '#795548',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  rescueMealTestButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  rescueMealSimpleButton: {
    backgroundColor: '#607D8B',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  rescueMealSimpleButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  rescueMealError: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#FFEBEE',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#F44336',
  },
  rescueMealErrorTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#C62828',
    marginBottom: 4,
  },
  rescueMealErrorText: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
  },
  rescueMealResult: {
    marginTop: 16,
  },
  rescueMealResultHeader: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  rescueMealResultTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  rescueMealResultSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  rescueMealList: {
    marginTop: 8,
  },
  userPrefsCard: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  userPrefsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1565C0',
    marginBottom: 4,
  },
  userPrefsText: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
  },
  // Rescue meal suggestion item styles
  canCookMeal: {
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  cannotCookMeal: {
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  mealName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  mealScore: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FF9800',
  },
  mealDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
    lineHeight: 18,
  },
  mealInfo: {
    fontSize: 13,
    color: '#795548',
    marginBottom: 8,
    fontWeight: '500',
  },
  mealReason: {
    fontSize: 13,
    color: '#2196F3',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  ingredientsContainer: {
    marginTop: 8,
  },
  ingredientsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  ingredient: {
    fontSize: 13,
    color: '#666',
    marginLeft: 8,
    marginBottom: 2,
  },
  moreIngredients: {
    fontSize: 12,
    color: '#999',
    marginLeft: 8,
    fontStyle: 'italic',
  },
  // Authentication styles
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  authContainer: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    margin: 16,
    marginTop: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  authTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  authDescription: {
    fontSize: 16,
    color: '#666',
    lineHeight: 22,
    marginBottom: 24,
    textAlign: 'center',
  },
  googleSignInButton: {
    backgroundColor: '#4285F4',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  googleSignInButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  authNote: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  userHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    padding: 16,
    marginBottom: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  logoutButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  logoutButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  // Week 5: Procurement styles
  criticalItem: {
    borderLeftWidth: 4,
    borderLeftColor: '#F44336',
    backgroundColor: '#FFEBEE',
  },
  lowStockItem: {
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
    backgroundColor: '#FFF3E0',
  },
  procurementCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  procurementButtonsContainer: {
    gap: 8,
    marginTop: 12,
  },
  procurementButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  procurementButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  procurementPingButton: {
    backgroundColor: '#2196F3',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  procurementPingButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  procurementButtonIcon: {
    fontSize: 20,
    marginRight: 8,
  },
});
