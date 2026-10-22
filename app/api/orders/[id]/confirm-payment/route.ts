import { NextRequest, NextResponse } from "next/server";
import { getCatalog, completeDraftAsPaid } from "@/lib/shopify";
import { priceItems, itemsText } from "@/lib/pricing";
import { paidConfirmationReply } from "@/lib/templates";
import { appendOrderHistory } from "@/lib/sheets";
import { blockingReason, paidSummary } from "@/lib/payments";
import { getOrder, saveOrder, tryLockOrder, unlockOrder } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Joey's "Confirm payment · mark paid" click.
 *
 * The evidence is the uploaded screenshots and the amount she put against
 * each one — Order Desk no longer cross-checks BPI transfer emails, so
 * there is nothing else to verify against. Every screenshot must be
 * priced and the total must cover the order, unless she explicitly ticks
 * the override (a cafe short-paying by withholding tax is routine).
 *
 * Marks the Shopify order paid, appends to the Order History sheet tab,
 * and reveals the paid-confirmation reply.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Claim BEFORE any other await — a double-submit can't mark paid twice.
  // In Supabase mode this is an atomic UPDATE ... WHERE locked_at IS NULL,
  // so the guarantee holds even across multiple serverless instances.
  if (!(await tryLockOrder(params.id))) {
    return NextResponse.json(
      { error: "Already confirming this payment — try again in a moment." },
      { status: 409 }
    );
  }
  try {
    const order = await getOrder(params.id);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.status !== "draft_created") {
      return NextResponse.json(
        { error: `Can't confirm payment from status “${order.status}”.` },
        { status: 409 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      manualOverride?: boolean;
    };
    // A missing screenshot is never overridable — it is the only record
    // that this order was paid at all. An unpriced or short one is, because
    // Joey can have a reason the app can't see.
    const proofs = order.payment.proofs ?? [];
    if (proofs.length === 0) {
      return NextResponse.json(
        {
          error:
            "Upload the payment screenshot first — it's the only record that this order was paid.",
        },
        { status: 409 }
      );
    }
    const blocked = blockingReason(order);
    if (blocked && !body.manualOverride) {
      return NextResponse.json({ error: blocked }, { status: 409 });
    }
    // Overriding is allowed, but it shouldn't be silent — if the order is
    // being marked paid for less than it's worth, say so on the way out so
    // the gap is visible now rather than at Wheng's recon.
    const summary = paidSummary(order);
    const paymentNote =
      blocked && body.manualOverride
        ? `Marked paid on your say-so: the screenshots total ₱${summary.paid.toLocaleString("en-PH")} against an order of ₱${order.total.toLocaleString("en-PH")}.`
        : undefined;

    // The catalog is only needed at the end (to render the items line on the
    // paid reply) and depends on nothing here, so start fetching it now and
    // collect it later. It used to run *after* the Shopify call, adding its
    // latency to a chain of external round trips that already had three.
    const catalogPromise = getCatalog();
    // Swallow here so a rejection can't surface as an unhandled rejection
    // while we're awaiting the Shopify call; the real await below rethrows.
    catalogPromise.catch(() => {});

    const { orderId } = await completeDraftAsPaid(order);
    const catalog = await catalogPromise;
    const priced = priceItems(order.items, catalog);
    const items = itemsText(priced);

    order.shopifyOrderId = orderId;
    order.status = "paid";
    order.paidAt = new Date().toISOString();
    order.payment.confirmed = true;
    order.paidReply = paidConfirmationReply(items || "your order", order.total);
    await saveOrder(order);

    // The order IS paid at this point (Shopify already completed the draft) —
    // a history hiccup must not fail the request, only surface a warning.
    // The Google Sheet row is mirrored in the background (never awaited).
    let sheetWarning: string | undefined;
    try {
      await appendOrderHistory({
        paidAt: order.paidAt,
        company: order.company,
        items,
        total: order.total,
        orderId: order.id,
        shopifyDraftName: order.shopifyDraftName,
        status: "paid",
        isTest: order.isTest,
      });
    } catch (err) {
      console.error("Order History append failed:", err);
      sheetWarning =
        "Order marked paid, but recording it to History failed — add the row manually.";
    }

    return NextResponse.json({ order, sheetWarning, paymentNote });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Payment confirm failed." },
      { status: 502 }
    );
  } finally {
    await unlockOrder(params.id);
  }
}
