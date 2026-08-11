import { NextRequest, NextResponse } from "next/server";
import { getCatalog, completeDraftAsPaid } from "@/lib/shopify";
import { priceItems, itemsText } from "@/lib/pricing";
import { paidConfirmationReply } from "@/lib/templates";
import { appendOrderHistory } from "@/lib/sheets";
import { claimTransaction } from "@/lib/bpi";
import { getOrder, saveOrder, tryLockOrder, unlockOrder } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Joey's "Confirm payment · mark paid" click. Requires a BPI match — or an
 * explicit manual override when he has verified the transfer himself.
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
    if (!order.payment.bpiMatch && !body.manualOverride) {
      return NextResponse.json(
        {
          error:
            "No BPI transaction matched for this amount yet — verify manually or wait.",
        },
        { status: 409 }
      );
    }

    // The catalog is only needed at the end (to render the items line on the
    // paid reply) and depends on nothing here, so start fetching it now and
    // collect it later. It used to run *after* the Shopify call, adding its
    // latency to a chain of external round trips that already had three.
    const catalogPromise = getCatalog();
    // Swallow here so a rejection can't surface as an unhandled rejection
    // while we're awaiting the Shopify call; the real await below rethrows.
    catalogPromise.catch(() => {});

    // Claim the transaction row NOW, before touching Shopify — this is the
    // actual dedupe that stops the same payment being applied to two
    // different orders (a candidate can be shown to several same-amount
    // orders at preview time; only one can win the claim here). This must
    // stay sequential: claiming after Shopify would let a double-submit mark
    // two orders paid against one transfer.
    if (order.payment.bpiMatch) {
      const claim = await claimTransaction(order, order.payment.bpiMatch.matchKey);
      if (!claim.ok) {
        return NextResponse.json({ error: claim.error }, { status: 409 });
      }
    }

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

    return NextResponse.json({ order, sheetWarning });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Payment confirm failed." },
      { status: 502 }
    );
  } finally {
    await unlockOrder(params.id);
  }
}
