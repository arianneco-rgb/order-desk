// Prices ALWAYS come from Shopify variant prices — never hardcoded here.
// Total = Σ(quantity × unit price). Full cases are billed at the Case
// variant price; the remainder at the 200g pouch price (that's how the
// draft order line items map to Shopify variants too).
//
// In LIVE mode the final total (discounts, VAT, delivery fee) comes from
// Shopify's own draftOrderCalculate — see lib/shopify.ts calculateDraft().
// localDraftTotals() below is the mock-mode / offline-fallback math; it
// can't know the customer's automatic discounts, only the manual ones.

import type { CatalogProduct, DraftOptions, DraftTotals, OrderItem, PricedItem } from "./types";
import {
  MOQ_POUCHES,
  describeLine,
  joinNaturally,
  splitCases,
} from "./conversions";

export const VAT_RATE = 0.12;

function roundPeso(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Apply the draft options to a goods subtotal locally. Mirrors the draft's
 * real structure: manual discount → free samples → VAT (12% of the
 * discounted goods) → delivery fee. Automatic discounts are Shopify-side
 * only and NOT included here.
 */
export function localDraftTotals(
  priced: PricedItem[],
  options: DraftOptions
): DraftTotals {
  const goods = orderTotal(priced);
  const sampleAmount = priced
    .filter((l) => l.form === "sample")
    .reduce((sum, l) => sum + l.amount, 0);

  let discounts = options.freeSamples ? sampleAmount : 0;
  const discountable = goods - discounts;
  if (options.manualDiscount) {
    const d = options.manualDiscount;
    discounts +=
      d.valueType === "PERCENTAGE"
        ? roundPeso((discountable * Math.min(Math.max(d.value, 0), 100)) / 100)
        : Math.min(Math.max(d.value, 0), discountable);
  }

  const vat = options.chargeVat ? roundPeso((goods - discounts) * VAT_RATE) : 0;
  const shipping = options.deliveryMethod ? (options.deliveryFee ?? 0) : 0;

  return {
    subtotal: goods,
    discounts: roundPeso(discounts),
    vat,
    shipping,
    total: roundPeso(goods - discounts + vat + shipping),
  };
}

export function priceItems(
  items: OrderItem[],
  catalog: CatalogProduct[]
): PricedItem[] {
  return items.map((item) => {
    const product = catalog.find((p) => p.key === item.productKey);
    const warnings: string[] = [];

    if (!product) {
      warnings.push(`Unknown product “${item.productKey}” — not in the Shopify catalog.`);
      return {
        ...item,
        title: item.productKey,
        cases: 0,
        loosePouches: item.form === "pouch" ? item.qty : 0,
        pouchPrice: null,
        casePrice: null,
        samplePrice: null,
        amount: 0,
        warnings,
      };
    }

    if (item.form === "sample") {
      const samplePrice = product.sample?.price ?? null;
      if (samplePrice === null) {
        warnings.push(`${product.title} has no sample variant in Shopify.`);
      }
      return {
        ...item,
        title: product.title,
        cases: 0,
        loosePouches: 0,
        pouchPrice: null,
        casePrice: null,
        samplePrice,
        amount: (samplePrice ?? 0) * item.qty,
        warnings,
      };
    }

    const pouchPrice = product.pouch?.price ?? null;
    const casePrice = product.case?.price ?? null;
    let { cases, loosePouches } = splitCases(item.qty);

    // No case variant (e.g. custom blends) → everything at pouch price.
    if (casePrice === null) {
      loosePouches = item.qty;
      cases = 0;
    }

    if (casePrice !== null && pouchPrice !== null && casePrice < pouchPrice) {
      warnings.push(
        `${product.title}: the Case price in Shopify (₱${casePrice.toLocaleString()}) is lower than a single 200g pouch (₱${pouchPrice.toLocaleString()}) — looks like a data-entry error. Fix it in Shopify before confirming.`
      );
    }

    if (loosePouches > 0 && pouchPrice === null) {
      warnings.push(`${product.title} has no 200g pouch variant in Shopify.`);
    }

    const amount =
      cases * (casePrice ?? 0) + loosePouches * (pouchPrice ?? 0);

    return {
      ...item,
      title: product.title,
      cases,
      loosePouches,
      pouchPrice,
      casePrice,
      samplePrice: product.sample?.price ?? null,
      amount,
      warnings,
    };
  });
}

export function orderTotal(priced: PricedItem[]): number {
  return priced.reduce((sum, line) => sum + line.amount, 0);
}

/** "{ITEMS}" for the reply: "2 cases of Kasane, 5 pouches of Shizu, and …" */
export function itemsText(priced: PricedItem[]): string {
  return joinNaturally(
    priced.map((line) => describeLine(line.title, line.form, line.qty))
  );
}

/**
 * Review checks that depend on prices/quantities (parser reasons come
 * separately): below-MOQ and any pricing warnings.
 */
export function pricingReviewReasons(priced: PricedItem[]): string[] {
  const reasons: string[] = [];
  const totalPouches = priced
    .filter((l) => l.form === "pouch")
    .reduce((sum, l) => sum + l.qty, 0);

  if (priced.length > 0 && totalPouches > 0 && totalPouches < MOQ_POUCHES) {
    reasons.push(
      `Below MOQ: ${totalPouches * 200}g ordered, minimum is 2kg (1 case) — confirm with the cafe.`
    );
  }

  for (const line of priced) {
    reasons.push(...line.warnings);
  }
  return reasons;
}
