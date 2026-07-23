"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogProduct, Order } from "@/lib/types";
import { StatusPill } from "@/components/StatusPill";
import { TestBadge } from "@/components/TestBadge";
import { SkeletonCard } from "@/components/Skeleton";
import { Modal } from "@/components/Modal";
import { ClearAllModal } from "@/components/ClearAllModal";
import { OrderCard } from "@/components/processed/OrderCard";
import { buildTitleMap, itemsSummary, type TitleMap } from "@/components/processed/format";

const POLL_MS = 2000;
const RECENT_WINDOW_MS = 90_000;
// Skip applying polled data to a just-mutated order, so a stale in-flight
// poll can't clobber a fresh PATCH/draft result (same pattern as Processed).
const MUTATION_GRACE_MS = 1500;

type DayBucket = "today" | "week" | "older";

const COLUMNS: { key: DayBucket; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "older", label: "Older" },
];

/** Calendar-day bucket (not a rolling 24h/7d window): "today" is the same
 *  calendar date; "week" is Monday..yesterday of the CURRENT calendar week;
 *  anything from last week or earlier is "older". */
function dayBucket(iso: string): DayBucket {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays <= 0) return "today";
  const daysSinceMonday = (now.getDay() + 6) % 7; // Mon→0 … Sun→6
  if (diffDays <= daysSinceMonday) return "week";
  return "older";
}

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

/** Consolidated kanban card — company, items, status, time. Click for full detail. */
function KanbanCard({
  order,
  titles,
  onOpen,
}: {
  order: Order;
  titles: TitleMap;
  onOpen: (order: Order) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(order)}
      className="w-full rounded-lg border border-forest-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-forest-400 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-forest-900">{order.company}</p>
        {order.isTest && <TestBadge className="shrink-0" />}
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-forest-600">
        {itemsSummary(order, titles) || "No line items recognized yet"}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <StatusPill order={order} className="text-[11px]" />
        <span className="shrink-0 text-[11px] text-forest-500">{formatTime(order.createdAt)}</span>
      </div>
    </button>
  );
}

/**
 * The Queue is the WORKING stage (feedback round 4): pasted messages parse
 * here, then STAY here for review — line edits, VAT, discounts, delivery —
 * until Joey clicks Confirm · create draft. Finalized orders (draft created)
 * move to Processed, which is purely the awaiting-payment list.
 *
 * Round 7: the working stage is a time-bucketed kanban (Today / This week /
 * Older) instead of a Needs review / Ready to finalize split — StatusPill
 * still carries that distinction per-card. Each column scrolls internally
 * so the page itself doesn't grow unbounded. Cards are deliberately
 * consolidated; clicking one opens the full order in a popup.
 */
export default function QueuePage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [popupOrder, setPopupOrder] = useState<Order | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);

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
    setPopupOrder((prev) => (prev && prev.id === order.id ? order : prev));
  }, []);

  const handleOrderDeleted = useCallback((id: string) => {
    overlayRef.current.delete(id);
    setOrders((prev) => (prev ? prev.filter((o) => o.id !== id) : prev));
    setPopupOrder((prev) => (prev && prev.id === id ? null : prev));
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

  // Everything currently rendered anywhere on the page — what "Clear all" wipes.
  const everyVisibleOrder = useMemo(
    () => [...parsing, ...working, ...justFinalized],
    [parsing, working, justFinalized]
  );

  const isLoading = orders === null;
  const isEmpty =
    !isLoading && parsing.length === 0 && working.length === 0 && justFinalized.length === 0;

  return (
    <div className="mx-auto max-w-5xl">
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

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-forest-900">Queue</h1>
          <p className="mt-1 max-w-2xl text-sm text-forest-700">
            The working stage: review each parsed order, set VAT / discounts /
            delivery, then <span className="font-semibold">Confirm · create draft</span>{" "}
            — finalized orders move to Processed for payment confirmation.
          </p>
        </div>
        {everyVisibleOrder.length > 0 && (
          <button
            type="button"
            onClick={() => setClearAllOpen(true)}
            className="shrink-0 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
          >
            Clear all
          </button>
        )}
      </div>

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

          {/* Working stage — time-bucketed kanban, each column scrolls on its own */}
          {working.length > 0 && (
            <section className="mt-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {COLUMNS.map((col) => {
                  const items = working.filter((o) => dayBucket(o.createdAt) === col.key);
                  return (
                    <div
                      key={col.key}
                      className="flex flex-col rounded-xl border border-forest-200 bg-forest-50/40 p-3"
                    >
                      <div className="flex items-center justify-between px-1 pb-2">
                        <h3 className="text-sm font-semibold text-forest-800">{col.label}</h3>
                        <span className="text-xs font-medium text-forest-500">{items.length}</span>
                      </div>
                      <div className="od-scroll max-h-[65vh] flex-1 space-y-2 overflow-y-auto pr-0.5">
                        {items.length === 0 ? (
                          <p className="rounded-lg border-2 border-dashed border-forest-200 p-4 text-center text-xs text-forest-400">
                            Nothing here
                          </p>
                        ) : (
                          items.map((order) => (
                            <KanbanCard
                              key={order.id}
                              order={order}
                              titles={titles}
                              onOpen={setPopupOrder}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
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

      <Modal
        open={!!popupOrder}
        onClose={() => setPopupOrder(null)}
        title={popupOrder?.company ?? "Order"}
        maxWidthClassName="max-w-xl"
      >
        {popupOrder && (
          <OrderCard
            order={popupOrder}
            catalog={catalog}
            titles={titles}
            selected={false}
            onSelect={() => {}}
            onOrderUpdate={handleOrderUpdate}
            onOrderDeleted={handleOrderDeleted}
          />
        )}
      </Modal>

      <ClearAllModal
        open={clearAllOpen}
        onClose={() => setClearAllOpen(false)}
        orders={everyVisibleOrder}
        pageLabel="Queue"
        onOrderDeleted={handleOrderDeleted}
      />
    </div>
  );
}
