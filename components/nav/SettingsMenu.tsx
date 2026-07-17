"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { usePreferences, type ThemeChoice, type Density } from "@/components/Preferences";

interface Modes {
  shopify: string;
  sheets: string;
  parser: string;
  bpi: string;
  db: string;
  auth: string;
}

/** Segmented control used for both theme and density choices. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-forest-200 bg-forest-50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
            value === o.value
              ? "bg-white text-forest-900 shadow-sm"
              : "text-forest-600 hover:text-forest-900"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The gear popover: appearance (theme + density), the test-mode switch, and
 * the live/demo status — the low-frequency controls pulled out of the main
 * nav so both the desktop bar and the mobile "More" sheet can host it.
 */
export function SettingsMenu({
  modes,
  testMode,
  togglingTestMode,
  onToggleTestMode,
  variant = "popover",
}: {
  modes: Modes | null;
  testMode: boolean;
  togglingTestMode: boolean;
  onToggleTestMode: () => void;
  /** "popover" = desktop gear; "inline" = rendered flat inside the mobile sheet. */
  variant?: "popover" | "inline";
}) {
  const { theme, density, setTheme, setDensity } = usePreferences();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const anyMock =
    modes && (modes.shopify !== "live" || modes.parser !== "claude" || modes.bpi !== "live");

  const panel = (
    <div
      className={clsx(
        variant === "popover"
          ? "absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-forest-200 bg-white p-4 shadow-[var(--shadow-pop)]"
          : "w-full"
      )}
    >
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-forest-500">Appearance</p>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-sm text-forest-800">Theme</span>
            <Segmented<ThemeChoice>
              value={theme}
              onChange={setTheme}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "Auto" },
              ]}
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-sm text-forest-800">Density</span>
            <Segmented<Density>
              value={density}
              onChange={setDensity}
              options={[
                { value: "comfortable", label: "Cozy" },
                { value: "compact", label: "Compact" },
              ]}
            />
          </div>
        </div>

        <div className="border-t border-forest-100 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-forest-800">Test mode</span>
            <button
              type="button"
              onClick={onToggleTestMode}
              disabled={togglingTestMode}
              role="switch"
              aria-checked={testMode}
              className={clsx(
                "inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-60",
                testMode ? "bg-amber-500" : "bg-forest-200"
              )}
            >
              <span
                className={clsx(
                  "h-4 w-4 rounded-full bg-white shadow transition-transform",
                  testMode ? "translate-x-4" : "translate-x-0.5"
                )}
              />
            </button>
          </div>
          <p className="mt-1 text-xs text-forest-500">
            {testMode
              ? "ON — new orders skip real Shopify + the Sheet."
              : "Off — orders are live."}
          </p>
        </div>

        {modes && (
          <div className="border-t border-forest-100 pt-3">
            <span
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                anyMock ? "bg-amber-200/90 text-amber-900" : "bg-forest-200 text-forest-900"
              )}
              title={`Shopify: ${modes.shopify} · Sheets: ${modes.sheets} · Parser: ${modes.parser} · BPI: ${modes.bpi} · DB: ${modes.db}`}
            >
              <span className={clsx("h-1.5 w-1.5 rounded-full", anyMock ? "bg-amber-600" : "bg-forest-600")} />
              {anyMock ? "Demo data in use" : "All systems live"}
            </span>
          </div>
        )}

        <p className="border-t border-forest-100 pt-3 text-xs text-forest-500">
          Tip: press <kbd className="rounded border border-forest-300 px-1 font-semibold">⌘K</kbd> to
          jump to any page or cafe.
        </p>
      </div>
    </div>
  );

  if (variant === "inline") return panel;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Settings"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-forest-100 transition-colors hover:bg-forest-800"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        {testMode && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
      </button>
      {open && panel}
    </div>
  );
}
