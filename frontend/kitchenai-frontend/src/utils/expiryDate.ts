/** Calendar-day expiry helpers (local timezone, not UTC midnight). */

export function parseExpiryDateLocal(value: string): Date | null {
  if (!value?.trim()) return null;
  const dateOnly = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(`${dateOnly}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function startOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Whole days from today (local) until expiry date (local). Negative = already expired. */
export function daysUntilExpiryLocal(expiryIso: string): number | null {
  const expiry = parseExpiryDateLocal(expiryIso);
  if (!expiry) return null;
  const today = startOfLocalDay(new Date());
  const expiryDay = startOfLocalDay(expiry);
  return Math.round((expiryDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** Normalize API expiry (RFC3339 or date-only) to YYYY-MM-DD for create/update requests. */
export function expiryToApiDate(expiry?: string): string | undefined {
  const parsed = parseExpiryDateLocal(expiry ?? '');
  if (!parsed) return undefined;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatExpiryCountdown(daysLeft: number | null): string | null {
  if (daysLeft === null) return null;
  if (daysLeft < 0) {
    const n = Math.abs(daysLeft);
    return n === 1 ? 'Expired yesterday' : `Expired ${n} days ago`;
  }
  if (daysLeft > 7) return null;
  if (daysLeft === 0) return 'Expires today';
  if (daysLeft === 1) return '1 day left';
  return `${daysLeft} days left`;
}
