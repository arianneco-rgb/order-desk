"use client";

import clsx from "clsx";
import type { Order } from "@/lib/types";
import { formatPeso } from "@/lib/conversions";
import { StatusPill } from "@/components/StatusPill";
import { itemLines, type TitleMap } from "./format";

/** Table view of processed / draft-created orders. Rows select the order. */
export function OrdersTable({
  orders,
  titles,
  selectedId,
  onSelect,
}: {
  orders: Order[];
  titles: TitleMap;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-forest-200 bg-white shadow-sm">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-forest-100 text-xs uppercase tracking-wide text-forest-500">
            <th className="px-4 py-3 font-semibold">Cafe</th>
            <th className="px-4 py-3 font-semibold">Items</th>
            <th className="px-4 py-3 font-semibold">Total</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const selected = order.id === selectedId;
            return (
              <tr
                key={order.id}
                onClick={() => onSelect(order.id)}
                className={clsx(
                  "cursor-pointer border-b border-forest-100 align-top transition-colors last:border-b-0",
                  selected
                    ? "bg-forest-50 ring-1 ring-inset ring-forest-300"
                    : "hover:bg-forest-50/60"
                )}
              >
                <td className="px-4 py-3 font-medium text-forest-900">
                  {order.company}
                </td>
                <td className="px-4 py-3 text-forest-700">
                  {itemLines(order, titles).map((line, i) => (
                    <div key={i} className="whitespace-nowrap">
                      {line}
                    </div>
                  ))}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-forest-900">
                  {formatPeso(order.total)}
                </td>
                <td className="px-4 py-3">
                  <StatusPill order={order} />
                </td>
                <td className="px-4 py-3 text-forest-400">›</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
