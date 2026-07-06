import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { setAppLanguage, appLanguageLabel } from '../i18n';
import type { AppLanguage } from '../i18n/types';
import { APP_LANGUAGES, isAppLanguage } from '../i18n/types';

type LocaleContextValue = {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => Promise<void>;
  languageLabel: (lang: AppLanguage) => string;
  languageOptions: { code: AppLanguage; label: string }[];
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function normalizeLanguage(code: string | undefined): AppLanguage {
  const base = (code ?? 'en').split('-')[0].toLowerCase();
  return isAppLanguage(base) ? base : 'en';
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation();

  const language = normalizeLanguage(i18n.language);

  const setLanguage = useCallback(async (lang: AppLanguage) => {
    await setAppLanguage(lang);
  }, []);

  const languageOptions = useMemo(
    () => APP_LANGUAGES.map((code) => ({ code, label: appLanguageLabel(code) })),
    [],
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      languageLabel: appLanguageLabel,
      languageOptions,
    }),
    [language, setLanguage, languageOptions],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error('useLocale must be used within LocaleProvider');
  }
  return ctx;
}
