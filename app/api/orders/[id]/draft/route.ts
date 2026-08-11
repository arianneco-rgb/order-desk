import { NextRequest, NextResponse } from "next/server";
import { getCatalog, buildDraftLineItems, createDraftOrder } from "@/lib/shopify";
import { priceItems } from "@/lib/pricing";
import { getOrder, recordSampleCredit, saveOrder, tryLockOrder, unlockOrder } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Joey's "Confirm · create draft" click → a Shopify draft order. */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Claim BEFORE any other await — a double-submit can't create two drafts.
  // In Supabase mode this is an atomic UPDATE ... WHERE locked_at IS NULL,
  // so the guarantee holds even across multiple serverless instances.
  if (!(await tryLockOrder(params.id))) {
    return NextResponse.json(
      { error: "Already working on this order — try again in a moment." },
      { status: 409 }
    );
  }
  try {
    // The catalog is needed to price the lines, and it doesn't depend on the
    // order — so fetch it alongside the order lookup rather than after it.
    // (It can't move past createDraftOrder here: the line items are built
    // from it. That's a real dependency, unlike in confirm-payment.)
    const catalogPromise = getCatalog();
    catalogPromise.catch(() => {}); // real await below rethrows

    const order = await getOrder(params.id);
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

    const catalog = await catalogPromise;
    const priced = priceItems(order.items, catalog);
    const lineItems = buildDraftLineItems(priced, catalog);
    const draft = await createDraftOrder(order, lineItems);

    order.shopifyDraftId = draft.draftId;
    order.shopifyDraftName = draft.draftName;
    order.shopifyDraftUrl = draft.draftUrl;
    order.draftCreatedAt = new Date().toISOString();
    order.status = "draft_created";
    await saveOrder(order);

    // The draft now carries this credit — record it so the auto-suggest
    // never offers the same pesos twice. Sample credits are identified by
    // the discount title the suggest button sets. Test orders are excluded:
    // their fake drafts must not consume the cafe's real credit.
    const md = order.options.manualDiscount;
    if (
      !order.isTest &&
      order.customerId &&
      md &&
      md.valueType === "FIXED_AMOUNT" &&
      md.value > 0 &&
      md.title.toLowerCase().startsWith("sample credit")
    ) {
      try {
        await recordSampleCredit({
          orderId: order.id,
          customerId: order.customerId,
          amount: md.value,
        });
      } catch (err) {
        console.error("Sample credit record failed (suggest may re-offer):", err);
      }
    }

    return NextResponse.json({ order });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Draft creation failed." },
      { status: 502 }
    );
  } finally {
    await unlockOrder(params.id);
  }
}
