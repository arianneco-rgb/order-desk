import { NextRequest, NextResponse } from "next/server";
import { lookupOrder, findByMatchKey } from "@/lib/bpi";
import { bpiMode } from "@/lib/config";
import { getOrder, saveOrder, tryLockOrder, unlockOrder } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Check the BPI Transactions log for a transfer matching this order
 * (amount + reference — real BPI emails carry no payer name at all, see
 * lib/bpi.ts). Only ever SHOWS the match; confirming is Joey's click on
 * /confirm-payment, which is also the only place a transaction actually
 * gets claimed (see claimTransaction in lib/bpi.ts) — so the same
 * transaction can still be shown as a candidate to two same-amount orders
 * here without either being locked out.
 *
 * Shares the money-route lock even though this route only ever SHOWS a
 * match — it still does a read-modify-write of the whole order
 * (payment.bpiMatch/noMatch). Without the lock, a check that's mid-flight
 * when Joey clicks Confirm payment can finish afterward and save its now-
 * stale copy of the order right over the top, silently reverting a just-
 * paid order back to "draft_created" in the live store — while
 * History/Shopify still correctly show it paid. Caught 2026-07-23: exactly
 * this happened to a real order (Wahunomi, #D3614).
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

    const { match, candidates } = await lookupOrder(order);
    order.payment.bpiMatch = match ?? undefined;
    order.payment.noMatch = !match;
    await saveOrder(order);
    return NextResponse.json({
      order,
      match,
      candidates,
      // Test orders always match the simulated log (see lib/bpi.ts),
      // regardless of the global BPI mode.
      simulated: order.isTest || bpiMode() === "simulated",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't check the BPI transaction log." },
      { status: 502 }
    );
  } finally {
    await unlockOrder(params.id);
  }
}

/** Joey manually picking a candidate transaction from the list (same-amount collision, or a PESONet transfer with no auto-match signal). */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!(await tryLockOrder(params.id))) {
    return NextResponse.json({ error: "busy", locked: true }, { status: 409 });
  }
  try {
    const order = await getOrder(params.id);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as { matchKey?: string };
    if (!body.matchKey) {
      return NextResponse.json({ error: "matchKey is required." }, { status: 400 });
    }

    const match = await findByMatchKey(order, body.matchKey);
    if (!match) {
      return NextResponse.json(
        { error: "That transaction is no longer available — someone else may have just claimed it." },
        { status: 409 }
      );
    }
    order.payment.bpiMatch = match;
    order.payment.noMatch = false;
    await saveOrder(order);
    return NextResponse.json({ order, match });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't apply that transaction." },
      { status: 502 }
    );
  } finally {
    await unlockOrder(params.id);
  }
}
