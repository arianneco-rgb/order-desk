"use client";

import type { Order } from "@/lib/types";
import { formatPeso } from "@/lib/conversions";
import { paymentReminderReply } from "@/lib/templates";
import { CopyButton } from "@/components/CopyButton";

/**
 * Drafts that have sat unpaid past the follow-up window, oldest first —
 * so Joey never has to re-scan the whole board to find who hasn't paid.
 * Each row has a ready-to-copy gentle nudge. Nothing is ever auto-sent.
 */
export function FollowUpQueue({
  orders,
  followUpDays,
  selectedId,
  onSelect,
}: {
  orders: Order[];
  followUpDays: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const cutoff = Date.now() - followUpDays * 24 * 60 * 60 * 1000;
  const overdue = orders
    .filter(
      (o) =>
        o.status === "draft_created" &&
        !o.payment.confirmed &&
        o.draftCreatedAt !== undefined &&
        Date.parse(o.draftCreatedAt) < cutoff
    )
    .sort(
      (a, b) => Date.parse(a.draftCreatedAt ?? "") - Date.parse(b.draftCreatedAt ?? "")
    );

  if (overdue.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">
        Needs follow-up · {overdue.length}{" "}
        <span className="font-normal">
          (unpaid {followUpDays}+ day{followUpDays === 1 ? "" : "s"} after the draft)
        </span>
      </p>
      <ul className="mt-2 divide-y divide-amber-200/70">
        {overdue.map((order) => {
          const days = Math.floor(
            (Date.now() - Date.parse(order.draftCreatedAt ?? "")) / 86_400_000
          );
          return (
            <li
              key={order.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <button
                type="button"
                onClick={() => onSelect(order.id)}
                className={
                  "min-w-0 text-left text-sm hover:underline " +
                  (selectedId === order.id
                    ? "font-bold text-amber-950"
                    : "font-medium text-amber-900")
                }
              >
                {order.company}
                <span className="font-normal text-amber-800">
                  {" "}
                  · {formatPeso(order.total)}
                  {order.shopifyDraftName ? ` · ${order.shopifyDraftName}` : ""} ·
                  waiting {days} day{days === 1 ? "" : "s"}
                </span>
              </button>
              <CopyButton
                text={paymentReminderReply(order.total)}
                label="Copy reminder"
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
