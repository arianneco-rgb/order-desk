// Google Sheets mirror — ONE spreadsheet, two tabs:
//   "Customers"      — cafe list, synced ONE-WAY from Shopify (feeds the dropdown)
//   "Order History"  — a row appended every time an order is marked paid
//
// LIVE mode (GOOGLE_SA_JSON + SHEET_ID): Sheets REST API with a service
// account (share the spreadsheet with the service-account email as Editor).
// MOCK mode: an in-memory mirror so the whole flow works with zero setup.
// Two-way editing is intentionally NOT built.

import crypto from "crypto";
import { sheetsMode } from "./config";
import { appendHistory, historyRows, setHistoryNote } from "./store";
import { getCafeCustomers } from "./shopify";
import type { CafeCustomer, OrderHistoryRow } from "./types";

export const CUSTOMERS_TAB = "Customers";
export const HISTORY_TAB = "Order History";

// ── Service-account auth (no SDK — plain REST + RS256 JWT) ──────────────

interface TokenCache {
  token: string;
  expiresAt: number;
}
declare global {
  // eslint-disable-next-line no-var
  var __odSheetsToken: TokenCache | undefined;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

async function accessToken(): Promise<string> {
  const cached = globalThis.__odSheetsToken;
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const sa = JSON.parse(process.env.GOOGLE_SA_JSON as string) as {
    client_email: string;
    private_key: string;
  };
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(sa.private_key));
  const jwt = `${header}.${claims}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  globalThis.__odSheetsToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

async function sheetsFetch(path: string, init?: RequestInit): Promise<any> {
  const token = await accessToken();
  const sheetId = process.env.SHEET_ID as string;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    }
  );
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Tab self-provisioning ────────────────────────────────────────────────
// The spreadsheet was first created from a CSV import (one tab). On the
// first live run this renames that imported tab to "Customers" (its A1 is
// "Cafe") and adds the "Order History" tab — so no manual setup is needed.

declare global {
  // eslint-disable-next-line no-var
  var __odSheetsTabsReady: boolean | undefined;
}

async function ensureTabs(): Promise<void> {
  if (globalThis.__odSheetsTabsReady) return;

  const meta = (await sheetsFetch("?fields=sheets.properties")) as {
    sheets: { properties: { sheetId: number; title: string } }[];
  };
  const tabs = meta.sheets.map((s) => s.properties);
  const requests: unknown[] = [];

  if (!tabs.some((t) => t.title === CUSTOMERS_TAB)) {
    // Prefer renaming the CSV-imported tab that already holds the cafe list.
    let renamed = false;
    for (const tab of tabs) {
      const a1 = await sheetsFetch(
        `/values/${encodeURIComponent(`${tab.title}`)}!A1`
      ).catch(() => null);
      if (a1?.values?.[0]?.[0] === "Cafe") {
        requests.push({
          updateSheetProperties: {
            properties: { sheetId: tab.sheetId, title: CUSTOMERS_TAB },
            fields: "title",
          },
        });
        renamed = true;
        break;
      }
    }
    if (!renamed) {
      requests.push({ addSheet: { properties: { title: CUSTOMERS_TAB } } });
    }
  }

  if (!tabs.some((t) => t.title === HISTORY_TAB)) {
    requests.push({ addSheet: { properties: { title: HISTORY_TAB } } });
  }

  if (requests.length > 0) {
    await sheetsFetch(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  }
  globalThis.__odSheetsTabsReady = true;
}

// ── Customers tab (one-way Shopify → Sheet) ─────────────────────────────

const CUSTOMER_HEADER = ["Cafe", "Contact", "Email", "Phone", "City", "Shopify ID"];

/** Overwrite the Customers tab with the current Shopify wholesale list. */
export async function syncCustomersToSheet(): Promise<{ count: number }> {
  const customers = await getCafeCustomers();
  if (sheetsMode() === "mock") return { count: customers.length }; // dropdown reads Shopify directly in mock

  await ensureTabs();
  const rows = [
    CUSTOMER_HEADER,
    ...customers.map((c) => [
      c.name,
      c.contactName ?? "",
      c.email ?? "",
      c.phone ?? "",
      c.city ?? "",
      c.shopifyId,
    ]),
  ];
  await sheetsFetch(`/values/${encodeURIComponent(CUSTOMERS_TAB)}!A1:F10000:clear`, {
    method: "POST",
    body: "{}",
  });
  await sheetsFetch(
    `/values/${encodeURIComponent(CUSTOMERS_TAB)}!A1?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: rows }) }
  );
  return { count: customers.length };
}

/** The dropdown's data source: the Customers tab (mock: Shopify snapshot). */
export async function listSheetCustomers(): Promise<CafeCustomer[]> {
  if (sheetsMode() === "mock") return getCafeCustomers();

  await ensureTabs();
  const data = await sheetsFetch(
    `/values/${encodeURIComponent(CUSTOMERS_TAB)}!A2:F10000`
  );
  const rows: string[][] = data.values ?? [];
  const fromSheet = rows
    .filter((r) => r[0])
    .map((r) => ({
      name: r[0],
      contactName: r[1] || undefined,
      email: r[2] || undefined,
      phone: r[3] || undefined,
      city: r[4] || undefined,
      shopifyId: r[5] || "",
    }));
  // An empty tab (first run) self-heals by syncing from Shopify.
  if (fromSheet.length === 0) {
    await syncCustomersToSheet();
    return getCafeCustomers();
  }
  return fromSheet;
}

// ── Order History tab (append on paid; History page reads it) ───────────

const HISTORY_HEADER = ["Paid at", "Cafe", "Items", "Total (PHP)", "Order Desk ID", "Shopify draft", "Status", "Notes"];

export async function appendOrderHistory(row: OrderHistoryRow): Promise<void> {
  appendHistory(row); // always keep the in-memory mirror for the UI
  if (sheetsMode() === "mock") return;

  await ensureTabs();
  await ensureHistoryHeader();
  await sheetsFetch(
    `/values/${encodeURIComponent(HISTORY_TAB)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({
        values: [[
          row.paidAt,
          row.company,
          row.items,
          row.total,
          row.orderId,
          row.shopifyDraftName ?? "",
          row.status,
          row.notes ?? "",
        ]],
      }),
    }
  );
}

async function ensureHistoryHeader(): Promise<void> {
  const data = await sheetsFetch(`/values/${encodeURIComponent(HISTORY_TAB)}!A1:H1`);
  if (!data.values?.length) {
    await sheetsFetch(
      `/values/${encodeURIComponent(HISTORY_TAB)}!A1?valueInputOption=RAW`,
      { method: "PUT", body: JSON.stringify({ values: [HISTORY_HEADER] }) }
    );
  }
}

export async function listOrderHistory(): Promise<OrderHistoryRow[]> {
  if (sheetsMode() === "mock") return historyRows();

  await ensureTabs();
  const data = await sheetsFetch(
    `/values/${encodeURIComponent(HISTORY_TAB)}!A2:H100000`
  );
  const rows: string[][] = data.values ?? [];
  return rows
    .filter((r) => r[0])
    .map((r) => ({
      paidAt: r[0],
      company: r[1] ?? "",
      items: r[2] ?? "",
      total: Number(r[3] ?? 0),
      orderId: r[4] ?? "",
      shopifyDraftName: r[5] || undefined,
      status: "paid" as const,
      notes: r[7] || undefined,
    }))
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
}

/** Add/edit the note on a history row after the fact — Joey's corrections/annotations. */
export async function setOrderHistoryNote(
  orderId: string,
  note: string
): Promise<boolean> {
  const foundInMirror = setHistoryNote(orderId, note);
  if (sheetsMode() === "mock") return foundInMirror;

  await ensureTabs();
  const data = await sheetsFetch(
    `/values/${encodeURIComponent(HISTORY_TAB)}!A2:H100000`
  );
  const rows: string[][] = data.values ?? [];
  const idx = rows.findIndex((r) => r[4] === orderId);
  if (idx === -1) return foundInMirror;

  const sheetRow = idx + 2; // +1 for header, +1 for 1-indexing
  await sheetsFetch(
    `/values/${encodeURIComponent(HISTORY_TAB)}!H${sheetRow}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [[note]] }) }
  );
  return true;
}
