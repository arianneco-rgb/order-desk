import clsx from "clsx";

/** Marks an order created while the global test-mode switch was on. */
export function TestBadge({ className }: { className?: string }) {
  return (
    <span
      title="Test order — no real Shopify draft/payment, not mirrored to the Sheet"
      className={clsx(
        "inline-flex shrink-0 items-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white",
        className
      )}
    >
      Test
    </span>
  );
}
