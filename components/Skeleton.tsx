import clsx from "clsx";

/** A pulsing placeholder block — use while data is loading. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx("animate-pulse rounded-md bg-forest-100", className)}
    />
  );
}

/** A stack of skeleton lines, e.g. for a loading list/card. */
export function SkeletonLines({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={clsx("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={clsx("h-3", i === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

/** A skeleton shaped like an order card (avoids layout shift on Processed/Queue). */
export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-forest-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <SkeletonLines lines={2} className="mt-3" />
      <Skeleton className="mt-3 h-16 w-full" />
    </div>
  );
}
