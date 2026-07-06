// BPI payment-email matching.
//
// LIVE mode: a Google service account (domain-wide delegation) impersonates
// a mailbox (BPI_GMAIL_USER) and reads it read-only via the Gmail API,
// searching for BPI transfer-notification emails. No IMAP credentials, no
// password for the mailbox itself — same trust model as the Sheets service
// account, just a different scope + a "sub" (impersonation) claim.
// SIMULATED mode (default, no service account configured): a matching
// transfer notification "arrives" a few seconds after a draft is created,
// so both the no-match error state and the matched state can be
// demonstrated. The matcher itself (amount + sender name/reference) is
// shared between both modes.
//
// Golden rule: a match is only ever SHOWN to Joey — nothing auto-confirms.

import crypto from "crypto";
import { bpiMode } from "./config";
import { listOrders } from "./store";
import type { BpiMatch, Order } from "./types";

export interface BpiEmail {
  emailId: string;
  amount: number;
  senderName: string;
  ref: string;
  date: string;
}

/** How long after draft creation the simulated BPI email "arrives". */
const SIMULATED_ARRIVAL_MS = 8_000;

function refFor(order: Order): string {
  // Deterministic pseudo-reference so re-reads return the same email.
  let hash = 0;
  for (const ch of order.id) hash = (hash * 31 + ch.charCodeAt(0)) % 1_000_000;
  return `BPI${String(hash).padStart(6, "0")}${order.id.slice(-3).toUpperCase()}`;
}

/** The simulated dedicated BPI mailbox, derived from current app state. */
export function simulatedInbox(): BpiEmail[] {
  const now = Date.now();
  const emails: BpiEmail[] = [
    // Decoys — transfers that belong to no open draft.
    {
      emailId: "sim-decoy-1",
      amount: 3175,
      senderName: "JUAN DELA CRUZ",
      ref: "BPI558201XZQ",
      date: new Date(now - 86_400_000).toISOString(),
    },
    {
      emailId: "sim-decoy-2",
      amount: 47_800,
      senderName: "MARIA CLARA COFFEE OPC",
      ref: "BPI994712AAB",
      date: new Date(now - 43_200_000).toISOString(),
    },
  ];

  for (const order of listOrders()) {
    if (order.status !== "draft_created" || !order.draftCreatedAt) continue;
    const arrivedAt = Date.parse(order.draftCreatedAt) + SIMULATED_ARRIVAL_MS;
    if (now < arrivedAt) continue; // transfer "hasn't landed" yet
    emails.push({
      emailId: `sim-${order.id}`,
      amount: order.total,
      senderName: order.company.toUpperCase(),
      ref: refFor(order),
      date: new Date(arrivedAt).toISOString(),
    });
  }
  return emails;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Match an order against the inbox by amount + sender name/reference.
 * Amount must match to the centavo; the sender must resemble the cafe name
 * (or the reference must cite the order). Never auto-confirms.
 */
export function findMatch(order: Order, inbox: BpiEmail[]): BpiMatch | null {
  const company = normalize(order.company);
  for (const email of inbox) {
    if (Math.abs(email.amount - order.total) > 0.009) continue;
    const sender = normalize(email.senderName);
    const nameMatches =
      company.length > 0 &&
      (sender.includes(company) || company.includes(sender));
    const refMatches = normalize(email.ref).includes(
      normalize(order.id.replace("od_", ""))
    );
    if (nameMatches || refMatches) {
      return {
        amount: email.amount,
        senderName: email.senderName,
        ref: email.ref,
        date: email.date,
        emailId: email.emailId,
      };
    }
  }
  return null;
}

// ── Gmail service-account auth (impersonation via domain-wide delegation) ─

interface TokenCache {
  token: string;
  expiresAt: number;
}
declare global {
  // eslint-disable-next-line no-var
  var __odGmailToken: TokenCache | undefined;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

async function gmailAccessToken(): Promise<string> {
  const cached = globalThis.__odGmailToken;
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const rawSaJson = process.env.BPI_GMAIL_SA_JSON || process.env.GOOGLE_SA_JSON;
  const mailbox = process.env.BPI_GMAIL_USER;
  if (!rawSaJson || !mailbox) {
    throw new Error("BPI live mode requires a service account JSON + BPI_GMAIL_USER.");
  }
  const sa = JSON.parse(rawSaJson) as { client_email: string; private_key: string };

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      // Impersonate the mailbox that actually receives BPI notifications —
      // requires domain-wide delegation authorizing this scope for this
      // service account's client ID in the Google Workspace admin console.
      sub: mailbox,
      scope: "https://www.googleapis.com/auth/gmail.readonly",
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
  if (!res.ok) throw new Error(`Gmail token exchange failed: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  globalThis.__odGmailToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

async function gmailFetch(path: string): Promise<any> {
  const token = await gmailAccessToken();
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Parsing a BPI notification email into a BpiEmail ─────────────────────
//
// ⚠️ Best-effort defaults, not verified against a real BPI notification —
// tune these once real emails are landing. The typical PH bank transfer
// alert reads roughly: "You have received PHP 5,000.00 from JUAN DELA CRUZ
// ... Reference No. 123456789012" — adjust the regexes below to match
// whatever BPI actually sends once you have a sample.

function extractAmount(text: string): number | null {
  const m = text.match(/(?:PHP|₱)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractReference(text: string): string | null {
  const m = text.match(/ref(?:erence)?\.?\s*(?:no\.?|number|#)?\s*:?\s*([A-Za-z0-9-]{5,})/i);
  return m ? m[1] : null;
}

function extractSenderName(text: string): string | null {
  const m = text.match(/from\s+([A-Z][A-Za-z.,'\-\s]{2,60}?)(?:\s+(?:on|via|through)\b|[.,\n]|$)/);
  return m ? m[1].trim() : null;
}

function decodeGmailBody(payload: any): string {
  function walk(part: any): string {
    if (!part) return "";
    if (part.body?.data) {
      const buf = Buffer.from(part.body.data, "base64url").toString("utf-8");
      if (part.mimeType === "text/plain") return buf;
      if (part.mimeType === "text/html") return buf.replace(/<[^>]+>/g, " ");
      return buf;
    }
    for (const p of part.parts ?? []) {
      const found = walk(p);
      if (found) return found;
    }
    return "";
  }
  return walk(payload);
}

function parseBpiMessage(id: string, subject: string, body: string, date: string): BpiEmail | null {
  const text = `${subject}\n${body}`;
  const amount = extractAmount(text);
  if (amount === null) return null;
  return {
    emailId: id,
    amount,
    senderName: extractSenderName(text) ?? "",
    ref: extractReference(text) ?? "",
    date,
  };
}

// Cache the parsed inbox briefly — Processed polls this every 5s per open
// order, and Gmail API quota is per-project, not worth spending on every poll.
const LIVE_INBOX_CACHE_MS = 15_000;
declare global {
  // eslint-disable-next-line no-var
  var __odBpiInboxCache: { at: number; emails: BpiEmail[] } | undefined;
}

async function fetchLiveInbox(): Promise<BpiEmail[]> {
  const cached = globalThis.__odBpiInboxCache;
  if (cached && Date.now() - cached.at < LIVE_INBOX_CACHE_MS) return cached.emails;

  // Broad by design — narrow this once you know exactly what BPI's sender
  // address / subject line looks like. Override via BPI_EMAIL_QUERY.
  const query =
    process.env.BPI_EMAIL_QUERY ||
    'newer_than:2d (from:bpi.com.ph OR subject:"BPI" OR subject:"fund transfer")';
  const list = await gmailFetch(`/messages?q=${encodeURIComponent(query)}&maxResults=25`);
  const ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);

  const emails: BpiEmail[] = [];
  for (const id of ids) {
    const msg = await gmailFetch(`/messages/${id}?format=full`);
    const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
    const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
    const body = decodeGmailBody(msg.payload);
    const date = new Date(Number(msg.internalDate)).toISOString();
    const parsed = parseBpiMessage(id, subject, body, date);
    if (parsed) emails.push(parsed);
  }

  globalThis.__odBpiInboxCache = { at: Date.now(), emails };
  return emails;
}

export async function matchOrder(order: Order): Promise<BpiMatch | null> {
  if (bpiMode() === "live") {
    const inbox = await fetchLiveInbox();
    return findMatch(order, inbox);
  }
  return findMatch(order, simulatedInbox());
}
