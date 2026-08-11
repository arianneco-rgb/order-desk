// BPI payment matching.
//
// LIVE mode: reads from a shared "BPI Transactions" spreadsheet via the
// main Apps Script bridge (lib/apps-script.ts) — NOT a live Gmail search.
// A separate Apps Script project (scripts/apps-script/BpiMatching.gs,
// deployed under whoever actually receives BPI transfer emails, e.g.
// Marco) logs new transactions into that sheet on its own timer. This
// keeps Order Desk's own bridge (and Order Desk itself) completely
// decoupled from needing Gmail access to anyone's inbox.
//
// Real BPI notification emails carry no payer name at all (verified
// 2026-07-29 against 7 real samples) — matching is amount + reference +
// (InstaPay only) the sending account's last 4 digits, never a name.
//
// SIMULATED mode (default, no bridge configured): a matching transfer
// notification "arrives" a few seconds after a draft is created, so both
// the no-match error state and the matched state can be demonstrated.
//
// Golden rule: a match is only ever SHOWN to Joey — nothing auto-confirms.
// The sheet row itself is only claimed (preventing reuse on another order)
// at the moment Joey actually clicks Confirm — see confirm-payment/route.ts.

import { bpiMode } from "./config";
import { listActiveOrders } from "./store";
import { callAppsScript } from "./apps-script";
import { cached, invalidate, CACHE_KEYS } from "./shared-cache";
import type { BpiMatch, Order } from "./types";

export interface BpiTransaction {
  emailId: string;
  matchKey: string;
  type: "instapay" | "edpo";
  amount: number;
  ref: string;
  fromAccountLast4: string;
  sourceBank: string;
  status: string;
  settled: boolean;
  date: string;
  loggedAt: string;
  matchedOrderId: string;
  matchedAt: string;
  warnings: string[];
}

/** How long after draft creation the simulated BPI transaction "arrives". */
const SIMULATED_ARRIVAL_MS = 8_000;

function refFor(order: Order): string {
  // Deterministic pseudo-reference so re-reads return the same transaction.
  let hash = 0;
  for (const ch of order.id) hash = (hash * 31 + ch.charCodeAt(0)) % 1_000_000;
  return `BPI${String(hash).padStart(6, "0")}${order.id.slice(-3).toUpperCase()}`;
}

/** The simulated transaction log, derived from current app state. */
export async function simulatedInbox(): Promise<BpiTransaction[]> {
  const now = Date.now();
  const transactions: BpiTransaction[] = [
    // Decoys — transfers that belong to no open draft.
    {
      emailId: "sim-decoy-1",
      matchKey: "instapay:BPI558201XZQ",
      type: "instapay",
      amount: 3175,
      ref: "BPI558201XZQ",
      fromAccountLast4: "9021",
      sourceBank: "Simulated Bank",
      status: "credited",
      settled: true,
      date: new Date(now - 86_400_000).toISOString(),
      loggedAt: new Date(now - 86_400_000).toISOString(),
      matchedOrderId: "",
      matchedAt: "",
      warnings: [],
    },
    {
      emailId: "sim-decoy-2",
      matchKey: "instapay:BPI994712AAB",
      type: "instapay",
      amount: 47_800,
      ref: "BPI994712AAB",
      fromAccountLast4: "4471",
      sourceBank: "Simulated Bank",
      status: "credited",
      settled: true,
      date: new Date(now - 43_200_000).toISOString(),
      loggedAt: new Date(now - 43_200_000).toISOString(),
      matchedOrderId: "",
      matchedAt: "",
      warnings: [],
    },
  ];

  for (const order of await listActiveOrders()) {
    if (order.status !== "draft_created" || !order.draftCreatedAt) continue;
    const arrivedAt = Date.parse(order.draftCreatedAt) + SIMULATED_ARRIVAL_MS;
    if (now < arrivedAt) continue; // transfer "hasn't landed" yet
    const ref = refFor(order);
    transactions.push({
      emailId: `sim-${order.id}`,
      matchKey: `instapay:${ref}`,
      type: "instapay",
      amount: order.total,
      ref,
      fromAccountLast4: order.id.slice(-4),
      sourceBank: "Simulated Bank",
      status: "credited",
      settled: true,
      date: new Date(arrivedAt).toISOString(),
      loggedAt: new Date(arrivedAt).toISOString(),
      matchedOrderId: "",
      matchedAt: "",
      warnings: [],
    });
  }
  return transactions;
}

function toMatch(t: BpiTransaction, matchedBy?: "reference" | "amount"): BpiMatch {
  return {
    amount: t.amount,
    ref: t.ref,
    date: t.date,
    emailId: t.emailId,
    matchKey: t.matchKey,
    type: t.type,
    fromAccountLast4: t.fromAccountLast4 || undefined,
    sourceBank: t.sourceBank || undefined,
    settled: t.settled,
    warnings: t.warnings,
    matchedBy,
  };
}

/**
 * Reference numbers Claude vision read off this order's proof screenshots
 * (see lib/proof-reader.ts). InstaPay's reference number is the network's
 * own end-to-end transaction ID — it's shown identically on the sender's
 * banking/e-wallet app and in BPI's confirmation email, so an exact match
 * here is stronger evidence than amount alone.
 */
function proofRefs(order: Order): string[] {
  const refs = (order.payment.proofs ?? [])
    .map((p) => p.analysis?.ref)
    .filter((r): r is string => Boolean(r && r.trim()))
    .map((r) => r.trim().toUpperCase());
  return Array.from(new Set(refs));
}

/**
 * Match an order against unclaimed transactions. Tries an exact reference
 * match against the order's proof screenshots first (disambiguates
 * same-amount collisions with no manual pick needed); falls back to amount
 * (to the centavo), first unclaimed match wins. Never auto-confirms.
 */
export function findMatch(order: Order, transactions: BpiTransaction[]): BpiMatch | null {
  const refs = proofRefs(order);
  if (refs.length > 0) {
    for (const t of transactions) {
      if (t.matchedOrderId && t.matchedOrderId !== order.id) continue;
      if (refs.includes(t.ref.trim().toUpperCase())) return toMatch(t, "reference");
    }
  }

  for (const t of transactions) {
    if (t.matchedOrderId && t.matchedOrderId !== order.id) continue; // already claimed by a different order
    if (Math.abs(t.amount - order.total) > 0.009) continue;
    return toMatch(t, "amount");
  }
  return null;
}

/**
 * Every other unclaimed transaction (excluding whatever findMatch already
 * returned) — for the manual-pick fallback when there's no confident
 * auto-match (a same-amount collision, or a PESONet/EDPO transfer that
 * carries no secondary signal to disambiguate at all).
 */
export function otherCandidates(
  transactions: BpiTransaction[],
  excludeMatchKey: string | undefined,
  limit = 8
): BpiMatch[] {
  return transactions
    .filter((t) => !t.matchedOrderId && t.matchKey !== excludeMatchKey)
    .slice(0, limit)
    .map((t) => toMatch(t));
}

// ── Transaction log via the main Apps Script bridge ──────────────────────
// Reads the shared sheet a separate Gmail-reading script keeps updated —
// see scripts/apps-script/BpiMatching.gs. Cached briefly since Processed
// polls this every 5s per open order and the sheet itself only changes on
// a ~10 minute timer.

// Longer than it looks: the Gmail-side script only writes to the sheet every
// 10 minutes, so a 15s cache was re-reading the same rows ~40 times between
// updates. This is the app's slowest endpoint (median 1.8s, peaks near 3.7s)
// AND its most frequent — the payment pane polls it every 8s per open order.
// 60s shared across instances still surfaces a new payment well inside the
// 10-minute write cycle.
const TRANSACTIONS_CACHE_MS = 60_000;

async function fetchTransactions(): Promise<BpiTransaction[]> {
  return cached(CACHE_KEYS.bpiTransactions, TRANSACTIONS_CACHE_MS, async () => {
    const data = await callAppsScript<{ transactions: BpiTransaction[] }>("listBpiTransactions");
    return data.transactions;
  });
}

export interface BpiLookup {
  match: BpiMatch | null;
  candidates: BpiMatch[];
}

async function transactionsFor(order: Order): Promise<BpiTransaction[]> {
  // Test-mode orders never search the real log — a coincidental match
  // against an actual transfer would be genuinely confusing (fake order,
  // real money). They only ever match the simulated one.
  const live = bpiMode() === "live" && !order.isTest;
  return live ? await fetchTransactions() : await simulatedInbox();
}

/** Looks up one specific transaction by key — used when Joey manually picks a candidate. */
export async function findByMatchKey(order: Order, matchKey: string): Promise<BpiMatch | null> {
  const transactions = await transactionsFor(order);
  const found = transactions.find((t) => t.matchKey === matchKey && (!t.matchedOrderId || t.matchedOrderId === order.id));
  return found ? toMatch(found) : null;
}

export async function lookupOrder(order: Order): Promise<BpiLookup> {
  const transactions = await transactionsFor(order);
  const match = findMatch(order, transactions);
  const candidates = otherCandidates(transactions, match?.matchKey);
  return { match, candidates };
}

/** Back-compat single-value form — see app/api/orders/[id]/bpi-match. */
export async function matchOrder(order: Order): Promise<BpiMatch | null> {
  return (await lookupOrder(order)).match;
}

/**
 * Claims a transaction for an order in the shared sheet — called only at
 * actual confirm-payment time (never at preview time), so a candidate
 * shown to two same-amount orders doesn't get locked out from either
 * until one of them is actually confirmed. No-ops for simulated/test
 * orders, which have no real sheet row to claim.
 */
export async function claimTransaction(
  order: Order,
  matchKey: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (bpiMode() !== "live" || order.isTest) return { ok: true };
  const result = await callAppsScript<{ ok?: true; error?: string; matchedOrderId?: string }>(
    "markBpiTransactionMatched",
    { matchKey, orderId: order.id }
  );
  if (result.error === "already_matched") {
    return { ok: false, error: `This transaction was already applied to order ${result.matchedOrderId}.` };
  }
  if (result.error) return { ok: false, error: result.error };
  // The sheet now says this row belongs to an order. Drop the cached copy so
  // a claimed payment can't keep being offered to other same-amount orders
  // for the rest of the TTL.
  await invalidate(CACHE_KEYS.bpiTransactions);
  return { ok: true };
}
