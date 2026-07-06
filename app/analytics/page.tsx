"use client";

import { useEffect, useState } from "react";
import { formatPeso } from "@/lib/conversions";
import { SkeletonCard, SkeletonLines } from "@/components/Skeleton";

const POLL_MS = 30_000;

interface TopCafe {
  company: string;
  revenue: number;
  orderCount: number;
}

interface RevenueDay {
  date: string;
  revenue: number;
  orderCount: number;
}

interface VariantCount {
  variant: string;
  count: number;
}

interface AnalyticsData {
  totalRevenue: number;
  orderCount: number;
  avgOrderValue: number;
  topCafes: TopCafe[];
  revenueByDay: RevenueDay[];
  variantBreakdown: VariantCount[];
}

function formatShortDate(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/analytics");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setData(json as AnalyticsData);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Couldn't load analytics — retrying…");
      }
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const isEmpty = data !== null && data.orderCount === 0;
  const maxDayRevenue = data
    ? Math.max(1, ...data.revenueByDay.map((d) => d.revenue))
    : 1;
  const maxVariantCount = data
    ? Math.max(1, ...data.variantBreakdown.map((v) => v.count))
    : 1;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-forest-900">
        Analytics
      </h1>
      <p className="mt-1 text-sm text-forest-600">
        Revenue and order trends across all paid orders.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary cards */}
      {data === null ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-forest-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-forest-600">Total Revenue</p>
            <p className="mt-1 text-2xl font-bold text-forest-900">
              {formatPeso(data.totalRevenue)}
            </p>
          </div>
          <div className="rounded-xl border border-forest-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-forest-600">Total Paid Orders</p>
            <p className="mt-1 text-2xl font-bold text-forest-900">
              {data.orderCount.toLocaleString("en-PH")}
            </p>
          </div>
          <div className="rounded-xl border border-forest-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-forest-600">Average Order Value</p>
            <p className="mt-1 text-2xl font-bold text-forest-900">
              {formatPeso(data.avgOrderValue)}
            </p>
          </div>
        </div>
      )}

      {isEmpty && (
        <div className="mt-4 rounded-lg border-2 border-dashed border-forest-200 p-8 text-center text-sm text-forest-500">
          No paid orders yet — analytics will populate once payments start
          landing in the Order History sheet.
        </div>
      )}

      {!isEmpty && (
        <>
          {/* Top Cafes */}
          <div className="mt-6 rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-forest-900">
              Top Cafes
            </h2>
            <div className="mt-4">
              {data === null ? (
                <SkeletonLines lines={5} />
              ) : data.topCafes.length === 0 ? (
                <p className="text-sm text-forest-500">No cafe data yet.</p>
              ) : (
                <ol className="divide-y divide-forest-100">
                  {data.topCafes.map((cafe, i) => (
                    <li
                      key={cafe.company}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-forest-100 text-xs font-semibold text-forest-700">
                          {i + 1}
                        </span>
                        <span className="truncate text-sm font-medium text-forest-900">
                          {cafe.company}
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-forest-900">
                          {formatPeso(cafe.revenue)}
                        </p>
                        <p className="text-xs text-forest-500">
                          {cafe.orderCount}{" "}
                          {cafe.orderCount === 1 ? "order" : "orders"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          {/* Best-Selling Variants */}
          <div className="mt-6 rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-forest-900">
              Best-Selling Variants
            </h2>
            <div className="mt-4">
              {data === null ? (
                <SkeletonLines lines={5} />
              ) : data.variantBreakdown.length === 0 ? (
                <p className="text-sm text-forest-500">
                  No variant data yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.variantBreakdown.map((v) => (
                    <div key={v.variant}>
                      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                        <span className="truncate font-medium text-forest-900">
                          {v.variant}
                        </span>
                        <span className="shrink-0 text-forest-600">
                          {v.count}
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-forest-100">
                        <div
                          className="h-2 rounded-full bg-forest-500"
                          style={{
                            width: `${Math.max(
                              4,
                              (v.count / maxVariantCount) * 100
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Revenue last 30 days */}
          <div className="mt-6 rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-forest-900">
              Revenue — last 30 days
            </h2>
            <div className="mt-4">
              {data === null ? (
                <Skeleton30 />
              ) : (
                <div className="flex h-32 items-end gap-1">
                  {data.revenueByDay.map((day) => {
                    const heightPct = Math.max(
                      4,
                      (day.revenue / maxDayRevenue) * 100
                    );
                    return (
                      <div
                        key={day.date}
                        title={`${formatShortDate(day.date)}: ${formatPeso(
                          day.revenue
                        )} (${day.orderCount} ${
                          day.orderCount === 1 ? "order" : "orders"
                        })`}
                        className="flex-1 rounded-t bg-forest-400 transition-colors hover:bg-forest-600"
                        style={{ height: `${heightPct}%` }}
                      />
                    );
                  })}
                </div>
              )}
              {data !== null && (
                <div className="mt-2 flex justify-between text-xs text-forest-500">
                  <span>{formatShortDate(data.revenueByDay[0]?.date ?? "")}</span>
                  <span>
                    {formatShortDate(
                      data.revenueByDay[data.revenueByDay.length - 1]?.date ??
                        ""
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Skeleton30() {
  return (
    <div className="flex h-32 items-end gap-1">
      {Array.from({ length: 30 }).map((_, i) => (
        <div
          key={i}
          className="flex-1 animate-pulse rounded-t bg-forest-100"
          style={{ height: `${20 + (i % 5) * 15}%` }}
        />
      ))}
    </div>
  );
}
