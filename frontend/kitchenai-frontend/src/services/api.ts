import { Platform } from 'react-native';
import { BRAND_DISPLAY_NAME } from '../constants/brand';
import { BILL_SCAN_ALERT_MESSAGE } from '../utils/billScanMessage';
import {
  appliableActions,
  clampWhatsAppMessageText,
  logImportError,
  normalizeParsedAction,
  normalizeParsedActions,
  unknownWhatsAppAction,
} from '../utils/whatsappAction';
import { sanitizeUserFacingMessage } from '../utils/userFacingError';
import {
  CatalogIngredient,
  InventoryItem,
  InventoryFoodGroup,
  InventoryBucket,
  InventoryBucketsResponse,
  InventoryListPage,
  ExpiringItem,
  RescueMealResponse,
  LowStockItem,
  ShoppingListResponse,
  UserShoppingItem,
  OrderSuggestResponse,
  PreMarketPingResponse,
  ProcurementSummary,
  ScanResult,
  WhatsAppResult,
  WhatsAppParsedAction,
  WhatsAppParseResponse,
  BuddyChatHistoryTurn,
  WhatsAppApplyResponse,
  CookInfo,
  CookProfile,
  UserProfile,
  UpdateProfileRequest,
  UserMemory,
  CookedLogEntry,
  DietAnalysisSettings,
  DietDayReportResponse,
  CookedHistoryResponse,
  Entitlements,
  BillingConfig,
  PlanProduct,
  CheckoutOrderResponse,
  VerifyCheckoutRequest,
  KitchenInfo,
  CommercePartnersResponse,
  OrderLinkResponse,
  CatalogDishSearchItem,
  DishLookupResponse,
  DishRecipe,
  DishRecipeSummary,
  DishRecipeListPage,
  ShoppingListPage,
} from '../types';
import type { MealOfDayMeal } from '../components/MealOfDayCard';
import { normalizeInventoryBucketsResponse } from '../utils/inventoryBuckets';
import { normalizeUnit } from '../utils/units';
import { getAppVersionHeaders } from '../utils/appUpdate';

function resolveApiBaseUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_BASE_URL!;
  if (Platform.OS === 'web') {
    // 10.0.2.2 is the Android emulator alias for the host — browsers must use localhost.
    return url.replace(/10\.0\.2\.2/g, 'localhost');
  }
  if (
    Platform.OS === 'android' &&
    (url.includes('localhost') || url.includes('127.0.0.1'))
  ) {
    return url.replace(/localhost|127\.0\.0\.1/g, '10.0.2.2');
  }
  return url;
}

const API_BASE_URL = resolveApiBaseUrl();

let _authToken: string | null = null;
let _onUnauthorized: (() => void) | null = null;
let _onUpdateRequired: ((message: string) => void) | null = null;
let _unauthorizedFired = false;
let _updateRequiredFired = false;

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

/** Fires once when the API returns 426 update_required (server-side force update). */
export function setOnUpdateRequired(handler: ((message: string) => void) | null) {
  _onUpdateRequired = handler;
}

function notifyUpdateRequiredIfNeeded(res: Response) {
  if (res.status !== 426 || !_onUpdateRequired || _updateRequiredFired) {
    return;
  }
  _updateRequiredFired = true;
  let message = `A new version of ${BRAND_DISPLAY_NAME} is required. Please update from the store to continue.`;
  res.clone().json().then(body => {
    if (typeof body.message === 'string' && body.message.trim()) {
      message = body.message.trim();
    }
    try {
      _onUpdateRequired?.(message);
    } catch (e) {
      console.warn('onUpdateRequired handler failed:', e);
    }
  }).catch(() => {
    try {
      _onUpdateRequired?.(message);
    } catch (e) {
      console.warn('onUpdateRequired handler failed:', e);
    }
  });
}

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const tokenAtRequest = _authToken;
  const headers: Record<string, string> = {
    ...getAppVersionHeaders(),
    ...(options.headers as Record<string, string>),
  };
  if (tokenAtRequest) {
    headers['Authorization'] = `Bearer ${tokenAtRequest}`;
  }
  const res = await fetch(url, { ...options, headers });
  notifyUpdateRequiredIfNeeded(res);
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

export class UpgradeRequiredError extends Error {
  feature: string;

  constructor(message: string, feature: string) {
    super(message);
    this.name = 'UpgradeRequiredError';
    this.feature = feature;
  }
}

async function parseApiError(res: Response, fallback: string): Promise<never> {
  try {
    const body = await res.json();
    if (body?.error === 'upgrade_required' && body?.message) {
      throw new UpgradeRequiredError(
        sanitizeUserFacingMessage(body.message, fallback),
        body.feature || 'unknown',
      );
    }
  } catch (e) {
    if (e instanceof UpgradeRequiredError) {
      throw e;
    }
  }
  throw new Error(fallback);
}

// ─── Entitlements (freemium) ──────────────────────────────────

/** Maps API payload to current shape (plan_tier + is_pro only). */
function normalizeEntitlements(raw: Record<string, unknown>): Entitlements {
  const legacyPlan = typeof raw.plan === 'string' ? raw.plan : '';
  const tier =
    (typeof raw.plan_tier === 'string' && raw.plan_tier) ||
    (legacyPlan === 'pro' || legacyPlan === 'elite' ? legacyPlan : 'free');
  const isPro = Boolean(
    raw.is_pro ??
      ((tier === 'pro' || tier === 'elite') || raw.is_premium === true),
  );
  const proMeals =
    (raw.pro_meal_categories as string[] | undefined) ??
    (raw.premium_meal_categories as string[] | undefined) ??
    [];
  return {
    plan_tier: tier,
    plan_interval: raw.plan_interval as string | undefined,
    plan_expires_at: raw.plan_expires_at as string | undefined,
    is_pro: isPro,
    is_elite: Boolean(raw.is_elite ?? tier === 'elite'),
    has_diet_analysis: Boolean(raw.has_diet_analysis),
    bill_scans_used: Number(raw.bill_scans_used ?? 0),
    bill_scan_limit: Number(raw.bill_scan_limit ?? (isPro ? -1 : 2)),
    bill_scans_remaining: Number(raw.bill_scans_remaining ?? (isPro ? -1 : 2)),
    free_meal_categories: (raw.free_meal_categories as string[]) ?? ['daily'],
    pro_meal_categories: proMeals,
    available_plans: raw.available_plans as Entitlements['available_plans'],
    upgrade_options: raw.upgrade_options as Entitlements['upgrade_options'],
  };
}

export async function getEntitlements(): Promise<Entitlements> {
  const res = await authFetch(`${API_BASE_URL}/entitlements`);
  if (!res.ok) {
    throw new Error('Could not load plan status.');
  }
  const raw = (await res.json()) as Record<string, unknown>;
  return normalizeEntitlements(raw);
}

// ─── Billing (Razorpay subscriptions) ───────────────────────

export async function getBillingConfig(): Promise<BillingConfig> {
  const res = await authFetch(`${API_BASE_URL}/billing/config`);
  if (!res.ok) await parseApiError(res, 'Failed to load billing config');
  return res.json();
}

export async function createSubscribeOrder(
  planTier: string,
  planInterval: string,
): Promise<CheckoutOrderResponse> {
  const res = await authFetch(`${API_BASE_URL}/billing/subscribe/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan_tier: planTier, plan_interval: planInterval }),
  });
  if (!res.ok) await parseApiError(res, 'Failed to start checkout');
  return res.json();
}

export async function verifySubscribePayment(body: VerifyCheckoutRequest): Promise<void> {
  const res = await authFetch(`${API_BASE_URL}/billing/subscribe/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await parseApiError(res, 'Payment verification failed');
}

export async function syncSubscribeOrder(orderId: string): Promise<{ is_pro: boolean }> {
  const res = await authFetch(`${API_BASE_URL}/billing/subscribe/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: orderId }),
  });
  if (res.status === 402) {
    return { is_pro: false };
  }
  if (!res.ok) await parseApiError(res, 'Could not confirm payment');
  const data = await res.json();
  return {
    is_pro: Boolean(data.is_pro) || data.status === 'active',
  };
}

// ─── Commerce (server flag + partners; links from POST /commerce/order-link only) ───

export async function getCommercePartners(): Promise<CommercePartnersResponse> {
  try {
    const res = await authFetch(`${API_BASE_URL}/commerce/partners`);
    if (!res.ok) return { enabled: false, partners: [] };
    return res.json();
  } catch {
    return { enabled: false, partners: [] };
  }
}

export async function createOrderLink(
  partner: string,
  items: { name: string; qty: number; unit: string }[],
  source: string = 'shopping_list',
): Promise<OrderLinkResponse> {
  const res = await authFetch(`${API_BASE_URL}/commerce/order-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partner, items, source }),
  });
  if (!res.ok) await parseApiError(res, 'Could not open ordering');
  return res.json();
}

// ─── Inventory ───────────────────────────────────────────────

export async function getKitchen(): Promise<KitchenInfo> {
  const res = await authFetch(`${API_BASE_URL}/kitchen`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function createKitchen(name?: string): Promise<KitchenInfo> {
  const res = await authFetch(`${API_BASE_URL}/kitchen/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: (name || '').trim() || undefined }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function joinKitchen(inviteCode: string): Promise<KitchenInfo> {
  const res = await authFetch(`${API_BASE_URL}/kitchen/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite_code: inviteCode.trim().toUpperCase() }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function leaveKitchen(): Promise<void> {
  const res = await authFetch(`${API_BASE_URL}/kitchen/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function fetchInventoryBuckets(
  include: InventoryBucket[],
): Promise<InventoryBucketsResponse> {
  const params = new URLSearchParams({ include: include.join(',') });
  const res = await authFetch(`${API_BASE_URL}/inventory?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  return normalizeInventoryBucketsResponse(raw, include);
}

export const INVENTORY_PAGE_SIZE = 30;

async function parseInventoryListResponse(res: Response): Promise<InventoryListPage> {
  const data: unknown = await res.json();
  if (data && typeof data === 'object' && Array.isArray((data as InventoryListPage).items)) {
    const page = data as InventoryListPage;
    return {
      items: page.items ?? [],
      total: page.total ?? 0,
      offset: page.offset ?? 0,
      limit: page.limit ?? INVENTORY_PAGE_SIZE,
      has_more: Boolean(page.has_more),
      counts: page.counts ?? { active: 0, expiring: 0, expired: 0, total: 0 },
      group_counts: page.group_counts ?? {},
    };
  }
  const buckets = normalizeInventoryBucketsResponse(data, ['active', 'expiring', 'expired']);
  const items = [...(buckets.active ?? []), ...(buckets.expiring ?? []), ...(buckets.expired ?? [])];
  return {
    items,
    total: items.length,
    offset: 0,
    limit: items.length,
    has_more: false,
    counts: buckets.counts,
    group_counts: {},
  };
}

/** Paginated pantry browse (search + filters on server). */
export async function fetchInventoryPage(opts: {
  include: InventoryBucket[];
  q?: string;
  foodGroup?: string | null;
  expiringOnly?: boolean;
  offset?: number;
  limit?: number;
}): Promise<InventoryListPage> {
  const params = new URLSearchParams({ include: opts.include.join(',') });
  if (opts.q?.trim()) params.set('q', opts.q.trim());
  if (opts.foodGroup) params.set('food_group', opts.foodGroup);
  if (opts.expiringOnly) params.set('expiring_only', 'true');
  const limit = opts.limit ?? INVENTORY_PAGE_SIZE;
  params.set('limit', String(limit));
  params.set('offset', String(opts.offset ?? 0));
  const res = await authFetch(`${API_BASE_URL}/inventory?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseInventoryListResponse(res);
}

export async function fetchInventoryFoodGroups(): Promise<InventoryFoodGroup[]> {
  const res = await authFetch(`${API_BASE_URL}/inventory/food-groups`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchIngredientsCatalog(query?: string): Promise<CatalogIngredient[]> {
  const params = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  const res = await authFetch(`${API_BASE_URL}/ingredients${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchDishesCatalog(opts?: {
  q?: string;
  mealSlot?: string;
  limit?: number;
}): Promise<CatalogDishSearchItem[]> {
  const params = new URLSearchParams();
  if (opts?.q?.trim()) params.set('q', opts.q.trim());
  if (opts?.mealSlot?.trim()) params.set('meal_slot', opts.mealSlot.trim());
  if (opts?.limit != null && opts.limit > 0) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const res = await authFetch(`${API_BASE_URL}/dishes${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function lookupDish(opts: {
  dishId?: string;
  name?: string;
}): Promise<DishLookupResponse> {
  const params = new URLSearchParams();
  if (opts.dishId?.trim()) params.set('dish_id', opts.dishId.trim());
  if (opts.name?.trim()) params.set('name', opts.name.trim());
  const res = await authFetch(`${API_BASE_URL}/dishes/lookup?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const DISH_RECIPE_PAGE_SIZE = 30;

async function parseDishRecipeListResponse(res: Response): Promise<DishRecipeListPage> {
  const data: unknown = await res.json();
  if (Array.isArray(data)) {
    const items = data as DishRecipeSummary[];
    return {
      items,
      total: items.length,
      offset: 0,
      limit: items.length,
      has_more: false,
    };
  }
  const page = data as DishRecipeListPage;
  return {
    items: page.items ?? [],
    total: page.total ?? 0,
    offset: page.offset ?? 0,
    limit: page.limit ?? DISH_RECIPE_PAGE_SIZE,
    has_more: Boolean(page.has_more),
  };
}

/** Paginated recipe browse (pass offset for pages; legacy array responses are normalized). */
export async function fetchDishRecipePage(opts?: {
  q?: string;
  limit?: number;
  offset?: number;
  page?: number;
}): Promise<DishRecipeListPage> {
  const params = new URLSearchParams();
  if (opts?.q?.trim()) params.set('q', opts.q.trim());
  const limit = opts?.limit ?? DISH_RECIPE_PAGE_SIZE;
  params.set('limit', String(limit));
  if (opts?.offset != null && opts.offset >= 0) {
    params.set('offset', String(opts.offset));
  } else if (opts?.page != null && opts.page > 0) {
    params.set('page', String(opts.page));
  } else {
    params.set('offset', '0');
  }
  const res = await authFetch(`${API_BASE_URL}/dishes/recipes?${params.toString()}`);
  if (!res.ok) throw new Error('Could not load recipes.');
  return parseDishRecipeListResponse(res);
}

/** Legacy helper: full list via non-paginated API (backward compatible). */
export async function fetchDishRecipes(opts?: {
  q?: string;
  limit?: number;
}): Promise<DishRecipeSummary[]> {
  const params = new URLSearchParams();
  if (opts?.q?.trim()) params.set('q', opts.q.trim());
  if (opts?.limit != null && opts.limit > 0) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const res = await authFetch(`${API_BASE_URL}/dishes/recipes${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Could not load recipes.');
  return (await parseDishRecipeListResponse(res)).items;
}

export async function fetchDishRecipe(dishId: string): Promise<DishRecipe> {
  const id = dishId.trim();
  if (!id) throw new Error('dish_id is required');
  const res = await authFetch(`${API_BASE_URL}/dishes/${encodeURIComponent(id)}/recipe`);
  if (!res.ok) throw new Error(res.status === 404 ? 'Recipe not found' : 'Could not load recipe.');
  return res.json();
}

export async function addInventoryItem(item: {
  canonical_name: string;
  qty: number;
  unit: string;
  estimated_expiry?: string;
  food_group?: string;
}): Promise<InventoryItem> {
  const res = await authFetch(`${API_BASE_URL}/inventory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...item, unit: normalizeUnit(item.unit) }),
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
    canonical_name?: string;
    qty?: number;
    unit?: string;
    estimated_expiry?: string;
    is_manual?: boolean;
  },
): Promise<void> {
  const body: Record<string, string | number | boolean> = {};
  if (patch.canonical_name !== undefined) body.canonical_name = patch.canonical_name;
  if (patch.qty !== undefined) body.qty = patch.qty;
  if (patch.unit !== undefined) body.unit = normalizeUnit(patch.unit);
  if (patch.estimated_expiry !== undefined) body.estimated_expiry = patch.estimated_expiry;
  if (patch.is_manual !== undefined) body.is_manual = patch.is_manual;

  const res = await authFetch(`${API_BASE_URL}/inventory/${itemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

export async function scanBillUpload(fileUri: string, mimeHint?: string): Promise<ScanResult> {
  const [{ prepareBillImageForScan }, { fileUriToBase64 }] = await Promise.all([
    import('../utils/billImagePrepare'),
    import('../utils/imageToBase64'),
  ]);
  const prepared = await prepareBillImageForScan(fileUri, mimeHint);
  const { base64: base64Data, mimeType } = await fileUriToBase64(prepared.uri, prepared.mimeType);

  const res = await authFetch(`${API_BASE_URL}/bill/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_data: base64Data,
      image_type: mimeType,
    }),
  });

  let body: ScanResult & { error?: string; feature?: string; message?: string };
  try {
    body = await res.json();
  } catch {
    if (!res.ok) throw new Error(BILL_SCAN_ALERT_MESSAGE);
    throw new Error(BILL_SCAN_ALERT_MESSAGE);
  }

  if (
    body?.error === 'upgrade_required' &&
    typeof body.message === 'string' &&
    body.message
  ) {
    throw new UpgradeRequiredError(
      sanitizeUserFacingMessage(body.message, BILL_SCAN_ALERT_MESSAGE),
      body.feature || 'bill_scan',
    );
  }

  if (!res.ok || body.success === false) {
    throw new Error(BILL_SCAN_ALERT_MESSAGE);
  }

  return body;
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

function parseApiErrorMessage(body: string, _status: number): string {
  const trimmed = body.trim();
  if (!trimmed) return sanitizeUserFacingMessage('');
  try {
    const j = JSON.parse(trimmed) as { error?: string; message?: string };
    return sanitizeUserFacingMessage(j.error || j.message || trimmed);
  } catch {
    return sanitizeUserFacingMessage(trimmed);
  }
}

export async function parseWhatsAppMessage(
  text: string,
  history?: BuddyChatHistoryTurn[],
): Promise<WhatsAppParseResponse> {
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
      body: JSON.stringify({
        text: trimmed,
        history: history?.length ? history : undefined,
      }),
    });
  } catch (cause) {
    const rawMessage = cause instanceof Error ? cause.message : String(cause);
    logImportError('parse', { url, rawMessage, cause });
    throw new Error(sanitizeUserFacingMessage(rawMessage));
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
  const actions = normalizeParsedActions(
    data?.actions?.length ? data.actions : data?.action,
  );
  const action = actions[0] ?? unknownWhatsAppAction();
  if (__DEV__) {
    console.log('[RASOIBUDDY import/parse] ok', {
      count: actions.length,
      intents: actions.map((a) => a.intent),
    });
  }
  return {
    action,
    actions: actions.length ? actions : [action],
    reply: typeof data?.reply === 'string' ? data.reply : undefined,
    raw_text: typeof data?.raw_text === 'string' ? data.raw_text : trimmed,
  };
}

export async function applyWhatsAppActions(
  actions: WhatsAppParsedAction[],
): Promise<WhatsAppApplyResponse> {
  const safe = appliableActions(
    actions
      .map((a) => normalizeParsedAction(a))
      .filter((a): a is WhatsAppParsedAction => a != null),
  );
  if (safe.length === 0) {
    throw new Error('This message was not understood well enough to apply.');
  }
  const url = `${API_BASE_URL}/whatsapp/apply`;
  let res: Response;
  try {
    res = await authFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions: safe }),
    });
  } catch (cause) {
    const rawMessage = cause instanceof Error ? cause.message : String(cause);
    logImportError('apply', { url, rawMessage, cause });
    throw new Error(sanitizeUserFacingMessage(rawMessage));
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
    throw new Error(sanitizeUserFacingMessage(raw));
  }
  return data;
}

export async function applyWhatsAppAction(action: WhatsAppParsedAction): Promise<WhatsAppApplyResponse> {
  return applyWhatsAppActions([action]);
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

export async function getOrderSuggestions(exclude: string[] = []): Promise<OrderSuggestResponse> {
  const params = new URLSearchParams();
  if (exclude.length > 0) {
    params.set('exclude', exclude.join(','));
  }
  const qs = params.toString();
  const url = `${API_BASE_URL}/shopping/order-suggestions${qs ? `?${qs}` : ''}`;
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getShoppingItems(): Promise<UserShoppingItem[]> {
  const res = await authFetch(`${API_BASE_URL}/shopping`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data) ? data : data?.items;
  return Array.isArray(items) ? items : [];
}

export const SHOPPING_PAGE_SIZE = 30;

async function parseShoppingListResponse(res: Response): Promise<ShoppingListPage> {
  const data: unknown = await res.json();
  if (data && typeof data === 'object' && Array.isArray((data as ShoppingListPage).items) && 'has_more' in (data as ShoppingListPage)) {
    const page = data as ShoppingListPage;
    return {
      items: page.items ?? [],
      total: page.total ?? 0,
      offset: page.offset ?? 0,
      limit: page.limit ?? SHOPPING_PAGE_SIZE,
      has_more: Boolean(page.has_more),
      count: page.count ?? page.total ?? 0,
    };
  }
  const items = Array.isArray(data) ? data : (data as { items?: UserShoppingItem[] })?.items ?? [];
  const list = Array.isArray(items) ? items : [];
  return {
    items: list,
    total: list.length,
    offset: 0,
    limit: list.length,
    has_more: false,
    count: list.length,
  };
}

/** Paginated shopping list browse (search on server). */
export async function fetchShoppingPage(opts?: {
  q?: string;
  offset?: number;
  limit?: number;
}): Promise<ShoppingListPage> {
  const params = new URLSearchParams();
  if (opts?.q?.trim()) params.set('q', opts.q.trim());
  const limit = opts?.limit ?? SHOPPING_PAGE_SIZE;
  params.set('limit', String(limit));
  params.set('offset', String(opts?.offset ?? 0));
  const res = await authFetch(`${API_BASE_URL}/shopping?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseShoppingListResponse(res);
}

export async function addShoppingItem(name: string, qty: number = 0, unit: string = 'pcs'): Promise<any> {
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

export async function updateShoppingItem(
  id: string,
  patch: { name: string; qty: number; unit: string },
): Promise<UserShoppingItem> {
  const res = await authFetch(`${API_BASE_URL}/shopping/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
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

export async function purchaseShoppingItems(
  ids: string[],
): Promise<{ purchased: number; inventory: InventoryItem[] }> {
  const res = await authFetch(`${API_BASE_URL}/shopping/purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function bulkDeleteShoppingItems(ids: string[]): Promise<{ deleted: number }> {
  const res = await authFetch(`${API_BASE_URL}/shopping/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
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
  mealType: string = 'lunch_dinner',
): Promise<any> {
  const qp = new URLSearchParams();
  qp.set('category', category);
  qp.set('meal_type', mealType || 'lunch_dinner');
  if (userPrompt) qp.set('prompt', userPrompt);
  if (excludeDish?.trim()) qp.set('exclude', excludeDish.trim());
  const res = await authFetch(`${API_BASE_URL}/meals/smart?${qp.toString()}`);
  if (!res.ok) await parseApiError(res, `HTTP ${res.status}`);
  return res.json();
}

/** Today's meal-of-the-day from Redis (refreshed at midnight IST). */
export type MealOfDayCategory = {
  id: string;
  title: string;
  description: string;
  meals: MealOfDayMeal[];
};

export async function getMealOfDay(): Promise<{
  date: string;
  categories: MealOfDayCategory[];
  generated_at: string;
  source: string;
} | null> {
  const res = await authFetch(`${API_BASE_URL}/meals/meal-of-day`);
  if (res.status === 404) return null;
  if (res.status === 503) {
    throw new Error('Meal of the Day is temporarily unavailable. Please try again later.');
  }
  if (!res.ok) await parseApiError(res, 'Failed to load meal of the day');
  return res.json();
}

export type WeekPlanDayResponse = {
  date: string;
  categories: MealOfDayCategory[];
};

export async function getWeekPlan(): Promise<{
  kitchen_id: string;
  anchor_date: string;
  days: WeekPlanDayResponse[];
  generated_at: string;
  source: string;
  cache_available: boolean;
  cache_stale?: boolean;
} | null> {
  const res = await authFetch(`${API_BASE_URL}/meals/week-plan`);
  if (res.status === 404) return null;
  if (res.status === 503) {
    throw new Error('Meal planning is temporarily unavailable. Please try again later.');
  }
  if (!res.ok) await parseApiError(res, 'Failed to load meal plan');
  return res.json();
}

export async function refreshWeekPlanDay(
  date: string,
  mealSlot?: string,
  options?: {
    category?: string;
    userPrompt?: string;
    mealType?: string;
  },
): Promise<WeekPlanDayResponse> {
  const res = await authFetch(`${API_BASE_URL}/meals/week-plan/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date,
      meal_slot: mealSlot || undefined,
      category: options?.category || undefined,
      user_prompt: options?.userPrompt?.trim() || undefined,
      meal_type: options?.mealType || undefined,
    }),
  });
  if (!res.ok) await parseApiError(res, 'Failed to refresh meal plan');
  return res.json();
}

export async function setWeekPlanDish(
  date: string,
  mealSlot: string,
  dishId: string,
): Promise<WeekPlanDayResponse> {
  const res = await authFetch(`${API_BASE_URL}/meals/week-plan/set-dish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, meal_slot: mealSlot, dish_id: dishId }),
  });
  if (!res.ok) await parseApiError(res, 'Failed to update meal');
  return res.json();
}

export async function getDietAnalysisSettings(): Promise<DietAnalysisSettings> {
  const res = await authFetch(`${API_BASE_URL}/meals/diet-analysis`);
  if (!res.ok) await parseApiError(res, 'Failed to load diet analysis settings');
  return res.json();
}

export async function updateDietAnalysisSettings(emailEnabled: boolean): Promise<DietAnalysisSettings> {
  const res = await authFetch(`${API_BASE_URL}/meals/diet-analysis`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email_enabled: emailEnabled }),
  });
  if (!res.ok) await parseApiError(res, 'Failed to update diet analysis');
  return res.json();
}

export async function getDietDayReport(dateISO?: string): Promise<DietDayReportResponse> {
  const qs = dateISO?.trim() ? `?date=${encodeURIComponent(dateISO.trim())}` : '';
  const res = await authFetch(`${API_BASE_URL}/meals/diet-analysis/report${qs}`);
  if (!res.ok) await parseApiError(res, 'Failed to load nutrient analysis');
  return res.json();
}

export async function getCookedHistory(): Promise<CookedHistoryResponse> {
  const res = await authFetch(`${API_BASE_URL}/meals/cooked-history`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getCookMessages(): Promise<{ messages: CookedLogEntry[]; limit: number }> {
  const res = await authFetch(`${API_BASE_URL}/cook/messages`);
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

// ─── Global dish stars (one star per user per dish) ───────────

/** Toggle global star for a dish (+1 / -1); returns updated total star count. */
export async function starDish(
  dishName: string,
): Promise<{ star_count: number; user_starred: boolean }> {
  const res = await authFetch(`${API_BASE_URL}/dishes/star`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dish_name: dishName.trim() }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── App config (public) ──────────────────────────────────────

export interface AppConfigResponse {
  min_android_version: string;
  min_ios_version: string;
  min_android_build: number;
  min_ios_build: number;
  update_message: string;
  play_store_url: string;
  app_store_url: string;
  dish_images_cdn_url?: string;
}

export async function fetchAppConfig(): Promise<AppConfigResponse> {
  const res = await fetch(`${API_BASE_URL}/app/config`, {
    headers: getAppVersionHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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
    headers: {
      ...getAppVersionHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ credential }),
  });
  notifyUpdateRequiredIfNeeded(res);
  if (!res.ok) {
    throw new Error('Could not sign in. Please try again.');
  }
  return res.json();
}

export async function logoutApi(token: string) {
  await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ─── Ops panel (hidden route; 404 unless allowlisted) ─────────

export type PanelPairAlias = {
  label: string;
  target_kind: 'dish' | 'ingredient';
  target_id: string;
};

/** Returns true only when the signed-in user is on the server allowlist. */
export async function checkPanelAccess(): Promise<boolean> {
  const res = await authFetch(`${API_BASE_URL}/panel/access`);
  return res.ok;
}

export async function listPanelPairAliases(): Promise<PanelPairAlias[]> {
  const res = await authFetch(`${API_BASE_URL}/panel/catalog/pair-aliases`);
  if (!res.ok) {
    throw new Error(res.status === 404 ? 'Not found' : `HTTP ${res.status}`);
  }
  const data = await res.json();
  return Array.isArray(data.aliases) ? data.aliases : [];
}

export async function registerPanelPairAlias(body: {
  label: string;
  target_kind: 'dish' | 'ingredient';
  target_id: string;
}): Promise<void> {
  const res = await authFetch(`${API_BASE_URL}/panel/catalog/pair-aliases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error('Could not save changes.');
  }
}

export async function deletePanelPairAlias(label: string): Promise<void> {
  const res = await authFetch(
    `${API_BASE_URL}/panel/catalog/pair-aliases?label=${encodeURIComponent(label)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    throw new Error('Could not save changes.');
  }
}

export async function upsertPanelDish(body: {
  id?: string;
  name: string;
  ingredients: string[];
  pairs_with?: string[];
  effort?: string;
  diet?: string;
}): Promise<string> {
  const res = await authFetch(`${API_BASE_URL}/panel/catalog/dishes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error('Could not save changes.');
  }
  const data = await res.json();
  return typeof data.id === 'string' ? data.id : body.id ?? '';
}

