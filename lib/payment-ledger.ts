// Payment ledger — the record of what a cafe actually paid.
//
// Replaces auto-matching as the primary mechanism. The app no longer tries
// to decide which bank transfer belongs to which order: Joey or JJ uploads
// the screenshot they were sent, says how much it was for, and that becomes
// a row Wheng reconciles against the bank weekly.
//
// One row per TRANSFER. Split payments are several rows for the same order,
// and the ledger's Balance column carries the remainder — so a ₱21,560
// payment against a ₱22,000 order shows ₱440 open rather than silently
// failing an equality check. That's the case auto-matching kept getting
// wrong (withholding tax, partial transfers).

import { sheetsMode } from "./config";
import { callAppsScript } from "./apps-script";

export interface LedgerEntry {
  orderNo: string;
  orderDeskId: string;
  customerName: string;
  orderTotal: number;
  amountPaid: number;
  paymentDate?: string;
  bank?: string;
  reference?: string;
  screenshotUrl?: string;
  uploadedBy?: string;
  notes?: string;
}

/** Saves a screenshot to the shared Drive folder. Returns its link. */
export async function savePaymentProofToDrive(
  dataUrl: string,
  fileName: string
): Promise<{ url: string; fileId: string } | null> {
  if (sheetsMode() === "mock") return null;
  const res = await callAppsScript<{ url?: string; fileId?: string; error?: string }>(
    "savePaymentProof",
    { dataUrl, fileName }
  );
  if (!res.url || !res.fileId) return null;
  return { url: res.url, fileId: res.fileId };
}

/** Appends one transfer. The bridge computes Balance from prior rows. */
export async function appendPaymentLedger(
  entry: LedgerEntry
): Promise<{ balance: number; alreadyPaid: number } | null> {
  if (sheetsMode() === "mock") return null;
  const res = await callAppsScript<{
    ok?: true;
    balance?: number;
    alreadyPaid?: number;
    error?: string;
  }>("appendPaymentLedger", { ...entry });
  if (res.error || typeof res.balance !== "number") return null;
  return { balance: res.balance, alreadyPaid: res.alreadyPaid ?? 0 };
}
