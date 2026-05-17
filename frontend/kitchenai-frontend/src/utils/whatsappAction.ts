import { WhatsAppParsedAction, WhatsAppParseIntent } from '../types';

const VALID_INTENTS: WhatsAppParseIntent[] = [
  'add_to_shopping_list',
  'mark_out_of_stock',
  'add_inventory',
  'note_dislike',
  'report_cooked_dish',
  'unknown',
];

const MAX_MESSAGE_LEN = 8000;

const GENERIC_ERROR = 'Something went wrong. Please try again in a moment.';

const INTERNAL_ERROR_RE =
  /groq|gemini|openai|rate limit|whatsapp parse|org_01|tokens per|service tier|llama-|http\s*5\d{2}/i;

/** Log full import/parse errors to Metro or browser devtools (raw, not sanitized). */
export function logImportError(
  step: 'parse' | 'apply',
  details: {
    status?: number;
    body?: string;
    url?: string;
    rawMessage?: string;
    cause?: unknown;
  },
) {
  const cause =
    details.cause instanceof Error
      ? { name: details.cause.name, message: details.cause.message, stack: details.cause.stack }
      : details.cause;
  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
  const hint =
    apiBase?.includes('localhost') || apiBase?.includes('127.0.0.1')
      ? 'On a physical device or emulator, localhost is the phone itself — use your computer IP (e.g. http://192.168.x.x:8080/api/v1) or Android emulator http://10.0.2.2:8080/api/v1'
      : undefined;
  console.error(`[KITCHMATE import/${step}]`, {
    apiBase,
    hint,
    status: details.status,
    url: details.url,
    rawMessage: details.rawMessage,
    responseBody: details.body,
    cause,
  });
}

/** Hide LLM/provider errors from the UI. */
export function toUserFacingMessage(raw: string | undefined | null): string {
  const msg = String(raw ?? '').trim();
  if (!msg) return GENERIC_ERROR;
  if (INTERNAL_ERROR_RE.test(msg) || msg.length > 160) return GENERIC_ERROR;
  return msg;
}

function sanitizeSummary(summary: string, intent: string): string {
  const s = summary.trim();
  if (!s || INTERNAL_ERROR_RE.test(s) || s.length > 200) {
    return intent === 'unknown'
      ? 'Could not understand this message.'
      : 'Suggested action';
  }
  return s;
}

export function clampWhatsAppMessageText(text: string): string {
  return String(text ?? '').trim().slice(0, MAX_MESSAGE_LEN);
}

export function unknownWhatsAppAction(summary?: string): WhatsAppParsedAction {
  return {
    intent: 'unknown',
    confidence: 0.2,
    summary: summary?.trim() || 'Could not understand this message.',
    entities: {},
  };
}

/** Coerce API / LLM payloads into a safe shape for UI and apply. */
export function normalizeParsedAction(raw: unknown): WhatsAppParsedAction | null {
  if (!raw || typeof raw !== 'object') return null;

  const o = raw as Record<string, unknown>;
  let intent = typeof o.intent === 'string' ? o.intent.trim() : 'unknown';
  if (!VALID_INTENTS.includes(intent as WhatsAppParseIntent)) {
    intent = 'unknown';
  }

  let confidence = 0;
  if (typeof o.confidence === 'number' && Number.isFinite(o.confidence)) {
    confidence = o.confidence;
  } else if (typeof o.confidence === 'string') {
    const n = parseFloat(o.confidence);
    if (Number.isFinite(n)) confidence = n;
  }
  if (confidence <= 0 || confidence > 1) {
    confidence = intent === 'unknown' ? 0.2 : 0.75;
  }

  const rawSummary = typeof o.summary === 'string' ? o.summary : '';
  const summary = sanitizeSummary(rawSummary, intent);

  const entitiesRaw =
    o.entities && typeof o.entities === 'object' && !Array.isArray(o.entities)
      ? (o.entities as Record<string, unknown>)
      : {};

  const item_name =
    typeof entitiesRaw.item_name === 'string' ? entitiesRaw.item_name.trim() : undefined;
  const unit =
    typeof entitiesRaw.unit === 'string' ? entitiesRaw.unit.trim() : undefined;
  const dish_name =
    typeof entitiesRaw.dish_name === 'string' ? entitiesRaw.dish_name.trim() : undefined;
  const note =
    typeof entitiesRaw.note === 'string' ? entitiesRaw.note.trim() : undefined;

  let qty = 1;
  if (typeof entitiesRaw.qty === 'number' && Number.isFinite(entitiesRaw.qty) && entitiesRaw.qty > 0) {
    qty = entitiesRaw.qty;
  } else if (typeof entitiesRaw.qty === 'string') {
    const n = parseFloat(entitiesRaw.qty);
    if (Number.isFinite(n) && n > 0) qty = n;
  }

  return {
    intent: intent as WhatsAppParseIntent,
    confidence,
    summary,
    entities: {
      ...(item_name ? { item_name } : {}),
      qty,
      unit: unit || 'pcs',
      ...(dish_name ? { dish_name } : {}),
      ...(note ? { note } : {}),
    },
  };
}

export function formatConfidence(confidence: number): string {
  const n = typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0;
  return String(Math.round(n * 100));
}
