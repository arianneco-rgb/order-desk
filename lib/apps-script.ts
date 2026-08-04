// Shared client for the Order Desk Apps Script bridge — one deployed Web
// App handles Google Sheets (Customers / Order History / Invoice
// generator / the BPI Transactions log). Apps Script runs under a regular
// Google account's own permissions, so it needs no service account and no
// Workspace admin approval — this exists specifically because domain-wide
// delegation was blocked by the org's admin. See
// scripts/apps-script/Code.gs and SETUP.md for deployment steps.
//
// BPI email reading itself happens in a completely SEPARATE Apps Script
// project (scripts/apps-script/BpiMatching.gs) deployed under whoever
// actually receives BPI transfer emails — it logs transactions into a
// shared sheet on its own timer, which THIS bridge just reads. Order Desk
// never calls that other project directly, so it's not part of this file.
//
// The web app has no real auth of its own (Apps Script "Anyone" access is
// unauthenticated at the HTTP layer), so every call carries a shared secret
// as a query param that the script checks itself.

export function appsScriptConfigured(): boolean {
  return Boolean(process.env.APPS_SCRIPT_URL && process.env.APPS_SCRIPT_SECRET);
}

/**
 * Every /exec call is answered with a 302 to script.googleusercontent.com,
 * and the fetch spec says a 302 following a POST is re-issued as a GET with
 * the body dropped. That makes this bridge intermittently lossy in two
 * distinct ways, both of which used to surface to Joey as raw noise:
 *
 *   - the body vanishes, the script sees no action, and returns
 *     {"error":"Unknown action: undefined"}
 *   - the redirect target itself hiccups and Google serves an HTML
 *     "Sorry, unable to open the file at this time" page (HTTP 404)
 *
 * Measured against the live deployment, roughly 1 call in 3 hit one of
 * these. Two defences: the action also rides in the query string (handle()
 * reads `body.action || params.action`, so it survives a dropped body), and
 * transient failures are retried rather than thrown straight at the UI.
 */
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;

/** True for the redirect-related failures above — worth retrying, unlike a real error. */
function isTransient(status: number, text: string): boolean {
  if (status >= 500 || status === 404) return true;
  const t = text.trimStart().toLowerCase();
  if (t.startsWith("<!doctype html") || t.startsWith("<html")) return true;
  return text.includes('"error":"Unknown action: undefined"');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function callAppsScript<T>(
  action: string,
  body?: Record<string, unknown>
): Promise<T> {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) {
    throw new Error("Apps Script bridge requires APPS_SCRIPT_URL + APPS_SCRIPT_SECRET.");
  }
  const endpoint = `${url}?key=${encodeURIComponent(secret)}&action=${encodeURIComponent(action)}`;

  let lastFailure = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let status = 0;
    let text = "";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
        cache: "no-store",
      });
      status = res.status;
      text = await res.text();
    } catch (err) {
      lastFailure = `network error: ${err instanceof Error ? err.message : String(err)}`;
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * attempt);
      continue;
    }

    if (isTransient(status, text)) {
      // Never surface Google's HTML error page — it's hundreds of lines of
      // markup that tells the reader nothing.
      lastFailure =
        status === 404 || text.trimStart().startsWith("<")
          ? `Google returned an error page instead of running the script (HTTP ${status})`
          : "the request reached the script without its payload";
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * attempt);
      continue;
    }

    if (!res_ok(status)) {
      throw new Error(`Apps Script HTTP ${status}`);
    }

    // Apps Script web apps always answer HTTP 200 — real failures come back
    // as a normal JSON body with an `error` field, not a non-2xx status.
    let json: T & { error?: string };
    try {
      json = JSON.parse(text) as T & { error?: string };
    } catch {
      throw new Error("Apps Script returned a response that wasn't JSON.");
    }
    if (json.error) {
      throw new Error(`Apps Script error: ${json.error}`);
    }
    return json;
  }

  throw new Error(
    `Couldn't reach the Google Sheet after ${MAX_ATTEMPTS} tries — ${lastFailure}. Open /health for a full diagnosis.`
  );
}

function res_ok(status: number): boolean {
  return status >= 200 && status < 300;
}
