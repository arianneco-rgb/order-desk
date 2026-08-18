// Google Sheets mirror — ONE spreadsheet, two tabs:
//   "Customers"      — cafe list, synced ONE-WAY from Shopify (feeds the dropdown)
//   "Order History"  — a row appended every time an order is marked paid
//
// LIVE mode (APPS_SCRIPT_URL + APPS_SCRIPT_SECRET): talks to a Google Apps
// Script Web App (scripts/apps-script/Code.gs) deployed under a regular
// Google account — a Cloud service account was blocked by the Workspace
// admin. Apps Script calls take ~2-3s EACH, so the sheet is treated as a
// WRITE-ONLY mirror: history reads come from the store (Supabase/memory,
// ~0.3s) and sheet writes happen in the background with one retry. The
// sheet stays the durable, human-readable copy — the app just never waits
// on it. Rows edited BY HAND in the sheet won't show in the app; in-app
// note edits still land in both. Customers reads are cached briefly for
// the same reason.
// MOCK mode: the in-memory mirror, zero setup. Two-way editing is
// intentionally NOT built.

import { sheetsMode } from "./config";
import { appendHistory, deleteHistoryRow, historyRows, setHistoryNote } from "./store";
import { getCafeCustomers } from "./shopify";
import { callAppsScript } from "./apps-script";
import { cached, primeCache, CACHE_KEYS } from "./shared-cache";
import type { CafeCustomer, OrderHistoryRow } from "./types";

/** Fire-and-forget sheet write: one retry, then log — never blocks a request. */
function mirrorToSheet(action: string, body: Record<string, unknown>, what: string): void {
  void callAppsScript(action, body)
    .catch(() => callAppsScript(action, body))
    .catch((err) => console.error(`Sheet mirror failed (${what}):`, err));
}

// ── Customers ────────────────────────────────────────────────────────────

// 30 minutes, not 5: the full Shopify customer fetch is ~8s over 8 pages,
// and the cafe list changes rarely (a new cafe is added days apart, and
// adding one through the app primes this cache directly). Paying 8s every
// 5 minutes for data that barely moves is the wrong trade.
const CUSTOMERS_CACHE_MS = 30 * 60_000;

/** Overwrite the Customers tab with the current Shopify wholesale list. */
export async function syncCustomersToSheet(): Promise<{ count: number }> {
  const customers = await getCafeCustomers();
  // The fresh Shopify list IS the new dropdown state — seed the shared cache
  // so no one pays for a re-read of the tab we just wrote.
  await primeCache(CACHE_KEYS.sheetCustomers, customers);
  if (sheetsMode() === "mock") return { count: customers.length }; // dropdown reads Shopify directly in mock

  return callAppsScript<{ count: number }>("syncCustomers", { customers });
}

/**
 * The dropdown's data source: the Customers tab (mock: Shopify snapshot).
 * Cached through Supabase so all serverless instances share one warm copy —
 * this call measured 513ms warm vs 3528ms cold when the cache was
 * per-instance, and the dropdown is the first thing Joey touches.
 */
export async function listSheetCustomers(): Promise<CafeCustomer[]> {
  if (sheetsMode() === "mock") return getCafeCustomers();

  // Reads SHOPIFY, not the Customers tab. The tab only carries name/contact/
  // email/phone/city — no tags and no address book — so serving the picker
  // from it made two things impossible: customers tagged something other
  // than "wholesale" were invisible (Jerico Ondoy and Jane Degulacion are
  // tagged only "Invoice Requested"), and the branch picker had no
  // addresses to offer. Shopify is the source of truth for both.
  //
  // The full fetch is ~8.7s over 19 pages, so it leans on the shared cache:
  // that cost lands roughly once per TTL across the whole deployment, not
  // per search. The Customers tab stays as the human-readable mirror it was
  // always meant to be.
  return cached(CACHE_KEYS.sheetCustomers, CUSTOMERS_CACHE_MS, () => getCafeCustomers());
}

// ── Order history ────────────────────────────────────────────────────────
// The store (Supabase/memory) is the READ source; the sheet is a
// background-mirrored write target only.

export async function appendOrderHistory(row: OrderHistoryRow): Promise<void> {
  await appendHistory(row); // the durable write — the one we wait on
  // Test-mode orders (global switch, see lib/store.ts) never touch the real
  // sheet — they still show in the app's History, tagged, for testing.
  if (sheetsMode() === "mock" || row.isTest) return;

  mirrorToSheet("appendHistory", { row }, `history row ${row.orderId}`);
}

export async function listOrderHistory(): Promise<OrderHistoryRow[]> {
  return historyRows();
}

/** Add/edit the note on a history row after the fact — Joey's corrections/annotations. */
export async function setOrderHistoryNote(
  orderId: string,
  note: string
): Promise<boolean> {
  const found = await setHistoryNote(orderId, note);
  if (sheetsMode() === "mock" || !found) return found;

  const row = (await historyRows()).find((r) => r.orderId === orderId);
  if (row?.isTest) return true; // never mirror a test order's note either

  mirrorToSheet("setHistoryNote", { orderId, note }, `note on ${orderId}`);
  return true;
}

/** Remove an order's row from local history (if any) and mirror the removal. */
export async function deleteOrderHistory(orderId: string): Promise<void> {
  const found = await deleteHistoryRow(orderId);
  if (!found || sheetsMode() === "mock") return;

  mirrorToSheet("deleteHistoryRow", { orderId }, `delete history row ${orderId}`);
}
