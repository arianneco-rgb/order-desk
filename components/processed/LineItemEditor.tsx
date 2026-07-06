"use client";

import { useEffect, useRef, useState } from "react";
import type { CatalogProduct, ItemForm, Order, OrderItem } from "@/lib/types";
import { POUCHES_PER_CASE } from "@/lib/conversions";

const DEBOUNCE_MS = 400;

/**
 * Inline editor for the order's line items. Every change is debounced and
 * PATCHed to the server, which recomputes the total + reply — the parent
 * receives the updated order via onOrderUpdate ("editing live-updates the reply").
 */
export function LineItemEditor({
  order,
  catalog,
  onOrderUpdate,
}: {
  order: Order;
  catalog: CatalogProduct[];
  onOrderUpdate: (order: Order) => void;
}) {
  const [items, setItems] = useState<OrderItem[]>(order.items);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<OrderItem[] | null>(null);

  // Reset local draft when a different order is selected.
  useEffect(() => {
    setItems(order.items);
    setError(null);
    pendingRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  // Flush a pending save if the editor unmounts mid-debounce.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pendingRef.current) {
        void save(pendingRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(next: OrderItem[]) {
    pendingRef.current = null;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Save failed (HTTP ${res.status}).`);
      }
      onOrderUpdate(data.order);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the lines.");
    } finally {
      setSaving(false);
    }
  }

  function mutate(next: OrderItem[]) {
    setItems(next);
    pendingRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(next), DEBOUNCE_MS);
  }

  // Hand-edited lines are trusted: confidence 1.
  function updateLine(index: number, patch: Partial<OrderItem>) {
    mutate(
      items.map((item, i) =>
        i === index ? { ...item, ...patch, confidence: 1 } : item
      )
    );
  }

  function removeLine(index: number) {
    mutate(items.filter((_, i) => i !== index));
  }

  function addLine() {
    const first = catalog[0];
    mutate([
      ...items,
      {
        productKey: first ? first.key : "",
        form: "pouch",
        qty: POUCHES_PER_CASE, // start at MOQ: 1 case
        confidence: 1,
      },
    ]);
  }

  function clampQty(raw: string): number {
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }

  return (
    <div>
      <ul className="divide-y divide-forest-100">
        {items.map((item, index) => {
          const known = catalog.some((p) => p.key === item.productKey);
          return (
            <li key={index} className="flex flex-wrap items-center gap-2 py-2">
              <select
                value={item.productKey}
                onChange={(e) => updateLine(index, { productKey: e.target.value })}
                className="min-w-[10rem] flex-1 rounded-md border border-forest-300 bg-white px-2 py-1.5 text-sm text-forest-900 focus:border-forest-600 focus:outline-none"
              >
                {!known && (
                  <option value={item.productKey}>{item.productKey}</option>
                )}
                {catalog.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.title}
                  </option>
                ))}
              </select>
              <select
                value={item.form}
                onChange={(e) =>
                  updateLine(index, { form: e.target.value as ItemForm })
                }
                className="rounded-md border border-forest-300 bg-white px-2 py-1.5 text-sm text-forest-900 focus:border-forest-600 focus:outline-none"
              >
                <option value="pouch">200g pouches</option>
                <option value="sample">20g samples</option>
              </select>
              <input
                type="number"
                min={1}
                value={item.qty}
                onChange={(e) => updateLine(index, { qty: clampQty(e.target.value) })}
                className="w-20 rounded-md border border-forest-300 px-2 py-1.5 text-sm text-forest-900 focus:border-forest-600 focus:outline-none"
                aria-label={item.form === "pouch" ? "Pouches" : "Sachets"}
              />
              {item.form === "pouch" && (
                <button
                  type="button"
                  onClick={() =>
                    updateLine(index, { qty: item.qty + POUCHES_PER_CASE })
                  }
                  title="Add one case (10 pouches)"
                  className="rounded-md border border-forest-300 bg-white px-2 py-1.5 text-xs font-semibold text-forest-800 transition-colors hover:bg-forest-50"
                >
                  +case
                </button>
              )}
              <button
                type="button"
                onClick={() => removeLine(index)}
                aria-label="Remove line"
                className="rounded-md px-2 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={addLine}
          className="rounded-md border border-dashed border-forest-300 px-3 py-1.5 text-sm font-medium text-forest-700 transition-colors hover:bg-forest-50"
        >
          + Add line
        </button>
        {saving && <span className="text-xs text-forest-500">Saving…</span>}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
