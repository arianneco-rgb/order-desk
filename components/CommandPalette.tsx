"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CafeCustomer } from "@/lib/types";

interface Item {
  kind: "page" | "cafe" | "action";
  label: string;
  hint?: string;
  run: () => void;
}

const PAGES: { label: string; href: string; hint: string }[] = [
  { label: "Home", href: "/", hint: "day at a glance" },
  { label: "Paste order", href: "/paste", hint: "new order or customer" },
  { label: "Queue", href: "/queue", hint: "work in progress" },
  { label: "Processed", href: "/processed", hint: "awaiting payment" },
  { label: "History", href: "/history", hint: "paid orders" },
  { label: "Analytics", href: "/analytics", hint: "dashboard" },
  { label: "Reports", href: "/reports", hint: "printable report" },
];

/**
 * ⌘K / Ctrl-K quick-jump — search pages and cafes, hit Enter to go. Picking
 * a cafe drops you on Paste with it preselected (via ?cafe=…). Built to feel
 * instant: the cafe list is fetched once, filtering is local.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [cafes, setCafes] = useState<CafeCustomer[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global ⌘K / Ctrl-K, and "/" when not already typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(
        (document.activeElement?.tagName ?? "")
      );
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "/" && !inField && !open) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Load cafes lazily the first time the palette opens.
  useEffect(() => {
    if (!open || cafes.length) return;
    fetch("/api/customers")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.customers && setCafes(d.customers))
      .catch(() => {});
  }, [open, cafes.length]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const pageItems: Item[] = PAGES.filter(
      (p) => !q || p.label.toLowerCase().includes(q) || p.hint.includes(q)
    ).map((p) => ({ kind: "page", label: p.label, hint: p.hint, run: () => go(p.href) }));

    if (!q) return pageItems;

    const cafeItems: Item[] = cafes
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.contactName ?? "").toLowerCase().includes(q)
      )
      .slice(0, 8)
      .map((c) => ({
        kind: "cafe",
        label: c.name,
        hint: c.city ? `cafe · ${c.city}` : "cafe",
        run: () => go(`/paste?cafe=${encodeURIComponent(c.shopifyId)}`),
      }));

    return [...pageItems, ...cafeItems];
  }, [query, cafes, go]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(items.length - 1, 0)));
  }, [items.length]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-forest-950/40 p-4 pt-[12vh]"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-forest-200 bg-white shadow-[var(--shadow-pop)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-forest-100 px-4">
          <span className="text-forest-400" aria-hidden>
            ⌕
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                items[active]?.run();
              }
            }}
            placeholder="Jump to a page or cafe…"
            className="w-full bg-transparent py-3.5 text-sm text-forest-900 placeholder:text-forest-400 focus:outline-none"
          />
          <kbd className="hidden rounded border border-forest-200 px-1.5 py-0.5 text-[10px] font-semibold text-forest-500 sm:inline">
            esc
          </kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {items.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-forest-500">
              Nothing matches “{query}”.
            </li>
          ) : (
            items.map((item, i) => (
              <li key={`${item.kind}-${item.label}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => item.run()}
                  className={
                    "flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left text-sm " +
                    (i === active ? "bg-forest-50 text-forest-900" : "text-forest-800")
                  }
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span
                      className={
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase " +
                        (item.kind === "cafe"
                          ? "bg-forest-100 text-forest-700"
                          : "bg-forest-700 text-forest-50")
                      }
                    >
                      {item.kind}
                    </span>
                    <span className="truncate font-medium">{item.label}</span>
                  </span>
                  {item.hint && (
                    <span className="shrink-0 text-xs text-forest-500">{item.hint}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
