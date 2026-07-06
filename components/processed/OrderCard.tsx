"use client";

import { useState } from "react";
import clsx from "clsx";
import type { CatalogProduct, Order } from "@/lib/types";
import { formatPeso, formatPouchQty, formatSampleQty } from "@/lib/conversions";
import { CopyButton } from "@/components/CopyButton";
import { StatusPill } from "@/components/StatusPill";
import { Modal } from "@/components/Modal";
import { LineItemEditor } from "./LineItemEditor";
import {
  formatTime,
  lineAmount,
  titleFor,
  variantBreakdown,
  type TitleMap,
} from "./format";

/**
 * One processed order, self-contained (mockup layout): line items with
 * per-line amounts → total from Shopify prices → the "Reply to send" block
 * with Copy → Edit lines + Confirm · create draft.
 */
export function OrderCard({
  order,
  catalog,
  titles,
  selected,
  onSelect,
  onOrderUpdate,
}: {
  order: Order;
  catalog: CatalogProduct[];
  titles: TitleMap;
  selected: boolean;
  onSelect: (id: string) => void;
  onOrderUpdate: (order: Order) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  function openPreview(e: React.MouseEvent) {
    e.stopPropagation();
    setDraftError(null);
    setPreviewOpen(true);
  }

  async function createDraft() {
    setDraftBusy(true);
    setDraftError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/draft`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Draft failed (HTTP ${res.status}).`);
      onOrderUpdate(data.order);
      setDraftNotice(`Draft ${data.order.shopifyDraftName ?? ""} created in Shopify.`);
      setEditing(false);
      setPreviewOpen(false);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Draft creation failed.");
    } finally {
      setDraftBusy(false);
    }
  }

  return (
    <div
      onClick={() => onSelect(order.id)}
      className={clsx(
        "cursor-pointer rounded-xl border bg-white p-4 shadow-sm transition-colors",
        selected
          ? "border-forest-600 ring-1 ring-forest-600"
          : "border-forest-200 hover:border-forest-300"
      )}
    >
      {/* Header: cafe + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-base font-semibold text-forest-900">
            {order.company}
          </p>
          <p className="mt-0.5 text-xs text-forest-500">
            Received {formatTime(order.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusPill order={order} />
          {order.shopifyDraftName &&
            (order.shopifyDraftUrl ? (
              <a
                href={order.shopifyDraftUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-xs font-semibold text-forest-700 underline hover:text-forest-900"
              >
                {order.shopifyDraftName} ↗
              </a>
            ) : (
              <span
                title="Mock draft — connect a Shopify Admin token for a real link"
                className="cursor-help rounded bg-forest-100 px-1.5 py-0.5 text-[11px] text-forest-600"
              >
                {order.shopifyDraftName}
              </span>
            ))}
        </div>
      </div>

      {/* Review flags */}
      {order.needsReview && order.reviewReasons.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
          <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-900">
            {order.reviewReasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Line items with per-line amounts */}
      {editing ? (
        <div className="mt-3" onClick={(e) => e.stopPropagation()}>
          <LineItemEditor order={order} catalog={catalog} onOrderUpdate={onOrderUpdate} />
        </div>
      ) : (
        <div className="mt-3 divide-y divide-forest-100 border-y border-forest-100">
          {order.items.length === 0 && (
            <p className="py-2 text-sm text-forest-500">
              No line items recognized — use Edit lines to add them.
            </p>
          )}
          {order.items.map((item, i) => {
            const amount = lineAmount(item, catalog);
            return (
              <div key={i} className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-sm text-forest-900">
                  {titleFor(titles, item.productKey)}
                  {" · "}
                  {item.form === "sample"
                    ? formatSampleQty(item.qty)
                    : formatPouchQty(item.qty)}
                  {item.confidence < 0.7 && (
                    <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[11px] text-amber-800">
                      check qty
                    </span>
                  )}
                </span>
                <span className="whitespace-nowrap text-sm font-medium text-forest-900">
                  {amount === null ? "—" : formatPeso(amount)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Total */}
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-forest-900">
          Total <span className="font-normal text-forest-500">(Shopify prices)</span>
        </span>
        <span className="text-base font-bold text-forest-900">
          {formatPeso(order.total)}
        </span>
      </div>

      {/* Reply to send */}
      <div
        className="mt-3 rounded-lg border border-forest-100 bg-forest-50 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-forest-800">Reply to send</p>
          <CopyButton text={order.reply} label="Copy" />
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-forest-900">
          {order.reply}
        </p>
      </div>

      {/* Actions */}
      <div
        className="mt-3 flex flex-wrap items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="rounded-md border border-forest-300 bg-white px-3 py-1.5 text-sm font-semibold text-forest-800 transition-colors hover:bg-forest-50"
        >
          {editing ? "Done editing" : "Edit lines"}
        </button>
        {order.status === "processed" && (
          <button
            type="button"
            onClick={openPreview}
            disabled={draftBusy || order.items.length === 0}
            className="rounded-md bg-forest-700 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-forest-800 disabled:opacity-50"
          >
            {draftBusy ? "Creating draft…" : "Confirm · create draft"}
          </button>
        )}
      </div>
      {draftNotice && !draftError && (
        <p className="mt-2 text-xs font-medium text-forest-700">{draftNotice}</p>
      )}
      {draftError && <p className="mt-2 text-sm text-red-600">{draftError}</p>}

      <div onClick={(e) => e.stopPropagation()}>
        <Modal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title="Create Shopify draft"
        >
          <p className="text-sm text-forest-700">
            This creates a Shopify draft order for{" "}
            <span className="font-semibold text-forest-900">{order.company}</span>{" "}
            with the lines below.
          </p>

          {order.needsReview && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              This order is flagged for review
              {order.reviewReasons.length > 0 && (
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {order.reviewReasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-3 divide-y divide-forest-100 border-y border-forest-100">
            {order.items.map((item, i) => {
              const amount = lineAmount(item, catalog);
              return (
                <div key={i} className="py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-forest-900">
                      {titleFor(titles, item.productKey)}
                      {" · "}
                      {item.form === "sample"
                        ? formatSampleQty(item.qty)
                        : formatPouchQty(item.qty)}
                    </span>
                    <span className="whitespace-nowrap text-sm font-medium text-forest-900">
                      {amount === null ? "—" : formatPeso(amount)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-forest-500">
                    Shopify variant: {variantBreakdown(item)}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold text-forest-900">Total</span>
            <span className="text-base font-bold text-forest-900">
              {formatPeso(order.total)}
            </span>
          </div>

          {draftError && <p className="mt-3 text-sm text-red-600">{draftError}</p>}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              disabled={draftBusy}
              className="rounded-md border border-forest-300 bg-white px-3 py-1.5 text-sm font-semibold text-forest-800 transition-colors hover:bg-forest-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void createDraft()}
              disabled={draftBusy || order.items.length === 0}
              className="rounded-md bg-forest-700 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-forest-800 disabled:opacity-50"
            >
              {draftBusy ? "Creating draft…" : "Confirm · create draft"}
            </button>
          </div>
        </Modal>
      </div>
    </div>
  );
}
