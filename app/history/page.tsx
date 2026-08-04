"use client";

import { useEffect, useMemo, useState } from "react";
import type { OrderHistoryRow } from "@/lib/types";
import { formatPeso } from "@/lib/conversions";
import { StatusPill } from "@/components/StatusPill";
import { TestBadge } from "@/components/TestBadge";
import { SkeletonCard } from "@/components/Skeleton";

const POLL_MS = 10_000;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Inline view/add/edit control for a History row's free-text note. */
function NoteEditor({
  row,
  onSaved,
}: {
  row: OrderHistoryRow;
  onSaved: (orderId: string, note: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/history/${encodeURIComponent(row.orderId)}/note`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: draft }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error("History row not found.");
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onSaved(row.orderId, draft);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the note.");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="mt-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
          rows={2}
          autoFocus
          placeholder="Add a note…"
          className="w-full rounded-md border border-forest-200 px-2.5 py-1.5 text-sm text-forest-900 placeholder:text-forest-300 focus:border-forest-600 focus:outline-none"
        />
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-md border border-forest-600 bg-forest-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-forest-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(row.notes ?? "");
              setEditing(false);
              setError(null);
            }}
            disabled={saving}
            className="rounded-md border border-forest-200 px-2.5 py-1 text-xs font-semibold text-forest-700 hover:bg-forest-50"
          >
            Cancel
          </button>
          {saved && <span className="text-xs text-forest-600">Saved ✓</span>}
        </div>
      </div>
    );
  }

  if (row.notes) {
    return (
      <div className="mt-2 flex items-start justify-between gap-2 rounded-md bg-forest-50 px-2.5 py-1.5">
        <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-forest-700">
          {row.notes}
        </p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-xs font-semibold text-forest-600 hover:text-forest-800 hover:underline"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs font-semibold text-forest-500 hover:text-forest-700 hover:underline"
      >
        + Add note
      </button>
      {saved && <span className="ml-2 text-xs text-forest-600">Saved ✓</span>}
    </div>
  );
}

export default function HistoryPage() {
  const [rows, setRows] = useState<OrderHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/history");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setRows(Array.isArray(data.rows) ? data.rows : []);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Couldn't load history — retrying…");
      }
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const filtered = useMemo(() => {
    const all = rows ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (r) =>
        r.company.toLowerCase().includes(q) || r.items.toLowerCase().includes(q)
    );
  }, [rows, query]);

  function handleNoteSaved(orderId: string, note: string) {
    setRows((prev) =>
      prev
        ? prev.map((r) => (r.orderId === orderId ? { ...r, notes: note } : r))
        : prev
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-forest-900">
        History
      </h1>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4 rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-forest-900">
            History · completed orders{" "}
            <span className="font-normal text-forest-500">
              (mirrored to the Order History sheet)
            </span>
          </h2>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cafe or items…"
            className="w-full max-w-full rounded-md border border-forest-200 px-2.5 py-1.5 text-sm text-forest-900 placeholder:text-forest-300 focus:border-forest-600 focus:outline-none sm:w-48"
          />
        </div>

        <div className="mt-4 space-y-3 overflow-x-auto">
          {rows === null ? (
            <div className="space-y-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-forest-200 p-8 text-center text-sm text-forest-500">
              {query
                ? "No paid orders match that search."
                : "No paid orders yet — confirmed payments land here and in the Order History sheet tab."}
            </div>
          ) : (
            filtered.map((row) => (
              <div
                key={`${row.orderId}-${row.paidAt}`}
                className="rounded-xl border border-forest-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-base font-semibold text-forest-900">
                      {row.company}
                      {row.isTest && <TestBadge />}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-forest-600">
                      {row.items || "—"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-base font-bold text-forest-900">
                      {formatPeso(row.total)}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center justify-end gap-1.5 text-sm text-forest-600">
                      {formatDate(row.paidAt)} ·{" "}
                      <StatusPill order={{ status: "paid", needsReview: false }} />
                    </p>
                    <a
                      href={`/invoice/${encodeURIComponent(row.orderId)}`}
                      className="mt-1 inline-block text-xs font-semibold text-forest-600 hover:text-forest-800 hover:underline"
                    >
                      View invoice
                    </a>
                  </div>
                </div>
                <NoteEditor row={row} onSaved={handleNoteSaved} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
