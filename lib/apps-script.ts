// Shared client for the Order Desk Apps Script bridge — one deployed Web
// App handles both Google Sheets (Customers / Order History) and Gmail (BPI
// matching). Apps Script runs under a regular Google account's own
// permissions, so it needs no service account and no Workspace admin
// approval — this exists specifically because domain-wide delegation was
// blocked by the org's admin. See scripts/apps-script/Code.gs and
// SETUP.md for deployment steps.
//
// The web app has no real auth of its own (Apps Script "Anyone" access is
// unauthenticated at the HTTP layer), so every call carries a shared secret
// as a query param that the script checks itself.

export function appsScriptConfigured(): boolean {
  return Boolean(process.env.APPS_SCRIPT_URL && process.env.APPS_SCRIPT_SECRET);
}

export async function callAppsScript<T>(
  action: string,
  body?: Record<string, unknown>
): Promise<T> {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) {
    throw new Error("Apps Script bridge requires APPS_SCRIPT_URL + APPS_SCRIPT_SECRET.");
  }
  const res = await fetch(`${url}?key=${encodeURIComponent(secret)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Apps Script HTTP ${res.status}: ${await res.text()}`);
  }
  // Apps Script web apps always answer HTTP 200 — failures come back as a
  // normal JSON body with an `error` field, not a non-2xx status.
  const json = (await res.json()) as T & { error?: string };
  if ((json as { error?: string }).error) {
    throw new Error(`Apps Script error: ${(json as { error?: string }).error}`);
  }
  return json as T;
}
