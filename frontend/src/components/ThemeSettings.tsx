"use client";

import { useTheme, type ThemePreference } from "@/contexts/ThemeContext";

export function ThemeSettings() {
  const { preference, setPreference } = useTheme();
  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      aria-labelledby="theme-settings-title"
    >
      <h3
        id="theme-settings-title"
        className="text-base font-semibold text-gray-800"
      >
        Appearance
      </h3>
      <p className="mt-1 text-sm text-gray-600">
        Choose light, dark, or follow the operating system. This affects only
        the local interface.
      </p>
      <label
        className="mt-3 block text-sm font-medium text-gray-700"
        htmlFor="theme-preference"
      >
        Theme
      </label>
      <select
        id="theme-preference"
        value={preference}
        onChange={(event) =>
          setPreference(event.target.value as ThemePreference)
        }
        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 sm:max-w-xs"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </section>
  );
}
