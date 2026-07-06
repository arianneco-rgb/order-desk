import { NextRequest, NextResponse } from "next/server";
import { tick } from "@/lib/pipeline";
import { createOrder, listOrders } from "@/lib/store";

export const dynamic = "force-dynamic";

/** List all orders. Every read also advances queued/processing orders. */
export async function GET() {
  await tick();
  return NextResponse.json({ orders: listOrders() });
}

/** Intake: cafe + pasted message → a queued order. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    company?: string;
    customerId?: string;
    rawMessage?: string;
  };
  const company = body.company?.trim();
  const rawMessage = body.rawMessage?.trim();
  if (!company || !rawMessage) {
    return NextResponse.json(
      { error: "Pick a cafe and paste a message first." },
      { status: 400 }
    );
  }
  if (company.length > 120 || rawMessage.length > 4000) {
    return NextResponse.json(
      { error: "Message too long — paste one order at a time (max 4000 characters)." },
      { status: 400 }
    );
  }
  // Only accept Shopify customer GIDs (or snapshot-mode mock ids).
  const customerId =
    body.customerId?.startsWith("gid://shopify/Customer/") ||
    body.customerId?.startsWith("mock:")
      ? body.customerId
      : undefined;
  const order = createOrder({
    company,
    customerId,
    rawMessage,
  });
  return NextResponse.json({ order }, { status: 201 });
}
