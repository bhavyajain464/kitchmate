import { Platform } from 'react-native';
import {
  clampWhatsAppMessageText,
  logImportError,
  normalizeParsedAction,
  toUserFacingMessage,
  unknownWhatsAppAction,
} from '../utils/whatsappAction';
import {
  InventoryItem,
  ExpiringItem,
  RescueMealResponse,
  LowStockItem,
  ShoppingListResponse,
  UserShoppingItem,
  PreMarketPingResponse,
  ProcurementSummary,
  ScanResult,
  WhatsAppResult,
  WhatsAppParsedAction,
  WhatsAppParseResponse,
  WhatsAppApplyResponse,
  CookInfo,
  CookProfile,
  UserProfile,
  UpdateProfileRequest,
  UserMemory,
  CookedLogEntry,
  CookedHistoryResponse,
} from '../types';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL!;

let _authToken: string | null = null;
let _onUnauthorized: (() => void) | null = null;
let _unauthorizedFired = false;

export function setAuthToken(token: string | null) {
  _authToken = token;
  if (token) {
    _unauthorizedFired = false;
  }
}

/**
 * Register a callback that runs when the API returns 401. The first 401 after
 * a fresh sign-in fires the callback exactly once so AuthContext can clear the
 * session and route the user to Login instead of rendering empty data.
 */
export function setOnUnauthorized(handler: (() => void) | null) {
  _onUnauthorized = handler;
}

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  // Snapshot the token at the moment the request is dispatched. If the call
  // returns 401 we only treat it as a session-expired event when the request
  // actually carried a token; an unauthenticated call (token not yet set, or
  // a public endpoint) returning 401 is not a sign of an expired session.
  const tokenAtRequest = _authToken;
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (tokenAtRequest) {
    headers['Authorization'] = `Bearer ${tokenAtRequest}`;
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 && tokenAtRequest) {
    _authToken = null;
    if (_onUnauthorized && !_unauthorizedFired) {
      _unauthorizedFired = true;
      try {
        _onUnauthorized();
      } catch (e) {
        console.warn('onUnauthorized handler failed:', e);
      }
    }
  }
  return res;
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

export async function fetchExpiredItems(): Promise<ExpiringItem[]> {
  const res = await authFetch(`${API_BASE_URL}/inventory/expired`);
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

export async function updateInventoryItem(
  itemId: string,
  patch: {
    canonical_name: string;
    qty: number;
    unit: string;
    estimated_expiry?: string;
    is_manual?: boolean;
  },
): Promise<void> {
  const res = await authFetch(`${API_BASE_URL}/inventory/${itemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      canonical_name: patch.canonical_name,
      qty: patch.qty,
      unit: patch.unit,
      estimated_expiry: patch.estimated_expiry ?? '',
      is_manual: patch.is_manual ?? false,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function expireInventoryItem(itemId: string): Promise<void> {
  const res = await authFetch(`${API_BASE_URL}/inventory/${itemId}/expire`, {
    method: 'PATCH',
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
  dishName?: string,
): Promise<WhatsAppResult> {
  const res = await authFetch(`${API_BASE_URL}/whatsapp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone_number: phoneNumber,
      message,
      dish_name: dishName,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function sendMealSuggestion(
  mealName: string,
  ingredients: Array<{ name: string; quantity: number; unit: string }>,
  cookingTime: number,
  opts?: { instructions?: string },
): Promise<WhatsAppResult> {
  const res = await authFetch(`${API_BASE_URL}/whatsapp/send-meal-suggestion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meal_name: mealName,
      ingredients,
      cooking_time: cookingTime,
      instructions: opts?.instructions?.trim() || undefined,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function sendDailyMenu(
  menu: Array<{ meal_name: string; meal_time?: string }>,
): Promise<WhatsAppResult> {
  const res = await authFetch(`${API_BASE_URL}/whatsapp/send-daily-menu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ menu }),
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

function parseApiErrorMessage(body: string, status: number): string {
  const trimmed = body.trim();
  if (!trimmed) return toUserFacingMessage('');
  try {
    const j = JSON.parse(trimmed) as { error?: string; message?: string };
    return toUserFacingMessage(j.error || j.message || trimmed);
  } catch {
    return toUserFacingMessage(trimmed);
  }
}

export async function parseWhatsAppMessage(text: string): Promise<WhatsAppParseResponse> {
  const trimmed = clampWhatsAppMessageText(text);
  if (!trimmed) {
    throw new Error('Message is empty');
  }
  const url = `${API_BASE_URL}/whatsapp/parse`;
  let res: Response;
  try {
    res = await authFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed }),
    });
  } catch (cause) {
    const rawMessage = cause instanceof Error ? cause.message : String(cause);
    logImportError('parse', { url, rawMessage, cause });
    throw new Error(toUserFacingMessage(rawMessage));
  }
  const body = await res.text();
  if (!res.ok) {
    const friendly = parseApiErrorMessage(body, res.status);
    logImportError('parse', {
      url,
      status: res.status,
      body,
      rawMessage: body.trim() || `HTTP ${res.status}`,
    });
    throw new Error(friendly);
  }
  let data: WhatsAppParseResponse;
  try {
    data = JSON.parse(body) as WhatsAppParseResponse;
  } catch (cause) {
    logImportError('parse', {
      url,
      status: res.status,
      body,
      rawMessage: 'Invalid JSON in parse response',
      cause,
    });
    throw new Error('Invalid response from server');
  }
  const action = normalizeParsedAction(data?.action) ?? unknownWhatsAppAction();
  if (__DEV__) {
    console.log('[KITCHMATE import/parse] ok', {
      intent: action.intent,
      confidence: action.confidence,
      summary: action.summary,
    });
  }
  return { action, raw_text: typeof data?.raw_text === 'string' ? data.raw_text : trimmed };
}

export async function applyWhatsAppAction(action: WhatsAppParsedAction): Promise<WhatsAppApplyResponse> {
  const safe = normalizeParsedAction(action);
  if (!safe) {
    throw new Error('Invalid action');
  }
  if (safe.intent === 'unknown' || safe.confidence < 0.5) {
    throw new Error('This message was not understood well enough to apply.');
  }
  const url = `${API_BASE_URL}/whatsapp/apply`;
  let res: Response;
  try {
    res = await authFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: safe }),
    });
  } catch (cause) {
    const rawMessage = cause instanceof Error ? cause.message : String(cause);
    logImportError('apply', { url, rawMessage, cause });
    throw new Error(toUserFacingMessage(rawMessage));
  }
  const body = await res.text();
  let data: WhatsAppApplyResponse & { error?: string };
  try {
    data = JSON.parse(body) as WhatsAppApplyResponse & { error?: string };
  } catch (cause) {
    logImportError('apply', {
      url,
      status: res.status,
      body,
      rawMessage: 'Invalid JSON in apply response',
      cause,
    });
    throw new Error(`HTTP ${res.status}`);
  }
  if (!res.ok || !data.success) {
    const raw = data.message || data.error || body.trim() || `HTTP ${res.status}`;
    logImportError('apply', { url, status: res.status, body, rawMessage: raw });
    throw new Error(toUserFacingMessage(raw));
  }
  return data;
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

// ─── Shopping List ────────────────────────────────────────────

export async function getShoppingItems(): Promise<UserShoppingItem[]> {
  const res = await authFetch(`${API_BASE_URL}/shopping`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data) ? data : data?.items;
  return Array.isArray(items) ? items : [];
}

export async function addShoppingItem(name: string, qty: number = 1, unit: string = 'pcs'): Promise<any> {
  const res = await authFetch(`${API_BASE_URL}/shopping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, qty, unit }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function addBulkShoppingItems(items: { name: string; qty: number; unit: string }[]): Promise<any> {
  const res = await authFetch(`${API_BASE_URL}/shopping/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function toggleShoppingItem(id: string): Promise<any> {
  const res = await authFetch(`${API_BASE_URL}/shopping/${id}/toggle`, {
    method: 'PATCH',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function deleteShoppingItem(id: string): Promise<void> {
  const res = await authFetch(`${API_BASE_URL}/shopping/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function clearBoughtItems(): Promise<any> {
  const res = await authFetch(`${API_BASE_URL}/shopping/clear-bought`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Procurement (legacy) ────────────────────────────────────

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

export async function getSmartMeals(
  category: string,
  userPrompt?: string,
  excludeDish?: string,
): Promise<any> {
  const qp = new URLSearchParams();
  qp.set('category', category);
  if (userPrompt) qp.set('prompt', userPrompt);
  if (excludeDish?.trim()) qp.set('exclude', excludeDish.trim());
  const res = await authFetch(`${API_BASE_URL}/meals/smart?${qp.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getCookedHistory(): Promise<CookedHistoryResponse> {
  const res = await authFetch(`${API_BASE_URL}/meals/cooked-history`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function logCookedDish(payload: {
  dish_name: string;
  meal_slot?: string;
  portions?: number;
  source?: string;
  notes?: string;
  cooked_on?: string;
}): Promise<CookedLogEntry> {
  const res = await authFetch(`${API_BASE_URL}/meals/cooked`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
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
  cook_name?: string;
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

// ─── Onboarding ───────────────────────────────────────────────

export async function getOnboardingStatus(): Promise<{ onboarding_done: boolean }> {
  const res = await authFetch(`${API_BASE_URL}/onboarding/status`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function completeOnboarding(data: {
  household_size: number;
  dietary_tags: string[];
  fav_cuisines: string[];
  spice_level: string;
  cooking_skill: string;
  allergies: string[];
  dislikes: string[];
  items: { name: string; qty: number; unit: string }[];
}): Promise<any> {
  const res = await authFetch(`${API_BASE_URL}/onboarding/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Profile & Memory ─────────────────────────────────────────

export async function fetchProfile(): Promise<UserProfile> {
  const res = await authFetch(`${API_BASE_URL}/profile`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function updateProfile(profile: UpdateProfileRequest): Promise<void> {
  const res = await authFetch(`${API_BASE_URL}/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function addMemory(category: string, content: string): Promise<UserMemory> {
  const res = await authFetch(`${API_BASE_URL}/profile/memory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, content }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function deleteMemory(memoryId: string): Promise<void> {
  const res = await authFetch(`${API_BASE_URL}/profile/memory/${memoryId}`, {
    method: 'DELETE',
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
