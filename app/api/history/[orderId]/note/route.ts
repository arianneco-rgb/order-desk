import { NextRequest, NextResponse } from "next/server";
import { setOrderHistoryNote } from "@/lib/sheets";

export const dynamic = "force-dynamic";

/** Add/edit a note on a paid order's History row. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  const body = (await request.json().catch(() => ({}))) as { note?: string };
  if (typeof body.note !== "string" || body.note.length > 2000) {
    return NextResponse.json(
      { error: "note must be a string under 2000 characters." },
      { status: 400 }
    );
  }
  try {
    const found = await setOrderHistoryNote(params.orderId, body.note);
    if (!found) {
      return NextResponse.json({ error: "History row not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't save the note." },
      { status: 502 }
    );
  }
}
