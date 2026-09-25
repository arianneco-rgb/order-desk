// Reference scoring, ported from Marco's BPI BizLink Confirmation Finder
// (v2026-09-18.3, scoreRef_ / dice_ / normalize_ / isRefSubstring_).
//
// That script is a separate system — it indexes OUTGOING BizLink
// confirmations into its own sheet. What carries over is the search itself,
// which solves the problem Joey actually has: she's reading a reference off
// a screenshot and typing part of it. Whole-string matching fails for that,
// because a bank reference is long and the part a person quotes is usually
// the trailing serial.
//
// Kept verbatim in behaviour, including the score values, so results here
// rank the same way they do in Marco's tool.

/** Punctuation- and case-insensitive, so any way of pasting a reference works. */
export function normalizeRef(s: string): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Sørensen–Dice bigram similarity, 0..1. Tolerates a transposed or wrong digit. */
export function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const grams: Record<string, number> = {};
  let total = 0;
  let hits = 0;
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.substr(i, 2);
    grams[g] = (grams[g] || 0) + 1;
  }
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.substr(i, 2);
    total++;
    if (grams[g] > 0) {
      grams[g]--;
      hits++;
    }
  }
  return (2 * hits) / (a.length - 1 + total);
}

/**
 * 0..100. The tiers matter more than the numbers: an exact or serial-number
 * hit (>=88) is certain, a substring (80-84) is near-certain, and anything
 * below that is a fuzzy guess that must never outrank them.
 */
export function scoreRef(query: string, ref: string): number {
  const q = normalizeRef(query);
  const r = normalizeRef(ref);
  if (!q) return 0;
  if (q === r) return 100;

  // The trailing serial is the part people actually quote.
  const serial = ref.split("-").pop() ?? "";
  const qDigits = q.replace(/[^0-9]/g, "");
  if (qDigits.length >= 4) {
    if (serial === qDigits) return 96;
    if (serial.replace(/^0+/, "") === qDigits.replace(/^0+/, "")) return 94;
    if (serial.indexOf(qDigits) === 0 || serial.slice(-qDigits.length) === qDigits) return 88;
  }
  if (r.indexOf(q) !== -1) return 84;
  if (q.indexOf(r) !== -1) return 80;
  return Math.round(dice(q, r) * 74);
}

/** Below this, a fuzzy hit is noise rather than a candidate. */
export const MIN_SCORE = 45;

/**
 * When the top two scores are closer than this, the best match isn't
 * meaningfully better than the runner-up — so the UI says so instead of
 * implying the first one is right.
 */
export const AMBIGUITY_GAP = 12;
