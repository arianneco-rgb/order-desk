"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import type { Order } from "@/lib/types";

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

const COUNT_POLL_MS = 5000;

export function Nav() {
  const pathname = usePathname();
  const [modes, setModes] = useState<Modes | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setModes(d.modes))
      .catch(() => {});
  }, []);

  // Tab count pills (queue = parsing now, processed = awaiting Joey, history = paid).
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
        const historyRows = historyRes.ok
          ? ((await historyRes.json()).rows ?? [])
          : [];
        if (cancelled) return;
        setCounts({
          queue: orders.filter(
            (o) => o.status === "queued" || o.status === "processing"
          ).length,
          processed: orders.filter(
            (o) => o.status === "processed" || o.status === "draft_created"
          ).length,
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

  // Close the mobile menu on navigation and lock background scroll while open.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  if (pathname === "/login") return null;

  const anyMock =
    modes &&
    (modes.shopify !== "live" ||
      modes.parser !== "claude" ||
      modes.bpi !== "live");

  const links = [
    { href: "/paste", label: "Paste order", count: null as number | null },
    { href: "/queue", label: "Queue", count: counts?.queue ?? null },
    { href: "/processed", label: "Processed", count: counts?.processed ?? null },
    { href: "/history", label: "History", count: counts?.history ?? null },
    { href: "/analytics", label: "Analytics", count: null as number | null },
    { href: "/reports", label: "Reports", count: null as number | null },
  ];

  const modeBadge = modes && (
    <span
      title={`Shopify: ${modes.shopify} · Sheets: ${modes.sheets} · Parser: ${modes.parser} · BPI: ${modes.bpi} · DB: ${modes.db} · Auth: ${modes.auth}`}
      className={clsx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        anyMock ? "bg-amber-200/90 text-amber-900" : "bg-forest-200 text-forest-900"
      )}
    >
      <span
        className={clsx(
          "h-1.5 w-1.5 rounded-full",
          anyMock ? "bg-amber-600" : "bg-forest-600"
        )}
      />
      {anyMock ? "Demo data in use" : "All live"}
    </span>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-forest-800/20 bg-forest-900 text-cream shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6">
        <Link href="/paste" className="flex min-w-0 flex-1 items-center gap-2.5 sm:flex-initial">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Ritual Matcha Co."
            className="h-8 w-8 shrink-0 rounded-full bg-forest-50 object-contain p-0.5"
          />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold tracking-tight sm:text-base">
              Ritual Matcha · Order Desk
            </span>
            {modes && (
              <span className="truncate text-[11px] text-forest-300">
                {anyMock ? "Demo data in use" : "Live"}
              </span>
            )}
          </span>
        </Link>

        {/* Desktop nav (lg and up — narrower than that, 6 links don't fit) */}
        <nav className="hidden flex-1 items-center gap-1 overflow-x-auto lg:flex">
          {links.map((link) => {
            const active = pathname.startsWith(link.href);
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
                {link.count !== null && (
                  <span
                    className={clsx(
                      "rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none",
                      active
                        ? "bg-forest-600 text-forest-50"
                        : "bg-forest-800 text-forest-200"
                    )}
                  >
                    {link.count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="hidden shrink-0 lg:block">{modeBadge}</div>

        {/* Mobile/tablet hamburger toggle (below lg) */}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav-menu"
          className="flex shrink-0 items-center justify-center rounded-md p-2 text-forest-100 transition-colors hover:bg-forest-800 lg:hidden"
        >
          {menuOpen ? (
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile/tablet menu panel (below lg) */}
      {menuOpen && (
        <nav
          id="mobile-nav-menu"
          className="border-t border-forest-800/40 bg-forest-900 px-4 pb-4 pt-2 lg:hidden"
        >
          <div className="flex flex-col gap-1">
            {links.map((link) => {
              const active = pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={clsx(
                    "flex items-center justify-between rounded-md px-3 py-2.5 text-base transition-colors",
                    active
                      ? "bg-forest-700 font-semibold text-white"
                      : "text-forest-100 hover:bg-forest-800"
                  )}
                >
                  {link.label}
                  {link.count !== null && (
                    <span
                      className={clsx(
                        "rounded-full px-2 py-0.5 text-xs font-semibold leading-none",
                        active
                          ? "bg-forest-600 text-forest-50"
                          : "bg-forest-800 text-forest-200"
                      )}
                    >
                      {link.count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
          {modeBadge && <div className="mt-3 flex">{modeBadge}</div>}
        </nav>
      )}
    </header>
  );
}
