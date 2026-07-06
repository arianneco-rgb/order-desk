import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/** Product list for the line-item editor (variant prices from Shopify). */
export async function GET() {
  try {
    const catalog = await getCatalog();
    return NextResponse.json({ catalog });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't load catalog." },
      { status: 502 }
    );
  }
}
