// Small display helpers shared by the /processed components. Pure + client-safe.

import type { CatalogProduct, Order, OrderItem } from "@/lib/types";
import { formatPouchQty, formatSampleQty, splitCases } from "@/lib/conversions";

export type TitleMap = Record<string, string>;

export function buildTitleMap(catalog: CatalogProduct[]): TitleMap {
  const map: TitleMap = {};
  for (const p of catalog) map[p.key] = p.title;
  return map;
}

export function titleFor(titles: TitleMap, key: string): string {
  return titles[key] ?? key;
}

/** "2 cases (4kg) · Kasane" — one line per order item. */
export function itemLine(item: OrderItem, titles: TitleMap): string {
  const qty =
    item.form === "sample" ? formatSampleQty(item.qty) : formatPouchQty(item.qty);
  return `${qty} · ${titleFor(titles, item.productKey)}`;
}

export function itemLines(order: Order, titles: TitleMap): string[] {
  return order.items.map((item) => itemLine(item, titles));
}

/** Compact one-line summary for kanban cards. */
export function itemsSummary(order: Order, titles: TitleMap): string {
  return itemLines(order, titles).join(" · ");
}

/**
 * Per-line amount, mirroring the server's pricing: full cases at the Case
 * variant price + remainder at the 200g pouch price; samples at sample price.
 * Display-only — the authoritative total always comes from the server.
 */
export function lineAmount(
  item: OrderItem,
  catalog: CatalogProduct[]
): number | null {
  const product = catalog.find((p) => p.key === item.productKey);
  if (!product) return null;
  if (item.form === "sample") {
    return product.sample ? product.sample.price * item.qty : null;
  }
  const { cases, loosePouches } = splitCases(item.qty);
  if (product.case && cases > 0) {
    return cases * product.case.price + loosePouches * (product.pouch?.price ?? 0);
  }
  return product.pouch ? item.qty * product.pouch.price : null;
}

/**
 * The Shopify variant(s) a line will hit when the draft is created — mirrors
 * the server's pricing: full cases → the Case variant, remainder → the 200g
 * pouch variant, samples → the sample variant.
 */
export function variantBreakdown(item: OrderItem): string {
  if (item.form === "sample") {
    return `${item.qty} × sample sachet`;
  }
  const { cases, loosePouches } = splitCases(item.qty);
  const parts: string[] = [];
  if (cases > 0) parts.push(`${cases} × Case (10×200g)`);
  if (loosePouches > 0) parts.push(`${loosePouches} × 200g pouch`);
  if (parts.length === 0) return "—";
  return parts.join(" + ");
}

export function formatTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
