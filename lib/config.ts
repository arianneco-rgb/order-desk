// Every integration checks its own env var independently.
// Missing var = mock/snapshot mode, so the whole app runs with zero setup.

import { appsScriptConfigured } from "./apps-script";

export type ShopifyMode = "live" | "snapshot";
export type SheetsMode = "live" | "mock";
export type ParserMode = "claude" | "fallback";
export type BpiMode = "live" | "simulated";
export type DbMode = "supabase" | "memory";

export function shopifyMode(): ShopifyMode {
  const hasStaticToken = Boolean(process.env.SHOPIFY_ADMIN_TOKEN);
  const hasClientCredentials = Boolean(
    process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET
  );
  return process.env.SHOPIFY_STORE && (hasStaticToken || hasClientCredentials)
    ? "live"
    : "snapshot";
}

export function sheetsMode(): SheetsMode {
  return appsScriptConfigured() && Boolean(process.env.SHEET_ID) ? "live" : "mock";
}

export function parserMode(): ParserMode {
  return process.env.ANTHROPIC_API_KEY ? "claude" : "fallback";
}

export function bpiMode(): BpiMode {
  // Same Apps Script bridge as Sheets — it searches Gmail under the
  // deploying Google account's own permissions (see scripts/apps-script/Code.gs).
  // Whoever deployed it must be the account that receives BPI transfer
  // notification emails.
  return appsScriptConfigured() ? "live" : "simulated";
}

export function dbMode(): DbMode {
  // SUPABASE_SECRET_KEY is Supabase's newer sb_secret_... key format — full
  // server-side access, the direct successor to the old service_role JWT.
  return process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
    ? "supabase"
    : "memory";
}

export function authEnabled(): boolean {
  return Boolean(process.env.DASHBOARD_PASSWORD);
}

/** Payments above this prompt Joey to double-check before confirming. */
export const LARGE_PAYMENT_THRESHOLD = 100_000;

/** Drafts unpaid for this many days surface in the follow-up queue. */
export function followUpDays(): number {
  const n = Number(process.env.FOLLOW_UP_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

export function modeSummary() {
  return {
    shopify: shopifyMode(),
    sheets: sheetsMode(),
    parser: parserMode(),
    bpi: bpiMode(),
    db: dbMode(),
    auth: authEnabled() ? "on" : "off",
  };
}
