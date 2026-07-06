import { NextResponse } from "next/server";
import { modeSummary } from "@/lib/config";
import { CATALOG_SNAPSHOT_DATE } from "@/lib/catalog-snapshot";

export const dynamic = "force-dynamic";

/** Which layers are live vs mocked — shown in the footer badge. */
export async function GET() {
  return NextResponse.json({
    modes: modeSummary(),
    snapshotDate: CATALOG_SNAPSHOT_DATE,
  });
}
