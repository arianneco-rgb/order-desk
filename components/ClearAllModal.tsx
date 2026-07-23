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
  const toast = useToast();

  const ready = confirmText.trim().toUpperCase() === "DELETE";

  function close() {
    if (running) return;
    setConfirmText("");
    setFailures([]);
    onClose();
  }

  async function run() {
    setRunning(true);
    setFailures([]);
    const failed: { company: string; error: string }[] = [];
    let deleted = 0;
    for (const order of orders) {
      try {
        const res = await fetch(`/api/orders/${order.id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        deleted++;
        onOrderDeleted(order.id);
      } catch (err) {
        failed.push({
          company: order.company,
          error: err instanceof Error ? err.message : "Delete failed.",
        });
      }
    }
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
          {running ? "Deleting…" : `Delete all ${orders.length}`}
        </button>
      </div>
    </Modal>
  );
}
