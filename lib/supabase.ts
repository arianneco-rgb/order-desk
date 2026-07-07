// Supabase REST client — this is what actually runs against the database in
// both dev and on Vercel (a direct Postgres connection isn't used at
// runtime; see scripts/db/schema.sql for one-time table setup instead).
// Cached on globalThis so dev's hot-reload doesn't open a new client per edit.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

declare global {
  // eslint-disable-next-line no-var
  var __odSupabase: SupabaseClient | undefined;
}

export function supabase(): SupabaseClient {
  if (!globalThis.__odSupabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
      throw new Error("Supabase requires SUPABASE_URL + SUPABASE_SECRET_KEY.");
    }
    globalThis.__odSupabase = createClient(url, key, {
      auth: { persistSession: false },
      // Next.js patches global fetch to cache GET requests by default, even
      // inside Route Handlers — without this, two routes hitting the same
      // Supabase URL (e.g. app_settings) can see different, stale results.
      global: { fetch: (url, opts) => fetch(url, { ...opts, cache: "no-store" }) },
    });
  }
  return globalThis.__odSupabase;
}
