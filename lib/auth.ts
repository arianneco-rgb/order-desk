// Single shared password + signed session cookie protecting all routes.
// Uses Web Crypto (works in both Node route handlers and Edge middleware).
// If DASHBOARD_PASSWORD is unset, auth is disabled (local dev only).

export const SESSION_COOKIE = "od_session";
const SESSION_PAYLOAD = "order-desk-session-v1";

function secret(): string {
  return process.env.AUTH_SECRET || process.env.DASHBOARD_PASSWORD || "";
}

async function hmac(payload: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, matches the cookie

/** Expiring token: `<expiryMs>.<hmac(payload.expiryMs)>` — stateless but not permanent. */
export async function sessionToken(): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS;
  const sig = await hmac(`${SESSION_PAYLOAD}.${exp}`, secret());
  return `${exp}.${sig}`;
}

export async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = await hmac(`${SESSION_PAYLOAD}.${exp}`, secret());
  return token.slice(dot + 1) === expected;
}

export function checkPassword(candidate: string): boolean {
  const expected = process.env.DASHBOARD_PASSWORD;
  return Boolean(expected) && candidate === expected;
}
