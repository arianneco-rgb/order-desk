"use client";

import { useEffect, useState } from "react";
import type { CafeCustomer, OrderHistoryRow } from "@/lib/types";
import { formatPeso } from "@/lib/conversions";

const MAX_ROWS = 5;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
  });
}

function sameCafe(company: string, cafeName: string): boolean {
  return company.trim().toLowerCase() === cafeName.trim().toLowerCase();
}

/**
 * Small panel shown once a cafe is selected in the paste flow — surfaces
 * that cafe's last few paid orders from /api/history (fetched in full and
 * filtered client-side, since the endpoint has no per-cafe filter).
 */
export function CafeOrderHistory({
  cafe,
  messageEmpty,
}: {
  cafe: CafeCustomer;
  messageEmpty: boolean;
}) {
  const [rows, setRows] = useState<OrderHistoryRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setLoadFailed(false);
    async function load() {
      try {
        const res = await fetch("/api/history");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const all: OrderHistoryRow[] = Array.isArray(data.rows) ? data.rows : [];
        const mine = all
          .filter((r) => sameCafe(r.company, cafe.name))
          .sort(
            (a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime()
          )
          .slice(0, MAX_ROWS);
        setRows(mine);
      } catch {
        // Nice-to-have panel — fail silently, don't block the page.
        if (!cancelled) {
          setLoadFailed(true);
          setRows([]);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [cafe.name]);

  if (loadFailed && (rows === null || rows.length === 0)) {
    return null;
  }

  const lastOrder = rows && rows.length > 0 ? rows[0] : null;

  return (
    <div className="mt-4 rounded-xl border border-forest-200 bg-forest-50/50 p-4">
      <h3 className="text-sm font-semibold text-forest-900">
        {cafe.name} · recent orders
      </h3>

      {rows === null ? (
        <p className="mt-2 text-xs text-forest-500">Loading history…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-xs text-forest-500">No past orders yet.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((row) => (
            <li
              key={`${row.orderId}-${row.paidAt}`}
              className="flex items-baseline justify-between gap-3 text-xs"
            >
              <span className="shrink-0 text-forest-500">
                {formatDate(row.paidAt)}
              </span>
              <span className="min-w-0 flex-1 truncate text-forest-700">
                {row.items || "—"}
              </span>
              <span className="shrink-0 font-semibold text-forest-900">
                {formatPeso(row.total)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {messageEmpty && lastOrder && (
        <p className="mt-2.5 border-t border-forest-200 pt-2 text-xs italic text-forest-500">
          Ordered {lastOrder.items || "something"} last time — mention if it's
          a repeat (&ldquo;the usual&rdquo;)
        </p>
      )}
    </div>
  );
}
