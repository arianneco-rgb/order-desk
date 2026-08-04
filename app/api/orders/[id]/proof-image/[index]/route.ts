import { NextRequest, NextResponse } from "next/server";
import { getOrder } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Serves one proof-of-payment image's actual bytes, decoded from the
 * embedded base64 data URL stored on the order. Exists so the polled
 * order list (GET /api/orders) can send a lightweight path instead of the
 * full image every 2-2.5s — see lib/proof-refs.ts.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; index: string } }
) {
  const order = await getOrder(params.id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const index = Number(params.index);
  const proof = order.payment.proofs?.[index];
  if (!proof) return NextResponse.json({ error: "Proof not found" }, { status: 404 });

  const match = proof.url.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return NextResponse.json({ error: "This proof has no embedded image." }, { status: 404 });
  const [, contentType, base64] = match;

  return new NextResponse(Buffer.from(base64, "base64"), {
    headers: {
      "Content-Type": contentType,
      // Private (never a shared cache) — proofs aren't public. Long-lived
      // since a stored proof's bytes never change once uploaded.
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
