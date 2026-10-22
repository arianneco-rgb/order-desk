// What an order has actually been paid, worked out from the screenshots
// alone.
//
// This is now the whole evidence chain. Order Desk used to cross-check
// every payment against BPI transfer emails; that's gone, so the amount
// Joey types beside each screenshot IS the record — it's what reaches the
// Payment Ledger and what Wheng reconciles against. One function, used by
// both the pane and the confirm route, so the running total she sees can
// never disagree with the number the server enforces.
//
// Golden rule unchanged: this only reports. Confirming is Joey's click.

import type { Order, ProofOfPayment } from "./types";

/** Pesos below this are rounding, not a real shortfall. */
const EPSILON = 0.009;

export interface PaidSummary {
  /** Sum of every priced screenshot. */
  paid: number;
  /**
   * Screenshots with no amount against them. These are NOT counted as
   * paid — an unpriced slip is an unknown, and silently treating it as
   * the full total is how a half-paid order gets marked settled.
   */
  unpriced: number;
  /** Positive = still owed. Negative = overpaid (cafes round up). */
  short: number;
  /** Covered in full, with every screenshot priced. */
  settled: boolean;
}

/**
 * A lone screenshot with no amount means "this covers the whole order" —
 * that's the one-transfer case, and making Joey retype the total she can
 * already see would be busywork. The moment there are two, the rule stops
 * applying: each transfer has to say what it was for, because the whole
 * point of the split is that neither one is the total.
 */
export function proofAmount(
  proof: ProofOfPayment,
  index: number,
  proofs: ProofOfPayment[],
  orderTotal: number
): number | undefined {
  if (proof.amountPaid !== undefined) return proof.amountPaid;
  return proofs.length === 1 && index === 0 ? orderTotal : undefined;
}

/** What the screenshots on this order add up to. */
export function paidSummary(order: Order, staged = 0): PaidSummary {
  const proofs = order.payment.proofs ?? [];
  let paid = staged;
  let unpriced = 0;
  proofs.forEach((proof, i) => {
    const amount = proofAmount(proof, i, proofs, order.total);
    if (amount === undefined) unpriced += 1;
    else paid += amount;
  });
  const short = order.total - paid;
  return { paid, unpriced, short, settled: unpriced === 0 && short <= EPSILON };
}

/**
 * Why this order can't be confirmed yet, or null when it can.
 *
 * Returned as a sentence because it goes straight to Joey — she needs to
 * know what to fix, not that a check failed.
 */
export function blockingReason(order: Order): string | null {
  const proofs = order.payment.proofs ?? [];
  if (proofs.length === 0) {
    return "Upload the payment screenshot first — it's the only record that this order was paid.";
  }
  const { paid, unpriced, short } = paidSummary(order);
  if (unpriced > 0) {
    return unpriced === 1
      ? "One screenshot has no amount against it — say what that transfer covers before confirming."
      : `${unpriced} screenshots have no amount against them — say what each transfer covers before confirming.`;
  }
  if (short > EPSILON) {
    return `The screenshots add up to ₱${paid.toLocaleString("en-PH")} against an order of ₱${order.total.toLocaleString("en-PH")} — ₱${short.toLocaleString("en-PH")} short. Add the missing transfer, or tick the box to confirm anyway.`;
  }
  return null;
}
