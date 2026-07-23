// Fallback keyword/regex parser (used until ANTHROPIC_API_KEY is set).
// Turns a pasted Viber message into order lines. All incoming messages are
// treated as orders — there is no "is this an order?" branch.
//
// Unit rules: 1 pouch = 200g · 1 case = 10 pouches = 2kg · 1 kg = 5 pouches.
// Samples are 20g sachets. Anything uncertain lowers confidence so the order
// is flagged "Needs review" instead of silently guessing.

import type { CatalogProduct, ItemForm, OrderItem } from "./types";
import { POUCHES_PER_KG, gramsToPouches, plural } from "./conversions";

export interface ParseResult {
  items: OrderItem[];
  /** HARD reasons — genuine ambiguity that routes the order to "Needs review". */
  reasons: string[];
  /** SOFT notes — routine reads (bare→pouch, box→case) shown quietly, never flagged. */
  softNotes: string[];
}

const TAGALOG_NUMBERS: Record<string, number> = {
  isa: 1, isang: 1, dalawa: 2, dalawang: 2, tatlo: 3, tatlong: 3,
  apat: 4, apat_na: 4, lima: 5, limang: 5, anim: 6, pito: 7, pitong: 7,
  walo: 8, walong: 8, siyam: 9, sampu: 10, sampung: 10,
};

const WORD_NUMBERS: Record<string, number> = {
  one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  ...TAGALOG_NUMBERS,
};

interface QtyMatch {
  pouches?: number;
  samples?: number;
  confidence: number;
  matched: boolean;
  /** Read from a bare number with no unit (spec: bare → pouch) — soft-noted. */
  bare?: boolean;
}

function parseNumberWord(word: string): number | null {
  const n = Number(word);
  if (Number.isFinite(n) && n > 0) return n;
  return WORD_NUMBERS[word] ?? null;
}

const NUM = "(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|isa(?:ng)?|dalawa(?:ng)?|tatlo(?:ng)?|apat|lima(?:ng)?|anim|pito(?:ng)?|walo(?:ng)?|siyam|sampu(?:ng)?)";

// Same quantity phrases as extractQty below, in the same priority order,
// combined into one alternation so a whole segment can be scanned for EVERY
// quantity mention it contains (not just the first) — this is how
// splitRepeatedQuantities finds where a second un-punctuated item begins.
const QTY_SPAN_SOURCE = [
  `${NUM}\\s*(?:x\\s*)?(?:cases?|cs|box(?:es)?)\\b`,
  `(?:a\\s+)?case\\s+of\\b`,
  `${NUM}\\s*(?:x\\s*)?(?:pouch(?:es)?|packs?|bags?|pcs?|pieces?)\\b`,
  `${NUM}\\s*(?:x\\s*)?(?:samples?|sachets?|trial)\\b`,
  `samples?\\b`,
  `\\d+\\s*x\\s*\\d+(?:\\.\\d+)?\\s*(?:kgs?|kilos?|g)\\b`,
  `${NUM}\\s*(?:kgs?|kilos?|kilograms?)\\b`,
  `\\d+(?:\\.\\d+)?\\s*g(?:rams?)?\\b`,
  `(?:^|\\s)\\d+(?=\\s|$)`,
].join("|");

/**
 * Splits one segment into several when it has more than one quantity
 * mention with no punctuation between them — "2 shiori 1 kasane" typed
 * without a comma. Without this, findProduct/extractQty each only ever
 * return a single winner per segment, so the second item is silently
 * dropped. Segments with 0-1 quantity mentions pass through unchanged.
 */
function splitRepeatedQuantities(segment: string): string[] {
  const spanRe = new RegExp(QTY_SPAN_SOURCE, "gi");
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = spanRe.exec(segment))) {
    // The bare-number branch's leading `(?:^|\s)` can include a space
    // before the digit — start the piece at the digit, not the space.
    starts.push(m.index + (m[0].length - m[0].trimStart().length));
    if (m.index === spanRe.lastIndex) spanRe.lastIndex++;
  }
  if (starts.length < 2) return [segment];
  return starts
    .map((start, i) =>
      segment
        .slice(i === 0 ? 0 : start, i + 1 < starts.length ? starts[i + 1] : segment.length)
        .trim()
    )
    .filter(Boolean);
}

/** Extract a quantity from one message segment. */
function extractQty(segment: string): QtyMatch {
  // "2 cases", "1 case", "case of ..." (implicit 1)
  let m = segment.match(new RegExp(`${NUM}\\s*(?:x\\s*)?(?:cases?|cs|box(?:es)?)\\b`));
  if (m) {
    const n = parseNumberWord(m[1]);
    if (n) return { pouches: Math.round(n * 10), confidence: 1, matched: true };
  }
  if (/\b(?:a\s+)?case\s+of\b/.test(segment)) {
    return { pouches: 10, confidence: 0.9, matched: true };
  }

  // "5 pouches", "3 packs", "2 bags", "4 pcs"
  m = segment.match(new RegExp(`${NUM}\\s*(?:x\\s*)?(?:pouch(?:es)?|packs?|bags?|pcs?|pieces?)\\b`));
  if (m) {
    const n = parseNumberWord(m[1]);
    if (n) return { pouches: Math.round(n), confidence: 1, matched: true };
  }

  // "2 samples", "3 sachets", "2 trial packs"
  m = segment.match(new RegExp(`${NUM}\\s*(?:x\\s*)?(?:samples?|sachets?|trial)\\b`));
  if (m) {
    const n = parseNumberWord(m[1]);
    if (n) return { samples: Math.round(n), confidence: 1, matched: true };
  }
  if (/\bsamples?\b/.test(segment)) {
    return { samples: 1, confidence: 0.6, matched: true };
  }

  // Multiplier phrasing: "2 x 200g", "3x1kg" — N units of M grams/kilos.
  m = segment.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kgs?|kilos?|g)\b/);
  if (m) {
    const count = Number(m[1]);
    const size = Number(m[2]);
    const grams = m[3].startsWith("k") ? size * 1000 : size;
    if (count > 0 && grams > 0) {
      if (grams <= 50) {
        return { samples: count, confidence: 0.8, matched: true };
      }
      const pouches = count * gramsToPouches(grams);
      const rounded = Math.round(pouches);
      return {
        pouches: Math.max(1, rounded),
        confidence: Math.abs(pouches - rounded) < 1e-9 ? 0.95 : 0.5,
        matched: true,
      };
    }
  }

  // "4kg", "2 kilos", "1.5 kg"
  m = segment.match(new RegExp(`${NUM}\\s*(?:kgs?|kilos?|kilograms?)\\b`));
  if (m) {
    const n = parseNumberWord(m[1]);
    if (n) {
      const pouches = n * POUCHES_PER_KG;
      const rounded = Math.round(pouches);
      return {
        pouches: Math.max(1, rounded),
        confidence: Math.abs(pouches - rounded) < 1e-9 ? 1 : 0.5,
        matched: true,
      };
    }
  }

  // "600g", "200 grams", "20g" (20g = sample sachet size)
  m = segment.match(/(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/);
  if (m) {
    const grams = Number(m[1]);
    if (grams > 0) {
      if (grams <= 50) return { samples: 1, confidence: 0.7, matched: true };
      const pouches = gramsToPouches(grams);
      const rounded = Math.round(pouches);
      return {
        pouches: Math.max(1, rounded),
        confidence: Math.abs(pouches - rounded) < 1e-9 ? 1 : 0.5,
        matched: true,
      };
    }
  }

  // Bare number ("2 kasane" / "kasane 2") — spec rule: bare → pouches. This
  // is an accepted conversion, not an uncertain guess, so it's confident
  // (a soft note is surfaced instead of a review flag).
  m = segment.match(/(?:^|\s)(\d+)(?:\s|$)/);
  if (m) {
    const n = Number(m[1]);
    if (n > 0 && n <= 200) {
      return { pouches: n, confidence: 0.85, matched: true, bare: true };
    }
  }

  return { confidence: 0, matched: false };
}

function findProduct(segment: string, catalog: CatalogProduct[]): CatalogProduct | null {
  // Longest alias wins so "koyo hojicha" beats "koyo" and "hojicha".
  let best: CatalogProduct | null = null;
  let bestLen = 0;
  for (const product of catalog) {
    for (const alias of product.aliases) {
      if (segment.includes(alias) && alias.length > bestLen) {
        best = product;
        bestLen = alias.length;
      }
    }
  }
  return best;
}

/**
 * Strip whole-conversation noise BEFORE segmentation, so Joey can paste an
 * entire Viber thread instead of trimming it down to just the order lines:
 *  - "[10/07/26, 9:15 PM]"-style export timestamps (split-unsafe: they
 *    contain commas, so they must go before the comma split)
 *  - lines quoting OUR OWN replies — a pasted "The total is ₱X for 2 cases
 *    of Kasane!" must never re-add those 2 cases as a new line item
 */
function precleanConversation(message: string): string {
  const OWN_REPLY_MARKERS = [
    "the total is",
    "bank of the philippine islands",
    "account number",
    "2561013163",
    "we will process your order",
    "lead time is",
    "payment received",
    "ready for pickup",
    "tracking number",
  ];
  return message
    .split("\n")
    .map((line) => {
      const noTimestamp = line.replace(/^\s*\[[^\]]{4,40}\]\s*/, "");
      // Strip the "Sender Name:" prefix ONLY on lines that had a timestamp —
      // a hand-typed order line like "kasane: 2" must never lose its product.
      return noTimestamp === line
        ? line
        : noTimestamp.replace(/^[^:\n]{1,40}:\s*/, "");
    })
    .filter((line) => {
      const l = line.toLowerCase();
      return !OWN_REPLY_MARKERS.some((m) => l.includes(m));
    })
    .join("\n");
}

/** Segment-level conversation noise — skipped silently, never flagged. */
function isConversationNoise(segment: string): boolean {
  return (
    /^\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/.test(segment) || // bare time
    /^\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?$/.test(segment) || // bare date
    /\b(\+?63|0)9\d{2}[- ]?\d{3}[- ]?\d{4}\b/.test(segment) || // contains a PH mobile number
    /^https?:\/\//.test(segment) || // link
    /^[\p{Emoji}\p{P}\s]+$/u.test(segment) // emoji/punctuation only
  );
}

/** Split a message into candidate line segments. */
function segmentMessage(message: string): string[] {
  return precleanConversation(message)
    .toLowerCase()
    .split(/\n|,|;|\+|&|\band\b/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap(splitRepeatedQuantities);
}

/** True when the segment looks like it wanted to order something we missed. */
function looksOrderLike(segment: string): boolean {
  return /\d/.test(segment) || /\b(case|pouch|pack|kg|kilo|sample|order)\b/.test(segment);
}

const NOISE_PATTERNS = [
  /^(hi|hello|hey|good\s*(am|pm|morning|afternoon|evening)|thank(s| you).*|pa[- ]?order|order|pwede|paki|please|pls|po|opo|yes|sige|same day.*|asap.*)(\s+(po|naman|ulit|please|pls|sana))*$/,
];

export function parseMessage(
  message: string,
  catalog: CatalogProduct[]
): ParseResult {
  const reasons: string[] = [];
  const softNotes: string[] = [];
  const items: OrderItem[] = [];
  const segments = segmentMessage(message);

  // A qty with no product ("1 case" in "1 case and 3 pouches of kasane")
  // carries over to the next segment that names a product.
  let pendingQty: QtyMatch | null = null;

  for (const segment of segments) {
    if (isConversationNoise(segment)) continue;
    const product = findProduct(segment, catalog);
    const qty = extractQty(segment);

    if (!product) {
      if (qty.matched && (qty.pouches || qty.samples)) {
        pendingQty = qty;
      } else if (
        looksOrderLike(segment) &&
        !NOISE_PATTERNS.some((p) => p.test(segment))
      ) {
        reasons.push(`Could not read: “${segment}”`);
      }
      continue;
    }

    let pouches = qty.pouches ?? 0;
    let samples = qty.samples ?? 0;
    let confidence = qty.matched ? qty.confidence : 0;

    // Segment names a product but no quantity → assume 1 pouch, flag it.
    if (!qty.matched) {
      if (/\bsamples?\b/.test(segment)) {
        samples = 1;
        confidence = 0.6;
      } else {
        pouches = 1;
        confidence = 0.3;
        reasons.push(`No quantity found for ${product.title} — assumed 1 pouch`);
      }
    }

    if (pendingQty) {
      pouches += pendingQty.pouches ?? 0;
      samples += pendingQty.samples ?? 0;
      confidence = Math.min(confidence || 1, pendingQty.confidence, 0.8);
      pendingQty = null;
    }

    // Soft annotations (spec Stage 4): routine conversions, shown not flagged.
    if (qty.bare && pouches > 0) {
      softNotes.push(`${product.title}: read "${qty.pouches}" as ${plural(qty.pouches ?? 0, "pouch")}.`);
    } else if (/\bbox(?:es)?\b/.test(segment) && pouches > 0) {
      softNotes.push(`${product.title}: read "box" as case.`);
    }

    if (pouches > 0) upsert(items, product.key, "pouch", pouches, confidence);
    if (samples > 0) upsert(items, product.key, "sample", samples, confidence);
  }

  // "the usual" / repeat orders — the fallback parser can't see history.
  if (/\b(the )?usual\b|same as (last|before)|ulit\b|same order/i.test(message)) {
    reasons.push(
      "Looks like a repeat order (“the usual”) — check this cafe's history and fill the lines in manually."
    );
  }

  if (items.length === 0) {
    reasons.push("No line items recognized — add them manually.");
  }

  for (const item of items) {
    if (item.confidence < 0.7) {
      reasons.push("Low-confidence quantity on one or more lines — double-check.");
      break;
    }
  }

  return { items, reasons, softNotes };
}

function upsert(
  items: OrderItem[],
  productKey: string,
  form: ItemForm,
  qty: number,
  confidence: number
) {
  const existing = items.find((i) => i.productKey === productKey && i.form === form);
  if (existing) {
    existing.qty += qty;
    existing.confidence = Math.min(existing.confidence, confidence);
  } else {
    items.push({ productKey, form, qty, confidence });
  }
}
