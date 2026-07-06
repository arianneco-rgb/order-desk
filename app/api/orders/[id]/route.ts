import { NextRequest, NextResponse } from "next/server";
import { tick, updateItems } from "@/lib/pipeline";
import { getOrder, saveOrder } from "@/lib/store";
import type { OrderItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_QTY = 10_000;

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  await tick();
  const order = getOrder(params.id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json({ order });
}

/**
 * Edit line items (Joey's review) — total and reply update live.
 * Editing an order that already has a Shopify draft invalidates that draft:
 * the draft fields are cleared and status regresses to `processed`, so the
 * draft in Shopify can never silently diverge from the app's total.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const order = getOrder(params.id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.status !== "processed" && order.status !== "draft_created") {
    return NextResponse.json(
      { error: `Orders in status “${order.status}” can't be edited.` },
      { status: 409 }
    );
  }
  const body = (await request.json().catch(() => ({}))) as { items?: OrderItem[] };
  if (!Array.isArray(body.items) || body.items.length > 50) {
    return NextResponse.json({ error: "items[] required" }, { status: 400 });
  }
  for (const item of body.items) {
    if (
      typeof item.productKey !== "string" ||
      (item.form !== "pouch" && item.form !== "sample") ||
      typeof item.qty !== "number" ||
      !Number.isFinite(item.qty) ||
      item.qty < 0 ||
      item.qty > MAX_QTY
    ) {
      return NextResponse.json({ error: "Invalid line item." }, { status: 400 });
    }
  }

  const staleDraftName = order.status === "draft_created" ? order.shopifyDraftName : null;
  if (order.status === "draft_created") {
    order.shopifyDraftId = undefined;
    order.shopifyDraftName = undefined;
    order.shopifyDraftUrl = undefined;
    order.draftCreatedAt = undefined;
    order.status = "processed";
  }

  const updated = await updateItems(order, body.items);
  if (staleDraftName) {
    updated.reviewReasons.push(
      `Lines changed after draft ${staleDraftName} was created — that draft is stale. Create a new one (and delete the old draft in Shopify).`
    );
    updated.needsReview = true;
    saveOrder(updated);
  }
  return NextResponse.json({ order: updated });
}
