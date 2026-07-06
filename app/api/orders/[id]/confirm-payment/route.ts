import { NextRequest, NextResponse } from "next/server";
import { getCatalog, completeDraftAsPaid } from "@/lib/shopify";
import { priceItems, itemsText } from "@/lib/pricing";
import { paidConfirmationReply } from "@/lib/templates";
import { appendOrderHistory } from "@/lib/sheets";
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
  // Synchronous claim BEFORE any await — a double-submit can't mark paid twice.
  if (!tryLockOrder(params.id)) {
    return NextResponse.json(
      { error: "Already confirming this payment — try again in a moment." },
      { status: 409 }
    );
  }
  try {
    const order = getOrder(params.id);
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
            "No BPI email matched for this amount yet — verify manually or wait.",
        },
        { status: 409 }
      );
    }

    const { orderId } = await completeDraftAsPaid(order);
    const catalog = await getCatalog();
    const priced = priceItems(order.items, catalog);
    const items = itemsText(priced);

    order.shopifyOrderId = orderId;
    order.status = "paid";
    order.paidAt = new Date().toISOString();
    order.payment.confirmed = true;
    order.paidReply = paidConfirmationReply(items || "your order", order.total);
    saveOrder(order);

    // The order IS paid at this point (Shopify already completed the draft) —
    // a Sheets hiccup must not fail the request, only surface a warning.
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
      });
    } catch (err) {
      console.error("Order History append failed:", err);
      sheetWarning =
        "Order marked paid, but the row could not be written to the Order History sheet — add it manually.";
    }

    return NextResponse.json({ order, sheetWarning });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Payment confirm failed." },
      { status: 502 }
    );
  } finally {
    unlockOrder(params.id);
  }
}
