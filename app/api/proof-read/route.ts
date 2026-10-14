import { NextRequest, NextResponse } from "next/server";
import { analyzeProof, proofReaderEnabled } from "@/lib/proof-reader";

export const dynamic = "force-dynamic";

/**
 * Reads a payment screenshot WITHOUT saving anything.
 *
 * Deliberately separate from the upload route: the amount is the one field
 * Joey has to type per transfer, so the reading has to happen while the
 * screenshot is still staged and the number can be pre-filled for her to
 * check. Running it during upload — as it used to — meant the answer
 * arrived after she'd already typed it.
 *
 * Never throws at the caller: an unreadable slip or a dead API key just
 * means no pre-fill, and she types the amount as before.
 */
export async function POST(request: NextRequest) {
  if (!proofReaderEnabled()) return NextResponse.json({ analysis: null });

  const body = (await request.json().catch(() => ({}))) as { dataUrl?: string };
  if (!body.dataUrl?.startsWith("data:image/")) {
    return NextResponse.json({ error: "dataUrl required" }, { status: 400 });
  }
  try {
    return NextResponse.json({ analysis: (await analyzeProof(body.dataUrl)) ?? null });
  } catch (err) {
    console.error("Proof read failed:", err);
    return NextResponse.json({ analysis: null });
  }
}
