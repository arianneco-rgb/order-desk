"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import type { Order } from "@/lib/types";

/**
 * "Clear all" for Queue/Processed — deletes every given order (store +
 * Shopify draft + Sheet, via the per-order DELETE route) one at a time so
 * partial failures are visible instead of an opaque all-or-nothing.
 * Requires typing DELETE since this can remove live, real Shopify drafts.
 */
export function ClearAllModal({
  open,
  onClose,
  orders,
  pageLabel,
  onOrderDeleted,
}: {
  open: boolean;
  onClose: () => void;
  orders: Order[];
  pageLabel: string;
  onOrderDeleted: (id: string) => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [running, setRunning] = useState(false);
  const [failures, setFailures] = useState<{ company: string; error: string }[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const toast = useToast();

  const ready = confirmText.trim().toUpperCase() === "DELETE";

  function close() {
    if (running) return;
    setConfirmText("");
    setFailures([]);
    onClose();
  }

  // Each delete is slow (a Shopify draft removal plus a Google Sheet write)
  // and Google's bridge fails intermittently, so clearing a handful of
  // orders one-at-a-time was both the slowest and the most failure-prone
  // thing in the app — with N orders you get N chances to hit a blip.
  // Running a few at a time cuts the wall-clock roughly threefold, and one
  // retry absorbs the transient failures rather than reporting them at Joey.
  const CONCURRENCY = 3;

  async function deleteOne(order: { id: string; company: string }): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(`/api/orders/${order.id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return;
      } catch (err) {
        // A 409 means the order is genuinely un-deletable (paid, or mid-update)
        // — retrying just wastes time, so let it fail straight away.
        const message = err instanceof Error ? err.message : "Delete failed.";
        if (attempt === 2 || /permanent record|mid-update/i.test(message)) throw err;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  async function run() {
    setRunning(true);
    setFailures([]);
    setProgress({ done: 0, total: orders.length });
    const failed: { company: string; error: string }[] = [];
    let deleted = 0;

    const queue = [...orders];
    async function worker() {
      for (;;) {
        const order = queue.shift();
        if (!order) return;
        try {
          await deleteOne(order);
          deleted++;
          onOrderDeleted(order.id);
        } catch (err) {
          failed.push({
            company: order.company,
            error: err instanceof Error ? err.message : "Delete failed.",
          });
        }
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, orders.length) }, () => worker())
    );

    setRunning(false);
    setConfirmText("");
    if (failed.length === 0) {
      toast(`Deleted all ${deleted} order${deleted === 1 ? "" : "s"} from ${pageLabel}.`, "success");
      onClose();
    } else {
      setFailures(failed);
      toast(`Deleted ${deleted}, ${failed.length} failed — see details.`, "error");
    }
  }

  return (
    <Modal open={open} onClose={close} title={`Clear all — ${pageLabel}`}>
      <p className="text-sm text-forest-700">
        This permanently deletes{" "}
        <span className="font-semibold text-forest-900">
          all {orders.length} order{orders.length === 1 ? "" : "s"}
        </span>{" "}
        currently on {pageLabel} — from Order Desk, Shopify (any live drafts), and any Sheet
        record. This can&apos;t be undone.
      </p>

      <label className="mt-4 block text-sm font-medium text-forest-800">
        Type <span className="font-mono font-semibold">DELETE</span> to confirm
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          disabled={running}
          autoFocus
          className="mt-1 w-full rounded-md border border-forest-300 px-3 py-1.5 text-sm text-forest-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200"
        />
      </label>

      {failures.length > 0 && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <p className="font-semibold">{failures.length} couldn&apos;t be deleted:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {failures.map((f, i) => (
              <li key={i}>
                {f.company}: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={close}
          disabled={running}
          className="rounded-md border border-forest-300 bg-white px-3 py-1.5 text-sm font-semibold text-forest-800 transition-colors hover:bg-forest-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!ready || running || orders.length === 0}
          className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:opacity-50"
        >
          {running
            ? `Deleting… ${progress.done}/${progress.total}`
            : `Delete all ${orders.length}`}
        </button>
      </div>
    </Modal>
  );
}
