import { NextRequest, NextResponse } from "next/server";
import { getPaidSampleTotal } from "@/lib/shopify";
import { usedSampleCredit } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Sample-credit suggestion for a cafe: ₱ actually paid for samples across
 * their Shopify orders, minus credits already applied through this app.
 * Powers the one-click "Apply ₱X sample credit" chip — a SUGGESTION; Joey
 * still confirms, and the amount stays editable.
 */
export async function GET(request: NextRequest) {
  const customerId = request.nextUrl.searchParams.get("customerId") ?? "";
  if (!customerId) {
    return NextResponse.json({ error: "customerId required" }, { status: 400 });
  }
  try {
    const [paid, used] = await Promise.all([
      getPaidSampleTotal(customerId),
      usedSampleCredit(customerId),
    ]);
    const available = Math.max(0, Math.round((paid - used) * 100) / 100);
    return NextResponse.json({ paid, used, available });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't compute sample credit." },
      { status: 502 }
    );
  }
}
