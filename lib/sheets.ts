// Google Sheets mirror — ONE spreadsheet, two tabs:
//   "Customers"      — cafe list, synced ONE-WAY from Shopify (feeds the dropdown)
//   "Order History"  — a row appended every time an order is marked paid
//
// LIVE mode (APPS_SCRIPT_URL + APPS_SCRIPT_SECRET): talks to a Google Apps
// Script Web App deployed under a regular Google account — see
// scripts/apps-script/Code.gs. This replaced an earlier Cloud service
// account approach, which the org's Workspace admin blocked (no
// domain-wide delegation approval).
// MOCK mode: an in-memory mirror so the whole flow works with zero setup.
// Two-way editing is intentionally NOT built.

import { sheetsMode } from "./config";
import { appendHistory, historyRows, setHistoryNote } from "./store";
import { getCafeCustomers } from "./shopify";
import { callAppsScript } from "./apps-script";
import type { CafeCustomer, OrderHistoryRow } from "./types";

/** Overwrite the Customers tab with the current Shopify wholesale list. */
export async function syncCustomersToSheet(): Promise<{ count: number }> {
  const customers = await getCafeCustomers();
  if (sheetsMode() === "mock") return { count: customers.length }; // dropdown reads Shopify directly in mock

  return callAppsScript<{ count: number }>("syncCustomers", { customers });
}

/** The dropdown's data source: the Customers tab (mock: Shopify snapshot). */
export async function listSheetCustomers(): Promise<CafeCustomer[]> {
  if (sheetsMode() === "mock") return getCafeCustomers();

  const data = await callAppsScript<{ customers: CafeCustomer[] }>("listCustomers");
  // An empty tab (first run) self-heals by syncing from Shopify.
  if (data.customers.length === 0) {
    await syncCustomersToSheet();
    return getCafeCustomers();
  }
  return data.customers;
}

export async function appendOrderHistory(row: OrderHistoryRow): Promise<void> {
  appendHistory(row); // always keep the in-memory mirror for the UI
  if (sheetsMode() === "mock") return;

  await callAppsScript("appendHistory", { row });
}

export async function listOrderHistory(): Promise<OrderHistoryRow[]> {
  if (sheetsMode() === "mock") return historyRows();

  const data = await callAppsScript<{ rows: OrderHistoryRow[] }>("listHistory");
  return [...data.rows].sort((a, b) => b.paidAt.localeCompare(a.paidAt));
}

/** Add/edit the note on a history row after the fact — Joey's corrections/annotations. */
export async function setOrderHistoryNote(
  orderId: string,
  note: string
): Promise<boolean> {
  const foundInMirror = setHistoryNote(orderId, note);
  if (sheetsMode() === "mock") return foundInMirror;

  const data = await callAppsScript<{ ok: boolean }>("setHistoryNote", { orderId, note });
  return data.ok;
}
