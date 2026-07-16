// Chat-to-profile parsing (feedback round 4) — a pasted customer message →
// prefilled Shopify-profile fields. Handles all three shapes the team sees:
//
//  1. The labeled template:      "Name: Juan / Contact number: 0917… /
//     Cafe/Company Name: … / Delivery Address with barangay: …"
//     (labels may carry suffix words before the colon, and the value may sit
//     on the NEXT line when clients answer under each label)
//  2. Unlabeled line-by-line:    "Jericho Liao ⏎ 09171077776 ⏎ Ritual
//     Matcha ⏎ 173 Mariano Marcos St" — classified by pattern + position
//  3. Missing pieces (e.g. no cafe yet) — left empty and FLAGGED by the UI,
//     never guessed.
//
// Pure regex, no network — runs client-side for instant preview. NOTHING is
// created from this directly; the user always confirms an editable form.

import { findPhLocation } from "./ph-locations";

export interface ParsedProfile {
  /** Full name as given; firstName/lastName are the derived split. */
  contactName?: string;
  firstName?: string;
  lastName?: string;
  cafeName?: string;
  phone?: string;
  email?: string;
  address1?: string;
  /** Derived from the address via lib/ph-locations.ts when recognisable. */
  city?: string;
  province?: string;
  zip?: string;
  /** Lines that looked meaningful but matched nothing — usually the order. */
  unmatched: string[];
}

type Field = "contactName" | "cafeName" | "phone" | "email" | "address1" | "city" | "province" | "zip";

// Label matchers: anchored at line start, tolerate suffix words before the
// separator ("Delivery Address with barangay:", "Cafe/Company Name:").
const LABELS: { field: Field; re: RegExp }[] = [
  { field: "phone", re: /^(?:contact\s*(?:no\.?|number|#)?|phone(?:\s*number)?|mobile(?:\s*(?:no\.?|number))?|cell(?:phone)?|cp|tel|viber)[^:：\-–—]*[:：\-–—]\s*(.*)$/i },
  { field: "email", re: /^e-?mail[^:：\-–—]*[:：\-–—]\s*(.*)$/i },
  { field: "cafeName", re: /^(?:cafe|caf[eé]|coffee\s*shop|company|business|shop|store|brand)[^:：\-–—]*[:：\-–—]\s*(.*)$/i },
  { field: "address1", re: /^(?:delivery\s*|shipping\s*|complete\s*|full\s*)?(?:address|location)[^:：\-–—]*[:：\-–—]\s*(.*)$/i },
  { field: "city", re: /^city[^:：\-–—]*[:：\-–—]\s*(.*)$/i },
  { field: "province", re: /^(?:province|region)[^:：\-–—]*[:：\-–—]\s*(.*)$/i },
  { field: "zip", re: /^(?:zip|postal)[^:：\-–—]*[:：\-–—]\s*(.*)$/i },
  // "Name:" LAST — "Cafe/Company Name:" must hit the cafe matcher first.
  { field: "contactName", re: /^(?:full\s*)?(?:name|owner|contact\s*person)[^:：\-–—]*[:：\-–—]\s*(.*)$/i },
];

const PH_MOBILE = /(\+?63|0)\s?9\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/;
const ADDRESS_HINTS =
  /\b(st\.?|street|ave\.?|avenue|blvd|road|rd\.?|brgy\.?|barangay|village|subd|subdivision|unit|bldg|building|blk|block|lot|floor|city|tower|purok|sitio|highway|hiway|#\d)\b/i;
const CAFE_HINTS = /\b(cafe|caf[eé]|coffee|kape|matcha|bake|brew|kitchen|restaurant|bar|roast|espresso|bakery|deli|opc|corp|inc)\b/i;
// The team's own request message, if pasted along with the reply — drop it.
const REQUEST_NOISE = /may i ask|customer profile|thank you/i;

function cleanLine(line: string): string {
  return line
    .replace(/^\s*\[[^\]]{4,40}\]\s*/, "") // "[timestamp]" prefixes from chat exports
    .replace(/^[•\-*>\s]+/, "")
    .trim();
}

/** Normalize a PH mobile to +639… (what Shopify's phone validation wants). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+63")) return digits;
  if (digits.startsWith("63")) return `+${digits}`;
  if (digits.startsWith("09")) return `+63${digits.slice(1)}`;
  return raw.trim();
}

/** "Juan Miguel Dela Cruz" → first "Juan Miguel", last "Dela Cruz" (best effort). */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: full.trim(), lastName: "" };
  // Keep common surname particles attached ("Dela Cruz", "De Leon", "San Jose").
  const particleAt = parts.findIndex(
    (p, i) => i > 0 && i < parts.length - 1 && /^(dela?|del|de|san|sta\.?|santa|santo|van|von)$/i.test(p)
  );
  const splitAt = particleAt > 0 ? particleAt : parts.length - 1;
  return {
    firstName: parts.slice(0, splitAt).join(" "),
    lastName: parts.slice(splitAt).join(" "),
  };
}

function looksLikePersonOrShopName(line: string): boolean {
  return /^[A-Za-zÀ-ÿ0-9.&'’\- ]{2,60}$/.test(line) && line.split(/\s+/).length <= 6 && !/\d{4,}/.test(line);
}

export function parseProfileMessage(message: string): ParsedProfile {
  const out: ParsedProfile = { unmatched: [] };
  const rawLines = message.split("\n").map(cleanLine).filter(Boolean);

  // ── Pass 1: labeled lines (values inline OR on the following line) ──────
  const consumed = new Set<number>();
  for (let i = 0; i < rawLines.length; i++) {
    if (consumed.has(i)) continue;
    const line = rawLines[i];
    if (REQUEST_NOISE.test(line) && !LABELS.some((l) => l.re.test(line))) {
      consumed.add(i);
      continue;
    }
    const label = LABELS.find((l) => l.re.test(line));
    if (!label) continue;

    let value = line.match(label.re)![1].trim();
    consumed.add(i);
    // "Name:" with the answer on the next line.
    if (!value && i + 1 < rawLines.length && !LABELS.some((l) => l.re.test(rawLines[i + 1]))) {
      value = rawLines[i + 1].trim();
      consumed.add(i + 1);
    }
    if (value && !out[label.field]) {
      (out[label.field] as string) = label.field === "phone" ? normalizePhone(value) : value;
    }
  }

  // ── Pass 2: pattern + positional inference on the leftover lines ────────
  const leftovers: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (consumed.has(i)) continue;
    const line = rawLines[i];

    const phone = line.match(PH_MOBILE);
    if (phone && !out.phone) {
      out.phone = normalizePhone(phone[0]);
      const rest = line.replace(phone[0], "").replace(/[,·|]/g, " ").trim();
      if (rest.length > 2 && !out.contactName && !ADDRESS_HINTS.test(rest)) out.contactName = rest;
      continue;
    }
    const email = line.match(EMAIL);
    if (email && !out.email) {
      out.email = email[0];
      continue;
    }
    if (ADDRESS_HINTS.test(line) && !out.address1) {
      out.address1 = line;
      continue;
    }
    leftovers.push(line);
  }

  // Leftovers are names/cafes: a cafe-flavored line is the cafe; otherwise
  // FIRST person-shaped line = name, the NEXT one = cafe (Joey's example
  // order: name ⏎ phone ⏎ cafe ⏎ address).
  for (const line of leftovers) {
    if (!out.cafeName && CAFE_HINTS.test(line) && line.length <= 60 && out.contactName) {
      out.cafeName = line;
      continue;
    }
    if (!out.contactName && looksLikePersonOrShopName(line)) {
      out.contactName = line;
      continue;
    }
    if (!out.cafeName && looksLikePersonOrShopName(line)) {
      out.cafeName = line;
      continue;
    }
    if (line.length > 2) out.unmatched.push(line);
  }

  // ── Derivation (the fields NOT in the template) ─────────────────────────
  if (out.contactName) {
    const { firstName, lastName } = splitName(out.contactName);
    out.firstName = firstName;
    out.lastName = lastName;
  }
  if (out.address1) {
    if (!out.zip) {
      const zips = out.address1.match(/\b\d{4}\b/g);
      if (zips) out.zip = zips[zips.length - 1];
    }
    if (!out.city) {
      const loc = findPhLocation(out.address1);
      if (loc) {
        out.city = loc.city;
        if (!out.province) out.province = loc.province;
      }
    } else if (!out.province) {
      out.province = findPhLocation(out.city)?.province;
    }
  }
  if (out.phone) out.phone = normalizePhone(out.phone);

  return out;
}
