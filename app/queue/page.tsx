"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Order } from "@/lib/types";
import { StatusPill } from "@/components/StatusPill";
import { SkeletonCard } from "@/components/Skeleton";

const POLL_MS = 1500;
const RECENT_WINDOW_MS = 90_000;

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

interface CafeGroup {
  company: string;
  orders: Order[];
}

/** Group queued/processing orders by cafe, newest first within each group. */
function groupByCafe(orders: Order[]): CafeGroup[] {
  const groups = new Map<string, Order[]>();
  for (const order of orders) {
    const key = order.company || "Unknown cafe";
    const list = groups.get(key) ?? [];
    list.push(order);
    groups.set(key, list);
  }
  const result: CafeGroup[] = [];
  for (const [company, list] of groups) {
    list.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    result.push({ company, orders: list });
  }
  // Groups with the newest activity first.
  result.sort(
    (a, b) =>
      new Date(b.orders[0]?.createdAt ?? 0).getTime() -
      new Date(a.orders[0]?.createdAt ?? 0).getTime()
  );
  return result;
}

function QueueCard({ order }: { order: Order }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-forest-200 bg-white p-4 shadow-sm">
      {/* Shimmer sweep so the card visibly looks in-flight. */}
      <div
        aria-hidden
        className="od-shimmer pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-forest-50/80 to-transparent"
      />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <p className="line-clamp-4 min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-forest-900">
          {order.rawMessage || "(empty message)"}
        </p>
        <StatusPill order={order} className="shrink-0" />
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

export default function QueuePage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/orders", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setOrders(Array.isArray(data?.orders) ? data.orders : []);
          setError(null);
        }
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

  const all = orders ?? [];
  const now = Date.now();
  const trimmedQuery = query.trim();

  const inFlight = all.filter(
    (o) => o.status === "queued" || o.status === "processing"
  );
  const allGroups = groupByCafe(inFlight);
  const groups = trimmedQuery
    ? allGroups
        .map((group) => ({
          ...group,
          orders: group.orders.filter((o) => matchesQuery(o, trimmedQuery)),
        }))
        .filter((group) => group.orders.length > 0)
    : allGroups;

  const justProcessed = all
    .filter(
      (o) =>
        (o.status === "processed" || o.status === "draft_created") &&
        o.processedAt &&
        now - new Date(o.processedAt).getTime() <= RECENT_WINDOW_MS &&
        matchesQuery(o, trimmedQuery)
    )
    .sort(
      (a, b) =>
        new Date(b.processedAt ?? 0).getTime() -
        new Date(a.processedAt ?? 0).getTime()
    );

  const isLoading = orders === null;
  const isTrulyEmpty =
    orders !== null &&
    allGroups.length === 0 &&
    all.filter(
      (o) =>
        (o.status === "processed" || o.status === "draft_created") &&
        o.processedAt &&
        now - new Date(o.processedAt).getTime() <= RECENT_WINDOW_MS
    ).length === 0;
  const noSearchMatches =
    orders !== null && !isTrulyEmpty && trimmedQuery !== "" && groups.length === 0;
  const isEmpty = orders !== null && groups.length === 0 && justProcessed.length === 0;

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
        Messages being parsed. Items move to Processed automatically.
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

      <div className="mt-4 rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-forest-900">
          Queue · being processed
        </h2>

        {isLoading ? (
          <div className="mt-4 space-y-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : groups.length === 0 ? (
          <div className="mt-4 rounded-lg border-2 border-dashed border-forest-200 p-8 text-center text-sm text-forest-500">
            {noSearchMatches ? (
              <>No matches for &ldquo;{trimmedQuery}&rdquo;.</>
            ) : (
              <>
                Queue is clear. Pasted messages appear here while the AI reads
                them.{" "}
                <Link
                  href="/paste"
                  className="font-semibold text-forest-700 underline"
                >
                  Paste an order →
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-6">
            {groups.map((group) => (
              <section key={group.company}>
                <h3 className="flex items-baseline gap-2 text-sm font-semibold text-forest-900">
                  {group.company}
                  <span className="text-xs font-medium text-forest-600">
                    {group.orders.length}{" "}
                    {group.orders.length === 1 ? "message" : "messages"}
                  </span>
                </h3>
                <div className="mt-2 space-y-3">
                  {group.orders.map((order) => (
                    <QueueCard key={order.id} order={order} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {!isEmpty && (
        <>

          {justProcessed.length > 0 && (
            <section className="mt-10">
              <h2 className="text-sm font-semibold text-forest-900">
                Just processed
              </h2>
              <div className="mt-2 divide-y divide-forest-100 overflow-hidden rounded-xl border border-forest-200 bg-white shadow-sm">
                {justProcessed.map((order) => (
                  <div
                    key={order.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5"
                  >
                    <span className="shrink-0 max-w-full truncate text-sm font-medium text-forest-900">
                      {order.company}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-forest-700">
                      {firstLine(order.rawMessage)}
                    </span>
                    <StatusPill order={order} className="shrink-0" />
                    <Link
                      href="/processed"
                      className="shrink-0 whitespace-nowrap text-sm font-semibold text-forest-700 hover:text-forest-900 hover:underline sm:ml-0 w-full sm:w-auto"
                    >
                      Review it on Processed →
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
