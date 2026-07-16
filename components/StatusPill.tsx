import clsx from "clsx";
import type { Order } from "@/lib/types";

/**
 * The one status vocabulary used everywhere (feedback round 4: the Queue is
 * the working stage, Processed holds finalized drafts awaiting payment):
 * Processing… · Needs review · Ready to finalize · Awaiting payment · Paid
 */
export function statusLabel(order: Pick<Order, "status" | "needsReview">): string {
  switch (order.status) {
    case "queued":
    case "processing":
      return "Processing…";
    case "processed":
      return order.needsReview ? "Needs review" : "Ready to finalize";
    case "draft_created":
      return "Awaiting payment";
    case "paid":
      return "Paid";
  }
}

export function StatusPill({
  order,
  className,
}: {
  order: Pick<Order, "status" | "needsReview">;
  className?: string;
}) {
  const label = statusLabel(order);
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        label === "Processing…" && "bg-sky-100 text-sky-800",
        label === "Needs review" && "bg-amber-100 text-amber-900",
        label === "Ready to finalize" && "bg-forest-100 text-forest-800",
        label === "Awaiting payment" && "bg-indigo-100 text-indigo-800",
        label === "Paid" && "bg-forest-600 text-white",
        className
      )}
    >
      {label === "Processing…" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-600" />
      )}
      {label}
    </span>
  );
}
