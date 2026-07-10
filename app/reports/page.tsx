"use client";

import { useEffect, useMemo, useState } from "react";
import type { CafeCustomer } from "@/lib/types";
import type { ReportData } from "@/lib/reports";
import { formatPeso } from "@/lib/conversions";
import { SkeletonLines, SkeletonCard } from "@/components/Skeleton";
import { compactPeso, HBars, StatCard, TimeBars } from "@/components/reports/charts";

const ALL_CAFES = "All cafes";
const MAX_TABLE_ROWS = 200;

function formatInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDisplayDate(input: string): string {
  const [y, m, d] = input.split("-").map(Number);
  if (!y || !m || !d) return input;
  return new Date(y, m - 1, d).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRowDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function formatKg(kg: number): string {
  return `${kg % 1 === 0 ? kg : kg.toFixed(1)}kg`;
}

/** Quick presets — the ranges the team actually asks about. */
function presets(): { label: string; from: string; to: string }[] {
  const now = new Date();
  const today = formatInputDate(now);
  const monthStart = formatInputDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const lastMonthStart = formatInputDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lastMonthEnd = formatInputDate(new Date(now.getFullYear(), now.getMonth(), 0));
  const days30 = formatInputDate(new Date(now.getTime() - 29 * 86_400_000));
  const days90 = formatInputDate(new Date(now.getTime() - 89 * 86_400_000));
  const yearStart = formatInputDate(new Date(now.getFullYear(), 0, 1));
  return [
    { label: "This month", from: monthStart, to: today },
    { label: "Last month", from: lastMonthStart, to: lastMonthEnd },
    { label: "Last 30 days", from: days30, to: today },
    { label: "Last 90 days", from: days90, to: today },
    { label: "Year to date", from: yearStart, to: today },
  ];
}

export default function ReportsPage() {
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(() => formatInputDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(() => formatInputDate(new Date()));
  const [cafe, setCafe] = useState(ALL_CAFES);
  const [segment, setSegment] = useState<"all" | "wholesale" | "retail">("all");
  const [cafeOptions, setCafeOptions] = useState<string[]>([ALL_CAFES]);

  // Cafe filter options come from the same customer list the rest of the app uses.
  useEffect(() => {
    fetch("/api/customers")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.customers) return;
        const names = (d.customers as CafeCustomer[]).map((c) => c.name).sort((a, b) => a.localeCompare(b));
        setCafeOptions([ALL_CAFES, ...names]);
      })
      .catch(() => {});
  }, []);

  // Build the report whenever the filters settle (debounced for date typing).
  useEffect(() => {
    if (!from || !to || from > to) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ from, to, segment });
        if (cafe !== ALL_CAFES) params.set("company", cafe);
        const res = await fetch(`/api/reports?${params}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setReport(data.report);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load report data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [from, to, cafe, segment]);

  const rangeLabel = `${formatDisplayDate(from)} – ${formatDisplayDate(to)}`;
  const prevLabel = report ? `${formatDisplayDate(report.prevFrom)} – ${formatDisplayDate(report.prevTo)}` : "";

  const topProducts = useMemo(() => (report?.topProducts ?? []).slice(0, 8), [report]);
  const topCafes = useMemo(() => (report?.cafeStats ?? []).slice(0, 8), [report]);
  const productRevenue = useMemo(
    () => (report?.topProducts ?? []).reduce((s, p) => s + p.revenue, 0),
    [report]
  );

  return (
    <div className="mx-auto max-w-4xl">
      <style>{`@media print { body * { visibility: hidden; } #report-print-area, #report-print-area * { visibility: visible; } #report-print-area { position: absolute; top: 0; left: 0; width: 100%; } .print\\:hidden { display: none !important; } .break-inside-avoid { break-inside: avoid; } }`}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight text-forest-900">Reports</h1>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="mt-4 rounded-xl border border-forest-200 bg-white p-5 shadow-sm print:hidden">
        <div className="flex flex-wrap items-end gap-4">
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
            Segment
            <select
              value={segment}
              onChange={(e) => setSegment(e.target.value as "all" | "wholesale" | "retail")}
              className="rounded-md border border-forest-200 px-2.5 py-1.5 text-sm text-forest-900 focus:border-forest-600 focus:outline-none"
            >
              <option value="all">All orders</option>
              <option value="wholesale">Wholesale only</option>
              <option value="retail">Retail only</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-forest-700">
            Cafe
            <select
              value={cafe}
              onChange={(e) => setCafe(e.target.value)}
              className="max-w-56 rounded-md border border-forest-200 px-2.5 py-1.5 text-sm text-forest-900 focus:border-forest-600 focus:outline-none"
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
        <div className="mt-3 flex flex-wrap gap-1.5">
          {presets().map((p) => (
            <button
              key={p.label}
              onClick={() => {
                setFrom(p.from);
                setTo(p.to);
              }}
              className="rounded-full border border-forest-200 px-2.5 py-1 text-xs font-medium text-forest-700 hover:bg-forest-50"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div id="report-print-area" className="mt-4">
        {/* Report header */}
        <div className="break-inside-avoid">
          <h1 className="hidden text-xl font-semibold text-forest-900 print:block">
            Ritual Matcha Co. — Sales Report
          </h1>
          <p className="mt-1 text-sm text-forest-600">
            {rangeLabel}
            {cafe !== ALL_CAFES ? ` · ${cafe}` : ""}
            {segment !== "all" ? ` · ${segment}` : ""}
            {report && (
              <span className="text-forest-500">
                {" "}
                · compared with {prevLabel} ·{" "}
                {report.source === "shopify"
                  ? "all Shopify orders (paid)"
                  : "app-recorded orders only (demo mode)"}
              </span>
            )}
          </p>
          {report?.truncated && (
            <p className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
              ⚠️ This range has more than 1,000 orders — numbers below cover the most recent
              1,000. Narrow the range for exact totals.
            </p>
          )}
        </div>

        {loading || !report ? (
          <div className="mt-4 space-y-3">
            <SkeletonCard />
            <div className="rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
              <SkeletonLines lines={6} />
            </div>
          </div>
        ) : (
          <>
            {/* Headline stats */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <StatCard label="Revenue" value={formatPeso(report.revenue.current)} stat={report.revenue} />
              <StatCard label="Paid orders" value={String(report.orders.current)} stat={report.orders} />
              <StatCard label="Average order" value={formatPeso(report.aov.current)} stat={report.aov} />
              <StatCard label="Matcha sold" value={formatKg(report.kg.current)} stat={report.kg} />
              <StatCard label={segment === "wholesale" ? "Active cafes" : "Active customers"} value={String(report.cafes.current)} stat={report.cafes} sub={report.newCafes.length > 0 ? `${report.newCafes.length} new this period` : undefined} />
              <StatCard label="Samples sold" value={String(report.samples.current)} stat={report.samples} />
              <StatCard label="Discounts given" value={formatPeso(report.discounts.current)} stat={report.discounts} downIsGood />
              <StatCard
                label="Busiest day"
                value={
                  report.series.length > 0
                    ? report.series.reduce((a, b) => (b.revenue > a.revenue ? b : a)).label
                    : "—"
                }
                sub={
                  report.series.length > 0
                    ? compactPeso(Math.max(...report.series.map((s) => s.revenue)))
                    : undefined
                }
              />
            </div>
            <p className="mt-1.5 text-[11px] text-forest-500">
              ▲▼ compare with the previous period of the same length ({prevLabel}).
            </p>

            {/* Revenue over time */}
            <div className="mt-4 break-inside-avoid rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-forest-900">
                Revenue over time{" "}
                <span className="text-sm font-normal text-forest-500">
                  (per {report.bucketUnit})
                </span>
              </h2>
              {report.revenue.current === 0 ? (
                <p className="mt-3 text-sm text-forest-500">No paid orders in this range.</p>
              ) : (
                <TimeBars series={report.series} />
              )}
            </div>

            {/* Products + cafes, side by side on screen, stacked in print */}
            {report.topProducts.length > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="break-inside-avoid rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
                  <h2 className="text-base font-semibold text-forest-900">Top products</h2>
                  <HBars
                    items={topProducts.map((p) => ({
                      label: p.title,
                      value: p.revenue,
                      display: compactPeso(p.revenue),
                      sub: p.kg > 0 ? formatKg(p.kg) : p.samples > 0 ? `${p.samples} samples` : undefined,
                    }))}
                  />
                </div>
                <div className="break-inside-avoid rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
                  <h2 className="text-base font-semibold text-forest-900">Top cafes</h2>
                  <HBars
                    items={topCafes.map((c) => ({
                      label: c.name,
                      value: c.revenue,
                      display: compactPeso(c.revenue),
                      sub: `${c.orders} order${c.orders === 1 ? "" : "s"}${c.kg > 0 ? ` · ${formatKg(c.kg)}` : ""}`,
                    }))}
                  />
                </div>
              </div>
            )}

            {/* Product table with revenue share */}
            {report.topProducts.length > 0 && (
              <div className="mt-4 break-inside-avoid rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-forest-900">Product breakdown</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead>
                      <tr className="border-b border-forest-200 text-left text-forest-500">
                        <th className="py-2 pr-3 font-medium">Product</th>
                        <th className="py-2 pr-3 text-right font-medium">Volume</th>
                        <th className="py-2 pr-3 text-right font-medium">Samples</th>
                        <th className="py-2 pr-3 text-right font-medium">Revenue</th>
                        <th className="py-2 pl-3 text-right font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.topProducts.map((p) => (
                        <tr key={p.title} className="border-b border-forest-100 text-forest-900 last:border-0">
                          <td className="py-2 pr-3">{p.title}</td>
                          <td className="py-2 pr-3 text-right whitespace-nowrap">{p.kg > 0 ? formatKg(p.kg) : "—"}</td>
                          <td className="py-2 pr-3 text-right">{p.samples || "—"}</td>
                          <td className="py-2 pr-3 text-right font-semibold whitespace-nowrap">{formatPeso(p.revenue)}</td>
                          <td className="py-2 pl-3 text-right text-forest-600">
                            {productRevenue > 0 ? `${((p.revenue / productRevenue) * 100).toFixed(1)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* New cafes + delivery split */}
            {(report.newCafes.length > 0 || report.deliverySplit.length > 0) && (
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                {report.newCafes.length > 0 && (
                  <div className="break-inside-avoid rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
                    <h2 className="text-base font-semibold text-forest-900">
                      New cafes this period{" "}
                      <span className="text-sm font-normal text-forest-500">
                        (first-ever order)
                      </span>
                    </h2>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {report.newCafes.map((name) => (
                        <span key={name} className="rounded-full bg-forest-100 px-2.5 py-1 text-xs font-medium text-forest-800">
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {report.deliverySplit.length > 0 && (
                  <div className="break-inside-avoid rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
                    <h2 className="text-base font-semibold text-forest-900">
                      Delivery methods{" "}
                      <span className="text-sm font-normal text-forest-500">
                        (orders tagged by the Order Desk)
                      </span>
                    </h2>
                    <HBars
                      items={report.deliverySplit.map((d) => ({
                        label: d.label,
                        value: d.orders,
                        display: `${d.orders} order${d.orders === 1 ? "" : "s"}`,
                      }))}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Cafe table */}
            {cafe === ALL_CAFES && report.cafeStats.length > 0 && (
              <div className="mt-4 rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-forest-900">Per-cafe breakdown</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead>
                      <tr className="border-b border-forest-200 text-left text-forest-500">
                        <th className="py-2 pr-3 font-medium">Cafe</th>
                        <th className="py-2 pr-3 text-right font-medium">Orders</th>
                        <th className="py-2 pr-3 text-right font-medium">Volume</th>
                        <th className="py-2 pl-3 text-right font-medium">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.cafeStats.map((c) => (
                        <tr key={c.name} className="border-b border-forest-100 text-forest-900 last:border-0">
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {c.name}
                            {report.newCafes.includes(c.name) && (
                              <span className="ml-1.5 rounded bg-forest-100 px-1 py-0.5 text-[10px] font-semibold text-forest-700">
                                NEW
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right">{c.orders}</td>
                          <td className="py-2 pr-3 text-right whitespace-nowrap">{c.kg > 0 ? formatKg(c.kg) : "—"}</td>
                          <td className="py-2 pl-3 text-right font-semibold whitespace-nowrap">{formatPeso(c.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Order list */}
            <div className="mt-4 rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-forest-900">
                Orders in range{" "}
                <span className="text-sm font-normal text-forest-500">({report.rows.length})</span>
              </h2>
              {report.rows.length === 0 ? (
                <div className="mt-4 rounded-lg border-2 border-dashed border-forest-200 p-8 text-center text-sm text-forest-500">
                  No paid orders in this range.
                </div>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-forest-200 text-left text-forest-500">
                        <th className="py-2 pr-3 font-medium">Date</th>
                        <th className="py-2 pr-3 font-medium">Ref</th>
                        <th className="py-2 pr-3 font-medium">Cafe</th>
                        <th className="py-2 pr-3 font-medium">Items</th>
                        <th className="py-2 pl-3 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.slice(0, MAX_TABLE_ROWS).map((row) => (
                        <tr key={`${row.ref}-${row.date}`} className="border-b border-forest-100 text-forest-900 last:border-0">
                          <td className="py-2 pr-3 whitespace-nowrap">{formatRowDate(row.date)}</td>
                          <td className="py-2 pr-3 whitespace-nowrap text-forest-600">{row.ref}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{row.cafe}</td>
                          <td className="py-2 pr-3 text-forest-600">{row.items || "—"}</td>
                          <td className="py-2 pl-3 text-right font-semibold whitespace-nowrap">{formatPeso(row.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {report.rows.length > MAX_TABLE_ROWS && (
                    <p className="mt-2 text-xs text-forest-500">
                      Showing the first {MAX_TABLE_ROWS} of {report.rows.length} orders — totals
                      above still cover everything.
                    </p>
                  )}
                </div>
              )}
            </div>

            <p className="mt-3 text-[11px] text-forest-400">
              Generated {new Date().toLocaleString("en-PH")} · Ritual Matcha Co. Order Desk
            </p>
          </>
        )}
      </div>
    </div>
  );
}
