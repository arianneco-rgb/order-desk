// Turns the raw text an OCR engine reads off a payment screenshot into the
// handful of fields Joey actually checks: how much, what reference, who
// sent it, when.
//
// This is the hard half. Getting characters off the image is the easy part —
// a BPI slip has four or five peso figures on it (amount, fee, balance,
// sometimes a running total) and picking the wrong one is worse than
// picking none, because a pre-filled wrong number is a number she might not
// re-read. So every candidate is scored against the words around it and
// anything that looks like a fee, a balance or a limit is pushed down.
//
// Deliberately pure and engine-agnostic: no DOM, no network, no Tesseract
// types. Feed it text from anywhere.
//
// Golden rule: this only ANNOTATES. Nothing here confirms a payment.

import type { ProofAnalysis } from "./types";

/* ------------------------------------------------------------------ *
 * Labels
 *
 * Philippine slips in the wild: BPI, BDO, UnionBank, GCash, Maya,
 * SeaBank, InstaPay/PESONet confirmations. Matching is loose on purpose —
 * Tesseract drops and swaps characters, so these look for the stem of a
 * word rather than the exact phrase.
 * ------------------------------------------------------------------ */

/** Lines whose number is the transfer itself. */
const AMOUNT_LABEL =
  /\b(amount\s*(sent|paid|due|to\s*send)?|you\s*(have\s*)?sent|sent\s*amount|total\s*amount|amount\s*transferred|transfer\s*amount)\b/i;

/** Lines whose number is NOT the transfer, however peso-shaped it looks. */
const NOT_AMOUNT =
  /\b(fee|charge|balance|available|remaining|limit|points|rewards|cashback|discount|rate|tax|vat|convenience)\b/i;

const REF_LABEL =
  /\b(ref(erence)?(\s*(no|number|code|id))?|transaction\s*(no|number|id|ref)|trace\s*(no|number)|txn\s*(id|no)|confirmation\s*(no|number|code))\b/i;

const SENDER_LABEL =
  /\b(sender|sent\s*by|from|account\s*name|payer|source\s*account)\b/i;

const RECIPIENT_LABEL =
  /\b(recipient|receiver|send\s*to|sent\s*to|beneficiary|payee|to\s*account|destination)\b/i;

/* ------------------------------------------------------------------ *
 * Numbers
 * ------------------------------------------------------------------ */

/**
 * A peso figure. The currency mark is optional because OCR mangles "₱"
 * into P, R, PHP, or nothing at all — but then the number has to earn its
 * place some other way (see `looksLikeMoney`).
 */
const MONEY = /(?:₱|P\s?h?p?|PHP)?\s*(\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}|\d{3,9})/gi;

/** True when the raw matched text is money-shaped rather than an ID. */
function looksLikeMoney(raw: string, digits: string): boolean {
  if (/₱|php|\bp\s*\d/i.test(raw)) return true; // carried a currency mark
  if (/[,\s]\d{3}/.test(digits)) return true; // 20,000 / 20 000
  if (/\.\d{2}$/.test(digits)) return true; // 1500.00
  return false;
}

function toNumber(digits: string): number {
  return Number(digits.replace(/[,\s]/g, ""));
}

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const DATE_PATTERNS = [
  // 14 October 2026 / Oct 14, 2026
  new RegExp(`\\b(?:\\d{1,2}\\s+(?:${MONTHS})|(?:${MONTHS})\\s+\\d{1,2})[,.]?\\s+\\d{2,4}\\b`, "i"),
  // 2026-10-14
  /\b\d{4}-\d{2}-\d{2}\b/,
  // 14/10/2026 or 10/14/26
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/,
];

const TIME = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?)?\b/;

function findDate(lines: string[]): string | undefined {
  for (const line of lines) {
    for (const pattern of DATE_PATTERNS) {
      const hit = line.match(pattern);
      if (!hit) continue;
      const time = line.match(TIME);
      // Keep the time only when it sits on the same line as the date —
      // a stray clock reading from the phone's status bar isn't useful.
      return time ? `${hit[0]} ${time[0].trim()}` : hit[0];
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Reference numbers
 * ------------------------------------------------------------------ */

/** Long enough to be an actual reference, not a date fragment or an amount. */
const REF_VALUE = /\b([A-Z0-9][A-Z0-9-]{5,})\b/i;

/**
 * A line that is nothing but the tail of the reference above it.
 *
 * InstaPay references run to 32-odd characters and a phone wraps them, so
 * OCR emits "20261014BNORPHMMXXXB00" then "0020000551204" on the next
 * line. Read on its own the first half looks like a complete reference —
 * which is how you end up with a plausible, wrong number in the ledger.
 */
const REF_CONTINUATION = /^[A-Z0-9]{6,}$/i;

function joinWrappedRef(value: string, next: string | undefined): string {
  if (!next || !REF_CONTINUATION.test(next)) return value;
  // Must carry digits: the line under a reference is just as often the
  // next field's label ("Sender", "Recipient"), which is the same shape.
  if (!/\d/.test(next)) return value;
  if (REF_LABEL.test(next) || SENDER_LABEL.test(next) || AMOUNT_LABEL.test(next)) {
    return value;
  }
  return value + next;
}

function findRef(lines: string[]): string | undefined {
  for (let i = 0; i < lines.length; i += 1) {
    if (!REF_LABEL.test(lines[i])) continue;
    // Usually "Ref No. 20261014BNOR…" — sometimes the label is its own line
    // and the value sits underneath it.
    const after = lines[i].replace(REF_LABEL, " ").replace(/^[\s:.#-]+/, "");
    const here = after.match(REF_VALUE);
    if (here && /\d/.test(here[1])) {
      const endsLine = after.trimEnd().endsWith(here[1]);
      return endsLine ? joinWrappedRef(here[1], lines[i + 1]) : here[1];
    }
    const next = lines[i + 1]?.match(REF_VALUE);
    if (next && /\d/.test(next[1])) {
      const endsLine = lines[i + 1].trimEnd().endsWith(next[1]);
      return endsLine ? joinWrappedRef(next[1], lines[i + 2]) : next[1];
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Sender
 * ------------------------------------------------------------------ */

/** A person or business name: letters and the punctuation names carry. */
const NAME = /^[A-Za-zÑñ][A-Za-zÑñ.'\- ]{2,48}$/;

/** Words that show up next to the label but aren't the name. */
const NAME_NOISE = /\b(account|name|number|no|bank|savings|checking|mobile|wallet)\b/i;

function cleanName(value: string): string | undefined {
  // Mask out the account digits banks print beside the name:
  // "MARIA CLARA SANTOS ****1234" → "MARIA CLARA SANTOS"
  const stripped = value
    .replace(/[*xX•]{2,}\s*\d*/g, " ")
    .replace(/\b\d[\d-]*\b/g, " ")
    .replace(/[:•|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!NAME.test(stripped)) return undefined;
  if (NAME_NOISE.test(stripped)) return undefined;
  if (!/\s/.test(stripped)) return undefined; // single word — too likely a stray label
  return stripped;
}

function findSender(lines: string[]): string | undefined {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!SENDER_LABEL.test(line)) continue;
    // "Send to" contains "to"… and "From" can appear in both halves of a
    // slip. When a line reads as the recipient, it isn't the sender.
    if (RECIPIENT_LABEL.test(line)) continue;
    const after = cleanName(line.replace(SENDER_LABEL, " ").replace(/^[\s:.-]+/, ""));
    if (after) return after;
    const next = lines[i + 1] ? cleanName(lines[i + 1]) : undefined;
    if (next) return next;
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Amount
 * ------------------------------------------------------------------ */

interface Candidate {
  value: number;
  score: number;
}

/**
 * Scores every peso-shaped number on the slip and returns the best.
 *
 * The scoring exists for one specific failure: a slip that reads
 * "Amount ₱20,000.00 / Service fee ₱0.00 / Available balance ₱48,250.00".
 * Taking the biggest number gives the balance; taking the first gives the
 * right answer only by luck of layout. So labels decide, and size only
 * breaks ties.
 */
function findAmount(lines: string[]): number | undefined {
  const candidates: Candidate[] = [];

  lines.forEach((line, i) => {
    const labelled = AMOUNT_LABEL.test(line);
    const barred = NOT_AMOUNT.test(line);
    // A bare number on its own line usually belongs to the label above it.
    const prev = lines[i - 1] ?? "";
    const inherits = !labelled && !barred && !/\d/.test(prev);
    const inheritedLabel = inherits && AMOUNT_LABEL.test(prev);
    const inheritedBar = inherits && NOT_AMOUNT.test(prev);

    for (const match of line.matchAll(MONEY)) {
      const digits = match[1];
      if (!looksLikeMoney(match[0], digits)) continue;
      const value = toNumber(digits);
      if (!Number.isFinite(value) || value <= 0) continue;
      // Above ₱10M it's a reference number that happened to have commas,
      // or a misread. Real wholesale transfers don't reach it.
      if (value > 10_000_000) continue;

      let score = 0;
      if (labelled || inheritedLabel) score += 100;
      if (barred || inheritedBar) score -= 200;
      // ₱0.00 fees are everywhere; a zero transfer is not a thing.
      if (value < 1) score -= 100;
      // Whole hundreds are what cafes actually send.
      if (value % 100 === 0) score += 5;
      candidates.push({ value, score });
    }
  });

  if (!candidates.length) return undefined;
  candidates.sort((a, b) => b.score - a.score || b.value - a.value);
  const best = candidates[0];
  // Everything plausible was a fee or a balance — better to say nothing
  // than to pre-fill a number Joey would have to notice is wrong.
  return best.score < 0 ? undefined : best.value;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/** Does this look like a payment slip at all, rather than a menu photo? */
const SLIP_WORDS =
  /\b(amount|sent|transfer|ref|reference|transaction|successful|received|paid|bank|gcash|maya|instapay|pesonet|bpi|bdo|unionbank|seabank)\b/i;

export function parseSlipText(text: string): ProofAnalysis {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const analysis: ProofAnalysis = {};
  const amount = findAmount(lines);
  if (amount !== undefined) analysis.amount = amount;
  const ref = findRef(lines);
  if (ref) analysis.ref = ref;
  const senderName = findSender(lines);
  if (senderName) analysis.senderName = senderName;
  const date = findDate(lines);
  if (date) analysis.date = date;

  // Nothing readable, or readable but not a payment slip. Either way the
  // UI says so rather than silently offering an empty box.
  if (!Object.keys(analysis).length || !lines.some((l) => SLIP_WORDS.test(l))) {
    return { ...analysis, unreadable: true };
  }
  return analysis;
}
