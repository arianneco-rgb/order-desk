import { NextRequest, NextResponse } from "next/server";
import { matchOrder } from "@/lib/bpi";
import { bpiMode } from "@/lib/config";
import { getOrder, saveOrder } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Search the BPI mailbox for a transfer matching this order
 * (amount + sender name/reference). Only ever SHOWS the match —
 * confirming is Joey's click on /confirm-payment.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const order = getOrder(params.id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const match = await matchOrder(order);
  order.payment.bpiMatch = match ?? undefined;
  order.payment.noMatch = !match;
  saveOrder(order);
  return NextResponse.json({
    order,
    match,
    simulated: bpiMode() === "simulated",
  });
}
