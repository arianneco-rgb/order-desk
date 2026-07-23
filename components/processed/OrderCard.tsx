"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { CatalogProduct, Order } from "@/lib/types";
import { formatPeso, formatPouchQty, formatSampleQty } from "@/lib/conversions";
import { priceItems, itemsText } from "@/lib/pricing";
import { totalOrderReply } from "@/lib/templates";
import { CopyButton } from "@/components/CopyButton";
import { StatusPill } from "@/components/StatusPill";
import { TestBadge } from "@/components/TestBadge";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { DELIVERY_METHODS } from "@/lib/delivery";
import { DraftOptionsPanel } from "./DraftOptionsPanel";
import { LineItemEditor } from "./LineItemEditor";
import {
  formatTime,
  lineAmount,
  titleFor,
  variantBreakdown,
  type TitleMap,
} from "./format";

/** Subtotal → discounts → VAT → delivery → total; plain Total when nothing extra. */
function TotalsBreakdown({ order }: { order: Order }) {
  const t = order.totals;
  const interesting = t && (t.discounts > 0 || t.vat > 0 || t.shipping > 0);
  return (
    <div className="mt-2 space-y-0.5">
      {interesting && (
        <>
          <div className="flex items-baseline justify-between gap-3 text-sm text-forest-700">
            <span>Subtotal</span>
            <span>{formatPeso(t.subtotal)}</span>
          </div>
          {t.discounts > 0 && (
            <div className="flex items-baseline justify-between gap-3 text-sm text-forest-700">
              <span>
                Discounts
                {order.options.manualDiscount ? ` · ${order.options.manualDiscount.title}` : ""}
                {order.options.freeSamples ? " · free samples" : ""}
              </span>
              <span>−{formatPeso(t.discounts)}</span>
            </div>
          )}
          {t.vat > 0 && (
            <div className="flex items-baseline justify-between gap-3 text-sm text-forest-700">
              <span>VAT (12%)</span>
              <span>+{formatPeso(t.vat)}</span>
            </div>
          )}
          {t.shipping > 0 && (
            <div className="flex items-baseline justify-between gap-3 text-sm text-forest-700">
              <span>
                Delivery
                {order.options.deliveryMethod
                  ? ` · ${DELIVERY_METHODS[order.options.deliveryMethod].label}`
                  : ""}
              </span>
              <span>+{formatPeso(t.shipping)}</span>
            </div>
          )}
        </>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-forest-900">
          Total <span className="font-normal text-forest-500">(Shopify prices)</span>
        </span>
        <span className="text-base font-bold text-forest-900">
          {formatPeso(order.total)}
        </span>
      </div>
    </div>
  );
}

/**
 * One processed order, self-contained (mockup layout): line items with
 * per-line amounts → draft options (discounts/VAT/delivery) → total from
 * Shopify prices → the "Reply to send" block with Copy → Edit lines +
 * Confirm · create draft.
 */
export function OrderCard({
  order,
  catalog,
  titles,
  selected,
  onSelect,
  onOrderUpdate,
  onOrderDeleted,
}: {
  order: Order;
  catalog: CatalogProduct[];
  titles: TitleMap;
  selected: boolean;
  onSelect: (id: string) => void;
  onOrderUpdate: (order: Order) => void;
  /** Called after the order is confirmed deleted, so the parent list can drop it immediately. */
  onOrderDeleted?: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const toast = useToast();

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

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Delete failed (HTTP ${res.status}).`);
      setDeleteOpen(false);
      toast(`Deleted ${order.company}'s order.`, "success");
      onOrderDeleted?.(order.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't delete this order.";
      setDeleteError(message);
      toast(message, "error");
    } finally {
      setDeleting(false);
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
          <div className="flex items-center gap-1.5">
            {order.isTest && <TestBadge />}
            <StatusPill order={order} />
          </div>
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
                title={
                  order.isTest
                    ? "Test mode — no real draft was created in Shopify"
                    : "Mock draft — connect a Shopify Admin token for a real link"
                }
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

      {/* Soft notes: routine reads/conversions — informational, not a flag */}
      {order.softNotes && order.softNotes.length > 0 && (
        <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-forest-500">
          {order.softNotes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
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

      {/* Draft options: discounts / VAT / delivery / free samples */}
      <DraftOptionsPanel order={order} onOrderUpdate={onOrderUpdate} />

      {/* Total (with breakdown when discounts/VAT/delivery are in play) */}
      <TotalsBreakdown order={order} />

      {/* Reply to send — regenerated from the CURRENT template + total so the
          section spacing is always right, even on orders whose stored reply
          predates the formatting fix. Falls back to the stored reply until
          the catalog has loaded (needed to describe the line items). */}
      {(() => {
        const reply =
          catalog.length && order.items.length
            ? totalOrderReply(
                order.total,
                itemsText(priceItems(order.items, catalog)) || "your order"
              )
            : order.reply;
        return (
          <div
            className="mt-3 rounded-lg border border-forest-100 bg-forest-50 p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-forest-800">Reply to send</p>
              <CopyButton text={reply} label="Copy" toastLabel="Reply copied" />
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-forest-900">
              {reply}
            </p>
          </div>
        );
      })()}

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
        {order.shopifyDraftId && (
          <Link
            href={`/invoice/${order.id}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="rounded-md border border-forest-300 bg-white px-3 py-1.5 text-sm font-semibold text-forest-800 transition-colors hover:bg-forest-50"
          >
            Generate invoice
          </Link>
        )}
        <button
          type="button"
          onClick={() => {
            setDeleteError(null);
            setDeleteOpen(true);
          }}
          className="ml-auto rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
        >
          Delete
        </button>
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

          <TotalsBreakdown order={order} />

          {/* What else lands on the draft */}
          <ul className="mt-2 space-y-0.5 text-xs text-forest-600">
            {order.options.applyEligibleDiscounts && (
              <li>· Shopify will apply this cafe&apos;s eligible automatic discounts.</li>
            )}
            {order.options.deliveryMethod && (
              <li>
                · Shipping line: {DELIVERY_METHODS[order.options.deliveryMethod].label} (
                {formatPeso(order.options.deliveryFee ?? 0)}) — tagged for packing.
              </li>
            )}
            {order.options.chargeVat && <li>· VAT (12%) added as Shopify tax on the draft.</li>}
            {order.options.freeSamples && <li>· Sample lines carry a 100% discount.</li>}
          </ul>

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

        <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete this order?">
          <p className="text-sm text-forest-700">
            This permanently deletes{" "}
            <span className="font-semibold text-forest-900">{order.company}</span>&apos;s order
            from Order Desk
            {order.shopifyDraftId && !order.shopifyDraftId.startsWith("mock:")
              ? `, removes its Shopify draft${order.shopifyDraftName ? ` (${order.shopifyDraftName})` : ""},`
              : ","}{" "}
            and clears any Sheet record. This can&apos;t be undone.
          </p>
          {deleteError && <p className="mt-3 text-sm text-red-600">{deleteError}</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
              className="rounded-md border border-forest-300 bg-white px-3 py-1.5 text-sm font-semibold text-forest-800 transition-colors hover:bg-forest-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              disabled={deleting}
              className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete permanently"}
            </button>
          </div>
        </Modal>
      </div>
    </div>
  );
}
