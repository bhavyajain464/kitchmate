export interface InventoryItem {
  item_id: string;
  canonical_name: string;
  qty: number;
  unit: string;
  estimated_expiry?: string;
  is_manual: boolean;
}

export interface ExpiringItem {
  item_id: string;
  canonical_name: string;
  qty: number;
  unit: string;
  estimated_expiry: string;
  days_until_expiry: number;
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
  qty: number;
  unit: string;
  bought: boolean;
  created_at: string;
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
  items?: Array<{
    name: string;
    quantity: number;
    unit: string;
    shelf_life_days?: number;
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
    note?: string;
  };
}

export interface WhatsAppParseResponse {
  action: WhatsAppParsedAction;
  raw_text: string;
}

export interface WhatsAppApplyResponse {
  success: boolean;
  message: string;
  intent?: string;
  details?: Record<string, unknown>;
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

export interface CookProfile {
  cook_id: string;
  cook_name?: string;
  dishes_known: string[];
  preferred_lang: string;
  phone_number?: string;
  created_at?: string;
  updated_at?: string;
}
