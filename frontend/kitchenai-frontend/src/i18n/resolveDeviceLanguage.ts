import type { AppLanguage } from './types';

function deviceLocaleCodes(): string[] {
  const codes: string[] = [];
  try {
    const intl = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intl) codes.push(intl.toLowerCase());
  } catch {
    // Hermes/Intl unavailable — fall through to English.
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    codes.push(navigator.language.toLowerCase());
  }
  return codes;
}

/** Map device locale to supported app language; default English. */
export function resolveDeviceLanguage(): AppLanguage {
  const codes = deviceLocaleCodes();
  if (codes.some((c) => c === 'hi' || c.startsWith('hi-'))) return 'hi';
  if (codes.some((c) => c === 'kn' || c.startsWith('kn-'))) return 'kn';
  return 'en';
}
