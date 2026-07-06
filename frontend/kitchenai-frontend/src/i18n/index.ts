import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import hi from './locales/hi.json';
import kn from './locales/kn.json';
import { resolveDeviceLanguage } from './resolveDeviceLanguage';
import { loadSavedAppLanguage, saveAppLanguage } from './storage';
import type { AppLanguage } from './types';

export type { AppLanguage } from './types';
export { APP_LANGUAGES, isAppLanguage } from './types';

let initPromise: Promise<typeof i18n> | null = null;

export function initI18n(): Promise<typeof i18n> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const saved = await loadSavedAppLanguage();
    const lng = saved ?? resolveDeviceLanguage();
    await i18n.use(initReactI18next).init({
      resources: {
        en: { translation: en },
        hi: { translation: hi },
        kn: { translation: kn },
      },
      lng,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      compatibilityJSON: 'v4',
    });
    return i18n;
  })();
  return initPromise;
}

export async function setAppLanguage(lang: AppLanguage): Promise<void> {
  await saveAppLanguage(lang);
  await i18n.changeLanguage(lang);
}

export function appLanguageLabel(lang: AppLanguage): string {
  switch (lang) {
    case 'hi':
      return 'हिन्दी';
    case 'kn':
      return 'ಕನ್ನಡ';
    default:
      return 'English';
  }
}

export default i18n;
