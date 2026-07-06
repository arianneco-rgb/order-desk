"use client";

import { useEffect, useMemo, useState } from "react";
import type { OrderHistoryRow } from "@/lib/types";
import { formatPeso } from "@/lib/conversions";
import { SkeletonLines, SkeletonCard } from "@/components/Skeleton";

const ALL_CAFES = "All cafes";

function toDateOnly(iso: string): Date | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseInputDate(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRowDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function firstDayOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function lastDayOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0);
}

interface CafeBreakdown {
  company: string;
  revenue: number;
  count: number;
}

export default function ReportsPage() {
  const [rows, setRows] = useState<OrderHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(() => formatInputDate(firstDayOfMonth()));
  const [to, setTo] = useState(() => formatInputDate(lastDayOfMonth()));
  const [cafe, setCafe] = useState(ALL_CAFES);

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
        if (!cancelled) setError("Couldn't load report data.");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    try {
      const res = await fetch("/api/history");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setError(null);
    } catch {
      setError("Couldn't load report data.");
    }
  }

  const cafeOptions = useMemo(() => {
    const all = rows ?? [];
    const names = Array.from(new Set(all.map((r) => r.company))).sort((a, b) =>
      a.localeCompare(b)
    );
    return [ALL_CAFES, ...names];
  }, [rows]);

  const fromDate = useMemo(() => parseInputDate(from), [from]);
  const toDate = useMemo(() => parseInputDate(to), [to]);

  const filtered = useMemo(() => {
    const all = rows ?? [];
    if (!fromDate || !toDate) return [];
    return all.filter((r) => {
      const paid = toDateOnly(r.paidAt);
      if (!paid) return false;
      if (paid < fromDate || paid > toDate) return false;
      if (cafe !== ALL_CAFES && r.company !== cafe) return false;
      return true;
    });
  }, [rows, fromDate, toDate, cafe]);

  const totalRevenue = useMemo(
    () => filtered.reduce((sum, r) => sum + r.total, 0),
    [filtered]
  );

  const breakdown = useMemo<CafeBreakdown[]>(() => {
    const map = new Map<string, CafeBreakdown>();
    for (const r of filtered) {
      const entry = map.get(r.company) ?? {
        company: r.company,
        revenue: 0,
        count: 0,
      };
      entry.revenue += r.total;
      entry.count += 1;
      map.set(r.company, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [filtered]);

  const rangeLabel =
    fromDate && toDate
      ? `${formatDisplayDate(fromDate)} – ${formatDisplayDate(toDate)}`
      : "—";

  return (
    <div className="mx-auto max-w-3xl">
      <style>{`@media print { body * { visibility: hidden; } #report-print-area, #report-print-area * { visibility: visible; } #report-print-area { position: absolute; top: 0; left: 0; width: 100%; } .print\\:hidden { display: none !important; } }`}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight text-forest-900">
          Reports
        </h1>
        <button
          onClick={refresh}
          className="rounded-md border border-forest-200 px-3 py-1.5 text-sm font-medium text-forest-700 hover:bg-forest-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">
          {error}
        </div>
      )}

      <div className="mt-4 rounded-xl border border-forest-200 bg-white p-5 shadow-sm print:hidden">
        <h2 className="text-base font-semibold text-forest-900">
          Report filters
        </h2>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-forest-700">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-forest-200 px-2.5 py-1.5 text-sm text-forest-900 focus:border-forest-600 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-forest-700">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-forest-200 px-2.5 py-1.5 text-sm text-forest-900 focus:border-forest-600 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-forest-700">
            Cafe
            <select
              value={cafe}
              onChange={(e) => setCafe(e.target.value)}
              className="rounded-md border border-forest-200 px-2.5 py-1.5 text-sm text-forest-900 focus:border-forest-600 focus:outline-none"
            >
              {cafeOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => window.print()}
            className="ml-auto rounded-md bg-forest-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-800"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      <div id="report-print-area" className="mt-4">
        <h1 className="hidden text-xl font-semibold text-forest-900 print:block">
          Ritual Matcha Co. — Sales Report
        </h1>
        <p className="mt-1 text-sm text-forest-600">
          Report: {rangeLabel}
          {cafe !== ALL_CAFES ? ` · ${cafe}` : ""}
        </p>

        {rows === null ? (
          <div className="mt-4 space-y-3">
            <SkeletonCard />
            <div className="rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
              <SkeletonLines lines={4} />
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-forest-500">Total revenue</p>
                <p className="mt-1 text-2xl font-bold text-forest-900">
                  {formatPeso(totalRevenue)}
                </p>
              </div>
              <div className="rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-forest-500">Orders</p>
                <p className="mt-1 text-2xl font-bold text-forest-900">
                  {filtered.length}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-forest-900">
                Orders in range
              </h2>
              {filtered.length === 0 ? (
                <div className="mt-4 rounded-lg border-2 border-dashed border-forest-200 p-8 text-center text-sm text-forest-500">
                  No paid orders in this range.
                </div>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-forest-200 text-left text-forest-500">
                        <th className="py-2 pr-3 font-medium">Date</th>
                        <th className="py-2 pr-3 font-medium">Cafe</th>
                        <th className="py-2 pr-3 font-medium">Items</th>
                        <th className="py-2 pr-3 text-right font-medium">
                          Total
                        </th>
                        <th className="py-2 pl-3 font-medium">Ref</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row) => (
                        <tr
                          key={`${row.orderId}-${row.paidAt}`}
                          className="border-b border-forest-100 text-forest-900 last:border-0"
                        >
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {formatRowDate(row.paidAt)}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap">{row.company}</td>
                          <td className="py-2 pr-3 text-forest-600">
                            {row.items || "—"}
                          </td>
                          <td className="py-2 pr-3 text-right font-semibold whitespace-nowrap">
                            {formatPeso(row.total)}
                          </td>
                          <td className="py-2 pl-3 text-forest-600 whitespace-nowrap">
                            {row.shopifyDraftName || row.orderId}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {cafe === ALL_CAFES && filtered.length > 0 && (
              <div className="mt-4 rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-forest-900">
                  Per-cafe breakdown
                </h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[360px] text-sm">
                    <thead>
                      <tr className="border-b border-forest-200 text-left text-forest-500">
                        <th className="py-2 pr-3 font-medium">Cafe</th>
                        <th className="py-2 pr-3 text-right font-medium">
                          Revenue
                        </th>
                        <th className="py-2 pl-3 text-right font-medium">
                          Orders
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdown.map((b) => (
                        <tr
                          key={b.company}
                          className="border-b border-forest-100 text-forest-900 last:border-0"
                        >
                          <td className="py-2 pr-3 whitespace-nowrap">{b.company}</td>
                          <td className="py-2 pr-3 text-right font-semibold whitespace-nowrap">
                            {formatPeso(b.revenue)}
                          </td>
                          <td className="py-2 pl-3 text-right">{b.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
