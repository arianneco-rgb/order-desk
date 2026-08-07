"use client";

import { useVisibleInterval } from "@/lib/use-visible-interval";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CatalogProduct, Order } from "@/lib/types";
import { OrderCard } from "@/components/processed/OrderCard";
import { PaymentPane } from "@/components/processed/PaymentPane";
import { FollowUpQueue } from "@/components/processed/FollowUpQueue";
import { buildTitleMap, itemsSummary, type TitleMap } from "@/components/processed/format";
import { SkeletonCard } from "@/components/Skeleton";
import { StatusPill } from "@/components/StatusPill";
import { TestBadge } from "@/components/TestBadge";
import { ClearAllModal } from "@/components/ClearAllModal";

const POLL_MS = 2500;

/**
 * Feedback round 4: Processed holds ONLY finalized orders — draft created,
 * awaiting payment confirmation. All working-stage editing lives on the
 * Queue; editing an order here invalidates its draft and bounces it back
 * to the Queue automatically.
 *
 * Round 7 (revised): split screen again — left column is the consolidated
 * list (company + items ordered), right column is payment verification,
 * always visible for whichever row is selected. Clicking a row selects it
 * (single-select, like the old right-panel model) AND expands it inline on
 * the left to show the full OrderCard (lines, options, reply, delete) —
 * just never the payment pane there, since that always lives on the
 * right. `pinnedPaidIds` keeps an order visible after Joey confirms its
 * payment — /api/orders drops paid orders immediately, but the row/pane
 * should stay long enough to copy the paid-confirmation reply.
 */
function matchesQuery(order: Order, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    order.company.toLowerCase().includes(needle) ||
    order.rawMessage.toLowerCase().includes(needle)
  );
}

function newestFirst(a: Order, b: Order): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function ProcessedRow({
  order,
  catalog,
  titles,
  selected,
  onSelect,
  onOrderUpdate,
  onOrderDeleted,
}: {
  order: Order;
  catalog: CatalogProduct[];
  titles: TitleMap;
  selected: boolean;
  onSelect: (id: string) => void;
  onOrderUpdate: (order: Order) => void;
  onOrderDeleted: (id: string) => void;
}) {
  return (
    <div
      id={`processed-row-${order.id}`}
      className="border-b border-forest-100 last:border-b-0"
    >
      <button
        type="button"
        onClick={() => onSelect(order.id)}
        aria-expanded={selected}
        className={
          "flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-forest-50/60" +
          (selected ? " bg-forest-50/80" : "")
        }
      >
        <span className="max-w-[45%] shrink-0 truncate text-sm font-semibold text-forest-900">
          {order.company}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-forest-600">
          {itemsSummary(order, titles) || "No line items recognized"}
        </span>
        {order.isTest && <TestBadge className="shrink-0" />}
        <StatusPill order={order} className="shrink-0" />
        <span aria-hidden className="shrink-0 text-forest-400">
          {selected ? "▲" : "▼"}
        </span>
      </button>
      {selected && (
        <div className="border-t border-forest-100 bg-forest-50/30 p-4">
          <OrderCard
            order={order}
            catalog={catalog}
            titles={titles}
            selected={false}
            onSelect={() => {}}
            onOrderUpdate={onOrderUpdate}
            onOrderDeleted={onOrderDeleted}
          />
        </div>
      )}
    </div>
  );
}

export default function ProcessedPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [followUpDays, setFollowUpDays] = useState(3);
  const [clearAllOpen, setClearAllOpen] = useState(false);

  // Orders locally confirmed paid this session — kept in the list (dropped by
  // /api/orders the moment they're paid) so the row/pane stays put to copy from.
  const pinnedPaidRef = useRef<Set<string>>(new Set());
  const autoSelectedRef = useRef(false);
  // Poll body, swapped in by the effect below; useVisibleInterval calls the
  // latest one and stops entirely while the tab is hidden.
  const tickRef = useRef<() => void>(() => {});

  const titles = useMemo(() => buildTitleMap(catalog), [catalog]);
  const sortedOrders = useMemo(
    () =>
      orders
        .filter((o) => o.status === "draft_created" || pinnedPaidRef.current.has(o.id))
        .sort(newestFirst),
    [orders]
  );
  const visibleOrders = useMemo(
    () => sortedOrders.filter((o) => matchesQuery(o, query)),
    [sortedOrders, query]
  );
  // Clear all only ever targets orders that are actually deletable — a
  // pinned "just paid" row is kept visible to copy from, but paid orders
  // are the permanent record and the delete route rejects them anyway.
  const deletableOrders = useMemo(
    () => sortedOrders.filter((o) => o.status !== "paid"),
    [sortedOrders]
  );
  // The right pane looks the order up in the FULL list (not sortedOrders),
  // so it can still show "back in the Queue" if editing invalidated the
  // draft, instead of just going blank.
  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedId) ?? null,
    [orders, selectedId]
  );

  // Load the catalog once (product titles + editor options + line prices).
  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCatalog(d.catalog ?? []))
      .catch(() => {});
  }, []);

  // Follow-up window (FOLLOW_UP_DAYS env, default 3).
  useEffect(() => {
    fetch("/api/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (typeof d?.followUpDays === "number") setFollowUpDays(d.followUpDays);
      })
      .catch(() => {});
  }, []);

  // Poll the orders list every 2.5s, keeping any locally-pinned paid rows.
  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await fetch("/api/orders");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!alive) return;
        const polled: Order[] = data.orders ?? [];
        setOrders((prev) => {
          const merged = [...polled];
          const freshIds = new Set(polled.map((o) => o.id));
          const prevById = new Map(prev.map((o) => [o.id, o]));
          for (const id of pinnedPaidRef.current) {
            if (!freshIds.has(id)) {
              const keep = prevById.get(id);
              if (keep) merged.push(keep);
            }
          }
          return merged;
        });
        setLoadError(null);
        setLoaded(true);
      } catch {
        if (!alive) return;
        setLoaded(true);
        setLoadError("Couldn't load orders — retrying…");
      }
    }
    void tick();
    tickRef.current = () => void tick();
    return () => {
      alive = false;
    };
  }, []);

  useVisibleInterval(() => tickRef.current(), POLL_MS);

  // Auto-select the newest order once, on first load — same as before, so
  // the right pane isn't just an empty placeholder the moment you arrive.
  useEffect(() => {
    if (autoSelectedRef.current || sortedOrders.length === 0) return;
    autoSelectedRef.current = true;
    setSelectedId(sortedOrders[0].id);
  }, [sortedOrders]);

  const handleOrderUpdate = useCallback((order: Order) => {
    if (order.status === "paid") pinnedPaidRef.current.add(order.id);
    setOrders((prev) => {
      const known = prev.some((o) => o.id === order.id);
      return known ? prev.map((o) => (o.id === order.id ? order : o)) : prev;
    });
  }, []);

  const handleOrderDeleted = useCallback((id: string) => {
    pinnedPaidRef.current.delete(id);
    setOrders((prev) => prev.filter((o) => o.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  }, []);

  function selectRow(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  function handleFollowUpSelect(id: string) {
    setSelectedId(id);
    requestAnimationFrame(() => {
      document
        .getElementById(`processed-row-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-forest-900">
            Processed + Payments
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-forest-700">
            Finalized orders — draft created, awaiting payment confirmation.
            Editing an order here invalidates its draft and sends it back to the{" "}
            <Link href="/queue" className="font-semibold text-forest-800 underline">
              Queue
            </Link>
            .
          </p>
        </div>
        {deletableOrders.length > 0 && (
          <button
            type="button"
            onClick={() => setClearAllOpen(true)}
            className="shrink-0 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
          >
            Clear all
          </button>
        )}
      </div>

      {loadError && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </div>
      )}

      <FollowUpQueue
        orders={sortedOrders}
        followUpDays={followUpDays}
        selectedId={selectedId}
        onSelect={handleFollowUpSelect}
      />

      {/* Split screen: consolidated list · payment verification */}
      <div className="mt-4 grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
        {/* LEFT: consolidated list */}
        <div className="lg:col-span-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cafe or message…"
            aria-label="Search orders"
            className="w-full rounded-xl border border-forest-200 bg-white px-4 py-2.5 text-sm text-forest-900 shadow-sm placeholder:text-forest-400 focus:border-forest-400 focus:outline-none focus:ring-2 focus:ring-forest-200"
          />

          <div className="mt-4 overflow-hidden rounded-xl border border-forest-200 bg-white shadow-sm">
            {!loaded ? (
              <div className="space-y-3 p-4">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : sortedOrders.length === 0 ? (
              <div className="p-8 text-center text-sm text-forest-500">
                Nothing awaiting payment — orders land here once you{" "}
                <span className="font-semibold">Confirm · create draft</span> on the{" "}
                <Link href="/queue" className="font-semibold text-forest-700 underline">
                  Queue
                </Link>
                .
              </div>
            ) : visibleOrders.length === 0 ? (
              <div className="p-8 text-center text-sm text-forest-500">
                No orders match &ldquo;{query}&rdquo;.
              </div>
            ) : (
              visibleOrders.map((order) => (
                <ProcessedRow
                  key={order.id}
                  order={order}
                  catalog={catalog}
                  titles={titles}
                  selected={selectedId === order.id}
                  onSelect={selectRow}
                  onOrderUpdate={handleOrderUpdate}
                  onOrderDeleted={handleOrderDeleted}
                />
              ))
            )}
          </div>
        </div>

        {/* RIGHT: payment verification for the selected order — always here */}
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-20">
            <PaymentPane order={selectedOrder} onOrderUpdate={handleOrderUpdate} />
          </div>
        </div>
      </div>

      <ClearAllModal
        open={clearAllOpen}
        onClose={() => setClearAllOpen(false)}
        orders={deletableOrders}
        pageLabel="Processed"
        onOrderDeleted={handleOrderDeleted}
      />
    </div>
  );
}
