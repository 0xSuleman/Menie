"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const APP_LOCALES = [
  { code: "en", label: "English", direction: "ltr" },
  { code: "ar", label: "العربية", direction: "rtl" },
] as const;

export type AppLocale = (typeof APP_LOCALES)[number]["code"];
type TranslationKey =
  "appLanguage" | "appLanguageDescription" | "english" | "arabic";

const translations: Record<AppLocale, Record<TranslationKey, string>> = {
  en: {
    appLanguage: "App language",
    appLanguageDescription:
      "Controls the application layout and translated interface strings. Transcript and summary language remain separate.",
    english: "English",
    arabic: "Arabic",
  },
  ar: {
    appLanguage: "لغة التطبيق",
    appLanguageDescription:
      "تتحكم في تخطيط التطبيق والنصوص المترجمة. تبقى لغة النسخ والملخص مستقلة.",
    english: "الإنجليزية",
    arabic: "العربية",
  },
};

interface LocalizationContextValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: TranslationKey) => string;
  formatDateTime: (
    value: string | number | Date,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}

const LocalizationContext = createContext<LocalizationContextValue | undefined>(
  undefined,
);
const storageKey = "menie.appLocale";

function initialLocale(): AppLocale {
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage.getItem(storageKey);
  if (saved === "ar" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en";
}

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(initialLocale);

  useEffect(() => {
    window.localStorage.setItem(storageKey, locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  const value = useMemo<LocalizationContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key) => translations[locale][key],
      formatDateTime: (value, options) =>
        new Intl.DateTimeFormat(locale, options).format(new Date(value)),
      formatNumber: (value, options) =>
        new Intl.NumberFormat(locale, options).format(value),
    }),
    [locale],
  );

  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  );
}

export function useLocalization(): LocalizationContextValue {
  const context = useContext(LocalizationContext);
  if (!context)
    throw new Error("useLocalization must be used inside LocalizationProvider");
  return context;
}
