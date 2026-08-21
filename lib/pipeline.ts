// Queue processing: raw pasted message → parsed lines → Shopify prices →
// total + filled reply. Runs when an order's "Processing…" window elapses.
// The dashboard never advances past `processed` on its own — creating the
// draft and confirming payment are Joey's clicks.

import {
  buildDraftLineItems,
  calculateDraft,
  getCatalog,
  getCustomerDefaults,
  getSampleCreditInfo,
} from "./shopify";
import { shopifyMode } from "./config";
import { defaultDeliveryMethod } from "./delivery";
import { MOQ_POUCHES } from "./conversions";
import { parseMessage } from "./parser";
import { priceItems, itemsText, localDraftTotals, pricingReviewReasons } from "./pricing";
import { totalOrderReply } from "./templates";
import { listActiveOrders, saveOrder, usedSampleCredit, PROCESS_DELAY_MS } from "./store";
import type { Order, OrderItem } from "./types";

/**
 * The auto-applied "first bulk order after a sample" credit (business
 * rule, not a suggestion Joey opts into): a customer's Shopify-paid sample
 * spend is credited back automatically, ONLY on the very first order that
 * (a) comes after any sample order and before any other real order, and
 * (b) has at least one full case (10 pouches of ONE product) — 5+5 across
 * two products does NOT qualify, only a single line hitting the MOQ does.
 * Recomputed on every reprice, so it applies/retracts itself as items
 * change; never touches a discount Joey set under a different title.
 */
const AUTO_SAMPLE_CREDIT_TITLE = "Sample credit";

async function applySampleCreditAutomation(order: Order): Promise<void> {
  if (!order.customerId || order.customerId.startsWith("mock:")) return;
  const current = order.options.manualDiscount;
  if (current && current.title !== AUTO_SAMPLE_CREDIT_TITLE) return; // Joey's own discount — never touch it

  const qualifiesByCase = order.items.some(
    (i) => i.form === "pouch" && i.qty >= MOQ_POUCHES
  );

  let available = 0;
  if (qualifiesByCase) {
    try {
      const { paidSampleTotal, hasPriorRealOrder } = await getSampleCreditInfo(order.customerId);
      if (!hasPriorRealOrder) {
        const used = await usedSampleCredit(order.customerId);
        available = Math.max(0, Math.round((paidSampleTotal - used) * 100) / 100);
      }
    } catch (err) {
      console.error("Sample credit lookup failed (skipping auto-apply):", err);
    }
  }

  if (available > 0) {
    order.options.manualDiscount = {
      valueType: "FIXED_AMOUNT",
      value: available,
      title: AUTO_SAMPLE_CREDIT_TITLE,
    };
  } else if (current?.title === AUTO_SAMPLE_CREDIT_TITLE) {
    order.options.manualDiscount = undefined; // no longer eligible — retract it
  }
}

/**
 * Advance the order state machine. Serverless-safe: no timers — every read
 * of the order list calls this, so "Processing…" completes on the next poll.
 *   queued → processing (immediately)
 *   processing → processed (after the processing window, via the parser)
 */
/**
 * Advances queued→processing→processed orders, then returns the same
 * (now up-to-date) list it fetched — callers that need a fresh order list
 * right after a tick (the /api/orders route) reuse this instead of doing
 * a second full fetch. Every element is mutated in place by
 * processOrder()/the status writes below, so the returned array already
 * reflects any transitions made during this call.
 */
export async function tick(): Promise<Order[]> {
  const now = Date.now();
  const orders = await listActiveOrders();
  for (const order of orders) {
    if (order.status === "queued") {
      order.status = "processing";
      if (!order.processAfter) {
        order.processAfter = new Date(now + PROCESS_DELAY_MS).toISOString();
      }
      await saveOrder(order);
    }
    if (
      order.status === "processing" &&
      order.processAfter &&
      now >= Date.parse(order.processAfter)
    ) {
      await processOrder(order);
    }
  }
  return orders;
}

export async function processOrder(order: Order): Promise<Order> {
  const catalog = await getCatalog();
  const { items, reasons, softNotes } = parseMessage(order.rawMessage, catalog);
  // The parser must never reach for the white-label case: "2 cases of
  // Nagomi" in a Viber message always means the standard labelled case.
  // Asking for the unlabelled one is a deliberate act on the Build screen.
  order.items = items.map((i) =>
    i.form === "case_nolabel" ? { ...i, form: "pouch" as const, qty: i.qty * 10 } : i
  );
  reasons.push(...(await duplicateReasons(order)));
  await applyCustomerDefaults(order);
  await repriceOrder(order, reasons, softNotes);
  order.status = "processed";
  order.processedAt = new Date().toISOString();
  await saveOrder(order);
  return order;
}

/**
 * Seed the draft options from the Shopify profile (runs ONCE, at
 * processing): address → delivery method, tax setting / "Invoice Requested"
 * tag → VAT box. Joey can override everything on the order card.
 */
async function applyCustomerDefaults(order: Order): Promise<void> {
  if (!order.customerId) return;
  try {
    const defaults = await getCustomerDefaults(order.customerId);
    if (!defaults) return;
    if (!order.options.deliveryMethod) {
      order.options.deliveryMethod = defaultDeliveryMethod(defaults.city, defaults.province);
    }
    const invoiceTag = defaults.tags.some((t) => t.toLowerCase().includes("invoice"));
    if (invoiceTag || !defaults.taxExempt) order.options.chargeVat = true;
  } catch (err) {
    console.error("Customer defaults lookup failed (using plain defaults):", err);
  }
}

/** Double-sent Viber messages happen — flag likely duplicates, never block. */
const DUPLICATE_WINDOW_MS = 6 * 60 * 60 * 1000; // same cafe, open order within 6h
const IDENTICAL_WINDOW_MS = 48 * 60 * 60 * 1000; // same cafe + same exact message

async function duplicateReasons(order: Order): Promise<string[]> {
  const company = order.company.trim().toLowerCase();
  const message = order.rawMessage.trim();
  const createdAt = Date.parse(order.createdAt);

  for (const other of await listActiveOrders()) {
    if (other.id === order.id) continue;
    if (other.company.trim().toLowerCase() !== company) continue;
    const gap = Math.abs(createdAt - Date.parse(other.createdAt));

    if (other.rawMessage.trim() === message && gap < IDENTICAL_WINDOW_MS) {
      return [
        `Possible duplicate: the exact same message from ${order.company} is already on the board — check before drafting.`,
      ];
    }
    if (gap < DUPLICATE_WINDOW_MS) {
      return [
        `Possible duplicate: ${order.company} already has an open order from the last few hours — check before drafting.`,
      ];
    }
  }
  return [];
}

/**
 * Recompute total, reply, and review flags from the current line items AND
 * draft options (discounts/VAT/delivery). Used after parsing, after Joey
 * edits quantities, and after Joey changes options — the reply updates live.
 *
 * LIVE mode asks Shopify itself (draftOrderCalculate — includes the
 * customer's automatic discounts), so the total Joey sends the cafe is
 * exactly what the draft will say. Mock mode / a Shopify hiccup falls back
 * to local math, which can't see automatic discounts.
 */
export async function repriceOrder(
  order: Order,
  parserReasons?: string[],
  parserSoftNotes?: string[]
): Promise<Order> {
  const catalog = await getCatalog();
  await applySampleCreditAutomation(order);
  const priced = priceItems(order.items, catalog);

  let totals = localDraftTotals(priced, order.options);
  if (shopifyMode() === "live" && order.items.length > 0) {
    try {
      totals = await calculateDraft(order, buildDraftLineItems(priced, catalog));
    } catch (err) {
      console.error("draftOrderCalculate failed — using local totals:", err);
    }
  }
  order.totals = totals;
  order.total = totals.total;
  order.reply = totalOrderReply(order.total, itemsText(priced) || "your order");

  const pr = pricingReviewReasons(priced);
  order.reviewReasons = [...(parserReasons ?? []), ...pr.reasons];
  order.softNotes = [...(parserSoftNotes ?? []), ...pr.softNotes];
  order.needsReview = order.reviewReasons.length > 0;
  await saveOrder(order);
  return order;
}

/** Replace line items after a Joey edit (his edits count as confident). */
export async function updateItems(
  order: Order,
  items: OrderItem[]
): Promise<Order> {
  // Round BEFORE filtering so a fractional qty like 0.4 can't survive as a
  // zero-quantity line (round → 0 → dropped).
  order.items = items
    .map((i) => ({ ...i, qty: Math.round(i.qty), confidence: 1 }))
    .filter((i) => i.qty > 0);
  return repriceOrder(order, []);
}
