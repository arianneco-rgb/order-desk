// Invoice generation — reads the team's existing Invoice Ledger / Customer
// Profiles spreadsheet via the Apps Script bridge (see Code.gs) and builds
// line items straight from Order Desk's own order + catalog data (NOT the
// sheet's "Order Created Ledger" staging table, which Order Desk doesn't
// populate and doesn't need — this app already has the same data live).

import { callAppsScript } from "./apps-script";
import { sheetsMode } from "./config";
import type { CatalogProduct, PricedItem } from "./types";

export interface CustomerProfile {
  merchantCode: string;
  customerName: string;
  contactNumber: string;
  companyName: string;
  tin: string;
  address: string;
  /** Per-customer default from the sheet — NOT necessarily what this order charged. See lib/invoice.ts vatMismatch(). */
  vat: boolean;
}

/**
 * Matches by contact number first (most reliable — company names in
 * Shopify are often not the real cafe/corporate name, e.g. "St Ali" vs
 * "Butter and Salt"), then customer/company name. Returns null if the
 * sheet isn't configured (mock mode) or no row matches — callers should
 * fall back to manual entry.
 */
export async function getCustomerProfile(
  contactNumber: string | undefined,
  nameOrCompany: string | undefined
): Promise<CustomerProfile | null> {
  if (sheetsMode() === "mock") return null;
  const data = await callAppsScript<{ profile: CustomerProfile | null }>(
    "getCustomerProfile",
    { contactNumber, nameOrCompany }
  );
  return data.profile;
}

export interface NewCustomerProfileInput {
  contactNumber?: string;
  nameOrCompany?: string;
  companyName: string;
  customerName?: string;
  tin?: string;
  address?: string;
  vat: boolean;
  /** Manual override after a code_collision response — skips derivation entirely. */
  merchantCode?: string;
}

export interface CodeCollision {
  error: "code_collision";
  derivedCode: string;
  takenBy: string;
}

/**
 * Only call this from the actual "Generate" action, never from a preview —
 * it writes a new Customer Profiles row when no existing match is found.
 * Searches first (same as getCustomerProfile); a `code_collision` result
 * means the derived/given merchant code already belongs to a different
 * company and the caller must supply an explicit override.
 */
export async function getOrCreateCustomerProfile(
  input: NewCustomerProfileInput
): Promise<{ profile: CustomerProfile; created: boolean } | CodeCollision> {
  return callAppsScript<{ profile: CustomerProfile; created: boolean } | CodeCollision>(
    "getOrCreateCustomerProfile",
    { ...input }
  );
}

export interface LogInvoiceInput {
  merchantCode: string;
  orderNo: string;
  poNo?: string;
  customerName: string;
  companyName: string;
  paymentStatus: string;
}

/** Assigns the next sequential invoice number for this merchant and appends the Invoice Ledger row. */
export async function logInvoiceToLedger(
  input: LogInvoiceInput
): Promise<{ invoiceNumber: string }> {
  return callAppsScript<{ invoiceNumber: string }>("logInvoice", { ...input });
}

export interface InvoiceLineItem {
  description: string;
  sku: string;
  uom: string;
  unitPrice: number;
  quantity: number;
  amount: number;
}

/**
 * Description/SKU/UOM/Unit price/Qty/Amount per purchasable line — a
 * product ordered as both a case and loose pouches is two lines, same as
 * how it's actually billed on the Shopify draft (mirrors
 * buildDraftLineItems in lib/shopify.ts).
 */
export function computeInvoiceLines(
  priced: PricedItem[],
  catalog: CatalogProduct[]
): InvoiceLineItem[] {
  const lines: InvoiceLineItem[] = [];
  for (const item of priced) {
    const product = catalog.find((p) => p.key === item.productKey);

    if (item.form === "sample") {
      lines.push({
        description: `${item.title} (Sample)`,
        sku: product?.sample?.sku ?? "",
        uom: "20g",
        unitPrice: item.samplePrice ?? 0,
        quantity: item.qty,
        amount: item.amount,
      });
      continue;
    }

    if (item.cases > 0) {
      lines.push({
        description: item.title,
        sku: product?.case?.sku ?? "",
        uom: "Case (10x200g)",
        unitPrice: item.casePrice ?? 0,
        quantity: item.cases,
        amount: item.cases * (item.casePrice ?? 0),
      });
    }
    if (item.loosePouches > 0) {
      lines.push({
        description: item.title,
        sku: product?.pouch?.sku ?? "",
        uom: "200g",
        unitPrice: item.pouchPrice ?? 0,
        quantity: item.loosePouches,
        amount: item.loosePouches * (item.pouchPrice ?? 0),
      });
    }
  }
  return lines;
}

/**
 * The team's decision (2026-07-24): the invoice's VAT is whatever Order
 * Desk's own chargeVat toggle was for THIS order — never overwrite the
 * sheet's Customer Profiles VAT flag from here. This just tells the caller
 * whether the two disagree, so Order Desk can show a warning instead of
 * silently picking one.
 */
export function vatMismatch(
  orderChargedVat: boolean,
  profile: CustomerProfile | null
): boolean {
  return profile !== null && profile.vat !== orderChargedVat;
}
