// Every integration checks its own env var independently.
// Missing var = mock/snapshot mode, so the whole app runs with zero setup.

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
  return process.env.GOOGLE_SA_JSON && process.env.SHEET_ID ? "live" : "mock";
}

export function parserMode(): ParserMode {
  return process.env.ANTHROPIC_API_KEY ? "claude" : "fallback";
}

export function bpiMode(): BpiMode {
  // Reuses the Sheets service account (GOOGLE_SA_JSON) unless a dedicated
  // one is given — either way, that service account needs domain-wide
  // delegation + the gmail.readonly scope authorized in the Google
  // Workspace admin console, and BPI_GMAIL_USER is the mailbox to read.
  const hasServiceAccount = Boolean(
    process.env.BPI_GMAIL_SA_JSON || process.env.GOOGLE_SA_JSON
  );
  return hasServiceAccount && process.env.BPI_GMAIL_USER ? "live" : "simulated";
}

export function dbMode(): DbMode {
  return process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? "supabase"
    : "memory";
}

export function authEnabled(): boolean {
  return Boolean(process.env.DASHBOARD_PASSWORD);
}

/** Payments above this prompt Joey to double-check before confirming. */
export const LARGE_PAYMENT_THRESHOLD = 100_000;

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
