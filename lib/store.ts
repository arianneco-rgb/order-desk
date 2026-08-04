// App state — Supabase-backed when SUPABASE_URL + SUPABASE_SECRET_KEY are
// set (see lib/config.ts dbMode()), otherwise an in-memory fallback that
// resets on restart (fine for local/demo use, not for production).
//
// Every domain object is stored as a single JSONB column matching
// lib/types.ts exactly — no ORM, no per-field schema to keep in sync. A few
// columns are pulled out alongside the JSONB purely so Postgres can
// index/sort/filter without parsing JSON (see scripts/db/schema.sql).
//
// All functions are async regardless of mode, so callers don't need to care
// which backend is active. In-memory state survives Next.js dev hot-reloads
// via globalThis, same as before.

import { dbMode } from "./config";
import { supabase } from "./supabase";
import type { CafeCustomer, Order, OrderHistoryRow } from "./types";

export const PROCESS_DELAY_MS = 2500;

/** Short, collision-resistant id — no shared counter to coordinate across instances. */
export function nextId(prefix: string): string {
  return `${prefix}${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

// ── In-memory fallback ──────────────────────────────────────────────────

interface MemDb {
  orders: Map<string, Order>;
  runtimeCustomers: CafeCustomer[];
  orderHistory: OrderHistoryRow[];
  /** Value is when the lock was claimed (ms) — lets a stale lock self-heal, same as the Supabase branch. */
  locks: Map<string, number>;
  testMode: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __orderDeskDb: MemDb | undefined;
}

function mem(): MemDb {
  if (!globalThis.__orderDeskDb) {
    globalThis.__orderDeskDb = {
      orders: new Map(),
      runtimeCustomers: [],
      orderHistory: [],
      locks: new Map(),
      testMode: false,
    };
  }
  return globalThis.__orderDeskDb;
}

function isLive(): boolean {
  return dbMode() === "supabase";
}

/** Draft-option defaults; per-customer defaults are applied during processing. */
export function defaultDraftOptions(): Order["options"] {
  return { applyEligibleDiscounts: true, chargeVat: false, freeSamples: false };
}

/** Orders written before DraftOptions existed lack `options` — fill on read. */
function normalizeOrder(order: Order): Order {
  if (!order.options) order.options = defaultDraftOptions();
  return order;
}

async function newOrder(input: {
  company: string;
  customerId?: string;
  rawMessage: string;
}): Promise<Order> {
  const now = new Date();
  return {
    id: nextId("od_"),
    company: input.company,
    customerId: input.customerId,
    rawMessage: input.rawMessage,
    items: [],
    total: 0,
    status: "queued",
    needsReview: false,
    reviewReasons: [],
    reply: "",
    options: defaultDraftOptions(),
    payment: { confirmed: false },
    createdAt: now.toISOString(),
    processAfter: new Date(now.getTime() + PROCESS_DELAY_MS).toISOString(),
    isTest: await getTestMode(),
  };
}

// ── Global settings (currently just the test-mode switch) ───────────────

export async function getTestMode(): Promise<boolean> {
  if (!isLive()) return mem().testMode;
  const { data, error } = await supabase()
    .from("app_settings")
    .select("test_mode")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`Supabase settings fetch failed: ${error.message}`);
  return data?.test_mode ?? false;
}

export async function setTestMode(enabled: boolean): Promise<void> {
  if (!isLive()) {
    mem().testMode = enabled;
    return;
  }
  const { error } = await supabase()
    .from("app_settings")
    .upsert({ id: 1, test_mode: enabled, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Supabase settings save failed: ${error.message}`);
}

// ── Orders ───────────────────────────────────────────────────────────────

export async function createOrder(input: {
  company: string;
  customerId?: string;
  rawMessage: string;
}): Promise<Order> {
  const order = await newOrder(input);
  if (!isLive()) {
    mem().orders.set(order.id, order);
    return order;
  }
  const { error } = await supabase()
    .from("orders")
    .insert({ id: order.id, status: order.status, created_at: order.createdAt, data: order });
  if (error) throw new Error(`Supabase order insert failed: ${error.message}`);
  return order;
}

export async function getOrder(id: string): Promise<Order | undefined> {
  if (!isLive()) return mem().orders.get(id);
  const { data, error } = await supabase()
    .from("orders")
    .select("data")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Supabase order fetch failed: ${error.message}`);
  const order = data?.data as Order | undefined;
  return order ? normalizeOrder(order) : undefined;
}

export async function listOrders(): Promise<Order[]> {
  if (!isLive()) {
    return Array.from(mem().orders.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }
  const { data, error } = await supabase()
    .from("orders")
    .select("data")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Supabase order list failed: ${error.message}`);
  return (data ?? []).map((row) => normalizeOrder(row.data as Order));
}

/**
 * Every current caller (the polled /api/orders route, tick(), duplicate
 * detection, BPI matching) only ever needs orders that are still "in
 * flight" — none of them read or display paid orders, and Processed
 * already has its own client-side fallback for a JUST-paid order dropping
 * out of the next poll. Paid orders are the fastest-growing, least-needed
 * part of the table for these call sites, so this filters at the DB level
 * (using the existing `orders_status_idx`) instead of fetching everything
 * and discarding most of it in JS on every 2-2.5s poll.
 */
export async function listActiveOrders(): Promise<Order[]> {
  if (!isLive()) {
    return Array.from(mem().orders.values())
      .filter((o) => o.status !== "paid")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const { data, error } = await supabase()
    .from("orders")
    .select("data")
    .neq("status", "paid")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Supabase order list failed: ${error.message}`);
  return (data ?? []).map((row) => normalizeOrder(row.data as Order));
}

export async function saveOrder(order: Order): Promise<void> {
  if (!isLive()) {
    mem().orders.set(order.id, order);
    return;
  }
  const { error } = await supabase()
    .from("orders")
    .upsert({ id: order.id, status: order.status, created_at: order.createdAt, data: order });
  if (error) throw new Error(`Supabase order save failed: ${error.message}`);
}

/** Permanently remove an order — Queue/Processed "Delete" action. Never used on paid orders. */
export async function deleteOrder(id: string): Promise<void> {
  if (!isLive()) {
    mem().orders.delete(id);
    mem().locks.delete(id);
    return;
  }
  const { error } = await supabase().from("orders").delete().eq("id", id);
  if (error) throw new Error(`Supabase order delete failed: ${error.message}`);
}

// ── Runtime customers (snapshot-mode "add a cafe" fallback) ────────────

export async function addRuntimeCustomer(customer: CafeCustomer): Promise<void> {
  if (!isLive()) {
    mem().runtimeCustomers.push(customer);
    return;
  }
  const { error } = await supabase()
    .from("runtime_customers")
    .insert({ shopify_id: customer.shopifyId, data: customer });
  if (error) throw new Error(`Supabase runtime customer insert failed: ${error.message}`);
}

export async function runtimeCustomers(): Promise<CafeCustomer[]> {
  if (!isLive()) return mem().runtimeCustomers;
  const { data, error } = await supabase().from("runtime_customers").select("data");
  if (error) throw new Error(`Supabase runtime customer list failed: ${error.message}`);
  return (data ?? []).map((row) => row.data as CafeCustomer);
}

// ── Order history (local mirror — the Google Sheet is the durable copy) ─

export async function appendHistory(row: OrderHistoryRow): Promise<void> {
  if (!isLive()) {
    mem().orderHistory.push(row);
    return;
  }
  const { error } = await supabase()
    .from("order_history")
    .insert({ order_id: row.orderId, paid_at: row.paidAt, data: row });
  if (error) throw new Error(`Supabase history insert failed: ${error.message}`);
}

export async function historyRows(): Promise<OrderHistoryRow[]> {
  if (!isLive()) {
    return [...mem().orderHistory].sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  }
  const { data, error } = await supabase()
    .from("order_history")
    .select("data")
    .order("paid_at", { ascending: false });
  if (error) throw new Error(`Supabase history list failed: ${error.message}`);
  return (data ?? []).map((row) => row.data as OrderHistoryRow);
}

/** Set/replace the note on a history row (annotating a paid order after the fact). */
export async function setHistoryNote(orderId: string, note: string): Promise<boolean> {
  if (!isLive()) {
    const row = mem().orderHistory.find((r) => r.orderId === orderId);
    if (!row) return false;
    row.notes = note;
    return true;
  }
  const { data: existing, error: selectError } = await supabase()
    .from("order_history")
    .select("data")
    .eq("order_id", orderId)
    .maybeSingle();
  if (selectError) throw new Error(`Supabase history fetch failed: ${selectError.message}`);
  if (!existing) return false;
  const updated: OrderHistoryRow = { ...(existing.data as OrderHistoryRow), notes: note };
  const { error } = await supabase()
    .from("order_history")
    .update({ data: updated })
    .eq("order_id", orderId);
  if (error) throw new Error(`Supabase history note update failed: ${error.message}`);
  return true;
}

/**
 * Remove an order's local history row, if one exists. In practice this is
 * almost always a no-op — a history row is only ever written once an order
 * is marked PAID, and deletion is only offered on Queue/Processed (never-
 * paid orders) — but it keeps "delete from the sheet" true if that ever
 * changes.
 */
export async function deleteHistoryRow(orderId: string): Promise<boolean> {
  if (!isLive()) {
    const idx = mem().orderHistory.findIndex((r) => r.orderId === orderId);
    if (idx === -1) return false;
    mem().orderHistory.splice(idx, 1);
    return true;
  }
  const { data, error } = await supabase()
    .from("order_history")
    .delete()
    .eq("order_id", orderId)
    .select("order_id");
  if (error) throw new Error(`Supabase history delete failed: ${error.message}`);
  return (data ?? []).length > 0;
}

// ── Order locking ────────────────────────────────────────────────────────
// Money-facing routes (create draft, confirm payment) claim this BEFORE
// their first other await so overlapping double-submits can't both pass a
// status check and mutate Shopify twice. In memory mode this is a plain Map
// check-and-set (atomic within one process). In Supabase mode it's an
// UPDATE ... WHERE locked_at IS NULL, which Postgres executes atomically —
// so it holds even across multiple serverless instances, which the
// in-memory Map never could.
//
// A lock older than LOCK_STALE_MS is treated as free. Without this, a
// request that dies between its Shopify call succeeding and its own
// `finally { unlockOrder }` running (a platform-level timeout/crash, not a
// thrown error — those still hit `finally` normally) leaves the order
// permanently unconfirmable, since nothing else ever clears locked_at.
// Caught 2026-07-24: a confirm-payment call completed the Shopify draft
// (#D3620 → real order #5376, PAID) but the function never got to save
// that back or release the lock — the order sat stuck for 4+ hours
// showing "Already confirming" on every retry, even though it had already
// been paid. LOCK_STALE_MS is comfortably longer than any real Shopify
// call should take, short enough to self-heal quickly if this recurs.
const LOCK_STALE_MS = 60_000;

export async function tryLockOrder(id: string): Promise<boolean> {
  if (!isLive()) {
    const locks = mem().locks;
    const claimedAt = locks.get(id);
    if (claimedAt !== undefined && Date.now() - claimedAt < LOCK_STALE_MS) return false;
    locks.set(id, Date.now());
    return true;
  }
  const staleCutoff = new Date(Date.now() - LOCK_STALE_MS).toISOString();
  const { data, error } = await supabase()
    .from("orders")
    .update({ locked_at: new Date().toISOString() })
    .eq("id", id)
    .or(`locked_at.is.null,locked_at.lt.${staleCutoff}`)
    .select("id");
  if (error) throw new Error(`Supabase lock claim failed: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function unlockOrder(id: string): Promise<void> {
  if (!isLive()) {
    mem().locks.delete(id);
    return;
  }
  const { error } = await supabase().from("orders").update({ locked_at: null }).eq("id", id);
  if (error) throw new Error(`Supabase lock release failed: ${error.message}`);
}

// ── Sample credits ───────────────────────────────────────────────────────
// A row per draft created with a "Sample credit" manual discount, so the
// auto-suggest never offers the same credit twice. Memory mode keeps these
// only for the session (fine for demos).

interface SampleCreditRow {
  orderId: string;
  customerId: string;
  amount: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __odSampleCredits: SampleCreditRow[] | undefined;
}

function memCredits(): SampleCreditRow[] {
  if (!globalThis.__odSampleCredits) globalThis.__odSampleCredits = [];
  return globalThis.__odSampleCredits;
}

export async function recordSampleCredit(row: SampleCreditRow): Promise<void> {
  if (!isLive()) {
    if (!memCredits().some((c) => c.orderId === row.orderId)) memCredits().push(row);
    return;
  }
  const { error } = await supabase()
    .from("sample_credits")
    .upsert({ order_id: row.orderId, customer_id: row.customerId, amount: row.amount });
  if (error) throw new Error(`Supabase sample credit insert failed: ${error.message}`);
}

/** Total ₱ of sample credit already applied to drafts for this customer. */
export async function usedSampleCredit(customerId: string): Promise<number> {
  if (!isLive()) {
    return memCredits()
      .filter((c) => c.customerId === customerId)
      .reduce((sum, c) => sum + c.amount, 0);
  }
  const { data, error } = await supabase()
    .from("sample_credits")
    .select("amount")
    .eq("customer_id", customerId);
  if (error) throw new Error(`Supabase sample credit fetch failed: ${error.message}`);
  return (data ?? []).reduce((sum, r) => sum + Number(r.amount), 0);
}
