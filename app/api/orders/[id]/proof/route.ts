import { NextRequest, NextResponse } from "next/server";
import { getOrder, saveOrder } from "@/lib/store";
import { analyzeProof, proofReaderEnabled } from "@/lib/proof-reader";
import { appendPaymentLedger, savePaymentProofToDrive } from "@/lib/payment-ledger";
import type { ProofOfPayment } from "@/lib/types";

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
  const order = await getOrder(params.id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as {
    dataUrl?: string;
    fileName?: string;
    amountPaid?: number;
    paymentDate?: string;
    notes?: string;
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
  const proof: ProofOfPayment = {
    url: body.dataUrl,
    name: body.fileName || `proof-${proofs.length + 1}`,
    uploadedAt: new Date().toISOString(),
    amountPaid: Number.isFinite(body.amountPaid) ? Number(body.amountPaid) : undefined,
    paymentDate: body.paymentDate?.slice(0, 40),
    notes: body.notes?.trim().slice(0, 300) || undefined,
  };

  // Best-effort screenshot reading (key-gated) — annotates the proof with
  // what Claude could read off it. A reader failure never blocks the upload.
  if (proofReaderEnabled()) {
    try {
      proof.analysis = (await analyzeProof(body.dataUrl)) ?? undefined;
    } catch (err) {
      console.error("Proof analysis failed:", err);
    }
  }

  // To Drive, not into the database. A screenshot stored as base64 on the
  // order row is the heaviest thing the app writes, and Wheng can't open it
  // from the ledger — she needs a link she can click.
  let driveUrl: string | undefined;
  try {
    const saved = await savePaymentProofToDrive(body.dataUrl, proof.name);
    if (saved) {
      driveUrl = saved.url;
      proof.url = saved.url;
    }
  } catch (err) {
    // Keep the inline copy rather than losing the upload — the ledger row
    // just won't have a working link, which the warning below reports.
    console.error("Drive upload failed, keeping inline copy:", err);
  }

  proofs.push(proof);
  order.payment.proofs = proofs;

  // One ledger row per transfer. Test orders stay out of the real ledger
  // for the same reason they stay out of the Order History sheet.
  let ledgerWarning: string | undefined;
  if (!order.isTest) {
    try {
      const amount = proof.amountPaid ?? order.total;
      const logged = await appendPaymentLedger({
        orderNo: order.shopifyDraftName ?? order.id,
        orderDeskId: order.id,
        customerName: order.company,
        orderTotal: order.total,
        amountPaid: amount,
        paymentDate: proof.paymentDate || proof.analysis?.date || "",
        bank: proof.analysis?.senderName || "",
        reference: proof.analysis?.ref || "",
        screenshotUrl: driveUrl || "",
        notes: proof.notes || "",
      });
      if (logged) proof.ledgerLogged = true;
      else ledgerWarning = "Saved, but the Payment Ledger row didn't write — add it by hand.";
    } catch (err) {
      console.error("Payment ledger append failed:", err);
      ledgerWarning = "Saved, but the Payment Ledger row didn't write — add it by hand.";
    }
  }

  await saveOrder(order);
  return NextResponse.json({
    order,
    ledgerWarning,
    driveSaved: Boolean(driveUrl),
  });
}

/** Remove one proof by index (mis-uploaded screenshot). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const order = await getOrder(params.id);
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
  await saveOrder(order);
  return NextResponse.json({ order });
}
