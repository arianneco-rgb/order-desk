"use client";

import { useEffect, useState } from "react";

/**
 * A labelled progress line for slow, multi-step actions (create draft, mark
 * paid). It advances on a timer through the steps the server is actually
 * working through, rather than showing one static "Saving…".
 *
 * The honesty question this raises is deliberate: the client can't observe
 * the server's internal steps over a plain fetch, so the timings below are
 * measured estimates, not live telemetry. That's fine for the two things
 * this is used for — the step ORDER is real and fixed in the route, so the
 * label always names something genuinely happening or already done. What it
 * never does is claim completion: the final step holds at "almost there"
 * until the real response lands, so a slow request can't show a finished
 * state while the work is still running.
 */
export function StagedProgress({
  steps,
  className = "",
}: {
  /** In server order. `ms` is how long this step usually takes. */
  steps: { label: string; ms: number }[];
  className?: string;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let elapsed = 0;
    // Stop before the last step: it stays on screen until the request
    // resolves and this component unmounts.
    steps.slice(0, -1).forEach((step, i) => {
      elapsed += step.ms;
      timers.push(
        setTimeout(() => {
          if (!cancelled) setIndex(i + 1);
        }, elapsed)
      );
    });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [steps]);

  const current = steps[Math.min(index, steps.length - 1)];
  const pct = Math.round(((index + 0.5) / steps.length) * 100);

  return (
    <div className={className} role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <Spinner />
        <span className="text-sm text-forest-700">{current.label}</span>
        <span className="ml-auto text-xs tabular-nums text-forest-500">
          {index + 1}/{steps.length}
        </span>
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-forest-100">
        <div
          className="h-full rounded-full bg-forest-600 transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin text-forest-600`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

/**
 * Shows its children only once a delay has passed. Flashing a spinner for a
 * 200ms response reads as jank, not feedback — this keeps fast responses
 * looking instant and only explains the wait when there genuinely is one.
 */
export function AfterDelay({
  ms = 400,
  children,
}: {
  ms?: number;
  children: React.ReactNode;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return show ? <>{children}</> : null;
}
