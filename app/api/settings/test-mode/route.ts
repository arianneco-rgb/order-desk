import { NextRequest, NextResponse } from "next/server";
import { getTestMode, setTestMode } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The nav's test-mode switch — global, shared across everyone using the dashboard. */
export async function GET() {
  return NextResponse.json({ testMode: await getTestMode() });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { enabled?: boolean };
  const enabled = Boolean(body.enabled);
  await setTestMode(enabled);
  return NextResponse.json({ testMode: enabled });
}
