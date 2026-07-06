"use client";

import type { CatalogProduct, Order } from "@/lib/types";
import { OrderCard } from "./OrderCard";
import type { TitleMap } from "./format";

const COLUMNS = [
  {
    key: "needs_review",
    title: "Needs review",
    match: (o: Order) => o.status === "processed",
  },
  {
    key: "draft_created",
    title: "Draft created",
    match: (o: Order) => o.status === "draft_created",
  },
] as const;

/** Kanban view: three columns of full, self-contained order cards. */
export function OrdersKanban({
  orders,
  catalog,
  titles,
  selectedId,
  onSelect,
  onOrderUpdate,
}: {
  orders: Order[];
  catalog: CatalogProduct[];
  titles: TitleMap;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOrderUpdate: (order: Order) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {COLUMNS.map((col) => {
        const items = orders.filter(col.match);
        return (
          <div key={col.key} className="rounded-lg bg-forest-50/60 p-2">
            <p className="flex items-center gap-2 px-1 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-forest-600">
              {col.title}
              <span className="rounded-full bg-forest-200 px-1.5 text-[11px] font-bold text-forest-800">
                {items.length}
              </span>
            </p>
            <div className="space-y-3">
              {items.length === 0 && (
                <p className="px-1 pb-2 text-xs text-forest-400">None</p>
              )}
              {items.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  catalog={catalog}
                  titles={titles}
                  selected={order.id === selectedId}
                  onSelect={onSelect}
                  onOrderUpdate={onOrderUpdate}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
