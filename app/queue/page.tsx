"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogProduct, Order } from "@/lib/types";
import { StatusPill } from "@/components/StatusPill";
import { TestBadge } from "@/components/TestBadge";
import { SkeletonCard } from "@/components/Skeleton";
import { OrderCard } from "@/components/processed/OrderCard";
import { buildTitleMap } from "@/components/processed/format";

const POLL_MS = 2000;
const RECENT_WINDOW_MS = 90_000;
// Skip applying polled data to a just-mutated order, so a stale in-flight
// poll can't clobber a fresh PATCH/draft result (same pattern as Processed).
const MUTATION_GRACE_MS = 1500;

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function firstLine(text: string): string {
  const line = (text ?? "").split("\n").find((l) => l.trim() !== "");
  return line?.trim() ?? "";
}

/** True if the cafe name or message text contains the query (case-insensitive). */
function matchesQuery(order: Order, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (order.company ?? "").toLowerCase().includes(q) ||
    (order.rawMessage ?? "").toLowerCase().includes(q)
  );
}

function newestFirst(a: Order, b: Order): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function ParsingCard({ order }: { order: Order }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-forest-200 bg-white p-4 shadow-sm">
      {/* Shimmer sweep so the card visibly looks in-flight. */}
      <div
        aria-hidden
        className="od-shimmer pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-forest-50/80 to-transparent"
      />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-forest-900">{order.company}</p>
          <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-sm text-forest-700">
            {order.rawMessage || "(empty message)"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {order.isTest && <TestBadge />}
          <StatusPill order={order} />
        </div>
      </div>
      <div className="relative mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-forest-700">{formatTime(order.createdAt)}</span>
        <div className="h-1 w-32 max-w-full overflow-hidden rounded-full bg-forest-100">
          <div className="od-progress h-full w-1/3 rounded-full bg-forest-500" />
        </div>
      </div>
    </div>
  );
}

/**
 * The Queue is the WORKING stage (feedback round 4): pasted messages parse
 * here, then STAY here for review — line edits, VAT, discounts, delivery —
 * until Joey clicks Confirm · create draft. Finalized orders (draft created)
 * move to Processed, which is purely the awaiting-payment list.
 */
export default function QueuePage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Local overlay of just-mutated orders (id → freshest copy), so polls
  // within the grace window can't undo a PATCH/draft response.
  const overlayRef = useRef(new Map<string, { at: number; order: Order }>());

  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCatalog(d.catalog ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/orders", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const now = Date.now();
        const overlay = overlayRef.current;
        for (const [id, entry] of overlay) {
          if (now - entry.at > MUTATION_GRACE_MS) overlay.delete(id);
        }
        const polled: Order[] = Array.isArray(data?.orders) ? data.orders : [];
        setOrders(polled.map((o) => overlay.get(o.id)?.order ?? o));
        setError(null);
      } catch {
        if (!cancelled) setError("Couldn't refresh the queue — retrying…");
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const handleOrderUpdate = useCallback((order: Order) => {
    overlayRef.current.set(order.id, { at: Date.now(), order });
    setOrders((prev) =>
      prev ? prev.map((o) => (o.id === order.id ? order : o)) : prev
    );
  }, []);

  const titles = useMemo(() => buildTitleMap(catalog), [catalog]);

  const all = orders ?? [];
  const now = Date.now();
  const trimmedQuery = query.trim();

  const parsing = all
    .filter((o) => o.status === "queued" || o.status === "processing")
    .filter((o) => matchesQuery(o, trimmedQuery))
    .sort(newestFirst);

  // The heart of the page: parsed orders being worked on.
  const working = all
    .filter((o) => o.status === "processed")
    .filter((o) => matchesQuery(o, trimmedQuery))
    .sort(newestFirst);
  const needsReview = working.filter((o) => o.needsReview);
  const readyToFinalize = working.filter((o) => !o.needsReview);

  const justFinalized = all
    .filter(
      (o) =>
        o.status === "draft_created" &&
        o.draftCreatedAt &&
        now - new Date(o.draftCreatedAt).getTime() <= RECENT_WINDOW_MS &&
        matchesQuery(o, trimmedQuery)
    )
    .sort(
      (a, b) =>
        new Date(b.draftCreatedAt ?? 0).getTime() -
        new Date(a.draftCreatedAt ?? 0).getTime()
    );

  const isLoading = orders === null;
  const isEmpty =
    !isLoading && parsing.length === 0 && working.length === 0 && justFinalized.length === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <style>{`
        @keyframes od-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .od-shimmer { animation: od-shimmer 1.8s ease-in-out infinite; }
        @keyframes od-progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
        .od-progress { animation: od-progress 1.4s ease-in-out infinite; }
      `}</style>

      <h1 className="text-2xl font-semibold text-forest-900">Queue</h1>
      <p className="mt-1 text-sm text-forest-700">
        The working stage: review each parsed order, set VAT / discounts /
        delivery, then <span className="font-semibold">Confirm · create draft</span>{" "}
        — finalized orders move to Processed for payment confirmation.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}
        </div>
      )}

      <div className="mt-4">
        <label htmlFor="queue-search" className="sr-only">
          Search queue by cafe or message
        </label>
        <input
          id="queue-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by cafe name or message…"
          className="w-full rounded-xl border border-forest-200 bg-white px-4 py-2.5 text-sm text-forest-900 shadow-sm placeholder:text-forest-400 focus:border-forest-400 focus:outline-none focus:ring-2 focus:ring-forest-200"
        />
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : isEmpty ? (
        <div className="mt-4 rounded-xl border-2 border-dashed border-forest-200 bg-white p-10 text-center text-sm text-forest-500">
          {trimmedQuery ? (
            <>No matches for &ldquo;{trimmedQuery}&rdquo;.</>
          ) : (
            <>
              Queue is clear — nothing waiting to be worked on.{" "}
              <Link href="/paste" className="font-semibold text-forest-700 underline">
                Paste an order →
              </Link>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Still parsing */}
          {parsing.length > 0 && (
            <section className="mt-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-forest-600">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-600" />
                Parsing · {parsing.length}
              </h2>
              <div className="mt-2 space-y-3">
                {parsing.map((order) => (
                  <ParsingCard key={order.id} order={order} />
                ))}
              </div>
            </section>
          )}

          {/* Needs review first — the ones the parser wasn't sure about */}
          {needsReview.length > 0 && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700">
                Needs review · {needsReview.length}
              </h2>
              <div className="mt-2 space-y-4">
                {needsReview.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    catalog={catalog}
                    titles={titles}
                    selected={false}
                    onSelect={() => {}}
                    onOrderUpdate={handleOrderUpdate}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Clean parses, ready to finalize */}
          {readyToFinalize.length > 0 && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-forest-600">
                Ready to finalize · {readyToFinalize.length}
              </h2>
              <div className="mt-2 space-y-4">
                {readyToFinalize.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    catalog={catalog}
                    titles={titles}
                    selected={false}
                    onSelect={() => {}}
                    onOrderUpdate={handleOrderUpdate}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Freshly finalized → now on Processed */}
          {justFinalized.length > 0 && (
            <section className="mt-8">
              <h2 className="text-sm font-semibold text-forest-900">Just finalized</h2>
              <div className="mt-2 divide-y divide-forest-100 overflow-hidden rounded-xl border border-forest-200 bg-white shadow-sm">
                {justFinalized.map((order) => (
                  <div
                    key={order.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5"
                  >
                    <span className="max-w-full shrink-0 truncate text-sm font-medium text-forest-900">
                      {order.company}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-forest-700">
                      {firstLine(order.rawMessage)}
                    </span>
                    {order.isTest && <TestBadge className="shrink-0" />}
                    <StatusPill order={order} className="shrink-0" />
                    <Link
                      href="/processed"
                      className="w-full shrink-0 whitespace-nowrap text-sm font-semibold text-forest-700 hover:text-forest-900 hover:underline sm:ml-0 sm:w-auto"
                    >
                      Confirm payment on Processed →
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
