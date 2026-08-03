"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemePreference = "light" | "dark" | "system";
const themeKey = "menie.themePreference";

function readPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const value = window.localStorage.getItem(themeKey);
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

function systemIsDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  const applyTheme = (next: ThemePreference) => {
    const dark = next === "dark" || (next === "system" && systemIsDark());
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  };

  useEffect(() => {
    const stored = readPreference();
    setPreferenceState(stored);
  }, []);

  useEffect(() => {
    applyTheme(preference);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemThemeChanged = () => {
      if (preference === "system") applyTheme("system");
    };
    media.addEventListener?.("change", onSystemThemeChanged);
    return () => media.removeEventListener?.("change", onSystemThemeChanged);
  }, [preference]);

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    window.localStorage.setItem(themeKey, next);
    applyTheme(next);
  };

  const value = useMemo(() => ({ preference, setPreference }), [preference]);
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
