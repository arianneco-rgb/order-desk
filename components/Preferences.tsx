"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Theme (light / dark / follow the OS) and layout density, persisted to
 * localStorage and applied to <html> as `class="dark"` + `data-density`.
 * A tiny inline script in layout.tsx applies the saved values before first
 * paint so there's no flash — this provider keeps React in sync afterward.
 */
export type ThemeChoice = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";

interface Prefs {
  theme: ThemeChoice;
  density: Density;
  setTheme: (t: ThemeChoice) => void;
  setDensity: (d: Density) => void;
  /** The theme actually showing right now (system resolved to light/dark). */
  resolved: "light" | "dark";
}

const PrefsContext = createContext<Prefs | null>(null);

const THEME_KEY = "od-theme";
const DENSITY_KEY = "od-density";

function systemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: ThemeChoice) {
  const dark = theme === "dark" || (theme === "system" && systemDark());
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.dataset.theme = dark ? "dark" : "light";
}

function applyDensity(density: Density) {
  document.documentElement.dataset.density = density === "compact" ? "compact" : "comfortable";
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const [density, setDensityState] = useState<Density>("comfortable");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  // Read persisted values on mount (the inline script already applied them).
  useEffect(() => {
    const t = (localStorage.getItem(THEME_KEY) as ThemeChoice) || "system";
    const d = (localStorage.getItem(DENSITY_KEY) as Density) || "comfortable";
    setThemeState(t);
    setDensityState(d);
    setResolved(t === "dark" || (t === "system" && systemDark()) ? "dark" : "light");
  }, []);

  // Re-resolve when the OS theme changes and we're following it.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((localStorage.getItem(THEME_KEY) as ThemeChoice || "system") === "system") {
        applyTheme("system");
        setResolved(systemDark() ? "dark" : "light");
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((t: ThemeChoice) => {
    localStorage.setItem(THEME_KEY, t);
    applyTheme(t);
    setThemeState(t);
    setResolved(t === "dark" || (t === "system" && systemDark()) ? "dark" : "light");
  }, []);

  const setDensity = useCallback((d: Density) => {
    localStorage.setItem(DENSITY_KEY, d);
    applyDensity(d);
    setDensityState(d);
  }, []);

  return (
    <PrefsContext.Provider value={{ theme, density, setTheme, setDensity, resolved }}>
      {children}
    </PrefsContext.Provider>
  );
}

export function usePreferences(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}

/** Inline, runs before paint — prevents a light-then-dark flash. */
export const PREFS_BOOT_SCRIPT = `
(function(){try{
  var t = localStorage.getItem("${THEME_KEY}") || "system";
  var d = localStorage.getItem("${DENSITY_KEY}") || "comfortable";
  var dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var r = document.documentElement;
  if (dark) r.classList.add("dark");
  r.dataset.theme = dark ? "dark" : "light";
  r.dataset.density = d === "compact" ? "compact" : "comfortable";
}catch(e){}})();
`;
