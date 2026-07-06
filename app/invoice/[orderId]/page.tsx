"use client";

import { useEffect, useState } from "react";
import type { OrderHistoryRow } from "@/lib/types";
import { formatPeso } from "@/lib/conversions";

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

export default function InvoicePage({
  params,
}: {
  params: { orderId: string };
}) {
  const [rows, setRows] = useState<OrderHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/history");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setRows(Array.isArray(data.rows) ? data.rows : []);
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
  }, []);

  const row = rows?.find((r) => r.orderId === params.orderId) ?? null;

  if (rows === null) {
    return (
      <div className="mx-auto max-w-2xl print:hidden">
        <div className="mt-4 rounded-xl border border-forest-200 bg-white p-8 text-center text-sm text-forest-500 shadow-sm">
          {error ?? "Loading invoice…"}
        </div>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="mx-auto max-w-2xl print:hidden">
        <div className="mt-4 rounded-xl border border-forest-200 bg-white p-8 text-center shadow-sm">
          <p className="text-base font-semibold text-forest-900">
            Invoice not found
          </p>
          <p className="mt-1 text-sm text-forest-600">
            No paid order matches “{params.orderId}”. It may not exist, or it
            hasn't been marked paid yet.
          </p>
        </div>
      </div>
    );
  }

  const reference = row.shopifyDraftName || row.orderId;

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
          <span className="inline-flex shrink-0 items-center rounded-full bg-forest-600 px-4 py-1.5 text-sm font-bold tracking-wide text-white print:rounded-none print:border-2 print:border-black print:bg-white print:text-black">
            PAID
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
            <p className="text-forest-500 print:text-black">Date paid</p>
            <p className="mt-0.5 font-semibold text-forest-900 print:text-black">
              {formatDate(row.paidAt)}
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
