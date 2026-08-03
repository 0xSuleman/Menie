"use client";

import { APP_LOCALES, useLocalization } from "@/contexts/LocalizationContext";

export function AppLanguageSettings() {
  const { locale, setLocale, t } = useLocalization();

  return (
    <section
      className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm"
      aria-labelledby="app-language-title"
    >
      <h3
        id="app-language-title"
        className="text-lg font-semibold text-gray-900"
      >
        {t("appLanguage")}
      </h3>
      <p className="mt-1 text-sm text-gray-600">
        {t("appLanguageDescription")}
      </p>
      <label
        className="mt-4 block text-sm font-medium text-gray-800"
        htmlFor="app-language-select"
      >
        {t("appLanguage")}
      </label>
      <select
        id="app-language-select"
        value={locale}
        onChange={(event) => setLocale(event.target.value as typeof locale)}
        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 sm:max-w-xs"
      >
        {APP_LOCALES.map((option) => (
          <option key={option.code} value={option.code}>
            {t(option.code === "en" ? "english" : "arabic")}
          </option>
        ))}
      </select>
    </section>
  );
}
