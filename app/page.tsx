"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Order, OrderHistoryRow } from "@/lib/types";
import { formatPeso } from "@/lib/conversions";
import { paymentReminderReply } from "@/lib/templates";
import { CopyButton } from "@/components/CopyButton";
import { SkeletonCard } from "@/components/Skeleton";

const POLL_MS = 10_000;
const DAY_MS = 86_400_000;

/** Local yyyy-mm-dd, for the "paid today" tile. */
function dayKeyOf(iso: string | Date): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Tile({
  label,
  value,
  sub,
  subTone = "ok",
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: "ok" | "bad";
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-forest-200 bg-white p-4 shadow-sm transition-colors hover:border-forest-400"
    >
      <p className="text-xs text-forest-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-forest-900">{value}</p>
      {sub && (
        <p
          className={
            subTone === "bad"
              ? "mt-0.5 text-xs font-semibold text-red-700"
              : "mt-0.5 text-xs font-medium text-forest-600"
          }
        >
          {sub}
        </p>
      )}
    </Link>
  );
}

/**
 * Home — the day at a glance (round 5, P2): how many pesos are waiting,
 * what needs work in the Queue, who's overdue for a follow-up, what got
 * paid today, and a "needs you first" list. Test orders are excluded from
 * every number here — this is the business view, not the test board.
 */
export default function HomePage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [history, setHistory] = useState<OrderHistoryRow[] | null>(null);
  const [followUpDays, setFollowUpDays] = useState(3);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (typeof d?.followUpDays === "number") setFollowUpDays(d.followUpDays);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [ordersRes, historyRes] = await Promise.all([
          fetch("/api/orders"),
          fetch("/api/history"),
        ]);
        if (!ordersRes.ok || !historyRes.ok) throw new Error("load failed");
        const o = await ordersRes.json();
        const h = await historyRes.json();
        if (cancelled) return;
        setOrders(Array.isArray(o.orders) ? o.orders : []);
        setHistory(Array.isArray(h.rows) ? h.rows : []);
        setError(null);
      } catch {
        if (!cancelled) setError("Couldn't load today's numbers — retrying…");
      }
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const stats = useMemo(() => {
    const real = (orders ?? []).filter((o) => !o.isTest);
    const awaiting = real.filter((o) => o.status === "draft_created");
    const inQueue = real.filter(
      (o) => o.status === "queued" || o.status === "processing" || o.status === "processed"
    );
    const needsReview = real.filter((o) => o.status === "processed" && o.needsReview);

    const now = Date.now();
    const cutoff = now - followUpDays * DAY_MS;
    const overdue = awaiting
      .filter((o) => o.draftCreatedAt && Date.parse(o.draftCreatedAt) < cutoff)
      .sort((a, b) => Date.parse(a.draftCreatedAt!) - Date.parse(b.draftCreatedAt!));
    const oldestDays = overdue.length
      ? Math.floor((now - Date.parse(overdue[0].draftCreatedAt!)) / DAY_MS)
      : 0;

    const today = dayKeyOf(new Date());
    const paidToday = (history ?? []).filter((r) => !r.isTest && dayKeyOf(r.paidAt) === today);

    return {
      awaitingTotal: awaiting.reduce((s, o) => s + o.total, 0),
      awaitingCount: awaiting.length,
      queueCount: inQueue.length,
      needsReviewCount: needsReview.length,
      needsReviewOrders: needsReview.slice(0, 4),
      overdue,
      oldestDays,
      paidTodayTotal: paidToday.reduce((s, r) => s + r.total, 0),
      paidTodayCount: paidToday.length,
    };
  }, [orders, history, followUpDays]);

  const loading = orders === null || history === null;
  const needsYou = stats.overdue.length + stats.needsReviewCount > 0;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-forest-900">Home</h1>
      <p className="mt-1 text-sm text-forest-700">
        The day at a glance — jump straight to whatever needs you.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-5 space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <>
          {/* The four numbers that run the day */}
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label="Awaiting payment"
              value={formatPeso(stats.awaitingTotal)}
              sub={`${stats.awaitingCount} order${stats.awaitingCount === 1 ? "" : "s"}`}
              href="/processed"
            />
            <Tile
              label="To finalize in Queue"
              value={String(stats.queueCount)}
              sub={
                stats.needsReviewCount > 0
                  ? `${stats.needsReviewCount} need${stats.needsReviewCount === 1 ? "s" : ""} review`
                  : "all clean"
              }
              subTone={stats.needsReviewCount > 0 ? "bad" : "ok"}
              href="/queue"
            />
            <Tile
              label="Overdue follow-ups"
              value={String(stats.overdue.length)}
              sub={
                stats.overdue.length
                  ? `oldest: ${stats.oldestDays} day${stats.oldestDays === 1 ? "" : "s"}`
                  : "none 🎉"
              }
              subTone={stats.overdue.length ? "bad" : "ok"}
              href="/processed"
            />
            <Tile
              label="Paid today"
              value={formatPeso(stats.paidTodayTotal)}
              sub={`${stats.paidTodayCount} order${stats.paidTodayCount === 1 ? "" : "s"}`}
              href="/history"
            />
          </div>

          {/* Needs you first */}
          <div className="mt-4 rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-forest-900">Needs you first</h2>
            {!needsYou ? (
              <p className="mt-3 rounded-lg border-2 border-dashed border-forest-200 p-6 text-center text-sm text-forest-500">
                Nothing urgent — paste the next order whenever it comes in.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-forest-100">
                {stats.overdue.map((o) => {
                  const days = Math.floor((Date.now() - Date.parse(o.draftCreatedAt!)) / DAY_MS);
                  return (
                    <li
                      key={o.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                    >
                      <span className="min-w-0 text-sm text-forest-900">
                        ⚠️ <span className="font-semibold">{o.company}</span>
                        <span className="text-forest-600">
                          {" "}
                          — unpaid {days} day{days === 1 ? "" : "s"} · {formatPeso(o.total)}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <CopyButton text={paymentReminderReply(o.total)} label="Copy reminder" />
                        <Link
                          href="/processed"
                          className="text-xs font-semibold text-forest-700 hover:underline"
                        >
                          Open →
                        </Link>
                      </span>
                    </li>
                  );
                })}
                {stats.needsReviewOrders.map((o) => (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  >
                    <span className="min-w-0 text-sm text-forest-900">
                      📝 <span className="font-semibold">{o.company}</span>
                      <span className="text-forest-600"> — parse needs review</span>
                    </span>
                    <Link
                      href="/queue"
                      className="shrink-0 text-xs font-semibold text-forest-700 hover:underline"
                    >
                      Open in Queue →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Quick actions */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/paste"
              className="rounded-lg bg-forest-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-forest-900"
            >
              Paste an order
            </Link>
            <Link
              href="/reports"
              className="rounded-lg border border-forest-300 bg-white px-4 py-2 text-sm font-semibold text-forest-800 transition-colors hover:bg-forest-50"
            >
              Reports
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
