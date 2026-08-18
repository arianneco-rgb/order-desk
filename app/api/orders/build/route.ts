import { NextRequest, NextResponse } from "next/server";
import {
  buildDraftLineItems,
  completeDraftAsPaid,
  createDraftOrder,
  getCatalog,
} from "@/lib/shopify";
import { itemsText, priceItems } from "@/lib/pricing";
import { paidConfirmationReply } from "@/lib/templates";
import { appendOrderHistory } from "@/lib/sheets";
import { repriceOrder } from "@/lib/pipeline";
import { createOrder, saveOrder } from "@/lib/store";
import { describeLine } from "@/lib/conversions";
import type { DeliveryMethod, ItemForm, OrderItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const FORMS: ItemForm[] = ["pouch", "sample", "piece"];
const MAX_LINES = 40;
const MAX_QTY = 10_000;

/**
 * Fast-track: build an order from tapped menu items, create the Shopify
 * draft, and mark it paid — in one request.
 *
 * Deliberately server-side as a single operation rather than three chained
 * client calls: a half-finished fast-track (draft created, never marked
 * paid) would leave an orphan draft on the production store that nobody is
 * watching for, because the order never appears in Queue or Processed.
 *
 * The parser is bypassed entirely — lines arrive already resolved to
 * catalog keys, so every item carries confidence 1. That also sidesteps the
 * retail/wholesale name collisions the text parser is prone to.
 *
 * This is the one path that marks money received without a BPI match, so
 * the caller must pass confirm:true — the UI gates that behind a modal
 * showing the cafe, every line, and the total.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    company?: string;
    customerId?: string;
    items?: { productKey?: string; form?: string; qty?: number }[];
    chargeVat?: boolean;
    deliveryMethod?: string;
    deliveryFee?: number;
    shippingAddress?: string;
    confirm?: boolean;
  };

  if (!body.confirm) {
    return NextResponse.json(
      { error: "Fast-track needs an explicit confirmation." },
      { status: 400 }
    );
  }

  const company = body.company?.trim();
  if (!company || company.length > 120) {
    return NextResponse.json({ error: "Pick a cafe first." }, { status: 400 });
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) {
    return NextResponse.json({ error: "Add at least one product." }, { status: 400 });
  }
  if (rawItems.length > MAX_LINES) {
    return NextResponse.json({ error: `That's more than ${MAX_LINES} lines.` }, { status: 400 });
  }

  const catalog = await getCatalog();
  const items: OrderItem[] = [];
  for (const raw of rawItems) {
    const productKey = String(raw.productKey ?? "");
    const form = String(raw.form ?? "") as ItemForm;
    const qty = Number(raw.qty);
    if (!catalog.some((p) => p.key === productKey)) {
      return NextResponse.json({ error: `Unknown product “${productKey}”.` }, { status: 400 });
    }
    if (!FORMS.includes(form)) {
      return NextResponse.json({ error: `Unknown size on “${productKey}”.` }, { status: 400 });
    }
    if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) {
      return NextResponse.json({ error: `Invalid quantity on “${productKey}”.` }, { status: 400 });
    }
    // Hand-picked, so confidence is 1 — nothing was guessed from text.
    items.push({ productKey, form, qty: Math.round(qty), confidence: 1 });
  }

  const customerId =
    body.customerId?.startsWith("gid://shopify/Customer/") || body.customerId?.startsWith("mock:")
      ? body.customerId
      : undefined;

  // A readable stand-in for the pasted Viber message: it becomes the note on
  // the Shopify draft and the record of what was ordered, so it must say
  // what Joey actually picked.
  const summary = items
    .map((i) => describeLine(catalog.find((p) => p.key === i.productKey)?.title ?? i.productKey, i.form, i.qty))
    .join("\n");
  const rawMessage = `Built in Order Desk (fast-track):\n${summary}`;

  const order = await createOrder({ company, customerId, rawMessage });
  try {
    order.items = items;
    order.options.chargeVat = body.chargeVat === true;
    if (typeof body.deliveryMethod === "string" && body.deliveryMethod) {
      order.options.deliveryMethod = body.deliveryMethod as DeliveryMethod;
    }
    if (Number.isFinite(body.deliveryFee)) {
      order.options.deliveryFee = Number(body.deliveryFee);
    }
    if (body.shippingAddress) order.shippingAddress = String(body.shippingAddress).slice(0, 300);

    await repriceOrder(order, []);
    order.status = "processed";
    await saveOrder(order);

    const priced = priceItems(order.items, catalog);
    const draft = await createDraftOrder(order, buildDraftLineItems(priced, catalog));
    order.shopifyDraftId = draft.draftId;
    order.shopifyDraftName = draft.draftName;
    order.shopifyDraftUrl = draft.draftUrl;
    order.draftCreatedAt = new Date().toISOString();
    order.status = "draft_created";
    await saveOrder(order);

    const { orderId } = await completeDraftAsPaid(order);
    const text = itemsText(priced);
    order.shopifyOrderId = orderId;
    order.status = "paid";
    order.paidAt = new Date().toISOString();
    // No BPI match: fast-track asserts the payment landed, the same as
    // ticking the manual-override box on the payment pane.
    order.payment.confirmed = true;
    order.paidReply = paidConfirmationReply(text || "your order", order.total);
    order.fastTracked = true;
    await saveOrder(order);

    let sheetWarning: string | undefined;
    try {
      await appendOrderHistory({
        paidAt: order.paidAt,
        company: order.company,
        items: text,
        total: order.total,
        orderId: order.id,
        shopifyDraftName: order.shopifyDraftName,
        status: "paid",
        isTest: order.isTest,
      });
    } catch (err) {
      console.error("Order History append failed:", err);
      sheetWarning = "Order created and marked paid, but recording it to History failed — add the row manually.";
    }

    return NextResponse.json({ order, sheetWarning }, { status: 201 });
  } catch (err) {
    // Leave the order behind at whatever stage it reached rather than
    // deleting it: if the Shopify draft WAS created, silently discarding the
    // record here would strand it with nothing pointing at it.
    order.needsReview = true;
    order.reviewReasons.push(
      `Fast-track failed partway: ${err instanceof Error ? err.message : "unknown error"}. Check Shopify before retrying.`
    );
    await saveOrder(order).catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Fast-track failed." },
      { status: 502 }
    );
  }
}
