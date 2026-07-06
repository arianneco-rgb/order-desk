import { NextRequest, NextResponse } from "next/server";
import { getCatalog, buildDraftLineItems, createDraftOrder } from "@/lib/shopify";
import { priceItems } from "@/lib/pricing";
import { getOrder, saveOrder, tryLockOrder, unlockOrder } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Joey's "Confirm · create draft" click → a Shopify draft order. */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Synchronous claim BEFORE any await — a double-submit can't create two drafts.
  if (!tryLockOrder(params.id)) {
    return NextResponse.json(
      { error: "Already working on this order — try again in a moment." },
      { status: 409 }
    );
  }
  try {
    const order = getOrder(params.id);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.status !== "processed") {
      return NextResponse.json(
        { error: `Can't create a draft from status “${order.status}”.` },
        { status: 409 }
      );
    }
    if (order.items.length === 0) {
      return NextResponse.json(
        { error: "Add at least one line item before creating a draft." },
        { status: 400 }
      );
    }

    const catalog = await getCatalog();
    const priced = priceItems(order.items, catalog);
    const lineItems = buildDraftLineItems(priced, catalog);
    const draft = await createDraftOrder(order, lineItems);

    order.shopifyDraftId = draft.draftId;
    order.shopifyDraftName = draft.draftName;
    order.shopifyDraftUrl = draft.draftUrl;
    order.draftCreatedAt = new Date().toISOString();
    order.status = "draft_created";
    saveOrder(order);
    return NextResponse.json({ order });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Draft creation failed." },
      { status: 502 }
    );
  } finally {
    unlockOrder(params.id);
  }
}
