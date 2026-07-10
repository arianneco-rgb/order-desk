// Delivery methods — the three the team named in the 2026-07 demo meeting
// (rename labels here if ops wording changes; the draft's shipping line and
// tag use these labels verbatim). Fee usually stays ₱0 — delivery is mostly
// billed outside Shopify — but can be set per order (e.g. Mom Wing).

import type { DeliveryMethod } from "./types";

export const DELIVERY_METHODS: Record<
  DeliveryMethod,
  { label: string; packingNote: string }
> = {
  pickup: { label: "Pick up", packingNote: "no courier packaging" },
  mm_delivery: { label: "Metro Manila Delivery", packingNote: "rider delivery" },
  jnt_nationwide: { label: "J&T (Nationwide)", packingNote: "bubble wrap for courier" },
};

const METRO_MANILA_HINTS = [
  "metro manila", "ncr",
  "makati", "quezon city", "san juan", "pasig", "taguig", "manila",
  "mandaluyong", "parañaque", "paranaque", "pasay", "caloocan", "marikina",
  "muntinlupa", "las piñas", "las pinas", "valenzuela", "malabon", "navotas",
  "pateros",
];

/**
 * Default from the customer's Shopify address: Metro Manila → rider
 * delivery, any other address → J&T. No address → no default (Joey picks).
 * Always overridable — Rizal/Laguna/Cavite cafes genuinely vary.
 */
export function defaultDeliveryMethod(
  city?: string,
  province?: string
): DeliveryMethod | undefined {
  const hay = `${city ?? ""} ${province ?? ""}`.toLowerCase().trim();
  if (!hay) return undefined;
  return METRO_MANILA_HINTS.some((h) => hay.includes(h))
    ? "mm_delivery"
    : "jnt_nationwide";
}
