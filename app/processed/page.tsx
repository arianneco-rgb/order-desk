"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CatalogProduct, Order } from "@/lib/types";
import { OrderCard } from "@/components/processed/OrderCard";
import { PaymentPane } from "@/components/processed/PaymentPane";
import { FollowUpQueue } from "@/components/processed/FollowUpQueue";
import { buildTitleMap } from "@/components/processed/format";
import { SkeletonCard } from "@/components/Skeleton";
import { Kbd } from "@/components/Kbd";

const POLL_MS = 2500;
// Skip applying polled data to the selected order right after a local
// mutation, so a stale in-flight poll can't clobber a fresh PATCH result.
const MUTATION_GRACE_MS = 1500;

/**
 * Feedback round 4: Processed holds ONLY finalized orders — draft created,
 * awaiting payment confirmation. All working-stage editing lives on the
 * Queue; editing an order here invalidates its draft and bounces it back
 * to the Queue automatically.
 */
function isVisible(order: Order): boolean {
  return order.status === "draft_created";
}

function newestFirst(a: Order, b: Order): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function matchesQuery(order: Order, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    order.company.toLowerCase().includes(needle) ||
    order.rawMessage.toLowerCase().includes(needle)
  );
}

export default function ProcessedPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [followUpDays, setFollowUpDays] = useState(3);

  const selectedRef = useRef<Order | null>(null);
  const lastMutationRef = useRef(0);
  const fetchingDetailRef = useRef(false);

  const titles = useMemo(() => buildTitleMap(catalog), [catalog]);
  const sortedOrders = useMemo(
    () => orders.filter(isVisible).sort(newestFirst),
    [orders]
  );
  const visibleOrders = useMemo(
    () => sortedOrders.filter((o) => matchesQuery(o, query)),
    [sortedOrders, query]
  );

  function setSelected(order: Order | null) {
    selectedRef.current = order;
    setSelectedOrder(order);
  }

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

  // Keep the selection in sync with a fresh poll result.
  const resolveSelection = useCallback((all: Order[]) => {
    const visible = all.filter(isVisible).sort(newestFirst);
    const current = selectedRef.current;

    if (!current) {
      if (visible.length > 0) setSelected(visible[0]);
      return;
    }

    const fresh = all.find((o) => o.id === current.id);
    if (fresh) {
      if (Date.now() - lastMutationRef.current > MUTATION_GRACE_MS) {
        setSelected(fresh);
      }
      return;
    }

    // Not in the list anymore. Paid orders drop out of /api/orders — keep the
    // selection so the paid reply can still be copied, fetching it by id.
    if (current.status === "paid") return;
    if (fetchingDetailRef.current) return;
    fetchingDetailRef.current = true;
    fetch(`/api/orders/${current.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.order) {
          setSelected(d.order);
        } else if (visible.length > 0) {
          setSelected(visible[0]);
        } else {
          setSelected(null);
        }
      })
      .catch(() => {})
      .finally(() => {
        fetchingDetailRef.current = false;
      });
  }, []);

  // Poll the orders list every 2.5s.
  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await fetch("/api/orders");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!alive) return;
        const all: Order[] = data.orders ?? [];
        setOrders(all);
        setLoadError(null);
        setLoaded(true);
        resolveSelection(all);
      } catch {
        if (!alive) return;
        setLoaded(true);
        setLoadError("Couldn't load orders — retrying…");
      }
    }
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [resolveSelection]);

  const handleSelect = useCallback(
    (id: string) => {
      const found = orders.find((o) => o.id === id);
      if (found) setSelected(found);
    },
    [orders]
  );

  // ↑/↓ move the selection through the currently-visible list. Ignored while
  // focus is inside a form control so typing/arrowing in inputs still works.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (visibleOrders.length === 0) return;
      e.preventDefault();
      const currentId = selectedRef.current?.id ?? null;
      const idx = visibleOrders.findIndex((o) => o.id === currentId);
      let next: number;
      if (idx === -1) {
        next = e.key === "ArrowDown" ? 0 : visibleOrders.length - 1;
      } else {
        next = e.key === "ArrowDown" ? idx + 1 : idx - 1;
      }
      if (next < 0 || next >= visibleOrders.length) return;
      setSelected(visibleOrders[next]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleOrders]);

  // Server-confirmed updates (PATCH lines/options, proof, bpi-match, confirm).
  const handleOrderUpdate = useCallback((order: Order) => {
    lastMutationRef.current = Date.now();
    setOrders((prev) => {
      const known = prev.some((o) => o.id === order.id);
      return known ? prev.map((o) => (o.id === order.id ? order : o)) : prev;
    });
    if (selectedRef.current?.id === order.id) setSelected(order);
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-forest-900">
        Processed + Payments
      </h1>
      <p className="mt-1 text-sm text-forest-700">
        Finalized orders — draft created, awaiting payment confirmation.
        Editing an order here invalidates its draft and sends it back to the{" "}
        <Link href="/queue" className="font-semibold text-forest-800 underline">
          Queue
        </Link>
        .
      </p>

      {loadError && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </div>
      )}

      <FollowUpQueue
        orders={sortedOrders}
        followUpDays={followUpDays}
        selectedId={selectedOrder?.id ?? null}
        onSelect={handleSelect}
      />

      {/* Split screen: finalized orders · payment verification */}
      <div className="mt-4 grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
        {/* LEFT card: finalized orders awaiting payment */}
        <div className="rounded-xl border border-forest-200 bg-white p-5 shadow-sm lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-forest-900">
              Awaiting payment
            </h2>
            <p className="flex shrink-0 items-center gap-1 text-xs text-forest-500">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span>to navigate</span>
            </p>
          </div>

          <div className="mt-4">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cafe or message…"
              aria-label="Search orders"
              className="w-full rounded-md border border-forest-300 bg-white px-3 py-1.5 text-sm text-forest-900 placeholder:text-forest-400 focus:border-forest-600 focus:outline-none"
            />
          </div>

          <div className="mt-4">
            {!loaded ? (
              <div className="space-y-3">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : sortedOrders.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-forest-200 p-8 text-center text-sm text-forest-500">
                Nothing awaiting payment — orders land here once you{" "}
                <span className="font-semibold">Confirm · create draft</span> on
                the{" "}
                <Link href="/queue" className="font-semibold text-forest-700 underline">
                  Queue
                </Link>
                .
              </div>
            ) : visibleOrders.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-forest-200 p-8 text-center text-sm text-forest-500">
                No orders match “{query}”.
              </div>
            ) : (
              <div className="space-y-4">
                {visibleOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    catalog={catalog}
                    titles={titles}
                    selected={order.id === selectedOrder?.id}
                    onSelect={handleSelect}
                    onOrderUpdate={handleOrderUpdate}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT card: payment verification for the selected order */}
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-20">
            <PaymentPane order={selectedOrder} onOrderUpdate={handleOrderUpdate} />
          </div>
        </div>
      </div>
    </div>
  );
}
