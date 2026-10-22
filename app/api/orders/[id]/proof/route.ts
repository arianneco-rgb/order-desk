import { NextRequest, NextResponse } from "next/server";
import { getOrder, saveOrder } from "@/lib/store";
import type { Order, ProofAnalysis } from "@/lib/types";
import { appendPaymentLedger, savePaymentProofToDrive } from "@/lib/payment-ledger";
import { proofAmount } from "@/lib/payments";
import type { ProofOfPayment } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_PROOFS = 8;

/**
 * Extension from the data URL's own mime type. Without one, Drive serves
 * the file as a blob and the ledger's link opens a download prompt
 * instead of a preview — which defeats the point of the link.
 */
function extensionFor(dataUrl: string): string {
  const mime = dataUrl.match(/^data:image\/([a-z0-9.+-]+)/i)?.[1]?.toLowerCase();
  if (!mime) return "";
  return mime === "jpeg" || mime === "jpg" ? ".jpg" : `.${mime}`;
}

/**
 * `[POP] #D3717 - 2.jpg`
 *
 * Whatever the phone called it ("IMG_0234.JPG", "Screenshot 2026-10-22 at
 * 11.30.14.png") tells nobody which order it belongs to. Named this way
 * the proofs folder sorts by order on its own, and a row in the ledger can
 * be traced to a file without opening anything.
 *
 * The number is the transfer's position on the order, so a split payment
 * reads as "- 1" and "- 2" in the order the cafe sent them.
 */
function proofFileName(order: Order, paymentNo: number, dataUrl: string): string {
  const orderNo = order.shopifyDraftName ?? order.id;
  return `[POP] ${orderNo} - ${paymentNo}${extensionFor(dataUrl)}`;
}

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
    notes?: string;
    /** What the browser's OCR read off this screenshot, if anything. */
    analysis?: ProofAnalysis;
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
  // "Leave it blank and we'll assume the full total" is only safe for the
  // FIRST transfer. Once an order has a payment on it, a blank second upload
  // would log the full total a second time and drive the ledger balance
  // negative — which is precisely the split payment this screen exists to
  // handle. Make the amount explicit from the second screenshot onwards.
  const amountGiven = Number.isFinite(body.amountPaid)
    ? Number(body.amountPaid)
    : undefined;
  if (amountGiven !== undefined && amountGiven <= 0) {
    return NextResponse.json(
      { error: "Amount paid has to be more than ₱0." },
      { status: 400 }
    );
  }
  if (amountGiven === undefined && proofs.length > 0) {
    return NextResponse.json(
      {
        error:
          "This order already has a payment logged — say how much this transfer covers.",
      },
      { status: 400 }
    );
  }

  const proof: ProofOfPayment = {
    url: body.dataUrl,
    // Renamed on the way in, never kept as the phone sent it.
    name: proofFileName(order, proofs.length + 1, body.dataUrl),
    originalName: body.fileName?.trim().slice(0, 200) || undefined,
    uploadedAt: new Date().toISOString(),
    amountPaid: amountGiven,
    notes: body.notes?.trim().slice(0, 300) || undefined,
    // Carried over from the staging step rather than re-read here. The
    // reading happens in Joey's browser (lib/ocr.ts) to pre-fill the
    // amount; the server has no OCR engine and no reason to run one.
    analysis: body.analysis,
  };

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
      // Same rule the pane shows and the confirm route enforces — a blank
      // amount only means "the whole order" when this is the only transfer.
      const amount = proofAmount(proof, proofs.length - 1, proofs, order.total);
      const logged = await appendPaymentLedger({
        orderNo: order.shopifyDraftName ?? order.id,
        orderDeskId: order.id,
        customerName: order.company,
        orderTotal: order.total,
        screenshotUrl: driveUrl || "",
        amountPaid: amount ?? 0,
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
