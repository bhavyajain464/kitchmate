import { Platform } from 'react-native';
import {
  InventoryItem,
  ExpiringItem,
  RescueMealResponse,
  LowStockItem,
  ShoppingListResponse,
  PreMarketPingResponse,
  ProcurementSummary,
  ScanResult,
  WhatsAppResult,
  CookInfo,
  CookProfile,
} from '../types';

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.0.116:8080/api/v1';

let _authToken: string | null = null;

export function setAuthToken(token: string | null) {
  _authToken = token;
}

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (_authToken) {
    headers['Authorization'] = `Bearer ${_authToken}`;
  }
  return fetch(url, { ...options, headers });
}

// ─── Inventory ───────────────────────────────────────────────

export async function fetchInventory(): Promise<InventoryItem[]> {
  const res = await authFetch(`${API_BASE_URL}/inventory`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchExpiringItems(): Promise<ExpiringItem[]> {
  const res = await authFetch(`${API_BASE_URL}/inventory/expiring`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function addInventoryItem(item: {
  canonical_name: string;
  qty: number;
  unit: string;
  estimated_expiry?: string;
}): Promise<InventoryItem> {
  const res = await authFetch(`${API_BASE_URL}/inventory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function deleteInventoryItem(itemId: string): Promise<void> {
  const res = await authFetch(`${API_BASE_URL}/inventory/${itemId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ─── Bill Scanning ───────────────────────────────────────────

export async function scanBillTest(): Promise<ScanResult> {
  const res = await fetch(`${API_BASE_URL}/bill/scan/test`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function scanBillUpload(imageUri: string): Promise<ScanResult> {
  const filename = imageUri.split('/').pop() || 'bill.jpg';
  const ext = filename.split('.').pop()?.toLowerCase() || 'jpeg';
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

  let base64Data: string;

  if (Platform.OS === 'web') {
    const response = await fetch(imageUri);
    const blob = await response.blob();
    base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        resolve(dataUrl.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } else {
    const FileSystem = require('expo-file-system');
    base64Data = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  const res = await authFetch(`${API_BASE_URL}/bill/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_data: base64Data,
      image_type: mimeType,
    }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errorText}`);
  }
  return res.json();
}

// ─── WhatsApp ────────────────────────────────────────────────

export async function sendWhatsAppMessage(
  phoneNumber: string,
  message: string,
  language: string = 'hindi',
): Promise<WhatsAppResult> {
  const res = await authFetch(`${API_BASE_URL}/whatsapp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone_number: phoneNumber,
      message,
      language,
      test_mode: true,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function sendMealSuggestion(
  mealName: string,
  ingredients: Array<{ name: string; quantity: number; unit: string }>,
  cookingTime: number,
  language: string = 'hindi',
): Promise<WhatsAppResult> {
  const res = await authFetch(`${API_BASE_URL}/whatsapp/send-meal-suggestion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meal_name: mealName,
      ingredients,
      cooking_time: cookingTime,
      language,
      test_mode: true,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function sendDailyMenu(
  meals: Array<{ name: string; cooking_time: number }>,
  language: string = 'hindi',
): Promise<WhatsAppResult> {
  const res = await authFetch(`${API_BASE_URL}/whatsapp/send-daily-menu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meals, language, test_mode: true }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function testWhatsApp(): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE_URL}/whatsapp/test`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getCookInfo(): Promise<CookInfo> {
  const res = await authFetch(`${API_BASE_URL}/whatsapp/cook-info`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Rescue Meals ────────────────────────────────────────────

export async function getRescueMealSuggestions(
  maxSuggestions: number = 3,
): Promise<RescueMealResponse> {
  const res = await authFetch(
    `${API_BASE_URL}/rescue-meal/suggestions?max_suggestions=${maxSuggestions}&language=english`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function testRescueMeal(): Promise<{
  status: string;
  message: string;
  suggestions?: any[];
}> {
  const res = await fetch(`${API_BASE_URL}/rescue-meal/test`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getSimpleRescueMeal(): Promise<{ suggestion: string }> {
  const res = await fetch(`${API_BASE_URL}/rescue-meal/simple`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Procurement ─────────────────────────────────────────────

export async function fetchLowStockItems(): Promise<LowStockItem[]> {
  const res = await authFetch(`${API_BASE_URL}/procurement/low-stock`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.low_stock_items || [];
}

export async function generateShoppingList(): Promise<ShoppingListResponse> {
  const res = await authFetch(`${API_BASE_URL}/procurement/shopping-list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      include_low_stock: true,
      include_expiring: true,
      max_items: 15,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchProcurementSummary(): Promise<ProcurementSummary> {
  const res = await authFetch(`${API_BASE_URL}/procurement/summary`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function sendPreMarketPing(
  language: string = 'en',
): Promise<PreMarketPingResponse> {
  const res = await authFetch(`${API_BASE_URL}/procurement/pre-market-ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language,
      test_mode: true,
      include_all: false,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Smart Meals (LLM-powered) ────────────────────────────────

export async function getSmartMeals(): Promise<any> {
  const res = await authFetch(`${API_BASE_URL}/meals/smart`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Cook Profile ─────────────────────────────────────────────

export async function fetchCookProfile(): Promise<CookProfile> {
  const res = await authFetch(`${API_BASE_URL}/cook/profile`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function updateCookProfile(profile: {
  dishes_known: string[];
  preferred_lang: string;
  phone_number?: string;
}): Promise<void> {
  const res = await authFetch(`${API_BASE_URL}/cook/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ─── Auth ────────────────────────────────────────────────────

export async function googleLogin(credential: string) {
  const res = await fetch(`${API_BASE_URL}/auth/google-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

export async function logoutApi(token: string) {
  await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}
