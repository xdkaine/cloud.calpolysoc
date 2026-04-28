"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_THEME,
  THEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

type ThemeContextValue = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function resolveTheme(theme: ThemePreference): ResolvedTheme {
  if (theme !== "system") {
    return theme;
  }

  return window.matchMedia(THEME_MEDIA_QUERY).matches ? "dark" : "light";
}

function applyResolvedTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(DEFAULT_THEME);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(storedTheme)) {
      setThemeState(storedTheme);
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia(THEME_MEDIA_QUERY);

    const updateResolvedTheme = () => {
      const nextResolvedTheme = resolveTheme(theme);
      setResolvedTheme(nextResolvedTheme);
      applyResolvedTheme(nextResolvedTheme);
    };

    updateResolvedTheme();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", updateResolvedTheme);
      return () => media.removeEventListener("change", updateResolvedTheme);
    }

    media.addListener(updateResolvedTheme);
    return () => media.removeListener(updateResolvedTheme);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme: (nextTheme) => {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        setThemeState(nextTheme);
      },
      toggleTheme: () => {
        const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        setThemeState(nextTheme);
      },
    }),
    [resolvedTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return value;
}