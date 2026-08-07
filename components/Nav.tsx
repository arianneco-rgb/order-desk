"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import type { Order } from "@/lib/types";
import { SettingsMenu } from "@/components/nav/SettingsMenu";

interface Modes {
  shopify: string;
  sheets: string;
  parser: string;
  bpi: string;
  db: string;
  auth: string;
}

interface Counts {
  queue: number;
  processed: number;
  history: number;
}

// Nav badge counts are ambient information — they don't need to be fresher
// than the pages themselves, and this fires on every page.
const COUNT_POLL_MS = 15000;

type IconName = "home" | "paste" | "queue" | "processed" | "history" | "analytics" | "reports" | "more";

function Icon({ name, className }: { name: IconName; className?: string }) {
  const common = {
    className: className ?? "h-5 w-5",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "home":
      return <svg {...common}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>;
    case "paste":
      return <svg {...common}><path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z" /><path d="M8 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2" /></svg>;
    case "queue":
      return <svg {...common}><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>;
    case "processed":
      return <svg {...common}><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>;
    case "history":
      return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 8v4l3 2" /></svg>;
    case "analytics":
      return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-6M22 20H2" /></svg>;
    case "reports":
      return <svg {...common}><path d="M6 3h9l3 3v15a0 0 0 0 1 0 0H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M9 13h6M9 17h6M9 9h3" /></svg>;
    case "more":
      return <svg {...common}><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>;
  }
}

export function Nav() {
  const pathname = usePathname();
  const [modes, setModes] = useState<Modes | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [testMode, setTestModeState] = useState(false);
  const [togglingTestMode, setTogglingTestMode] = useState(false);

  useEffect(() => {
    fetch("/api/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setModes(d.modes);
        setTestModeState(Boolean(d.testMode));
      })
      .catch(() => {});
  }, []);

  async function toggleTestMode() {
    const next = !testMode;
    if (
      next &&
      !window.confirm(
        "Turn on test mode? While it's on, EVERY order — including real ones pasted by anyone using the dashboard — skips the real Shopify draft/payment and the Sheet mirror. Turn it off when you're done testing."
      )
    ) {
      return;
    }
    setTogglingTestMode(true);
    try {
      const res = await fetch("/api/settings/test-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) setTestModeState(next);
    } catch {
      // Leave the switch as-is — the user can retry.
    } finally {
      setTogglingTestMode(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const [ordersRes, historyRes] = await Promise.all([
          fetch("/api/orders"),
          fetch("/api/history"),
        ]);
        if (cancelled || !ordersRes.ok) return;
        const orders: Order[] = (await ordersRes.json()).orders ?? [];
        const historyRows = historyRes.ok ? ((await historyRes.json()).rows ?? []) : [];
        if (cancelled) return;
        setCounts({
          queue: orders.filter(
            (o) => o.status === "queued" || o.status === "processing" || o.status === "processed"
          ).length,
          processed: orders.filter((o) => o.status === "draft_created").length,
          history: historyRows.length,
        });
      } catch {
        // Counts are a hint — keep the last known values.
      }
    }
    poll();
    const timer = setInterval(poll, COUNT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  if (pathname === "/login") return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const primary = [
    { href: "/", label: "Home", icon: "home" as IconName, count: null as number | null },
    { href: "/paste", label: "Paste", icon: "paste" as IconName, count: null },
    { href: "/queue", label: "Queue", icon: "queue" as IconName, count: counts?.queue ?? null },
    { href: "/processed", label: "Processed", icon: "processed" as IconName, count: counts?.processed ?? null },
  ];
  const secondary = [
    { href: "/history", label: "History", icon: "history" as IconName, count: counts?.history ?? null },
    { href: "/analytics", label: "Analytics", icon: "analytics" as IconName, count: null },
    { href: "/reports", label: "Reports", icon: "reports" as IconName, count: null },
  ];
  const allLinks = [...primary, ...secondary];

  function Count({ n, active }: { n: number; active: boolean }) {
    return (
      <span
        className={clsx(
          "rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums",
          active ? "bg-forest-600 text-forest-50" : "bg-forest-800 text-forest-200"
        )}
      >
        {n}
      </span>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-forest-800/30 bg-forest-900 text-cream shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6">
          <Link href="/" className="flex min-w-0 flex-1 items-center gap-2.5 lg:flex-initial">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Ritual Matcha Co."
              className="h-9 w-9 shrink-0 rounded-full bg-forest-50 object-contain p-0.5 ring-1 ring-forest-700"
            />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="font-display truncate text-base font-semibold tracking-tight sm:text-lg">
                Ritual Matcha
              </span>
              <span className="truncate text-[11px] uppercase tracking-[0.18em] text-forest-300">
                Order Desk
              </span>
            </span>
          </Link>

          {/* Desktop nav (lg+) */}
          <nav className="hidden flex-1 items-center gap-1 lg:flex">
            {allLinks.map((link) => {
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={clsx(
                    "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-forest-700 font-semibold text-white"
                      : "text-forest-100 hover:bg-forest-800"
                  )}
                >
                  {link.label}
                  {link.count !== null && <Count n={link.count} active={active} />}
                </Link>
              );
            })}
          </nav>

          <div className="hidden shrink-0 lg:block">
            <SettingsMenu
              modes={modes}
              testMode={testMode}
              togglingTestMode={togglingTestMode}
              onToggleTestMode={toggleTestMode}
            />
          </div>

          {/* Mobile: just the gear (navigation lives in the bottom bar). */}
          <div className="shrink-0 lg:hidden">
            <SettingsMenu
              modes={modes}
              testMode={testMode}
              togglingTestMode={togglingTestMode}
              onToggleTestMode={toggleTestMode}
            />
          </div>
        </div>

        {testMode && (
          <div className="border-t border-amber-700 bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-amber-950 sm:px-6">
            🧪 TEST MODE — new orders will NOT create real Shopify drafts/payments or write to the Sheet.{" "}
            <button type="button" onClick={toggleTestMode} className="underline hover:no-underline">
              Turn off
            </button>
          </div>
        )}
      </header>

      {/* Mobile bottom tab bar (below lg) — always visible, one tap. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-forest-800/40 bg-forest-900 pb-[env(safe-area-inset-bottom)] text-cream lg:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {primary.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  "relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors",
                  active ? "text-white" : "text-forest-300"
                )}
              >
                <span className="relative">
                  <Icon name={link.icon} className="h-6 w-6" />
                  {link.count !== null && link.count > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-amber-950 tabular-nums">
                      {link.count}
                    </span>
                  )}
                </span>
                {link.label}
                {active && <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-matcha" />}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-forest-300 transition-colors hover:text-white"
          >
            <Icon name="more" className="h-6 w-6" />
            More
          </button>
        </div>
      </nav>

      {/* Mobile "More" sheet — secondary pages + appearance/test-mode. */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-forest-950/50 lg:hidden"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-forest-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-forest-200" />
            <div className="grid grid-cols-3 gap-2">
              {secondary.map((link) => {
                const active = isActive(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={clsx(
                      "flex flex-col items-center gap-1.5 rounded-xl border p-3 text-sm font-medium transition-colors",
                      active
                        ? "border-forest-600 bg-forest-50 text-forest-900"
                        : "border-forest-200 text-forest-800 hover:bg-forest-50"
                    )}
                  >
                    <Icon name={link.icon} className="h-5 w-5" />
                    {link.label}
                    {link.count !== null && (
                      <span className="text-xs text-forest-500 tabular-nums">{link.count}</span>
                    )}
                  </Link>
                );
              })}
            </div>
            <div className="mt-4 border-t border-forest-100 pt-4">
              <SettingsMenu
                modes={modes}
                testMode={testMode}
                togglingTestMode={togglingTestMode}
                onToggleTestMode={toggleTestMode}
                variant="inline"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
