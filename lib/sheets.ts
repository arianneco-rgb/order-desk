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
import type { CafeCustomer, OrderHistoryRow } from "./types";

/** Fire-and-forget sheet write: one retry, then log — never blocks a request. */
function mirrorToSheet(action: string, body: Record<string, unknown>, what: string): void {
  void callAppsScript(action, body)
    .catch(() => callAppsScript(action, body))
    .catch((err) => console.error(`Sheet mirror failed (${what}):`, err));
}

// ── Customers ────────────────────────────────────────────────────────────

const CUSTOMERS_CACHE_MS = 5 * 60_000;
declare global {
  // eslint-disable-next-line no-var
  var __odSheetCustomersCache: { at: number; customers: CafeCustomer[] } | undefined;
}

/** Overwrite the Customers tab with the current Shopify wholesale list. */
export async function syncCustomersToSheet(): Promise<{ count: number }> {
  const customers = await getCafeCustomers();
  // The fresh Shopify list IS the new dropdown state — cache it right away.
  globalThis.__odSheetCustomersCache = { at: Date.now(), customers };
  if (sheetsMode() === "mock") return { count: customers.length }; // dropdown reads Shopify directly in mock

  return callAppsScript<{ count: number }>("syncCustomers", { customers });
}

/** The dropdown's data source: the Customers tab (mock: Shopify snapshot). */
export async function listSheetCustomers(): Promise<CafeCustomer[]> {
  if (sheetsMode() === "mock") return getCafeCustomers();

  const cached = globalThis.__odSheetCustomersCache;
  if (cached && Date.now() - cached.at < CUSTOMERS_CACHE_MS) return cached.customers;

  const data = await callAppsScript<{ customers: CafeCustomer[] }>("listCustomers");
  // An empty tab (first run) self-heals by syncing from Shopify.
  if (data.customers.length === 0) {
    await syncCustomersToSheet();
    return globalThis.__odSheetCustomersCache?.customers ?? getCafeCustomers();
  }
  globalThis.__odSheetCustomersCache = { at: Date.now(), customers: data.customers };
  return data.customers;
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
