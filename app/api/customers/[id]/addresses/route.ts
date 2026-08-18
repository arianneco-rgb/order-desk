import { NextResponse } from "next/server";
import { getCustomerAddresses } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/**
 * The branch list for one cafe. Fetched on selection rather than with the
 * customer list — see getCustomerAddresses for why.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const id = decodeURIComponent(params.id);
  if (!id.startsWith("gid://shopify/Customer/")) {
    return NextResponse.json({ addresses: [] });
  }
  try {
    return NextResponse.json({ addresses: await getCustomerAddresses(id) });
  } catch (err) {
    // A missing branch list must never block the order — Joey can still
    // proceed on the customer's default address.
    console.error("Address fetch failed:", err);
    return NextResponse.json({ addresses: [], error: "Couldn't load branches." });
  }
}
