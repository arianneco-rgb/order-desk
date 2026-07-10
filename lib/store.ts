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
  locks: Set<string>;
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
      locks: new Set(),
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

// ── Order locking ────────────────────────────────────────────────────────
// Money-facing routes (create draft, confirm payment) claim this BEFORE
// their first other await so overlapping double-submits can't both pass a
// status check and mutate Shopify twice. In memory mode this is a plain Set
// check-and-set (atomic within one process). In Supabase mode it's an
// UPDATE ... WHERE locked_at IS NULL, which Postgres executes atomically —
// so it holds even across multiple serverless instances, which the
// in-memory Set never could.

export async function tryLockOrder(id: string): Promise<boolean> {
  if (!isLive()) {
    const locks = mem().locks;
    if (locks.has(id)) return false;
    locks.add(id);
    return true;
  }
  const { data, error } = await supabase()
    .from("orders")
    .update({ locked_at: new Date().toISOString() })
    .eq("id", id)
    .is("locked_at", null)
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
