// In-memory app state (resets on restart). Supabase slots in later behind
// the same functions — nothing outside this file touches the storage.
// State survives Next.js dev hot-reloads via globalThis.

import type { CafeCustomer, Order, OrderHistoryRow } from "./types";

export const PROCESS_DELAY_MS = 2500;

interface Db {
  orders: Map<string, Order>;
  /** Cafes added from the Paste page at runtime (snapshot mode). */
  runtimeCustomers: CafeCustomer[];
  /** Mock mirror of the Google Sheet "Order History" tab. */
  orderHistory: OrderHistoryRow[];
  /** Per-order mutation locks (guards double-submits on draft/confirm). */
  locks: Set<string>;
  seq: number;
  seededAt: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __orderDeskDb: Db | undefined;
}

export function db(): Db {
  if (!globalThis.__orderDeskDb) {
    globalThis.__orderDeskDb = {
      orders: new Map(),
      runtimeCustomers: [],
      orderHistory: [],
      locks: new Set(),
      seq: 1000,
      seededAt: new Date().toISOString(),
    };
  }
  // Older dev-HMR snapshots of the db may predate the locks field.
  if (!globalThis.__orderDeskDb.locks) globalThis.__orderDeskDb.locks = new Set();
  return globalThis.__orderDeskDb;
}

export function nextId(prefix: string): string {
  const d = db();
  d.seq += 1;
  return `${prefix}${d.seq}`;
}

export function createOrder(input: {
  company: string;
  customerId?: string;
  rawMessage: string;
}): Order {
  const now = new Date();
  const order: Order = {
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
    payment: { confirmed: false },
    createdAt: now.toISOString(),
    processAfter: new Date(now.getTime() + PROCESS_DELAY_MS).toISOString(),
  };
  db().orders.set(order.id, order);
  return order;
}

export function getOrder(id: string): Order | undefined {
  return db().orders.get(id);
}

export function listOrders(): Order[] {
  return Array.from(db().orders.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

export function saveOrder(order: Order): void {
  db().orders.set(order.id, order);
}

export function addRuntimeCustomer(customer: CafeCustomer): void {
  db().runtimeCustomers.push(customer);
}

export function runtimeCustomers(): CafeCustomer[] {
  return db().runtimeCustomers;
}

export function appendHistory(row: OrderHistoryRow): void {
  db().orderHistory.push(row);
}

export function historyRows(): OrderHistoryRow[] {
  return [...db().orderHistory].sort((a, b) => b.paidAt.localeCompare(a.paidAt));
}

/** Set/replace the note on a history row (annotating a paid order after the fact). */
export function setHistoryNote(orderId: string, note: string): boolean {
  const row = db().orderHistory.find((r) => r.orderId === orderId);
  if (!row) return false;
  row.notes = note;
  return true;
}

/**
 * Synchronous check-and-set claim on an order. Money-facing routes (create
 * draft, confirm payment) take this BEFORE their first await so overlapping
 * double-submits can't both pass a status check and mutate Shopify twice.
 */
export function tryLockOrder(id: string): boolean {
  const locks = db().locks;
  if (locks.has(id)) return false;
  locks.add(id);
  return true;
}

export function unlockOrder(id: string): void {
  db().locks.delete(id);
}
