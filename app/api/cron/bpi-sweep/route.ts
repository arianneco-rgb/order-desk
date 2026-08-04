import { NextRequest, NextResponse } from "next/server";
import { matchOrder } from "@/lib/bpi";
import { getOrder, listActiveOrders, saveOrder, tryLockOrder, unlockOrder } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Background sweep for orders sitting at "awaiting payment" with proof
 * uploaded but no match yet — the BPI email can take longer than Joey
 * stays on that one order, and PaymentPane's 5s poll only runs while that
 * specific order is selected in the UI. This covers the rest of the time.
 *
 * Triggered by Vercel Cron (see vercel.json); protected by CRON_SECRET so
 * it can't be hit from outside. Shares the same money-route lock as the
 * live bpi-match route so a sweep and a Joey-initiated check never race.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const orders = await listActiveOrders();
  const candidates = orders.filter(
    (o) =>
      o.status === "draft_created" &&
      !o.payment.confirmed &&
      !o.payment.bpiMatch &&
      (o.payment.proofs?.length ?? 0) > 0
  );

  let matched = 0;
  let failed = 0;
  for (const candidate of candidates) {
    if (!(await tryLockOrder(candidate.id))) continue; // Joey's own check is running — skip, next sweep picks it up
    try {
      const order = await getOrder(candidate.id);
      if (!order) continue;
      const match = await matchOrder(order);
      if (match) {
        order.payment.bpiMatch = match;
        order.payment.noMatch = false;
        await saveOrder(order);
        matched++;
      }
    } catch (err) {
      failed++;
      console.error(`bpi-sweep: order ${candidate.id} failed:`, err);
    } finally {
      await unlockOrder(candidate.id);
    }
  }

  return NextResponse.json({ checked: candidates.length, matched, failed });
}
