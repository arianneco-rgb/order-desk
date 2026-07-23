"use client";

import { useEffect, useState } from "react";
import type { CatalogProduct, Order, OrderHistoryRow } from "@/lib/types";
import { formatPeso } from "@/lib/conversions";
import { itemsText, priceItems } from "@/lib/pricing";

const BANK_NAME = "Bank of the Philippine Islands (BPI)";
const BANK_ACCOUNT_NAME = "RMC Ritual Trading Corporation";
const BANK_ACCOUNT_NUMBER = "2561013163";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Both a paid order (from History) and an awaiting-payment order (from
 * Processed, live) render through this one shape — so a "Generate invoice"
 * click always finds something to show instead of 404ing on anything
 * that hasn't been marked paid yet. NOTE: this is the placeholder layout
 * from before the real invoice template/numbering (from the team's Google
 * Sheet invoice generator) is wired in — deliberately NOT redesigned yet,
 * pending that sheet.
 */
interface InvoiceData {
  company: string;
  reference: string;
  date: string;
  items: string;
  total: number;
  notes?: string;
  paid: boolean;
}

function fromHistoryRow(row: OrderHistoryRow): InvoiceData {
  return {
    company: row.company,
    reference: row.shopifyDraftName || row.orderId,
    date: row.paidAt,
    items: row.items || "—",
    total: row.total,
    notes: row.notes,
    paid: true,
  };
}

function fromLiveOrder(order: Order, catalog: CatalogProduct[]): InvoiceData {
  return {
    company: order.company,
    reference: order.shopifyDraftName || order.id,
    date: order.draftCreatedAt || order.createdAt,
    items: itemsText(priceItems(order.items, catalog)) || "—",
    total: order.total,
    paid: order.status === "paid",
  };
}

export default function InvoicePage({
  params,
}: {
  params: { orderId: string };
}) {
  const [invoice, setInvoice] = useState<InvoiceData | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const historyRes = await fetch("/api/history");
        if (!historyRes.ok) throw new Error(`HTTP ${historyRes.status}`);
        const historyData = await historyRes.json();
        const rows: OrderHistoryRow[] = Array.isArray(historyData.rows) ? historyData.rows : [];
        const row = rows.find((r) => r.orderId === params.orderId);
        if (row) {
          if (!cancelled) {
            setInvoice(fromHistoryRow(row));
            setError(null);
          }
          return;
        }

        // Not paid yet — fall back to the live order (Queue/Processed).
        const [orderRes, catalogRes] = await Promise.all([
          fetch(`/api/orders/${params.orderId}`),
          fetch("/api/catalog"),
        ]);
        if (orderRes.status === 404) {
          if (!cancelled) {
            setInvoice(null);
            setError(null);
          }
          return;
        }
        if (!orderRes.ok) throw new Error(`HTTP ${orderRes.status}`);
        const orderData = await orderRes.json();
        const catalogData = catalogRes.ok ? await catalogRes.json() : { catalog: [] };
        if (!cancelled) {
          setInvoice(fromLiveOrder(orderData.order as Order, catalogData.catalog ?? []));
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Couldn't load this invoice — retrying…");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [params.orderId]);

  if (invoice === undefined) {
    return (
      <div className="mx-auto max-w-2xl print:hidden">
        <div className="mt-4 rounded-xl border border-forest-200 bg-white p-8 text-center text-sm text-forest-500 shadow-sm">
          {error ?? "Loading invoice…"}
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="mx-auto max-w-2xl print:hidden">
        <div className="mt-4 rounded-xl border border-forest-200 bg-white p-8 text-center shadow-sm">
          <p className="text-base font-semibold text-forest-900">
            Invoice not found
          </p>
          <p className="mt-1 text-sm text-forest-600">
            No order matches “{params.orderId}”.
          </p>
        </div>
      </div>
    );
  }

  const row = invoice;
  const reference = row.reference;

  return (
    <div className="mx-auto max-w-2xl">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #invoice-print-area, #invoice-print-area * { visibility: visible; }
          #invoice-print-area {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
          }
        }
      `}</style>

      <div className="mb-4 flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight text-forest-900">
          Invoice
        </h1>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md border border-forest-600 bg-forest-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-forest-700"
        >
          Print / Save as PDF
        </button>
      </div>

      <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 print:hidden">
        Placeholder layout — the real template, invoice numbering, and
        TIN/business-registration fields come from the team's Google Sheet
        invoice generator, not yet wired in.
      </p>

      <div
        id="invoice-print-area"
        className="rounded-xl border border-forest-200 bg-white p-8 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-forest-200 pb-6 print:border-black">
          <div>
            <p className="text-xl font-bold text-forest-900 print:text-black">
              Ritual Matcha Co.
            </p>
            <p className="text-sm text-forest-600 print:text-black">
              RMC Ritual Trading Corporation
            </p>
            <p className="text-sm text-forest-600 print:text-black">
              ritualmatcha.ph
            </p>
          </div>
          <span
            className={
              row.paid
                ? "inline-flex shrink-0 items-center rounded-full bg-forest-600 px-4 py-1.5 text-sm font-bold tracking-wide text-white print:rounded-none print:border-2 print:border-black print:bg-white print:text-black"
                : "inline-flex shrink-0 items-center rounded-full bg-amber-100 px-4 py-1.5 text-sm font-bold tracking-wide text-amber-900 print:rounded-none print:border-2 print:border-black print:bg-white print:text-black"
            }
          >
            {row.paid ? "PAID" : "AWAITING PAYMENT"}
          </span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-forest-500 print:text-black">Billed to</p>
            <p className="mt-0.5 font-semibold text-forest-900 print:text-black">
              {row.company}
            </p>
          </div>
          <div className="text-right">
            <p className="text-forest-500 print:text-black">{row.paid ? "Date paid" : "Date"}</p>
            <p className="mt-0.5 font-semibold text-forest-900 print:text-black">
              {formatDate(row.date)}
            </p>
          </div>
        </div>

        <div className="mt-2 text-right text-sm">
          <p className="text-forest-500 print:text-black">Reference</p>
          <p className="mt-0.5 font-mono text-forest-900 print:text-black">
            {reference}
          </p>
        </div>

        <div className="mt-6 rounded-lg border border-forest-200 p-4 print:rounded-none print:border-black">
          <p className="text-xs font-semibold uppercase tracking-wide text-forest-500 print:text-black">
            Items
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-forest-900 print:text-black">
            {row.items || "—"}
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-forest-200 pt-4 print:border-black">
          <p className="text-base font-semibold text-forest-900 print:text-black">
            Total
          </p>
          <p className="text-xl font-bold text-forest-900 print:text-black">
            {formatPeso(row.total)}
          </p>
        </div>

        {row.notes && (
          <div className="mt-4 rounded-lg bg-forest-50 p-3 text-sm text-forest-700 print:bg-white print:border print:border-black print:text-black">
            <p className="text-xs font-semibold uppercase tracking-wide text-forest-500 print:text-black">
              Note
            </p>
            <p className="mt-1 whitespace-pre-wrap">{row.notes}</p>
          </div>
        )}

        <div className="mt-8 border-t border-dashed border-forest-200 pt-4 text-sm print:border-black">
          <p className="text-xs font-semibold uppercase tracking-wide text-forest-500 print:text-black">
            Payment details (for your records)
          </p>
          <p className="mt-1 text-forest-700 print:text-black">{BANK_NAME}</p>
          <p className="text-forest-700 print:text-black">
            Account name: {BANK_ACCOUNT_NAME}
          </p>
          <p className="text-forest-700 print:text-black">
            Account number: {BANK_ACCOUNT_NUMBER}
          </p>
        </div>

        <p className="mt-8 text-center text-xs text-forest-400 print:text-black">
          Thank you for your order — Ritual Matcha Co.
        </p>
      </div>
    </div>
  );
}
