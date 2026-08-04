import { NextRequest, NextResponse } from "next/server";
import { tick } from "@/lib/pipeline";
import { createOrder } from "@/lib/store";
import { withLightProofRefs } from "@/lib/proof-refs";

export const dynamic = "force-dynamic";

/**
 * List active (not-yet-paid) orders. Every read also advances
 * queued/processing orders — tick() does one DB fetch and returns the same
 * (now up-to-date) list, so this never re-fetches on top of it.
 */
export async function GET() {
  return NextResponse.json({ orders: withLightProofRefs(await tick()) });
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
  // Generous cap — whole conversations are fine, the parser skips the noise.
  if (company.length > 120 || rawMessage.length > 12_000) {
    return NextResponse.json(
      { error: "Message too long — paste one cafe's conversation at a time (max 12,000 characters)." },
      { status: 400 }
    );
  }
  // Only accept Shopify customer GIDs (or snapshot-mode mock ids).
  const customerId =
    body.customerId?.startsWith("gid://shopify/Customer/") ||
    body.customerId?.startsWith("mock:")
      ? body.customerId
      : undefined;
  const order = await createOrder({
    company,
    customerId,
    rawMessage,
  });
  return NextResponse.json({ order }, { status: 201 });
}
