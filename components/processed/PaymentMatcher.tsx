"use client";

import { useMemo, useState } from "react";
import type { BpiMatch } from "@/lib/types";
import { formatPeso } from "@/lib/conversions";
import { Spinner } from "@/components/StagedProgress";
import { formatTime } from "./format";
import { AMBIGUITY_GAP, MIN_SCORE, scoreRef } from "@/lib/ref-search";

/**
 * Pick which BPI transfers paid this order.
 *
 * Deliberately selection-first rather than auto-match. The previous version
 * attached its best guess to the order automatically, so confirming the
 * WRONG payment took a single click — and because the pane re-polls, the
 * guess also overwrote transactions Joey had picked by hand. Here the
 * suggestion is only ever a proposal; nothing is attached until it's
 * chosen, and anything chosen can be removed again.
 *
 * Multi-select because cafes split one order across several transfers.
 */
export function PaymentMatcher({
  orderTotal,
  selected,
  suggestion,
  candidates,
  simulated,
  busy,
  onChange,
}: {
  orderTotal: number;
  selected: BpiMatch[];
  suggestion: BpiMatch | null;
  candidates: BpiMatch[];
  simulated: boolean;
  busy: boolean;
  /** Full replacement list — an empty array clears the selection. */
  onChange: (matchKeys: string[]) => void;
}) {
  const [query, setQuery] = useState("");

  const selectedKeys = useMemo(() => new Set(selected.map((m) => m.matchKey)), [selected]);
  const paid = selected.reduce((sum, m) => sum + m.amount, 0);
  const remaining = orderTotal - paid;

  // The suggestion is shown alongside the list, so don't repeat it there.
  const pool = useMemo(() => {
    const all = suggestion ? [suggestion, ...candidates] : candidates;
    const seen = new Set<string>();
    return all.filter((c) => !seen.has(c.matchKey) && seen.add(c.matchKey));
  }, [suggestion, candidates]);

  const { results, ambiguous } = useMemo(() => {
    const q = query.trim();
    if (!q) return { results: pool, ambiguous: false };

    // Reference matching uses Marco's BizLink scoring (lib/ref-search.ts):
    // it handles someone typing just the trailing serial off a screenshot,
    // which plain substring matching misses entirely.
    //
    // The other fields on a bank slip — amount, bank, last 4, date — stay
    // plainly searchable, scored below any real reference hit so they can
    // never outrank one.
    const lower = q.toLowerCase();
    const digits = q.replace(/[^\d.]/g, "");
    const scored = pool
      .map((c) => {
        const byRef = scoreRef(q, c.ref);
        const hay = [
          c.sourceBank ?? "",
          c.fromAccountLast4 ?? "",
          String(c.amount),
          formatTime(c.date) || c.date,
        ]
          .join(" ")
          .toLowerCase();
        const byField =
          hay.includes(lower) || (digits.length > 0 && hay.includes(digits)) ? 70 : 0;
        return { c, score: Math.max(byRef, byField) };
      })
      .filter((x) => x.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score);

    return {
      results: scored.map((x) => x.c),
      // Two near-equal scores mean the top hit isn't actually the better
      // answer — say so rather than letting the ordering imply it is.
      ambiguous:
        scored.length > 1 && scored[0].score - scored[1].score < AMBIGUITY_GAP,
    };
  }, [pool, query]);

  function toggle(key: string) {
    const next = selectedKeys.has(key)
      ? selected.filter((m) => m.matchKey !== key).map((m) => m.matchKey)
      : [...selected.map((m) => m.matchKey), key];
    onChange(next);
  }

  return (
    <div className="mt-2 space-y-3">
      {/* What's attached right now */}
      {selected.length > 0 ? (
        <div className="rounded-lg border border-forest-300 bg-forest-50 p-3">
          <p className="flex items-center justify-between gap-2 text-sm font-semibold text-forest-800">
            {selected.length === 1 ? "Transfer selected" : `${selected.length} transfers selected`}
            {simulated && (
              <span className="rounded bg-forest-200 px-1.5 py-0.5 text-[11px] font-medium text-forest-800">
                simulated
              </span>
            )}
          </p>
          <ul className="mt-2 space-y-1.5">
            {selected.map((m) => (
              <li
                key={m.matchKey}
                className="flex items-start justify-between gap-2 rounded-md border border-forest-200 bg-white px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-forest-900">
                    {formatPeso(m.amount)}
                    {m.fromAccountLast4 ? ` · ···${m.fromAccountLast4}` : ""}
                    {m.sourceBank ? ` (${m.sourceBank})` : ""}
                  </p>
                  <p className="truncate text-[11px] text-forest-500">
                    Ref {m.ref} · {formatTime(m.date) || m.date}
                  </p>
                  {!m.settled && (
                    <p className="mt-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                      ⚠️ Not yet credited — pre-advice, the money isn&apos;t in the account yet.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => toggle(m.matchKey)}
                  disabled={busy}
                  className="shrink-0 rounded-md border border-forest-300 bg-white px-2 py-1 text-[11px] font-semibold text-forest-700 transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-forest-700">
            Selected <span className="font-semibold">{formatPeso(paid)}</span> of{" "}
            {formatPeso(orderTotal)}
            {Math.abs(remaining) < 0.01 ? (
              <span className="ml-1 font-semibold text-forest-800">· matches exactly ✓</span>
            ) : remaining > 0 ? (
              <span className="ml-1 font-semibold text-amber-800">
                · {formatPeso(remaining)} short — add another transfer
              </span>
            ) : (
              <span className="ml-1 font-semibold text-amber-800">
                · {formatPeso(-remaining)} over
              </span>
            )}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            No transfer selected yet — pick the payment below, or tick the manual box.
          </p>
          {suggestion && (
            <div className="mt-2 flex items-start justify-between gap-2 rounded-md border border-amber-200 bg-white px-2.5 py-1.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-forest-900">
                  {formatPeso(suggestion.amount)}
                  {suggestion.fromAccountLast4 ? ` · ···${suggestion.fromAccountLast4}` : ""}
                  {suggestion.sourceBank ? ` (${suggestion.sourceBank})` : ""}
                </p>
                <p className="truncate text-[11px] text-forest-500">
                  Ref {suggestion.ref} · {formatTime(suggestion.date) || suggestion.date}
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-amber-800">
                  Suggested{suggestion.matchedBy === "reference" ? " — reference matches the proof" : " — same amount, closest date"}. Check before using.
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggle(suggestion.matchKey)}
                disabled={busy}
                className="shrink-0 rounded-md bg-forest-700 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-forest-800 disabled:opacity-50"
              >
                Use this
              </button>
            </div>
          )}
        </div>
      )}

      {/* Search + pick */}
      <div className="rounded-lg border border-forest-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search amount, reference, bank, last 4…"
            className="w-full rounded-md border border-forest-200 px-2.5 py-1.5 text-sm text-forest-900 focus:border-forest-600 focus:outline-none"
          />
          {busy && <Spinner className="h-4 w-4 shrink-0" />}
        </div>

        {ambiguous && (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
            Several transfers match about equally well — check the reference before selecting.
          </p>
        )}

        {results.length === 0 ? (
          <p className="mt-2 text-xs text-forest-500">
            {pool.length === 0
              ? "No transactions logged yet — Marco's script writes them every 10 minutes."
              : `Nothing matches “${query.trim()}”.`}
          </p>
        ) : (
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {results.map((c) => {
              const isSelected = selectedKeys.has(c.matchKey);
              const exact = Math.abs(c.amount - orderTotal) < 0.01;
              return (
                <li key={c.matchKey}>
                  <button
                    type="button"
                    onClick={() => toggle(c.matchKey)}
                    disabled={busy}
                    aria-pressed={isSelected}
                    className={`flex w-full items-start justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors disabled:opacity-50 ${
                      isSelected
                        ? "border-forest-400 bg-forest-50"
                        : "border-forest-200 bg-white hover:bg-forest-50"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-forest-900">
                        {formatPeso(c.amount)}
                        {c.fromAccountLast4 ? ` · ···${c.fromAccountLast4}` : ""}
                        {c.sourceBank ? ` (${c.sourceBank})` : ""}
                        {exact && (
                          <span className="ml-1.5 rounded bg-forest-100 px-1 py-0.5 text-[10px] font-semibold text-forest-700">
                            exact
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-forest-500">
                        Ref {c.ref} · {formatTime(c.date) || c.date}
                        {!c.settled ? " · not yet credited" : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] font-semibold text-forest-700">
                      {isSelected ? "✓ selected" : "Select"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
