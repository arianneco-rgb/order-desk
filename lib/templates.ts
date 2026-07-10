// Copy-paste reply templates. The Total Order template is used VERBATIM per
// the spec. The fulfilment templates below are the team's actual saved Viber
// replies, from the "RMC Message Templates" doc (Drive, updated 2026-06-25).
// Blanks (order #, tracking number, shipping fee) are left for Joey to fill
// in by hand before sending, same as the source doc.

import { formatPeso } from "./conversions";
import type { DeliveryMethod } from "./types";

/** The reply for a new order. {TOTAL} and {ITEMS} are filled in. */
export function totalOrderReply(total: number, itemsText: string): string {
  return `The total is ${formatPeso(total)} for ${itemsText}!
You can send to:
Bank of the Philippine Islands (BPI)
Account: RMC Ritual Trading Corporation
Account Number: 2561013163
We will process your order after payment is received! Kindly note that our lead time is 3-5 days upon payment. Thank you! 🙂`;
}

/** Revealed after Joey confirms a payment. */
export function paidConfirmationReply(itemsText: string, total: number): string {
  return `Payment received — thank you! 🙂
Your order for ${itemsText} (${formatPeso(total)}) is confirmed and now being prepared.
Lead time is 3-5 days. We'll message you once it's ready for delivery or pickup!`;
}

/** Gentle nudge for drafts that have sat unpaid — the follow-up queue's copy button. */
export function paymentReminderReply(total: number): string {
  return `Hi! Just a gentle follow-up on your pending order (${formatPeso(total)}) 🙂
Sending the payment details again for convenience:
Bank of the Philippine Islands (BPI)
Account: RMC Ritual Trading Corporation
Account Number: 2561013163
We'll process the order as soon as payment comes through — lead time is 3-5 days upon payment. Thank you! 🙂`;
}

export interface FulfilmentTemplate {
  key: string;
  label: string;
  text: string;
}

// TODO: replace each `text` with the team's existing Viber saved replies —
// these are placeholders that follow the same tone as the Total Order message.
export const FULFILMENT_TEMPLATES: FulfilmentTemplate[] = [
  {
    key: "pickup",
    label: "Pickup",
    text: `Hi! Your order is ready for pickup 🙂
You can feel free to book pickup from 10:00AM-5:00PM (Monday to Friday) at the following address: 173 Mariano Marcos Street, Corner Wilson St., San Juan, Metro Manila
Contact: Joey Abesamis
Contact Number: 09693391625
Notes: Order #XXX for XXX, vines and bamboo around the perimeter, please doorbell at gate 173
Gentle reminder to please include the order number and name in the driver's notes, otherwise we will be unable to hand over the order. Thank you!`,
  },
  {
    key: "mm_delivery",
    label: "Metro Manila Delivery",
    text: `Hi! Your order will be delivered today by our rider Christopher! You can expect the delivery anytime between 10:00 AM and 6:00 PM. Thank you 🙂`,
  },
  {
    key: "nationwide",
    label: "Nationwide shipping",
    text: `Hi! Your order is ready for send out via J&T! 🙂
Here's the tracking number:
The shipping fee is XX! Kindly send to the same account:
Bank of the Philippine Islands (BPI)
Account: RMC Ritual Trading Corporation
Account Number: 2561013163
Thank you! 🙂`,
  },
  {
    key: "rush",
    label: "Rush Order Request / Lead Time Reminder",
    text: `Just a gentle reminder that our usual lead time is 3–5 days 🙂 If our schedule and production allow, we'll definitely send it out sooner!`,
  },
];

/** DeliveryMethod (lib/delivery.ts) → the matching fulfilment template key. */
const METHOD_TEMPLATE: Record<DeliveryMethod, string> = {
  pickup: "pickup",
  mm_delivery: "mm_delivery",
  jnt_nationwide: "nationwide",
};

/**
 * The fulfilment reply matching the order's delivery method — shown alone
 * (auto-selected) on the paid screen; the rest collapse under "other
 * replies". When the delivery fee is known, the nationwide template's
 * "XX" blank is filled with the real amount.
 */
export function fulfilmentReplyFor(
  method: DeliveryMethod,
  deliveryFee?: number
): FulfilmentTemplate | undefined {
  const template = FULFILMENT_TEMPLATES.find((t) => t.key === METHOD_TEMPLATE[method]);
  if (!template) return undefined;
  if (method === "jnt_nationwide" && deliveryFee && deliveryFee > 0) {
    return { ...template, text: template.text.replace(/\bXX\b/, formatPeso(deliveryFee)) };
  }
  return template;
}

/** Reference only (not part of the Total Order flow, which is BPI-only per spec). */
export const PAYMENT_METHODS_NOTE = `Payment Methods:
BPI
RMC Ritual Trading Corporation
2561013163
Gcash
Marco Antonio Adriano
09610457345`;
