import { NextRequest, NextResponse } from "next/server";
import { tick, updateItems } from "@/lib/pipeline";
import { deleteOrder, getOrder, saveOrder, tryLockOrder, unlockOrder } from "@/lib/store";
import { deleteDraftOrder } from "@/lib/shopify";
import { deleteOrderHistory } from "@/lib/sheets";
import type { OrderItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_QTY = 10_000;

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  await tick();
  const order = await getOrder(params.id);
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
  const order = await getOrder(params.id);
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
    await saveOrder(updated);
  }
  return NextResponse.json({ order: updated });
}

/**
 * Permanently delete an order — Queue/Processed "Delete" action. Removes any
 * Shopify draft, any (rare — orders here are never-paid) Sheet history row,
 * then the order itself. Never allowed on a paid order: that's the
 * permanent record, and deleting it here would leave a completed Shopify
 * order with no trace in the app.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!(await tryLockOrder(params.id))) {
    return NextResponse.json(
      { error: "This order is mid-update — try again in a moment." },
      { status: 409 }
    );
  }
  try {
    const order = await getOrder(params.id);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.status === "paid") {
      return NextResponse.json(
        { error: "Paid orders are the permanent record — they can't be deleted here." },
        { status: 409 }
      );
    }

    if (order.shopifyDraftId) {
      try {
        await deleteDraftOrder(order.shopifyDraftId);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Couldn't remove the Shopify draft.";
        return NextResponse.json(
          { error: `${reason} — nothing was deleted, so try again (or remove the draft in Shopify Admin first).` },
          { status: 502 }
        );
      }
    }

    try {
      await deleteOrderHistory(order.id);
    } catch (err) {
      // Non-fatal: this only ever matters for an order that somehow already
      // had a history row, which shouldn't happen for anything reachable
      // from Queue/Processed. Proceed with the (authoritative) store delete.
      console.error("Sheet history delete failed:", err);
    }

    await deleteOrder(order.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed." },
      { status: 502 }
    );
  } finally {
    await unlockOrder(params.id);
  }
}
