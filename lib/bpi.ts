// BPI payment-email matching.
//
// LIVE mode: reads BPI transfer-notification emails via the same Apps
// Script bridge used for Sheets (scripts/apps-script/Code.gs) — it searches
// Gmail under the deploying Google account's own permissions, no IMAP
// credentials or Cloud service account needed (the org's Workspace admin
// blocked domain-wide delegation, so this sidesteps that entirely).
// SIMULATED mode (default, no bridge configured): a matching transfer
// notification "arrives" a few seconds after a draft is created, so both
// the no-match error state and the matched state can be demonstrated. The
// matcher itself (amount + sender name/reference) is shared between modes.
//
// Golden rule: a match is only ever SHOWN to Joey — nothing auto-confirms.

import { bpiMode } from "./config";
import { listOrders } from "./store";
import { callAppsScript } from "./apps-script";
import type { BpiMatch, Order } from "./types";

export interface BpiEmail {
  emailId: string;
  amount: number;
  senderName: string;
  ref: string;
  date: string;
}

/** How long after draft creation the simulated BPI email "arrives". */
const SIMULATED_ARRIVAL_MS = 8_000;

function refFor(order: Order): string {
  // Deterministic pseudo-reference so re-reads return the same email.
  let hash = 0;
  for (const ch of order.id) hash = (hash * 31 + ch.charCodeAt(0)) % 1_000_000;
  return `BPI${String(hash).padStart(6, "0")}${order.id.slice(-3).toUpperCase()}`;
}

/** The simulated dedicated BPI mailbox, derived from current app state. */
export async function simulatedInbox(): Promise<BpiEmail[]> {
  const now = Date.now();
  const emails: BpiEmail[] = [
    // Decoys — transfers that belong to no open draft.
    {
      emailId: "sim-decoy-1",
      amount: 3175,
      senderName: "JUAN DELA CRUZ",
      ref: "BPI558201XZQ",
      date: new Date(now - 86_400_000).toISOString(),
    },
    {
      emailId: "sim-decoy-2",
      amount: 47_800,
      senderName: "MARIA CLARA COFFEE OPC",
      ref: "BPI994712AAB",
      date: new Date(now - 43_200_000).toISOString(),
    },
  ];

  for (const order of await listOrders()) {
    if (order.status !== "draft_created" || !order.draftCreatedAt) continue;
    const arrivedAt = Date.parse(order.draftCreatedAt) + SIMULATED_ARRIVAL_MS;
    if (now < arrivedAt) continue; // transfer "hasn't landed" yet
    emails.push({
      emailId: `sim-${order.id}`,
      amount: order.total,
      senderName: order.company.toUpperCase(),
      ref: refFor(order),
      date: new Date(arrivedAt).toISOString(),
    });
  }
  return emails;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Match an order against the inbox by amount + sender name/reference.
 * Amount must match to the centavo; the sender must resemble the cafe name
 * (or the reference must cite the order). Never auto-confirms.
 */
export function findMatch(order: Order, inbox: BpiEmail[]): BpiMatch | null {
  const company = normalize(order.company);
  for (const email of inbox) {
    if (Math.abs(email.amount - order.total) > 0.009) continue;
    const sender = normalize(email.senderName);
    const nameMatches =
      company.length > 0 &&
      (sender.includes(company) || company.includes(sender));
    const refMatches = normalize(email.ref).includes(
      normalize(order.id.replace("od_", ""))
    );
    if (nameMatches || refMatches) {
      return {
        amount: email.amount,
        senderName: email.senderName,
        ref: email.ref,
        date: email.date,
        emailId: email.emailId,
      };
    }
  }
  return null;
}

// ── Live inbox via the Apps Script bridge ────────────────────────────────
// The actual Gmail search + regex parsing runs inside Code.gs (under the
// deploying account's own Gmail access) — this just calls it and caches the
// result briefly, since Processed polls this every 5s per open order.

const LIVE_INBOX_CACHE_MS = 15_000;
declare global {
  // eslint-disable-next-line no-var
  var __odBpiInboxCache: { at: number; emails: BpiEmail[] } | undefined;
}

async function fetchLiveInbox(): Promise<BpiEmail[]> {
  const cached = globalThis.__odBpiInboxCache;
  if (cached && Date.now() - cached.at < LIVE_INBOX_CACHE_MS) return cached.emails;

  const data = await callAppsScript<{ emails: BpiEmail[] }>("searchBpi", {
    query: process.env.BPI_EMAIL_QUERY || undefined,
  });
  globalThis.__odBpiInboxCache = { at: Date.now(), emails: data.emails };
  return data.emails;
}

export async function matchOrder(order: Order): Promise<BpiMatch | null> {
  // Test-mode orders never search the real mailbox — a coincidental match
  // against an actual transfer would be genuinely confusing (fake order,
  // real money). They only ever match the simulated inbox.
  if (bpiMode() === "live" && !order.isTest) {
    const inbox = await fetchLiveInbox();
    return findMatch(order, inbox);
  }
  return findMatch(order, await simulatedInbox());
}
