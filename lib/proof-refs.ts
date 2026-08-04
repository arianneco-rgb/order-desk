// Payment-proof screenshots are stored as embedded base64 data URLs on the
// order itself (see app/api/orders/[id]/proof/route.ts) — fine for a single
// order, but the polled list endpoint (GET /api/orders, hit every 2-2.5s by
// Queue/Processed/Home/Nav) was re-sending that full image data on every
// poll for as long as an order sat awaiting payment. This rewrites heavy
// embedded proofs to a lightweight path in LIST responses only — the
// browser's own <img> tag fetches the real bytes on demand (and caches
// them) instead of them riding along on every poll. Single-order responses
// (upload/delete/etc.) are untouched, so a just-uploaded proof still shows
// immediately with no extra round trip.

import type { Order } from "./types";

const EMBEDDED_PREFIX = "data:";

export function withLightProofRefs(orders: Order[]): Order[] {
  return orders.map((order) => {
    const proofs = order.payment.proofs;
    if (!proofs?.some((p) => p.url.startsWith(EMBEDDED_PREFIX))) return order;
    return {
      ...order,
      payment: {
        ...order.payment,
        proofs: proofs.map((p, i) =>
          p.url.startsWith(EMBEDDED_PREFIX)
            ? { ...p, url: `/api/orders/${order.id}/proof-image/${i}` }
            : p
        ),
      },
    };
  });
}
