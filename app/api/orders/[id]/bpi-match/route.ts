import { NextRequest, NextResponse } from "next/server";
import { lookupOrder, findByMatchKeys, attachedMatches } from "@/lib/bpi";
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
  try {
    const order = await getOrder(params.id);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const { match, candidates } = await lookupOrder(order);
    // READ ONLY. This used to write the computed match onto the order and
    // save it, which caused two problems: the suggestion arrived already
    // applied, so confirming a wrong one took a single click; and because
    // the pane polls every 8 seconds, a transaction Joey picked by hand was
    // overwritten by the next recomputed guess. Selection now happens only
    // through POST below, and with nothing to write there's no read-modify-
    // write to protect, so the money-route lock isn't needed here either.
    return NextResponse.json({
      order,
      suggestion: match,
      selected: attachedMatches(order),
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

    // The full selection, not a delta — an empty list clears it, which is
    // how Joey rejects a wrong suggestion.
    const body = (await request.json().catch(() => ({}))) as {
      matchKeys?: unknown;
      matchKey?: string;
    };
    const keys = Array.isArray(body.matchKeys)
      ? body.matchKeys.filter((k): k is string => typeof k === "string")
      : typeof body.matchKey === "string"
        ? [body.matchKey]
        : null;
    if (keys === null) {
      return NextResponse.json({ error: "matchKeys is required." }, { status: 400 });
    }
    if (keys.length > 10) {
      return NextResponse.json(
        { error: "That's more than 10 transactions for one order — check the selection." },
        { status: 400 }
      );
    }

    const unique = Array.from(new Set(keys));
    const { matches, rejected } = await findByMatchKeys(order, unique);
    if (rejected.length > 0) {
      return NextResponse.json(
        {
          error:
            rejected.length === unique.length
              ? "That transaction is no longer available — someone else may have just claimed it."
              : `${rejected.length} of the selected transactions are no longer available — refresh and pick again.`,
        },
        { status: 409 }
      );
    }

    order.payment.bpiMatches = matches;
    // Legacy field kept in step so anything still reading it (an old paid
    // order's invoice, say) sees the first selected transaction.
    order.payment.bpiMatch = matches[0];
    order.payment.noMatch = matches.length === 0;
    await saveOrder(order);
    return NextResponse.json({ order, selected: matches });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't apply that transaction." },
      { status: 502 }
    );
  } finally {
    await unlockOrder(params.id);
  }
}
