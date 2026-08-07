// Delivery methods — the team's wording as of 2026-08 (rename labels here if
// ops wording changes; the draft's shipping line and tag use these labels
// verbatim). Fee is usually ₱0 because delivery is mostly billed outside
// Shopify; Metro Manila is the exception and pre-fills ₱200. Every fee stays
// editable per order.
//
// The first three KEYS predate the rename and are still stored on existing
// orders, so they're kept as-is and only their labels moved. Renaming a key
// would orphan every order already carrying it.

import type { DeliveryMethod } from "./types";

export const DELIVERY_METHODS: Record<
  DeliveryMethod,
  { label: string; packingNote: string; defaultFee?: number }
> = {
  wholesale_free: {
    label: "Wholesale Free Shipping",
    packingNote: "rider delivery (free within Metro Manila)",
  },
  pickup: { label: "Wholesale Pickup at San Juan", packingNote: "no courier packaging" },
  mm_delivery: {
    label: "Metro Manila Delivery",
    packingNote: "rider delivery",
    defaultFee: 200,
  },
  jnt_nationwide: { label: "J&T Shipping", packingNote: "bubble wrap for courier" },
  jnt_super: { label: "J&T Super", packingNote: "bubble wrap for courier" },
  wholesale_bulk: { label: "Wholesale BULK Shipping", packingNote: "bulk pallet/crate packing" },
};

/** Pre-filled fee when Joey picks a method — ₱0 unless the method says otherwise. */
export function defaultDeliveryFee(method: DeliveryMethod): number {
  return DELIVERY_METHODS[method].defaultFee ?? 0;
}

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
