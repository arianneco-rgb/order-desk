import { NextRequest, NextResponse } from "next/server";
import { repriceOrder } from "@/lib/pipeline";
import { DELIVERY_METHODS } from "@/lib/delivery";
import { getOrder, saveOrder, tryLockOrder, unlockOrder } from "@/lib/store";
import type { DeliveryMethod, DraftOptions, ManualDiscount } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_FEE = 100_000;
const MAX_DISCOUNT_TITLE = 80;

function parseManualDiscount(raw: unknown): ManualDiscount | null | "invalid" {
  if (raw === null) return null; // explicit clear
  if (typeof raw !== "object" || raw === undefined) return "invalid";
  const d = raw as Partial<ManualDiscount>;
  if (d.valueType !== "FIXED_AMOUNT" && d.valueType !== "PERCENTAGE") return "invalid";
  if (typeof d.value !== "number" || !Number.isFinite(d.value) || d.value < 0) return "invalid";
  if (d.valueType === "PERCENTAGE" && d.value > 100) return "invalid";
  if (d.valueType === "FIXED_AMOUNT" && d.value > 10_000_000) return "invalid";
  if (typeof d.title !== "string" || d.title.length > MAX_DISCOUNT_TITLE) return "invalid";
  return { valueType: d.valueType, value: d.value, title: d.title.trim() || "Discount" };
}

/**
 * Joey's draft options (discounts / VAT / delivery / free samples).
 * Changing them reprices the order live (Shopify-calculated in live mode)
 * and — like editing line items — invalidates an already-created draft so
 * it can never silently diverge from what the cafe was quoted.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Shares the money-route lock: an options change can't interleave with an
  // in-flight draft creation / payment confirm and silently diverge from it.
  if (!(await tryLockOrder(params.id))) {
    return NextResponse.json(
      { error: "Already working on this order — try again in a moment." },
      { status: 409 }
    );
  }
  try {
    return await patchOptions(request, params.id);
  } finally {
    await unlockOrder(params.id);
  }
}

async function patchOptions(request: NextRequest, id: string) {
  const order = await getOrder(id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.status !== "processed" && order.status !== "draft_created") {
    return NextResponse.json(
      { error: `Orders in status “${order.status}” can't be edited.` },
      { status: 409 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as Partial<
    Record<keyof DraftOptions, unknown>
  >;
  const next = { ...order.options };

  if ("applyEligibleDiscounts" in body) {
    if (typeof body.applyEligibleDiscounts !== "boolean") {
      return NextResponse.json({ error: "applyEligibleDiscounts must be a boolean." }, { status: 400 });
    }
    next.applyEligibleDiscounts = body.applyEligibleDiscounts;
  }
  if ("chargeVat" in body) {
    if (typeof body.chargeVat !== "boolean") {
      return NextResponse.json({ error: "chargeVat must be a boolean." }, { status: 400 });
    }
    next.chargeVat = body.chargeVat;
  }
  if ("freeSamples" in body) {
    if (typeof body.freeSamples !== "boolean") {
      return NextResponse.json({ error: "freeSamples must be a boolean." }, { status: 400 });
    }
    next.freeSamples = body.freeSamples;
  }
  if ("deliveryMethod" in body) {
    if (body.deliveryMethod === null) {
      next.deliveryMethod = undefined;
    } else if (
      typeof body.deliveryMethod === "string" &&
      body.deliveryMethod in DELIVERY_METHODS
    ) {
      next.deliveryMethod = body.deliveryMethod as DeliveryMethod;
    } else {
      return NextResponse.json({ error: "Unknown delivery method." }, { status: 400 });
    }
  }
  if ("deliveryFee" in body) {
    const fee = body.deliveryFee;
    if (fee === null) {
      next.deliveryFee = undefined;
    } else if (typeof fee === "number" && Number.isFinite(fee) && fee >= 0 && fee <= MAX_FEE) {
      next.deliveryFee = Math.round(fee * 100) / 100;
    } else {
      return NextResponse.json({ error: `Delivery fee must be ₱0–₱${MAX_FEE.toLocaleString()}.` }, { status: 400 });
    }
  }
  if ("manualDiscount" in body) {
    const parsed = parseManualDiscount(body.manualDiscount);
    if (parsed === "invalid") {
      return NextResponse.json({ error: "Invalid discount." }, { status: 400 });
    }
    next.manualDiscount = parsed ?? undefined;
  }

  order.options = next;

  // Same rule as editing line items: an existing draft becomes stale.
  const staleDraftName = order.status === "draft_created" ? order.shopifyDraftName : null;
  if (order.status === "draft_created") {
    order.shopifyDraftId = undefined;
    order.shopifyDraftName = undefined;
    order.shopifyDraftUrl = undefined;
    order.draftCreatedAt = undefined;
    order.status = "processed";
  }

  const updated = await repriceOrder(order, []);
  if (staleDraftName) {
    updated.reviewReasons.push(
      `Options changed after draft ${staleDraftName} was created — that draft is stale. Create a new one (and delete the old draft in Shopify).`
    );
    updated.needsReview = true;
    await saveOrder(updated);
  }
  return NextResponse.json({ order: updated });
}
