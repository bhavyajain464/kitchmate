/** Default copy when an error must not expose server or technical details. */
export const GENERIC_USER_ERROR = 'Something went wrong. Please try again.';

const INTERNAL_RE =
  /groq|gemini|openai|anthropic|redis|postgres|sql|pq:|database|http\s*\d{3}|failed to fetch|network request|rate limit|service tier|llama-|org_01|tokens per|panic:|runtime error|internal server|invalid input syntax|syntax error|restart local backend|deploy latest backend|server needs|invalid response from server|plan status request failed|dish_id is required|developer_error/i;

const SAFE_EXACT = new Set([
  'Payment cancelled',
  'Recipe not found',
  'Message is empty',
  'Not found',
  "We couldn't read this receipt. Try a clearer photo with good lighting, or add items manually.",
  'This message was not understood well enough to apply.',
]);

const SAFE_PREFIXES = [
  'Could not ',
  'Failed to ',
  'Enter ',
  'Select ',
  'Add ',
  'Your ',
  'No ',
  'Everything ',
  'Checkout is not available',
  'Suggestions unavailable',
  'Nothing to suggest',
  'All suggested',
  'Meal planning is temporarily unavailable',
  'Meal of the Day is temporarily unavailable',
];

function isSafeFrontendMessage(msg: string): boolean {
  if (SAFE_EXACT.has(msg)) return true;
  if (msg.length > 120) return false;
  if (INTERNAL_RE.test(msg)) return false;
  return SAFE_PREFIXES.some((prefix) => msg.startsWith(prefix));
}

/** Strip backend/technical text; only allow known safe frontend copy through. */
export function sanitizeUserFacingMessage(
  raw: string | undefined | null,
  fallback = GENERIC_USER_ERROR,
): string {
  const msg = String(raw ?? '').trim();
  if (!msg) return fallback;
  if (isSafeFrontendMessage(msg)) return msg;
  return fallback;
}

export function userFacingError(err: unknown, fallback = GENERIC_USER_ERROR): string {
  if (err && typeof err === 'object') {
    const named = err as Error;
    if (named.name === 'UpgradeRequiredError') {
      const msg = String(named.message ?? '').trim();
      if (msg && msg.length <= 200 && !INTERNAL_RE.test(msg)) return msg;
      return fallback;
    }
  }
  const raw = err instanceof Error ? err.message : String(err ?? '');
  return sanitizeUserFacingMessage(raw, fallback);
}
