// Two-level read-through cache.
//
//   L1  in-process memory  — free, but per serverless instance
//   L2  Supabase app_cache — shared by every instance
//
// Why both: the app used to have L1 only, in `globalThis`. Vercel runs many
// instances and routes each request to whichever is free, so an identical
// call was fast or slow depending purely on where it landed — /api/customers
// measured 513ms warm and 3528ms cold, a 7x swing with no pattern a user
// could perceive. Instances also get recycled, so a nominal five-minute
// cache frequently died much sooner.
//
// L2 makes the expensive fetch happen roughly once per TTL across the whole
// deployment instead of once per instance, which is what removes the
// variance. L1 stays because a same-instance repeat is then free.
//
// Deliberately fail-open: if Supabase is unreachable or the table is
// missing, every path falls back to fetching directly. A cache must never
// be the reason a page breaks.

import { dbMode } from "./config";
import { supabase } from "./supabase";

type Entry<T> = { at: number; value: T };

declare global {
  // eslint-disable-next-line no-var
  var __odSharedCacheL1: Map<string, Entry<unknown>> | undefined;
}

function l1(): Map<string, Entry<unknown>> {
  if (!globalThis.__odSharedCacheL1) globalThis.__odSharedCacheL1 = new Map();
  return globalThis.__odSharedCacheL1;
}

async function readL2<T>(key: string, ttlMs: number): Promise<T | undefined> {
  if (dbMode() !== "supabase") return undefined;
  try {
    const { data, error } = await supabase()
      .from("app_cache")
      .select("value, updated_at")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return undefined;
    const age = Date.now() - new Date(data.updated_at as string).getTime();
    if (age > ttlMs) return undefined;
    return data.value as T;
  } catch {
    return undefined;
  }
}

async function writeL2<T>(key: string, value: T): Promise<void> {
  if (dbMode() !== "supabase") return;
  try {
    await supabase()
      .from("app_cache")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch {
    // Losing a cache write is harmless — the next reader just refetches.
  }
}

/**
 * Returns the cached value, or runs `fetcher` and caches what it returns.
 *
 * `fetcher` errors propagate untouched: a failed refresh must surface as a
 * failure, not silently serve nothing. Only cache-layer faults are swallowed.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const hit = l1().get(key) as Entry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;

  const shared = await readL2<T>(key, ttlMs);
  if (shared !== undefined) {
    l1().set(key, { at: Date.now(), value: shared });
    return shared;
  }

  const fresh = await fetcher();
  l1().set(key, { at: Date.now(), value: fresh });
  await writeL2(key, fresh);
  return fresh;
}

/**
 * Stores a value we already have, so the next reader doesn't have to fetch
 * it. Used after a write that IS the new state (e.g. syncing the customer
 * list to the sheet — the list we just pushed is authoritative).
 */
export async function primeCache<T>(key: string, value: T): Promise<void> {
  l1().set(key, { at: Date.now(), value });
  await writeL2(key, value);
}

/** Drops a key from both levels — call after writing the underlying source. */
export async function invalidate(key: string): Promise<void> {
  l1().delete(key);
  if (dbMode() !== "supabase") return;
  try {
    await supabase().from("app_cache").delete().eq("key", key);
  } catch {
    // Best effort; the TTL will expire it anyway.
  }
}

export const CACHE_KEYS = {
  sheetCustomers: "sheet_customers",
  bpiTransactions: "bpi_transactions",
} as const;
