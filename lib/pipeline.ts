// Queue processing: raw pasted message → parsed lines → Shopify prices →
// total + filled reply. Runs when an order's "Processing…" window elapses.
// The dashboard never advances past `processed` on its own — creating the
// draft and confirming payment are Joey's clicks.

import { getCatalog } from "./shopify";
import { parseMessage } from "./parser";
import { priceItems, orderTotal, itemsText, pricingReviewReasons } from "./pricing";
import { totalOrderReply } from "./templates";
import { listOrders, saveOrder, PROCESS_DELAY_MS } from "./store";
import type { Order, OrderItem } from "./types";

/**
 * Advance the order state machine. Serverless-safe: no timers — every read
 * of the order list calls this, so "Processing…" completes on the next poll.
 *   queued → processing (immediately)
 *   processing → processed (after the processing window, via the parser)
 */
export async function tick(): Promise<void> {
  const now = Date.now();
  for (const order of listOrders()) {
    if (order.status === "queued") {
      order.status = "processing";
      if (!order.processAfter) {
        order.processAfter = new Date(now + PROCESS_DELAY_MS).toISOString();
      }
      saveOrder(order);
    }
    if (
      order.status === "processing" &&
      order.processAfter &&
      now >= Date.parse(order.processAfter)
    ) {
      await processOrder(order);
    }
  }
}

export async function processOrder(order: Order): Promise<Order> {
  const catalog = await getCatalog();
  const { items, reasons } = parseMessage(order.rawMessage, catalog);
  order.items = items;
  await repriceOrder(order, reasons);
  order.status = "processed";
  order.processedAt = new Date().toISOString();
  saveOrder(order);
  return order;
}

/**
 * Recompute total, reply, and review flags from the current line items.
 * Used after parsing AND after Joey edits quantities (reply updates live).
 * `parserReasons` are carried through; pass [] when repricing an edit.
 */
export async function repriceOrder(
  order: Order,
  parserReasons?: string[]
): Promise<Order> {
  const catalog = await getCatalog();
  const priced = priceItems(order.items, catalog);
  order.total = orderTotal(priced);
  order.reply = totalOrderReply(order.total, itemsText(priced) || "your order");

  const reasons = [...(parserReasons ?? []), ...pricingReviewReasons(priced)];
  order.reviewReasons = reasons;
  order.needsReview = reasons.length > 0;
  saveOrder(order);
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
