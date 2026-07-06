import { NextRequest, NextResponse } from "next/server";
import { getOrder, saveOrder } from "@/lib/store";

export const dynamic = "force-dynamic";

const MAX_PROOFS = 8;

/**
 * Attach a proof-of-payment screenshot (stored as a data URL in memory).
 * Appends — cafes sometimes send a partial payment first, then the rest.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const order = getOrder(params.id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as {
    dataUrl?: string;
    fileName?: string;
  };
  if (!body.dataUrl?.startsWith("data:")) {
    return NextResponse.json({ error: "dataUrl required" }, { status: 400 });
  }
  // ~4MB cap so a huge screenshot doesn't blow up the in-memory store.
  if (body.dataUrl.length > 4 * 1024 * 1024 * 1.4) {
    return NextResponse.json(
      { error: "Image too large — please attach one under 4MB." },
      { status: 413 }
    );
  }
  const proofs = order.payment.proofs ?? [];
  if (proofs.length >= MAX_PROOFS) {
    return NextResponse.json(
      { error: `Already have ${MAX_PROOFS} proofs attached — that's plenty.` },
      { status: 400 }
    );
  }
  proofs.push({
    url: body.dataUrl,
    name: body.fileName || `proof-${proofs.length + 1}`,
    uploadedAt: new Date().toISOString(),
  });
  order.payment.proofs = proofs;
  saveOrder(order);
  return NextResponse.json({ order });
}

/** Remove one proof by index (mis-uploaded screenshot). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const order = getOrder(params.id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { index?: number };
  const proofs = order.payment.proofs ?? [];
  if (
    typeof body.index !== "number" ||
    !Number.isInteger(body.index) ||
    body.index < 0 ||
    body.index >= proofs.length
  ) {
    return NextResponse.json({ error: "Invalid proof index." }, { status: 400 });
  }
  proofs.splice(body.index, 1);
  order.payment.proofs = proofs;
  saveOrder(order);
  return NextResponse.json({ order });
}
