import { NextRequest, NextResponse } from "next/server";
import { buildDraftLineItems, createDraftOrder, getCatalog } from "@/lib/shopify";
import { priceItems } from "@/lib/pricing";
import { repriceOrder } from "@/lib/pipeline";
import { createOrder, saveOrder } from "@/lib/store";
import { describeLine } from "@/lib/conversions";
import type { DeliveryMethod, ItemForm, OrderItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const FORMS: ItemForm[] = ["pouch", "sample", "piece"];
const MAX_LINES = 40;
const MAX_QTY = 10_000;

/**
 * Build order: create an order from tapped menu items and its real Shopify
 * draft, landing straight in Processed.
 *
 * What it skips is the QUEUE stage — the parse-and-review step — not the
 * payment review. The order arrives in Processed exactly as a pasted one
 * does: draft created, awaiting payment, with BPI matching and Joey's
 * "Confirm payment · mark paid" click still required. Nothing here records
 * money as received.
 *
 * The parser is bypassed entirely — lines arrive already resolved to
 * catalog keys, so every item carries confidence 1. That also sidesteps the
 * retail/wholesale name collisions the text parser is prone to.
 *
 * Server-side as one operation so a failure can't leave an order with no
 * draft silently sitting where nobody looks; confirm:true is required
 * because this writes a real draft to the production store.
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
      { error: "This needs an explicit confirmation." },
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

    // Stops here. Payment stays unconfirmed so the order shows up in
    // Processed with the usual BPI match and confirm step — the History
    // row is written when Joey actually confirms payment, not now.
    order.builtManually = true;
    await saveOrder(order);

    return NextResponse.json({ order }, { status: 201 });
  } catch (err) {
    // Leave the order behind at whatever stage it reached rather than
    // deleting it: if the Shopify draft WAS created, silently discarding the
    // record here would strand it with nothing pointing at it.
    order.needsReview = true;
    order.reviewReasons.push(
      `Build order failed partway: ${err instanceof Error ? err.message : "unknown error"}. Check Shopify before retrying.`
    );
    await saveOrder(order).catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn\u2019t create the order." },
      { status: 502 }
    );
  }
}
