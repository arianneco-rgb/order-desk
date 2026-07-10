import { NextRequest, NextResponse } from "next/server";
import { shopifyMode } from "@/lib/config";
import { getOrdersInRange, type RawReportOrder } from "@/lib/shopify";
import {
  aggregateAppReport,
  aggregateShopifyReport,
  previousRange,
  type ReportSegment,
} from "@/lib/reports";
import { listOrderHistory } from "@/lib/sheets";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 400;

// Raw Shopify orders per range, cached briefly — switching the cafe filter
// (or re-printing) shouldn't refetch hundreds of orders from Shopify.
const CACHE_MS = 2 * 60_000;
declare global {
  // eslint-disable-next-line no-var
  var __odReportCache:
    | Map<string, { at: number; orders: RawReportOrder[]; truncated: boolean }>
    | undefined;
}

async function ordersFor(
  from: string,
  to: string
): Promise<{ orders: RawReportOrder[]; truncated: boolean }> {
  if (!globalThis.__odReportCache) globalThis.__odReportCache = new Map();
  const cache = globalThis.__odReportCache;
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const fresh = await getOrdersInRange(from, to);
  cache.set(key, { at: Date.now(), ...fresh });
  if (cache.size > 20) {
    const oldest = Array.from(cache.entries()).sort((a, b) => a[1].at - b[1].at)[0];
    cache.delete(oldest[0]);
  }
  return fresh;
}

/** Report data for [from, to]: whole-store Shopify stats + prev-period deltas. */
export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const company = request.nextUrl.searchParams.get("company") ?? undefined;
  const segmentRaw = request.nextUrl.searchParams.get("segment") ?? "all";
  if (!["all", "wholesale", "retail"].includes(segmentRaw)) {
    return NextResponse.json({ error: "segment must be all|wholesale|retail." }, { status: 400 });
  }
  const segment = segmentRaw as ReportSegment;

  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    return NextResponse.json(
      { error: "from/to must be YYYY-MM-DD with from ≤ to." },
      { status: 400 }
    );
  }
  const spanDays = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  if (spanDays > MAX_SPAN_DAYS) {
    return NextResponse.json(
      { error: `Range too large — max ${MAX_SPAN_DAYS} days.` },
      { status: 400 }
    );
  }

  try {
    if (shopifyMode() !== "live") {
      const rows = await listOrderHistory();
      return NextResponse.json({ report: aggregateAppReport({ from, to, rows, company }) });
    }

    const { prevFrom, prevTo } = previousRange(from, to);
    const [currentRes, previousRes] = await Promise.all([
      ordersFor(from, to),
      ordersFor(prevFrom, prevTo),
    ]);
    return NextResponse.json({
      report: aggregateShopifyReport({
        from,
        to,
        current: currentRes.orders,
        previous: previousRes.orders,
        company,
        segment,
        truncated: currentRes.truncated || previousRes.truncated,
      }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't build the report." },
      { status: 502 }
    );
  }
}
