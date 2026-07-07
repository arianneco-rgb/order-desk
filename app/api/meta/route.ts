import { NextResponse } from "next/server";
import { followUpDays, modeSummary } from "@/lib/config";
import { CATALOG_SNAPSHOT_DATE } from "@/lib/catalog-snapshot";
import { getTestMode } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Which layers are live vs mocked, plus the test-mode switch — shown in the nav. */
export async function GET() {
  return NextResponse.json({
    modes: modeSummary(),
    snapshotDate: CATALOG_SNAPSHOT_DATE,
    followUpDays: followUpDays(),
    testMode: await getTestMode(),
  });
}
