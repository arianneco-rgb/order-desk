// Report aggregation — turns raw Shopify orders (lib/shopify.ts
// getOrdersInRange) into everything the Reports page renders: headline
// stats with previous-period deltas, a revenue time series, product volume
// in kg, cafe rankings, first-time cafes, and the delivery-method split.
// Pure functions, no I/O — the API route feeds it.

import type { RawReportOrder } from "./shopify";
import type { OrderHistoryRow } from "./types";

export interface ReportStat {
  current: number;
  previous: number;
}

export interface ReportBucket {
  /** e.g. "Jun 2" (day/week start) or "Jun 2026" (month). */
  label: string;
  revenue: number;
  orders: number;
}

export interface ProductStat {
  title: string;
  kg: number;
  samples: number;
  revenue: number;
}

export interface CafeStat {
  name: string;
  orders: number;
  revenue: number;
  kg: number;
}

export interface ReportOrderRow {
  date: string;
  ref: string;
  cafe: string;
  items: string;
  total: number;
}

export interface ReportData {
  /** "shopify" = every store order; "app" = only app-recorded paid orders. */
  source: "shopify" | "app";
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  revenue: ReportStat;
  orders: ReportStat;
  aov: ReportStat;
  cafes: ReportStat;
  kg: ReportStat;
  samples: ReportStat;
  discounts: ReportStat;
  bucketUnit: "day" | "week" | "month";
  series: ReportBucket[];
  topProducts: ProductStat[];
  cafeStats: CafeStat[];
  newCafes: string[];
  deliverySplit: { label: string; orders: number }[];
  rows: ReportOrderRow[];
  truncated: boolean;
}

/** Orders that count as money in the till. */
const PAID_STATUSES = new Set(["PAID", "PARTIALLY_REFUNDED"]);

export function isPaidStatus(status: string): boolean {
  return PAID_STATUSES.has(status);
}

/** Kilograms represented by one line item (samples excluded — tracked apart). */
function lineKg(li: { sku: string; variantTitle: string; quantity: number }): number {
  if (li.sku.startsWith("SAM-")) return 0;
  const v = li.variantTitle.toLowerCase();
  if (v.includes("case")) return li.quantity * 2;
  if (/\b1\s*kg\b/.test(v)) return li.quantity * 1;
  if (/\b200\s*g\b/.test(v)) return li.quantity * 0.2;
  return 0; // custom lines carry no weight (old paid orders may still have a manual "VAT (12%)" line from before VAT became Shopify tax)
}

function lineSamples(li: { sku: string; quantity: number }): number {
  return li.sku.startsWith("SAM-") ? li.quantity : 0;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── Date helpers (PH-local day bucketing) ────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(input: string): Date {
  const [y, m, d] = input.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortLabel(d: Date): string {
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-PH", { month: "short", year: "numeric" });
}

/** The previous window of the same length, ending the day before `from`. */
export function previousRange(from: string, to: string): { prevFrom: string; prevTo: string } {
  const fromD = parseDay(from);
  const toD = parseDay(to);
  const days = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / DAY_MS) + 1);
  const prevTo = new Date(fromD.getTime() - DAY_MS);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * DAY_MS);
  return { prevFrom: dayKey(prevFrom), prevTo: dayKey(prevTo) };
}

/** Zero-filled buckets across the whole range so charts show gaps honestly. */
function buildSeries(
  from: string,
  to: string,
  orders: { createdAt: string; total: number }[]
): { bucketUnit: ReportData["bucketUnit"]; series: ReportBucket[] } {
  const fromD = parseDay(from);
  const toD = parseDay(to);
  const days = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / DAY_MS) + 1);
  const bucketUnit: ReportData["bucketUnit"] = days <= 31 ? "day" : days <= 130 ? "week" : "month";

  const keyFor = (d: Date): string => {
    if (bucketUnit === "day") return dayKey(d);
    if (bucketUnit === "week") {
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return dayKey(monday < fromD ? fromD : monday);
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  };

  // Seed every bucket in the range with zeroes.
  const buckets = new Map<string, ReportBucket>();
  for (let t = fromD.getTime(); t <= toD.getTime(); t += DAY_MS) {
    const d = new Date(t);
    const key = keyFor(d);
    if (!buckets.has(key)) {
      buckets.set(key, {
        label: bucketUnit === "month" ? monthLabel(d) : shortLabel(parseDay(key)),
        revenue: 0,
        orders: 0,
      });
    }
  }

  for (const order of orders) {
    const d = new Date(order.createdAt);
    const bucket = buckets.get(keyFor(new Date(d.getFullYear(), d.getMonth(), d.getDate())));
    if (!bucket) continue; // outside the range (shouldn't happen)
    bucket.revenue = round2(bucket.revenue + order.total);
    bucket.orders += 1;
  }

  return { bucketUnit, series: Array.from(buckets.values()) };
}

// ── Aggregation over raw Shopify orders ──────────────────────────────────

interface Totals {
  revenue: number;
  orders: number;
  cafes: number;
  kg: number;
  samples: number;
  discounts: number;
}

function totalsOf(orders: RawReportOrder[]): Totals {
  const cafes = new Set<string>();
  let revenue = 0;
  let kg = 0;
  let samples = 0;
  let discounts = 0;
  for (const o of orders) {
    cafes.add(o.cafe);
    revenue += o.total;
    discounts += o.discounts;
    for (const li of o.lineItems) {
      kg += lineKg(li);
      samples += lineSamples(li);
    }
  }
  return {
    revenue: round2(revenue),
    orders: orders.length,
    cafes: cafes.size,
    kg: round2(kg),
    samples,
    discounts: round2(discounts),
  };
}

/** "2× Kasane Case (10 x 200g), 1× Mitsu 200g" — compact row summary. */
function itemsSummary(order: RawReportOrder): string {
  return order.lineItems
    .map((li) =>
      li.variantTitle && li.variantTitle !== "Default Title"
        ? `${li.quantity}× ${li.title} ${li.variantTitle}`
        : `${li.quantity}× ${li.title}`
    )
    .join(", ");
}

export type ReportSegment = "all" | "wholesale" | "retail";

export function aggregateShopifyReport(input: {
  from: string;
  to: string;
  current: RawReportOrder[];
  previous: RawReportOrder[];
  company?: string;
  segment?: ReportSegment;
  truncated: boolean;
}): ReportData {
  const byCompany = (o: RawReportOrder): boolean =>
    !input.company || o.cafe.toLowerCase() === input.company.toLowerCase();
  const bySegment = (o: RawReportOrder): boolean => {
    if (!input.segment || input.segment === "all") return true;
    const wholesale = (o.customerTags ?? []).some((t) => t.toLowerCase() === "wholesale");
    return input.segment === "wholesale" ? wholesale : !wholesale;
  };

  const include = (o: RawReportOrder): boolean =>
    isPaidStatus(o.financialStatus) && byCompany(o) && bySegment(o);
  const current = input.current.filter(include);
  const previous = input.previous.filter(include);

  const cur = totalsOf(current);
  const prev = totalsOf(previous);
  const { prevFrom, prevTo } = previousRange(input.from, input.to);

  // Products: group line items by product title.
  const products = new Map<string, ProductStat>();
  for (const o of current) {
    for (const li of o.lineItems) {
      const entry = products.get(li.title) ?? { title: li.title, kg: 0, samples: 0, revenue: 0 };
      entry.kg = round2(entry.kg + lineKg(li));
      entry.samples += lineSamples(li);
      entry.revenue = round2(entry.revenue + li.amount);
      products.set(li.title, entry);
    }
  }

  // Cafes: revenue ranking + first-time detection.
  const cafeMap = new Map<string, CafeStat & { inRange: number; lifetime: number }>();
  for (const o of current) {
    const entry =
      cafeMap.get(o.cafe) ??
      ({ name: o.cafe, orders: 0, revenue: 0, kg: 0, inRange: 0, lifetime: o.customerLifetimeOrders } as CafeStat & {
        inRange: number;
        lifetime: number;
      });
    entry.orders += 1;
    entry.inRange += 1;
    entry.revenue = round2(entry.revenue + o.total);
    entry.kg = round2(entry.kg + o.lineItems.reduce((s, li) => s + lineKg(li), 0));
    cafeMap.set(o.cafe, entry);
  }
  const cafeStats = Array.from(cafeMap.values()).sort((a, b) => b.revenue - a.revenue);
  // A cafe whose lifetime order count equals its in-range count placed their
  // first-ever order inside this window.
  const newCafes = cafeStats
    .filter((c) => c.lifetime > 0 && c.lifetime <= c.inRange)
    .map((c) => c.name);

  // Delivery split from the app's "Delivery: …" draft tags (app-era orders only).
  const delivery = new Map<string, number>();
  for (const o of current) {
    const tag = o.tags.find((t) => t.startsWith("Delivery: "));
    if (tag) delivery.set(tag.slice(10), (delivery.get(tag.slice(10)) ?? 0) + 1);
  }

  return {
    source: "shopify",
    from: input.from,
    to: input.to,
    prevFrom,
    prevTo,
    revenue: { current: cur.revenue, previous: prev.revenue },
    orders: { current: cur.orders, previous: prev.orders },
    aov: {
      current: cur.orders ? round2(cur.revenue / cur.orders) : 0,
      previous: prev.orders ? round2(prev.revenue / prev.orders) : 0,
    },
    cafes: { current: cur.cafes, previous: prev.cafes },
    kg: { current: cur.kg, previous: prev.kg },
    samples: { current: cur.samples, previous: prev.samples },
    discounts: { current: cur.discounts, previous: prev.discounts },
    ...buildSeries(input.from, input.to, current),
    topProducts: Array.from(products.values()).sort((a, b) => b.revenue - a.revenue),
    cafeStats: cafeStats.map(({ inRange: _i, lifetime: _l, ...c }) => c),
    newCafes,
    deliverySplit: Array.from(delivery.entries())
      .map(([label, orders]) => ({ label, orders }))
      .sort((a, b) => b.orders - a.orders),
    rows: current.map((o) => ({
      date: o.createdAt,
      ref: o.name,
      cafe: o.cafe,
      items: itemsSummary(o),
      total: o.total,
    })),
    truncated: input.truncated,
  };
}

// ── Mock-mode fallback: app-recorded history only ────────────────────────

export function aggregateAppReport(input: {
  from: string;
  to: string;
  rows: OrderHistoryRow[];
  company?: string;
}): ReportData {
  const { prevFrom, prevTo } = previousRange(input.from, input.to);
  const inRange = (paidAt: string, from: string, to: string): boolean => {
    const key = dayKey(new Date(paidAt));
    return key >= from && key <= to;
  };
  const byCompany = (r: OrderHistoryRow): boolean =>
    !input.company || r.company.toLowerCase() === input.company.toLowerCase();

  const all = input.rows.filter((r) => !r.isTest && byCompany(r));
  const current = all.filter((r) => inRange(r.paidAt, input.from, input.to));
  const previous = all.filter((r) => inRange(r.paidAt, prevFrom, prevTo));

  const sum = (rows: OrderHistoryRow[]): number => round2(rows.reduce((s, r) => s + r.total, 0));
  const cafes = (rows: OrderHistoryRow[]): number => new Set(rows.map((r) => r.company)).size;

  const cafeMap = new Map<string, CafeStat>();
  for (const r of current) {
    const entry = cafeMap.get(r.company) ?? { name: r.company, orders: 0, revenue: 0, kg: 0 };
    entry.orders += 1;
    entry.revenue = round2(entry.revenue + r.total);
    cafeMap.set(r.company, entry);
  }

  return {
    source: "app",
    from: input.from,
    to: input.to,
    prevFrom,
    prevTo,
    revenue: { current: sum(current), previous: sum(previous) },
    orders: { current: current.length, previous: previous.length },
    aov: {
      current: current.length ? round2(sum(current) / current.length) : 0,
      previous: previous.length ? round2(sum(previous) / previous.length) : 0,
    },
    cafes: { current: cafes(current), previous: cafes(previous) },
    kg: { current: 0, previous: 0 },
    samples: { current: 0, previous: 0 },
    discounts: { current: 0, previous: 0 },
    ...buildSeries(
      input.from,
      input.to,
      current.map((r) => ({ createdAt: r.paidAt, total: r.total }))
    ),
    topProducts: [],
    cafeStats: Array.from(cafeMap.values()).sort((a, b) => b.revenue - a.revenue),
    newCafes: [],
    deliverySplit: [],
    rows: current.map((r) => ({
      date: r.paidAt,
      ref: r.shopifyDraftName || r.orderId,
      cafe: r.company,
      items: r.items,
      total: r.total,
    })),
    truncated: false,
  };
}
