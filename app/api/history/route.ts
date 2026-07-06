import { NextResponse } from "next/server";
import { listOrderHistory } from "@/lib/sheets";

export const dynamic = "force-dynamic";

/** History page data: the Order History sheet tab. */
export async function GET() {
  try {
    const rows = await listOrderHistory();
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't load history." },
      { status: 502 }
    );
  }
}
