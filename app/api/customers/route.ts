import { NextRequest, NextResponse } from "next/server";
import { listSheetCustomers } from "@/lib/sheets";
import { createCafeCustomer } from "@/lib/shopify";
import { syncCustomersToSheet } from "@/lib/sheets";

export const dynamic = "force-dynamic";

/** The cafe dropdown reads the Customers sheet tab (synced from Shopify). */
export async function GET() {
  try {
    const customers = await listSheetCustomers();
    return NextResponse.json({ customers });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't load customers." },
      { status: 502 }
    );
  }
}

/**
 * Add a cafe that isn't listed: create it in Shopify → re-sync the
 * Customers sheet tab → it appears in the dropdown.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    cafeName?: string;
    contactName?: string;
    email?: string;
    phone?: string;
  };
  const cafeName = body.cafeName?.trim();
  if (!cafeName) {
    return NextResponse.json({ error: "Cafe name is required." }, { status: 400 });
  }
  try {
    const customer = await createCafeCustomer({
      cafeName,
      contactName: body.contactName?.trim() || undefined,
      email: body.email?.trim() || undefined,
      phone: body.phone?.trim() || undefined,
    });
    await syncCustomersToSheet();
    return NextResponse.json({ customer }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't create the cafe." },
      { status: 502 }
    );
  }
}
