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
 * Customers sheet tab → it appears in the dropdown. The chat-to-profile
 * flow posts here too, with the parsed (user-confirmed) address included
 * so delivery defaults work from day one.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    cafeName?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: {
      address1?: string;
      address2?: string;
      city?: string;
      province?: string;
      zip?: string;
    };
  };
  const cafeName = body.cafeName?.trim();
  if (!cafeName) {
    return NextResponse.json({ error: "Cafe name is required." }, { status: 400 });
  }
  const field = (v: unknown, max: number): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
  try {
    const address = body.address
      ? {
          address1: field(body.address.address1, 200),
          address2: field(body.address.address2, 200),
          city: field(body.address.city, 60),
          province: field(body.address.province, 60),
          zip: field(body.address.zip, 10),
        }
      : undefined;
    const customer = await createCafeCustomer({
      cafeName,
      contactName: field(body.contactName, 100),
      email: field(body.email, 100),
      phone: field(body.phone, 20),
      address: address && Object.values(address).some(Boolean) ? address : undefined,
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
