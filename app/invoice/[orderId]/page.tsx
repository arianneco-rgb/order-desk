"use client";

import { useEffect, useState } from "react";
import type { Order } from "@/lib/types";
import type { CustomerProfile, InvoiceLineItem } from "@/lib/invoice";

const TERMS = [
  {
    label: "Payment Conditions:",
    text: " Orders are processed after payment is received.",
  },
  {
    label: "Delivery:",
    text: " Lead time is 3-5 days upon payment. Free shipping is provided for case orders and above within Metro Manila.",
  },
  {
    label: "Return Policy:",
    text: " Damaged goods must be reported and returned within 24 hours of receipt. All returned products must be accompanied by a written notice, product lot number, and photographic proof before the return can be processed. Once verified, we will provide instructions for the return process, and a replacement will be issued accordingly.",
  },
];

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

/** Always 2 decimal places, matching the paper template (₱480.00, not ₱480). */
function formatMoney(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface PreviewData {
  order: Order;
  lines: InvoiceLineItem[];
  profile: CustomerProfile | null;
  preparers: string[];
  mismatch: boolean;
  invoiceNumber?: string;
  alreadyGenerated?: boolean;
}

export default function InvoicePage({ params }: { params: { orderId: string } }) {
  const [data, setData] = useState<PreviewData | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [preparedBy, setPreparedBy] = useState("");
  const [customName, setCustomName] = useState("");
  const [poNo, setPoNo] = useState("");
  const [sameAsCompany, setSameAsCompany] = useState(true);
  const [manualCompany, setManualCompany] = useState("");
  const [manualCustomer, setManualCustomer] = useState("");
  const [tin, setTin] = useState("");
  const [collision, setCollision] = useState<{ derivedCode: string; takenBy: string } | null>(null);
  const [merchantCodeOverride, setMerchantCodeOverride] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/orders/${params.orderId}/invoice`);
      if (res.status === 404) {
        setData(null);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load this invoice — retrying…");
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.orderId]);

  if (data === undefined) {
    return (
      <div className="mx-auto max-w-2xl print:hidden">
        <div className="mt-4 rounded-xl border border-forest-200 bg-white p-8 text-center text-sm text-forest-500 shadow-sm">
          {error ?? "Loading invoice…"}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl print:hidden">
        <div className="mt-4 rounded-xl border border-forest-200 bg-white p-8 text-center shadow-sm">
          <p className="text-base font-semibold text-forest-900">Invoice not found</p>
          <p className="mt-1 text-sm text-forest-600">No order matches "{params.orderId}".</p>
        </div>
      </div>
    );
  }

  const { order, lines, profile, preparers, mismatch } = data;
  const generated = Boolean(order.invoiceNumber);
  const totals = order.totals;
  const subtotal = totals?.subtotal ?? lines.reduce((s, l) => s + l.amount, 0);
  const discount = totals?.discounts ?? 0;
  const vat = order.options.chargeVat ? (totals?.vat ?? 0) : 0;
  const shipping = totals?.shipping ?? 0;
  const total = totals?.total ?? subtotal - discount + vat + shipping;

  async function generate() {
    const finalPreparedBy = preparedBy === "__other__" ? customName.trim() : preparedBy;
    if (!finalPreparedBy) {
      setGenError("Choose or type who's preparing this invoice.");
      return;
    }
    if (!profile) {
      if (!sameAsCompany && !manualCompany.trim()) {
        setGenError('Enter the real company name, or switch back to "same as cafe name".');
        return;
      }
      if (order.options.chargeVat && !tin.trim()) {
        setGenError("TIN is required — this order charged VAT.");
        return;
      }
    }
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch(`/api/orders/${params.orderId}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preparedBy: finalPreparedBy,
          poNo: poNo.trim() || undefined,
          companyName: !profile && !sameAsCompany ? manualCompany.trim() : undefined,
          customerName: manualCustomer.trim() || undefined,
          vatAvailed: profile ? undefined : order.options.chargeVat,
          tin: profile ? undefined : order.options.chargeVat ? tin.trim() : "",
          merchantCodeOverride: collision ? merchantCodeOverride.trim() || undefined : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.codeCollision) {
          setCollision(body.codeCollision);
          setGenError(body.error);
          return;
        }
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setCollision(null);
      await load();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Couldn't generate the invoice.");
    } finally {
      setGenerating(false);
    }
  }

  const merchantCode = profile?.merchantCode || "";
  const customerName = profile?.customerName || manualCustomer || "";
  const companyName = profile?.companyName || (!sameAsCompany && manualCompany) || order.company;
  const tinDisplay = profile?.tin || "";
  const address = profile?.address || "";
  const contactNo = profile?.contactNumber || "";
  const orderNo = order.invoiceOrderNo || order.shopifyDraftName || order.id;

  return (
    <div className="mx-auto max-w-2xl">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #invoice-print-area, #invoice-print-area * { visibility: visible; }
          #invoice-print-area { position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>

      <div className="mb-4 flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight text-forest-900">Invoice</h1>
        {generated && (
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-forest-600 bg-forest-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-forest-700"
          >
            Print / Save as PDF
          </button>
        )}
      </div>

      {mismatch && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 print:hidden">
          ⚠️ VAT mismatch: this order was {order.options.chargeVat ? "charged" : "not charged"} VAT,
          but the Customer Profiles sheet has this customer marked{" "}
          {profile?.vat ? "VAT-registered" : "not VAT-registered"}. The invoice below uses this
          order's own setting — double-check which is correct before sending.
        </p>
      )}

      {!generated && (
        <div className="mb-4 space-y-3 rounded-xl border border-forest-200 bg-white p-5 shadow-sm print:hidden">
          <p className="text-sm font-semibold text-forest-800">Generate invoice</p>

          {!profile && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold">No match in Customer Profiles</p>
              <p className="mt-1">
                A new row will be added to the sheet automatically from this order's info.
              </p>

              <div className="mt-2 space-y-1.5">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="companyMatch"
                    checked={sameAsCompany}
                    onChange={() => setSameAsCompany(true)}
                  />
                  Company name is the same as the cafe name ({order.company})
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="companyMatch"
                    checked={!sameAsCompany}
                    onChange={() => setSameAsCompany(false)}
                  />
                  Different — the corporate/company name isn't the cafe name
                </label>
                {!sameAsCompany && (
                  <input
                    value={manualCompany}
                    onChange={(e) => setManualCompany(e.target.value)}
                    placeholder="Real company / corporate name"
                    className="w-full rounded-md border border-amber-300 px-2 py-1 text-sm"
                  />
                )}
              </div>

              <input
                value={manualCustomer}
                onChange={(e) => setManualCustomer(e.target.value)}
                placeholder="Customer / contact name"
                className="mt-2 w-full rounded-md border border-amber-300 px-2 py-1 text-sm"
              />

              {order.options.chargeVat && (
                <div className="mt-3">
                  <p className="font-semibold">
                    This order charged VAT — TIN is required for the new profile.
                  </p>
                  <input
                    value={tin}
                    onChange={(e) => setTin(e.target.value)}
                    placeholder="TIN"
                    className="mt-2 w-full rounded-md border border-amber-300 px-2 py-1 text-sm"
                  />
                </div>
              )}

              {collision && (
                <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-2">
                  <p className="text-red-900">
                    Merchant code "{collision.derivedCode}" is already used by "{collision.takenBy}".
                  </p>
                  <input
                    value={merchantCodeOverride}
                    onChange={(e) => setMerchantCodeOverride(e.target.value)}
                    placeholder="Enter a different merchant code"
                    className="mt-1 w-full rounded-md border border-red-300 px-2 py-1 text-sm"
                  />
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-forest-500">
                Prepared by
              </label>
              <select
                value={preparedBy}
                onChange={(e) => setPreparedBy(e.target.value)}
                className="mt-1 w-full rounded-md border border-forest-300 px-2 py-1.5 text-sm"
              >
                <option value="">Choose…</option>
                {preparers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                <option value="__other__">Other…</option>
              </select>
              {preparedBy === "__other__" && (
                <input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Name"
                  className="mt-2 w-full rounded-md border border-forest-300 px-2 py-1.5 text-sm"
                />
              )}
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-forest-500">
                PO No. (if applicable)
              </label>
              <input
                value={poNo}
                onChange={(e) => setPoNo(e.target.value)}
                className="mt-1 w-full rounded-md border border-forest-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          {genError && <p className="text-sm text-red-700">{genError}</p>}

          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            className="w-full rounded-md bg-forest-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-forest-800 disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate invoice"}
          </button>
        </div>
      )}

      <div
        id="invoice-print-area"
        className={
          generated
            ? "bg-white p-8 text-black shadow-sm print:p-0 print:shadow-none"
            : "bg-white p-8 text-black opacity-60 print:hidden"
        }
      >
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Ritual Matcha Co." className="h-14 w-14 object-contain" />
          <p className="text-lg font-bold uppercase leading-tight tracking-wide">
            RMC Ritual Trading Corporation
          </p>
        </div>
        <p className="mt-2 text-xs">
          173 Mariano Marcos Street, Brgy. Maytunas, San Juan City, Metro Manila, 1500
        </p>
        <p className="text-xs">Phone : +63 917 890 0543, +63 917 107 7776</p>
        <div className="mt-3 border-b-2 border-black" />

        <table className="mt-4 w-full border-collapse text-sm">
          <tbody>
            <tr>
              <td className="w-1/3 border border-black px-2 py-1">PO No. (if applicable)</td>
              <td className="border border-black px-2 py-1">{order.invoicePoNo}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1">Proforma Invoice No.</td>
              <td className="border border-black px-2 py-1">{order.invoiceNumber}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-semibold italic">Order #</td>
              <td className="border border-black px-2 py-1 font-semibold italic">
                {generated ? orderNo : ""}
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1">Date:</td>
              <td className="border border-black px-2 py-1">
                {generated ? formatDate(order.invoiceGeneratedAt) : ""}
              </td>
            </tr>
          </tbody>
        </table>

        <table className="mt-4 w-full border-collapse text-sm">
          <tbody>
            <tr>
              <td className="w-1/3 border border-black px-2 py-1 font-semibold italic">
                Merchant Code
              </td>
              <td className="border border-black bg-gray-100 px-2 py-1 font-semibold italic">
                {merchantCode}
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1">Customer Name:</td>
              <td className="border border-black px-2 py-1">{customerName}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1">Company:</td>
              <td className="border border-black px-2 py-1">{companyName}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1">TIN:</td>
              <td className="border border-black px-2 py-1">{tinDisplay}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1">Address:</td>
              <td className="border border-black px-2 py-1">{address}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1">Contact No:</td>
              <td className="border border-black px-2 py-1">{contactNo}</td>
            </tr>
          </tbody>
        </table>

        <p className="mt-6 text-center text-sm font-bold">Proforma Invoice</p>

        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-black bg-forest-800 px-2 py-1.5 text-left font-bold text-white">
                Description
              </th>
              <th className="border border-black bg-forest-800 px-2 py-1.5 text-left font-bold text-white">
                UOM
              </th>
              <th className="border border-black bg-forest-800 px-2 py-1.5 text-right font-bold text-white">
                Unit Price
              </th>
              <th className="border border-black bg-forest-800 px-2 py-1.5 text-right font-bold text-white">
                Quantity
              </th>
              <th className="border border-black bg-forest-800 px-2 py-1.5 text-right font-bold text-white">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i}>
                <td className="border border-black px-2 py-1">{line.description}</td>
                <td className="border border-black px-2 py-1">{line.uom}</td>
                <td className="border border-black px-2 py-1 text-right">
                  {formatMoney(line.unitPrice)}
                </td>
                <td className="border border-black px-2 py-1 text-right">{line.quantity}</td>
                <td className="border border-black px-2 py-1 text-right">
                  {formatMoney(line.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex justify-end">
          <table className="w-full max-w-sm border-collapse text-sm">
            <tbody>
              <tr>
                <td className="border border-black px-2 py-1">Total before taxes:</td>
                <td className="border border-black px-2 py-1 text-right">{formatMoney(subtotal)}</td>
              </tr>
              <tr>
                <td className="border border-black px-2 py-1">Discount (if applicable)</td>
                <td className="border border-black px-2 py-1 text-right">
                  {discount > 0 ? formatMoney(discount) : ""}
                </td>
              </tr>
              {shipping > 0 && (
                <tr>
                  <td className="border border-black px-2 py-1">
                    Delivery fee <span className="text-xs italic">(not on the paper template)</span>
                  </td>
                  <td className="border border-black px-2 py-1 text-right">{formatMoney(shipping)}</td>
                </tr>
              )}
              <tr>
                <td className="border border-black px-2 py-1">VAT (12%)</td>
                <td className="border border-black px-2 py-1 text-right">
                  {order.options.chargeVat ? formatMoney(vat) : ""}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2 py-1">Outstanding Balance</td>
                <td className="border border-black px-2 py-1 text-right"></td>
              </tr>
              <tr>
                <td className="border border-black px-2 py-1 font-bold">TOTAL:</td>
                <td className="border border-black px-2 py-1 text-right font-bold">
                  {formatMoney(total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-6 bg-forest-800 py-1.5 text-center text-sm font-bold uppercase tracking-wide text-white">
          Terms and Conditions
        </div>
        <div className="mt-2 space-y-1 text-xs leading-relaxed">
          {TERMS.map((t) => (
            <p key={t.label}>
              <span className="font-bold">{t.label}</span>
              {t.text}
            </p>
          ))}
        </div>

        <div className="mt-4 max-w-sm border border-black px-2 py-1.5 text-xs leading-relaxed">
          <p>
            <span className="font-bold">Bank:</span> BPI
          </p>
          <p>
            <span className="font-bold">Account Name:</span> RMC Ritual Trading Corporation
          </p>
          <p>
            <span className="font-bold">Account Number:</span> 2561013163
          </p>
        </div>

        <p className="mt-3 text-right text-xs">RMC Ritual Trading Corporation</p>

        <p className="mt-10 text-sm">
          Prepared by:{" "}
          <span className="inline-block min-w-[220px] border-b border-black">
            {order.invoicePreparedBy}
          </span>
        </p>
      </div>
    </div>
  );
}
