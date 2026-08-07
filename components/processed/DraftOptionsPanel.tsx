"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import type { DeliveryMethod, Order } from "@/lib/types";
import { DELIVERY_METHODS, defaultDeliveryFee } from "@/lib/delivery";
import { formatPeso } from "@/lib/conversions";

/** Title the server auto-applies this discount under — see lib/pipeline.ts. */
const AUTO_SAMPLE_CREDIT_TITLE = "Sample credit";

/**
 * Joey's pre-draft choices (team-requested): eligible-discounts toggle,
 * manual discount, VAT tickbox, delivery method + fee, free samples. Every
 * change reprices the order live — the reply's total always matches what
 * the draft will say. Defaults come from the Shopify profile.
 *
 * The sample credit itself is NOT a button here — it's a business rule the
 * server applies automatically (only on a cafe's first case-sized order
 * after a sample, see lib/pipeline.ts applySampleCreditAutomation), so it
 * only ever shows as an informational line, never something to click.
 */
export function DraftOptionsPanel({
  order,
  onOrderUpdate,
}: {
  order: Order;
  onOrderUpdate: (order: Order) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual-discount form (committed via Apply, not per keystroke).
  const [discountType, setDiscountType] = useState<"FIXED_AMOUNT" | "PERCENTAGE">("FIXED_AMOUNT");
  const [discountValue, setDiscountValue] = useState("");
  const [discountTitle, setDiscountTitle] = useState("");
  const [feeDraft, setFeeDraft] = useState("");

  const opts = order.options;
  const hasSamples = order.items.some((i) => i.form === "sample");
  const editable = order.status === "processed" || order.status === "draft_created";
  const isAutoSampleCredit = opts.manualDiscount?.title === AUTO_SAMPLE_CREDIT_TITLE;

  useEffect(() => {
    setFeeDraft(opts.deliveryFee !== undefined ? String(opts.deliveryFee) : "");
  }, [order.id, opts.deliveryFee]);

  async function patch(change: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/options`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onOrderUpdate(data.order);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the options.");
    } finally {
      setBusy(false);
    }
  }

  function applyManualDiscount() {
    const value = Number(discountValue);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a discount amount first.");
      return;
    }
    void patch({
      manualDiscount: {
        valueType: discountType,
        value,
        title: discountTitle.trim() || "Discount",
      },
    });
  }

  if (!editable) return null;

  const checkboxClass = "h-4 w-4 rounded border-forest-300 accent-forest-700";
  const smallInput =
    "rounded-md border border-forest-200 px-2 py-1 text-sm text-forest-900 placeholder:text-forest-300 focus:border-forest-600 focus:outline-none";

  return (
    <div
      className={clsx("mt-3 rounded-lg border border-forest-100 bg-forest-50/60 p-3", busy && "opacity-60")}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-forest-500">
        Draft options{" "}
        <span className="normal-case font-normal">(defaults from the Shopify profile — override freely)</span>
      </p>

      <div className="mt-2 space-y-2 text-sm text-forest-900">
        {/* Eligible Shopify discounts */}
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className={clsx(checkboxClass, "mt-0.5")}
            checked={opts.applyEligibleDiscounts}
            disabled={busy}
            onChange={(e) => void patch({ applyEligibleDiscounts: e.target.checked })}
          />
          <span>
            Apply this cafe&apos;s eligible Shopify discounts{" "}
            <span className="text-forest-500">(automatic, e.g. customer-specific)</span>
          </span>
        </label>

        {/* VAT */}
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className={clsx(checkboxClass, "mt-0.5")}
            checked={opts.chargeVat}
            disabled={busy}
            onChange={(e) => void patch({ chargeVat: e.target.checked })}
          />
          <span>
            Charge VAT (12%) <span className="text-forest-500">— invoice requested</span>
          </span>
        </label>

        {/* Free samples */}
        {hasSamples && (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className={clsx(checkboxClass, "mt-0.5")}
              checked={opts.freeSamples}
              disabled={busy}
              onChange={(e) => void patch({ freeSamples: e.target.checked })}
            />
            <span>
              Free samples{" "}
              <span className="text-forest-500">(samples stay on the draft, charged ₱0)</span>
            </span>
          </label>
        )}

        {/* Delivery */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-forest-700">Delivery:</span>
          <select
            value={opts.deliveryMethod ?? ""}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value === "") {
                void patch({ deliveryMethod: null });
                return;
              }
              const method = e.target.value as DeliveryMethod;
              // Pre-fill the method's own default fee (₱200 for Metro Manila,
              // ₱0 for the rest) — but never overwrite a fee Joey already
              // typed for this order.
              const fee = defaultDeliveryFee(method);
              void patch(
                opts.deliveryFee === undefined && fee > 0
                  ? { deliveryMethod: method, deliveryFee: fee }
                  : { deliveryMethod: method }
              );
            }}
            className={smallInput}
          >
            <option value="">— choose —</option>
            {(Object.keys(DELIVERY_METHODS) as DeliveryMethod[]).map((key) => (
              <option key={key} value={key}>
                {DELIVERY_METHODS[key].label}
              </option>
            ))}
          </select>
          {opts.deliveryMethod && (
            <label className="flex items-center gap-1 text-forest-700">
              fee ₱
              <input
                type="number"
                min={0}
                value={feeDraft}
                disabled={busy}
                onChange={(e) => setFeeDraft(e.target.value)}
                onBlur={() => {
                  const fee = feeDraft === "" ? null : Number(feeDraft);
                  if (fee !== (opts.deliveryFee ?? null)) void patch({ deliveryFee: fee });
                }}
                placeholder="0"
                className={clsx(smallInput, "w-24")}
              />
            </label>
          )}
        </div>

        {/* Manual discount / auto sample credit */}
        {opts.manualDiscount ? (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={clsx(
                "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                isAutoSampleCredit ? "bg-amber-100 text-amber-900" : "bg-forest-200 text-forest-900"
              )}
            >
              {opts.manualDiscount.title}:{" "}
              {opts.manualDiscount.valueType === "PERCENTAGE"
                ? `${opts.manualDiscount.value}% off`
                : `−${formatPeso(opts.manualDiscount.value)}`}
            </span>
            {isAutoSampleCredit ? (
              <span className="text-xs text-forest-500">
                Applied automatically — this cafe&apos;s first case-sized order after a
                sample. Drops off on its own if no single line has a full case.
              </span>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void patch({ manualDiscount: null })}
                className="text-xs font-semibold text-forest-600 hover:text-forest-900 hover:underline"
              >
                Remove
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-forest-700">Discount:</span>
            <select
              value={discountType}
              disabled={busy}
              onChange={(e) => setDiscountType(e.target.value as "FIXED_AMOUNT" | "PERCENTAGE")}
              className={smallInput}
            >
              <option value="FIXED_AMOUNT">₱</option>
              <option value="PERCENTAGE">%</option>
            </select>
            <input
              type="number"
              min={0}
              value={discountValue}
              disabled={busy}
              onChange={(e) => setDiscountValue(e.target.value)}
              placeholder="0"
              className={clsx(smallInput, "w-24")}
            />
            <input
              type="text"
              value={discountTitle}
              disabled={busy}
              onChange={(e) => setDiscountTitle(e.target.value)}
              placeholder="Label (e.g. Loyalty discount)"
              className={clsx(smallInput, "w-44")}
            />
            <button
              type="button"
              disabled={busy}
              onClick={applyManualDiscount}
              className="rounded-md border border-forest-300 bg-white px-2.5 py-1 text-xs font-semibold text-forest-800 hover:bg-forest-100"
            >
              Apply
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{error}</p>
      )}
      {order.status === "draft_created" && (
        <p className="mt-2 text-xs text-amber-800">
          Changing options now invalidates the created draft (same as editing lines).
        </p>
      )}
    </div>
  );
}
