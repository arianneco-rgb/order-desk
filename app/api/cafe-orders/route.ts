import { NextRequest, NextResponse } from "next/server";
import { getCustomerPastOrders } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/**
 * The Paste page's past-orders panel: a cafe's real Shopify order history
 * (?customerId=gid://shopify/Customer/…&company=Cafe Name — company is the
 * snapshot-mode fallback filter).
 */
export async function GET(request: NextRequest) {
  const customerId = request.nextUrl.searchParams.get("customerId") ?? "";
  const company = request.nextUrl.searchParams.get("company") ?? "";
  if (!customerId && !company) {
    return NextResponse.json({ error: "customerId or company required" }, { status: 400 });
  }
  try {
    const orders = await getCustomerPastOrders(customerId, company);
    return NextResponse.json({ orders });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't load past orders." },
      { status: 502 }
    );
  }
}
