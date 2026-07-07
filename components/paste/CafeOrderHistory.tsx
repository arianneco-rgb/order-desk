"use client";

import { useEffect, useState } from "react";
import type { CafeCustomer } from "@/lib/types";
import type { PastOrder } from "@/lib/shopify";
import { formatPeso } from "@/lib/conversions";

// Switching between cafes shouldn't refetch one you just looked at.
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; orders: PastOrder[] }>();

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Panel shown once a cafe is selected in the paste flow — the cafe's real
 * Shopify order history (not just orders processed through this app), each
 * with a "Use as new order" button that fills the message box in wording
 * the parser reads back perfectly.
 */
export function CafeOrderHistory({
  cafe,
  messageEmpty,
  onUse,
}: {
  cafe: CafeCustomer;
  messageEmpty: boolean;
  onUse: (itemsText: string) => void;
}) {
  const [orders, setOrders] = useState<PastOrder[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const cacheKey = cafe.shopifyId || cafe.name;

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);

    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      setOrders(hit.orders);
      return;
    }
    setOrders(null);

    async function load() {
      try {
        const params = new URLSearchParams({
          customerId: cafe.shopifyId,
          company: cafe.name,
        });
        const res = await fetch(`/api/cafe-orders?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const fresh: PastOrder[] = Array.isArray(data.orders) ? data.orders : [];
        cache.set(cacheKey, { at: Date.now(), orders: fresh });
        setOrders(fresh);
      } catch {
        // Nice-to-have panel — fail silently, don't block the page.
        if (!cancelled) {
          setLoadFailed(true);
          setOrders([]);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, cafe.shopifyId, cafe.name]);

  if (loadFailed && (orders === null || orders.length === 0)) {
    return null;
  }

  const lastOrder = orders && orders.length > 0 ? orders[0] : null;

  return (
    <div className="mt-4 rounded-xl border border-forest-200 bg-forest-50/50 p-4">
      <h3 className="text-sm font-semibold text-forest-900">
        {cafe.name} · recent orders{" "}
        <span className="font-normal text-forest-500">(from Shopify)</span>
      </h3>

      {orders === null ? (
        <p className="mt-2 text-xs text-forest-500">Loading history…</p>
      ) : orders.length === 0 ? (
        <p className="mt-2 text-xs text-forest-500">No past orders yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {orders.map((order, i) => (
            <li
              key={`${order.name}-${order.date}-${i}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs"
            >
              <span className="shrink-0 text-forest-500">
                {formatDate(order.date)}
                {order.name ? ` · ${order.name}` : ""}
              </span>
              <span className="min-w-0 flex-1 truncate text-forest-700" title={order.itemsText}>
                {order.itemsText || "—"}
              </span>
              <span className="shrink-0 font-semibold text-forest-900">
                {formatPeso(order.total)}
              </span>
              {order.itemsText && (
                <button
                  type="button"
                  onClick={() => onUse(order.itemsText)}
                  title="Fill the message box with this order"
                  className="shrink-0 rounded-md border border-forest-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-forest-800 transition-colors hover:bg-forest-100"
                >
                  Use as new order
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {messageEmpty && lastOrder && (
        <p className="mt-2.5 border-t border-forest-200 pt-2 text-xs italic text-forest-500">
          Ordered {lastOrder.itemsText || "something"} last time — “Use as new
          order” fills the box if it&apos;s a repeat.
        </p>
      )}
    </div>
  );
}
