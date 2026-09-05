export interface InventoryFoodGroup {
  id: string;
  label: string;
  sort: number;
}

export interface CatalogIngredient {
  ingredient_id: string;
  name: string;
  default_unit: string;
  units?: string[];
  food_group?: string;
  synonyms?: string[];
}

/** Resolved catalog row attached to pantry/shopping API items. */
export type ItemCatalog = Omit<CatalogIngredient, 'synonyms'>;

export interface CatalogDishSearchItem {
  id: string;
  name: string;
  meal_types: string[];
  cuisine: string;
  cook_time_mins: number;
}

export interface DishLookupResponse {
  id: string;
  name: string;
  meal_types: string[];
  cuisine: string;
  cook_time_mins: number;
  image_urls?: Partial<Record<'hero' | 'card' | 'thumb', string>>;
}

export interface DishRecipe {
  dish_id: string;
  source: string;
  source_url?: string;
  title: string;
  description?: string;
  prep_time_minutes?: number;
  cook_time_minutes?: number;
  total_time_minutes?: number;
  yield?: string;
  ingredients: string[];
  instructions: string[];
  images?: string[];
  match_method?: string;
}

export interface DishRecipeSummary {
  dish_id: string;
  dish_name: string;
  title: string;
  description?: string;
  prep_time_minutes?: number;
  cook_time_minutes?: number;
  total_time_minutes?: number;
  yield?: string;
  ingredient_count: number;
  step_count: number;
}

export interface DishRecipeListPage {
  items: DishRecipeSummary[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

export interface InventoryItem {
  item_id: string;
  ingredient_id?: string;
  canonical_name: string;
  qty: number;
  unit: string;
  food_group?: string;
  display_qty?: string;
  catalog?: ItemCatalog;
  estimated_expiry?: string;
  is_manual: boolean;
  updated_at?: string;
}

export interface ExpiringItem {
  item_id: string;
  ingredient_id?: string;
  canonical_name: string;
  qty: number;
  unit: string;
  food_group?: string;
  display_qty?: string;
  catalog?: ItemCatalog;
  estimated_expiry: string;
  days_until_expiry: number;
  updated_at?: string;
}

export type InventoryBucket = 'active' | 'expiring' | 'expired';

export interface InventoryBucketCounts {
  active: number;
  expiring: number;
  expired: number;
  total: number;
}

export interface InventoryBucketsResponse {
  active?: InventoryItem[];
  expiring?: ExpiringItem[];
  expired?: ExpiringItem[];
  counts: InventoryBucketCounts;
}

export type PantryPageItem = InventoryItem | ExpiringItem;

export interface InventoryListPage {
  items: PantryPageItem[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
  counts: InventoryBucketCounts;
  group_counts?: Record<string, number>;
}

export interface ShoppingListPage {
  items: UserShoppingItem[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
  count?: number;
}

export interface RescueMealSuggestion {
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

export interface RescueMealResponse {
  suggestions: RescueMealSuggestion[];
  expiring_items: ExpiringItem[];
  cook_skills: string[];
  user_preferences?: {
    preferred_cuisines: string[];
    dietary_restrictions: string[];
  };
}

export interface LowStockItem {
  name: string;
  current_qty: number;
  unit: string;
  min_qty: number;
  recommended_qty: number;
  priority: number;
}

export interface ShoppingListItem {
  item_id: string;
  name: string;
  quantity: number;
  unit: string;
  reason: string;
  priority: number;
}

/** User-maintained shopping list (shopping_items table). */
export interface UserShoppingItem {
  id: string;
  name: string;
  ingredient_id?: string;
  qty: number;
  unit: string;
  display_qty?: string;
  catalog?: ItemCatalog;
  bought: boolean;
  created_at: string;
  bought_at?: string;
}

export interface OrderSuggestItem {
  name: string;
  qty: number;
  unit: string;
  reason?: string;
}

export interface OrderSuggestResponse {
  items: OrderSuggestItem[];
  summary: string;
  source: 'ai' | 'fallback' | string;
  generated_at: string;
}

// Commerce (Phase 0): server-controlled grocery ordering — display metadata only (no store URLs).
export interface CommercePartner {
  id: string;
  name: string;
  logo_url?: string;
  eta?: string;
}

export interface CommercePartnersResponse {
  enabled: boolean;
  partners: CommercePartner[];
}

export interface OrderLinkResponse {
  partner: string;
  url: string;
  tracking_id: string;
  copy_text: string;
}

export interface ShoppingListResponse {
  items: ShoppingListItem[];
  total_items: number;
  generated_at: string;
  low_stock_count: number;
  expiring_count: number;
}

export interface PreMarketPingRequest {
  language: string;
  test_mode: boolean;
  include_all: boolean;
}

export interface PreMarketPingResponse {
  sent: boolean;
  message: string;
  items_included: string[];
  error?: string;
}

export interface ProcurementSummary {
  low_stock_count: number;
  expiring_count: number;
  recent_lists: any[];
  generated_at: string;
  recommendation: string;
}

export interface AuthUser {
  user_id: string;
  google_id: string;
  email: string;
  name: string;
  picture_url: string;
}

export interface AuthSession {
  token: string;
  expires_at: string;
  user: AuthUser;
  provider: string;
}

export interface ScanResult {
  success?: boolean;
  message?: string;
  skipped?: string[];
  items?: Array<{
    name: string;
    quantity: number;
    unit: string;
    shelf_life_days?: number;
    food_group?: string;
    ingredient_id?: string;
    price_per_unit?: number;
    total_price?: number;
  }>;
  added_to_inventory?: Array<{
    item_id: string;
    name: string;
    quantity: number;
    unit: string;
    action: string;
    shelf_life_days?: number;
    estimated_expiry?: string;
  }>;
  errors?: string[];
}

export interface WhatsAppResult {
  success?: boolean;
  message?: string;
  body?: string;
  whatsapp_url?: string;
  message_id?: string;
  error?: string;
  status?: string;
  translated?: boolean;
}

export type WhatsAppParseIntent =
  | 'add_to_shopping_list'
  | 'mark_out_of_stock'
  | 'add_inventory'
  | 'note_dislike'
  | 'report_cooked_dish'
  | 'unknown';

export interface CookedLogEntry {
  id: string;
  dish_name: string;
  dish_id?: string;
  cooked_on: string;
  meal_slot?: string;
  portions: number;
  source: string;
  notes?: string;
  created_at: string;
}

export interface DietAnalysisSettings {
  eligible: boolean;
  email_enabled: boolean;
  email?: string;
  smtp_configured: boolean;
  delivery_hour: number;
  delivery_timezone: string;
  delivery_summary: string;
}

export interface DietMacroTotals {
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  sodium_mg: number;
}

export interface DietMacroSplit {
  protein: number;
  carbs: number;
  fat: number;
}

export interface DietMealBreakdown {
  name: string;
  slot: string;
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface DietMicronutrient {
  name: string;
  amount: string;
  status: string;
  note: string;
}

export interface DietDayReport {
  date: string;
  summary: string;
  balance_score: number;
  totals: DietMacroTotals;
  macro_split_pct: DietMacroSplit;
  meals: DietMealBreakdown[];
  micronutrients: DietMicronutrient[];
  highlights: string[];
  suggestions: string[];
  disclaimer: string;
}

export interface DietDayReportResponse {
  date: string;
  entries: CookedLogEntry[];
  report?: DietDayReport;
  analysis_status?: 'empty' | 'pending' | 'partial' | 'ready' | 'failed' | 'legacy_only' | string;
  pending_count?: number;
  failed_count?: number;
  completed_count?: number;
}

export interface CookedHistoryResponse {
  entries: CookedLogEntry[];
  days: number;
  from_cache?: boolean;
}

export interface WhatsAppParsedAction {
  intent: WhatsAppParseIntent;
  confidence: number;
  summary: string;
  entities: {
    item_name?: string;
    qty?: number;
    unit?: string;
    dish_name?: string;
    meal_slot?: string;
    note?: string;
  };
}

export interface WhatsAppParseResponse {
  action: WhatsAppParsedAction;
  actions?: WhatsAppParsedAction[];
  reply?: string;
  raw_text: string;
}

export type BuddyChatHistoryTurn = {
  role: 'user' | 'buddy';
  text: string;
};

export interface WhatsAppApplyItemResult {
  success: boolean;
  message: string;
  intent?: string;
}

export interface WhatsAppApplyResponse {
  success: boolean;
  message: string;
  intent?: string;
  details?: Record<string, unknown>;
  results?: WhatsAppApplyItemResult[];
}

export interface UserMemory {
  id: string;
  user_id: string;
  category: string;
  content: string;
  created_at: string;
}

export interface UserProfile {
  user: AuthUser;
  household_size: number;
  allergies: string[];
  dislikes: string[];
  dietary_tags: string[];
  fav_cuisines: string[];
  spice_level: string;
  cooking_skill: string;
  memories: UserMemory[];
  inventory_count: number;
  expiring_count: number;
}

export interface KitchenInfo {
  kitchen_id: string;
  name: string;
  invite_code: string;
  member_count: number;
}

export interface UpdateProfileRequest {
  household_size: number;
  allergies: string[];
  dislikes: string[];
  dietary_tags: string[];
  fav_cuisines: string[];
  spice_level: string;
  cooking_skill: string;
}

export interface CookInfo {
  cook_id?: string;
  name: string;
  cook_name?: string;
  dishes_known: string[];
  preferred_lang: string;
  phone_number?: string;
}

export interface UpgradeQuote {
  target: PlanProduct;
  list_price_paise: number;
  credit_paise: number;
  amount_paise: number;
  is_upgrade: boolean;
  is_renewal: boolean;
  days_remaining: number;
  days_in_period: number;
  credit_summary: string;
  amount_label: string;
}

export interface PlanProduct {
  tier: string;
  interval: string;
  amount_paise: number;
  currency: string;
  display_name: string;
  price_label: string;
  description: string;
  features: string[];
  available_for_purchase: boolean;
}

export interface Entitlements {
  plan_tier: 'free' | 'pro' | 'elite' | string;
  plan_interval?: string;
  plan_expires_at?: string;
  is_pro: boolean;
  is_elite: boolean;
  has_diet_analysis: boolean;
  bill_scans_used: number;
  bill_scan_limit: number;
  bill_scans_remaining: number;
  free_meal_categories: string[];
  pro_meal_categories: string[];
  available_plans?: PlanProduct[];
  upgrade_options?: UpgradeQuote[];
}

export interface BillingConfig {
  enabled: boolean;
  razorpay_env: 'staging' | 'production' | string;
  key_id: string;
  currency: string;
  plans: PlanProduct[];
}

export interface CheckoutOrderResponse {
  key_id: string;
  order_id: string;
  amount: number;
  currency: string;
  razorpay_env: string;
  name: string;
  description: string;
  prefill_email?: string;
  plan_tier: string;
  plan_interval: string;
  price_label: string;
  list_price_paise?: number;
  credit_paise?: number;
  is_upgrade?: boolean;
  credit_summary?: string;
}

export interface VerifyCheckoutRequest {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface UpgradeRequiredPayload {
  error: string;
  feature: string;
  message: string;
}

export interface CookProfile {
  cook_id?: string;
  cook_name?: string;
  dishes_known: string[];
  preferred_lang: string;
  phone_number?: string;
  configured?: boolean;
  created_at?: string;
  updated_at?: string;
}

