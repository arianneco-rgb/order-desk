import { NextResponse } from "next/server";
import { listOrderHistory } from "@/lib/sheets";
import type { OrderHistoryRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const DAYS = 30;

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

function toDateKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function computeTopCafes(rows: OrderHistoryRow[]): TopCafe[] {
  const byCompany = new Map<string, TopCafe>();
  for (const row of rows) {
    const existing = byCompany.get(row.company);
    if (existing) {
      existing.revenue += row.total;
      existing.orderCount += 1;
    } else {
      byCompany.set(row.company, {
        company: row.company,
        revenue: row.total,
        orderCount: 1,
      });
    }
  }
  return Array.from(byCompany.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

function computeRevenueByDay(rows: OrderHistoryRow[]): RevenueDay[] {
  const byDay = new Map<string, RevenueDay>();
  for (const row of rows) {
    const key = toDateKey(row.paidAt);
    if (!key) continue;
    const existing = byDay.get(key);
    if (existing) {
      existing.revenue += row.total;
      existing.orderCount += 1;
    } else {
      byDay.set(key, { date: key, revenue: row.total, orderCount: 1 });
    }
  }

  // Build a continuous window of the last DAYS days (including today), zero-filled.
  const days: RevenueDay[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const existing = byDay.get(key);
    days.push(existing ?? { date: key, revenue: 0, orderCount: 0 });
  }
  return days;
}

/**
 * Best-effort parse of the human-readable `items` field, e.g.
 * "2 cases of Kasane, 5 pouches of Shizu, and 5 pouches of Yasumi".
 * Extracts the text after " of " up to the next joiner (", and ", " and ", ", ") or end.
 */
function parseVariants(items: string): string[] {
  const matches = items.matchAll(
    / of\s+(.+?)(?:,\s*and\s+|,\s*|\s+and\s+|$)/g
  );
  const variants: string[] = [];
  for (const m of matches) {
    const name = m[1]?.trim();
    if (name) variants.push(name);
  }
  return variants;
}

function computeVariantBreakdown(rows: OrderHistoryRow[]): VariantCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    try {
      const variants = parseVariants(row.items);
      for (const variant of variants) {
        counts.set(variant, (counts.get(variant) ?? 0) + 1);
      }
    } catch {
      // best-effort parsing — skip this row's contribution on failure
      continue;
    }
  }
  return Array.from(counts.entries())
    .map(([variant, count]) => ({ variant, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

/** Analytics page data: aggregates computed from the Order History sheet. */
export async function GET() {
  try {
    const rows = await listOrderHistory();

    const orderCount = rows.length;
    const totalRevenue = rows.reduce((sum, r) => sum + r.total, 0);
    const avgOrderValue = orderCount === 0 ? 0 : totalRevenue / orderCount;

    const topCafes = computeTopCafes(rows);
    const revenueByDay = computeRevenueByDay(rows);
    const variantBreakdown = computeVariantBreakdown(rows);

    return NextResponse.json({
      totalRevenue,
      orderCount,
      avgOrderValue,
      topCafes,
      revenueByDay,
      variantBreakdown,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't load analytics." },
      { status: 502 }
    );
  }
}
