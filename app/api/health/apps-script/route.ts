import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Diagnoses the Apps Script bridge in plain English.
//
// The bridge has three things that must stay in sync — the deployed code,
// the deployment URL, and the shared secret — and when any one drifts, the
// raw failure surfaces as either a wall of Google's HTML or a bare
// "Unauthorized", neither of which says which one broke. Every failure this
// route knows about maps to one specific fix, so troubleshooting stops
// being guesswork.
//
// Deliberately reveals nothing secret: the URL is reduced to the tail of
// its deployment id (enough to tell two deployments apart, useless on its
// own) and the secret is never echoed, only length-checked.

type Check = {
  ok: boolean;
  /** What broke, in the user's terms. */
  diagnosis: string;
  /** The exact click-path that fixes it. */
  fix?: string;
  detail?: string;
};

/** Deployment ids are long; the last 12 chars distinguish them without exposing the callable URL. */
function urlFingerprint(url: string): string {
  const m = url.match(/\/macros\/s\/([^/]+)\/exec/);
  if (!m) return "not a /macros/s/…/exec URL";
  return `…${m[1].slice(-12)}/exec`;
}

const MANAGE =
  'Apps Script → Deploy → Manage deployments → pencil on the existing Web app → Version: "New version" → Deploy. Do NOT use "New deployment" — that mints a different URL and orphans this one.';

export async function GET() {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;

  if (!url || !secret) {
    return NextResponse.json({
      ok: false,
      checks: [
        {
          ok: false,
          diagnosis: `Bridge is not configured — ${!url ? "APPS_SCRIPT_URL" : "APPS_SCRIPT_SECRET"} is missing.`,
          fix: "Set both in Vercel → Project → Settings → Environment Variables, then redeploy.",
        } satisfies Check,
      ],
    });
  }

  const checks: Check[] = [];

  // Probe several times, not once. The bridge's dominant failure mode is
  // intermittent (see lib/apps-script.ts), so a single lucky call would
  // report "healthy" on a bridge that's actually failing a third of the
  // time — which is exactly how this went undiagnosed.
  const PROBES = 5;
  let transientFailures = 0;
  for (let i = 0; i < PROBES; i++) {
    try {
      const r = await fetch(`${url}?key=${encodeURIComponent(secret)}&action=listCustomers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listCustomers" }),
        cache: "no-store",
      });
      const t = await r.text();
      if (r.status === 404 || t.trimStart().startsWith("<") || t.includes("Unknown action: undefined")) {
        transientFailures++;
      }
    } catch {
      transientFailures++;
    }
  }

  const info = {
    urlFingerprint: urlFingerprint(url),
    secretLength: secret.length,
    probes: PROBES,
    transientFailures,
  };

  let res: Response;
  let body: string;
  try {
    res = await fetch(`${url}?key=${encodeURIComponent(secret)}&action=listCustomers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "listCustomers" }),
      cache: "no-store",
    });
    body = await res.text();
  } catch (err) {
    return NextResponse.json({
      ok: false,
      info,
      checks: [
        {
          ok: false,
          diagnosis: "Couldn't reach script.google.com at all.",
          fix: "Network/transient — retry. If it persists, check Google Workspace status.",
          detail: String(err),
        } satisfies Check,
      ],
    });
  }

  // Google serves its own HTML for a dead deployment or a login wall — the
  // status code alone doesn't distinguish those from a working script, so
  // sniff the content type of the actual body.
  const looksHtml = body.trimStart().toLowerCase().startsWith("<!doctype html") || body.includes("<html");

  if (looksHtml && /unable to open the file|Page Not Found/i.test(body)) {
    checks.push({
      ok: false,
      diagnosis:
        "The deployment this URL points at no longer exists. The script is fine — the URL is stale. This happens when a NEW deployment is created (each one gets its own URL) and the old one is archived or deleted.",
      fix: `Apps Script → Deploy → Manage deployments → copy the current Web app URL (ends in /exec) → update APPS_SCRIPT_URL in Vercel → redeploy Order Desk. Then afterwards, always use ${MANAGE}`,
      detail: `HTTP ${res.status}, Google returned an HTML error page.`,
    });
  } else if (looksHtml && /accounts\.google\.com|Sign in/i.test(body)) {
    checks.push({
      ok: false,
      diagnosis:
        'The deployment is not publicly callable — Google is demanding a login instead of running the script.',
      fix: 'Apps Script → Deploy → Manage deployments → pencil → set "Who has access" to Anyone (and "Execute as" to Me) → Deploy.',
      detail: `HTTP ${res.status}, Google returned a sign-in page.`,
    });
  } else if (looksHtml) {
    checks.push({
      ok: false,
      diagnosis: "Google returned an HTML page instead of the script's JSON response.",
      fix: MANAGE,
      detail: `HTTP ${res.status}: ${body.slice(0, 200)}`,
    });
  } else {
    let parsed: { error?: string; customers?: unknown[] } | null = null;
    try {
      parsed = JSON.parse(body) as { error?: string; customers?: unknown[] };
    } catch {
      checks.push({
        ok: false,
        diagnosis: "The script replied with something that isn't JSON.",
        fix: MANAGE,
        detail: body.slice(0, 200),
      });
    }

    if (parsed?.error === "Unauthorized") {
      checks.push({
        ok: false,
        diagnosis:
          "Reached the script, but it rejected the secret. The SECRET_KEY inside Code.gs doesn't match APPS_SCRIPT_SECRET here. Most often this means Code.gs was re-pasted from the template and its placeholder values overwrote the real ones.",
        fix: "Open Code.gs, confirm SHEET_ID and SECRET_KEY are the real values (not PASTE_…), then redeploy a new VERSION. Better: run setupConfig() once so the values live in Script Properties and survive future pastes.",
      });
    } else if (parsed?.error) {
      checks.push({
        ok: false,
        diagnosis: `Reached the script and it ran, but returned an error: ${parsed.error}`,
        fix: parsed.error.startsWith("Unknown action")
          ? `The deployed code is older than this app and doesn't have that action yet. ${MANAGE}`
          : "Usually a sheet permission or missing-tab problem — check that the deploying Google account has Editor access to the sheet named in the error.",
      });
    } else if (parsed) {
      checks.push({
        ok: true,
        diagnosis: `Bridge is reachable — the script answered and returned ${parsed.customers?.length ?? 0} customers.`,
      });
    }
  }

  if (transientFailures > 0) {
    checks.push({
      ok: false,
      diagnosis: `Intermittent: ${transientFailures} of ${PROBES} probe calls failed. Google answers /exec with a redirect, and the request's payload is sometimes dropped or the redirect target briefly 404s — so calls fail at random even when everything is configured correctly.`,
      fix: "Nothing to fix on your side — Order Desk now retries these automatically (3 attempts), so they should no longer reach the screen. If this stays above roughly half, the deployment itself is unhealthy: redeploy a new version.",
    });
  }

  return NextResponse.json({ ok: checks.every((c) => c.ok), info, checks });
}
