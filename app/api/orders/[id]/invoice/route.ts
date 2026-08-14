import { NextRequest, NextResponse } from "next/server";
import { getCatalog, getCafeCustomers, getCustomerFullAddress, getOrderName } from "@/lib/shopify";
import { priceItems } from "@/lib/pricing";
import {
  computeInvoiceLines,
  getCustomerProfile,
  getOrCreateCustomerProfile,
  logInvoiceToLedger,
  vatMismatch,
  type CustomerProfile,
} from "@/lib/invoice";
import { getOrder, saveOrder, tryLockOrder, unlockOrder } from "@/lib/store";

export const dynamic = "force-dynamic";

// Full legal names — an invoice is a document a customer files, so the
// "Prepared by" line carries the person's full name rather than the
// first-name shorthand the team uses internally.
const PREPARERS = [
  "Josephine Abesamis",
  "Jericho Manuel Liao IV",
  "Alfonso Rafael Noel",
  "Marco Antonio Adriano",
];

async function buildPreview(orderId: string) {
  const order = await getOrder(orderId);
  if (!order) return null;

  const [catalog, customers] = await Promise.all([getCatalog(), getCafeCustomers()]);
  const priced = priceItems(order.items, catalog);
  const lines = computeInvoiceLines(priced, catalog);
  const customer = customers.find((c) => c.shopifyId === order.customerId);

  let profile: CustomerProfile | null = null;
  try {
    profile = await getCustomerProfile(customer?.phone, order.company);
  } catch (err) {
    console.error("getCustomerProfile failed:", err);
  }

  return {
    order,
    lines,
    profile,
    preparers: PREPARERS,
    mismatch: vatMismatch(order.options.chargeVat, profile),
  };
}

/** Preview — never mutates, safe to call repeatedly while the invoice screen is open. */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const data = await buildPreview(params.id);
    if (!data) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't build the invoice preview." },
      { status: 502 }
    );
  }
}

/**
 * Assigns the invoice number (locked in permanently — a second POST just
 * returns the already-assigned one, it never reissues) and logs the
 * Invoice Ledger row. VAT always comes from THIS order's own chargeVat
 * toggle, never from the sheet's Customer Profiles flag — see lib/invoice.ts.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!(await tryLockOrder(params.id))) {
    return NextResponse.json({ error: "Already working on this order — try again in a moment." }, { status: 409 });
  }
  try {
    const order = await getOrder(params.id);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    if (order.invoiceNumber) {
      return NextResponse.json({ order, invoiceNumber: order.invoiceNumber, alreadyGenerated: true });
    }

    const body = (await request.json().catch(() => ({}))) as {
      preparedBy?: string;
      poNo?: string;
      companyName?: string;
      customerName?: string;
      /** New-customer path only (no Customer Profiles match): explicit yes/no + conditional TIN. */
      vatAvailed?: boolean;
      tin?: string;
      /** Manual override after a code_collision response on a previous attempt. */
      merchantCodeOverride?: string;
    };
    if (!body.preparedBy?.trim()) {
      return NextResponse.json({ error: "Prepared by is required." }, { status: 400 });
    }

    const [catalog, customers] = await Promise.all([getCatalog(), getCafeCustomers()]);
    const customer = customers.find((c) => c.shopifyId === order.customerId);

    let profile: CustomerProfile | null = null;
    try {
      profile = await getCustomerProfile(customer?.phone, order.company);
    } catch (err) {
      console.error("getCustomerProfile failed:", err);
    }

    // No existing row — create one from Order Desk's own data instead of
    // requiring the sheet to already know this customer. Only happens on
    // an actual Generate click, never on preview.
    if (!profile) {
      if (typeof body.vatAvailed !== "boolean") {
        return NextResponse.json(
          { error: "This customer isn't in Customer Profiles yet — say whether they availed of VAT before generating." },
          { status: 400 }
        );
      }
      if (body.vatAvailed && !body.tin?.trim()) {
        return NextResponse.json({ error: "TIN is required when VAT was availed." }, { status: 400 });
      }

      const companyName = body.companyName?.trim() || order.company;
      const address = order.customerId ? await getCustomerFullAddress(order.customerId).catch(() => null) : null;

      const result = await getOrCreateCustomerProfile({
        contactNumber: customer?.phone,
        nameOrCompany: order.company,
        companyName,
        customerName: body.customerName?.trim() || customer?.contactName || "",
        tin: body.vatAvailed ? body.tin?.trim() : "",
        address: address ?? "",
        vat: body.vatAvailed,
        merchantCode: body.merchantCodeOverride?.trim(),
      });

      if ("error" in result) {
        return NextResponse.json(
          {
            error: `Merchant code "${result.derivedCode}" is already used by "${result.takenBy}" — enter a different code manually.`,
            codeCollision: result,
          },
          { status: 409 }
        );
      }
      profile = result.profile;
    }

    const orderNo =
      (order.shopifyOrderId ? await getOrderName(order.shopifyOrderId).catch(() => null) : null) ??
      order.shopifyDraftName ??
      order.id;

    const { invoiceNumber } = await logInvoiceToLedger({
      merchantCode: profile.merchantCode,
      orderNo,
      poNo: body.poNo,
      customerName: profile.customerName || customer?.contactName || "",
      companyName: profile.companyName || order.company,
      paymentStatus: order.status === "paid" ? "Paid" : "Unpaid",
    });

    order.invoiceNumber = invoiceNumber;
    order.invoicePreparedBy = body.preparedBy.trim();
    order.invoiceGeneratedAt = new Date().toISOString();
    order.invoiceOrderNo = orderNo;
    if (body.poNo?.trim()) order.invoicePoNo = body.poNo.trim();
    await saveOrder(order);

    return NextResponse.json({
      order,
      invoiceNumber,
      lines: computeInvoiceLines(priceItems(order.items, catalog), catalog),
      profile,
      mismatch: vatMismatch(order.options.chargeVat, profile),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't generate the invoice." },
      { status: 502 }
    );
  } finally {
    await unlockOrder(params.id);
  }
}
