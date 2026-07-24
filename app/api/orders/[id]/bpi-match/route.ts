import { NextRequest, NextResponse } from "next/server";
import { matchOrder } from "@/lib/bpi";
import { bpiMode } from "@/lib/config";
import { getOrder, saveOrder, tryLockOrder, unlockOrder } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Search the BPI mailbox for a transfer matching this order
 * (amount + sender name/reference). Only ever SHOWS the match —
 * confirming is Joey's click on /confirm-payment.
 *
 * Shares the money-route lock even though this route only ever SHOWS a
 * match — it still does a read-modify-write of the whole order
 * (payment.bpiMatch/noMatch). Without the lock, a live BPI check that's
 * mid-flight (Gmail search takes ~2-3s) when Joey clicks Confirm payment
 * can finish afterward and save its now-stale copy of the order right
 * over the top, silently reverting a just-paid order back to
 * "draft_created" in the live store — while History/Shopify still
 * correctly show it paid. Caught 2026-07-23: exactly this happened to a
 * real order (Wahunomi, #D3614).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!(await tryLockOrder(params.id))) {
    // Another money-route action (confirm-payment, a draft/options edit,
    // or an overlapping check) is in flight — benign, the next poll retries.
    return NextResponse.json({ error: "busy", locked: true }, { status: 409 });
  }
  try {
    const order = await getOrder(params.id);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const match = await matchOrder(order);
    order.payment.bpiMatch = match ?? undefined;
    order.payment.noMatch = !match;
    await saveOrder(order);
    return NextResponse.json({
      order,
      match,
      // Test orders always match the simulated inbox (see lib/bpi.ts),
      // regardless of the global BPI mode.
      simulated: order.isTest || bpiMode() === "simulated",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't check the BPI inbox." },
      { status: 502 }
    );
  } finally {
    await unlockOrder(params.id);
  }
}
