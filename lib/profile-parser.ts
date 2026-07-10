// Chat-to-profile parsing: a pasted customer message (the team's template
// when they used it, free-form otherwise) → prefilled new-customer fields.
// Pure regex, no network — runs client-side for instant preview. NOTHING is
// created from this directly; the user always confirms an editable form.
//
// Template lines look like "Name: Juan Dela Cruz" — the label matcher wins
// whenever labels are present; the heuristics only fill gaps.

export interface ParsedProfile {
  contactName?: string;
  cafeName?: string;
  phone?: string;
  email?: string;
  address1?: string;
  city?: string;
  province?: string;
  zip?: string;
  /** Lines that looked meaningful but matched nothing — shown as a hint. */
  unmatched: string[];
}

const LABELS: { field: keyof ParsedProfile; re: RegExp }[] = [
  { field: "contactName", re: /^(?:contact\s*(?:person|name)|name|owner|proprietor)\s*[:\-–—]\s*(.+)$/i },
  { field: "cafeName", re: /^(?:cafe|caf[eé]\s*name|company|business(?:\s*name)?|shop|store(?:\s*name)?|brand)\s*[:\-–—]\s*(.+)$/i },
  { field: "phone", re: /^(?:contact\s*(?:no\.?|number)|phone(?:\s*number)?|mobile(?:\s*number)?|cellphone|cp|number|tel)\s*[:\-–—]\s*(.+)$/i },
  { field: "email", re: /^(?:e-?mail(?:\s*address)?)\s*[:\-–—]\s*(.+)$/i },
  { field: "address1", re: /^(?:delivery\s*address|shipping\s*address|address|location)\s*[:\-–—]\s*(.+)$/i },
  { field: "city", re: /^city\s*[:\-–—]\s*(.+)$/i },
  { field: "province", re: /^province\s*[:\-–—]\s*(.+)$/i },
  { field: "zip", re: /^(?:zip|postal)(?:\s*code)?\s*[:\-–—]\s*(.+)$/i },
];

const PH_MOBILE = /(\+?63|0)\s?9\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/;
const ADDRESS_HINTS =
  /\b(st\.?|street|ave\.?|avenue|blvd|road|rd\.?|brgy\.?|barangay|village|subd|subdivision|unit|bldg|building|blk|block|lot|floor|city|tower|purok|sitio|highway|hiway)\b/i;
const CAFE_HINTS = /\b(cafe|caf[eé]|coffee|kape|matcha|bake|brew|kitchen|restaurant|bar|roast|espresso|bakery|deli)\b/i;

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

export function parseProfileMessage(message: string): ParsedProfile {
  const out: ParsedProfile = { unmatched: [] };
  const lines = message.split("\n").map(cleanLine).filter(Boolean);

  for (const line of lines) {
    // 1. Labeled template lines win outright.
    const label = LABELS.find((l) => l.re.test(line));
    if (label) {
      const value = line.match(label.re)![1].trim();
      if (value && !out[label.field]) {
        (out[label.field] as string) = label.field === "phone" ? normalizePhone(value) : value;
      }
      continue;
    }

    // 2. Heuristics for free-form messages — first match per field wins.
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
    if (CAFE_HINTS.test(line) && !out.cafeName && line.length <= 60) {
      out.cafeName = line;
      continue;
    }
    if (!out.contactName && /^[A-Za-zÀ-ÿ.'\- ]{3,50}$/.test(line) && line.split(/\s+/).length <= 5) {
      out.contactName = line;
      continue;
    }
    if (line.length > 2) out.unmatched.push(line);
  }

  // Pull city (and zip) off the tail of a comma-separated address when not
  // labeled — handles both "…, Quezon City" and "…, Quezon City, 1101".
  if (out.address1 && !out.city) {
    const parts = out.address1.split(",").map((p) => p.trim());
    while (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const zipMatch = last.match(/\b\d{4}\b/);
      if (zipMatch && !out.zip) out.zip = zipMatch[0];
      const lastClean = last.replace(/\b\d{4}\b/, "").trim();
      if (lastClean && lastClean.length <= 40 && !/\d/.test(lastClean)) {
        out.city = lastClean;
        parts.pop();
        break;
      }
      if (!lastClean && zipMatch) {
        // The tail was just the zip — drop it and look at the next part.
        parts.pop();
        continue;
      }
      break;
    }
    if (out.city) out.address1 = parts.join(", ");
  }

  return out;
}
