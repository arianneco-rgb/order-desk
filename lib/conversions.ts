// Unit rules (must match how RMC sells):
//   1 pouch = 200g · 1 case = 2kg = 10 pouches · 1 kg = 5 pouches
//   MOQ = 2kg (1 case) per order — anything below is flagged for Joey.
//   Samples are 20g sachets and do not count toward the MOQ.

export const POUCH_GRAMS = 200;
export const POUCHES_PER_CASE = 10;
export const POUCHES_PER_KG = 5;
export const MOQ_POUCHES = POUCHES_PER_CASE; // 2kg = 1 case = 10 pouches

export function pouchesToKg(pouches: number): number {
  return (pouches * POUCH_GRAMS) / 1000;
}

export function kgToPouches(kg: number): number {
  return kg * POUCHES_PER_KG;
}

export function gramsToPouches(grams: number): number {
  return grams / POUCH_GRAMS;
}

/** Split a pouch quantity into full cases + loose pouches. */
export function splitCases(pouches: number): { cases: number; loosePouches: number } {
  const cases = Math.floor(pouches / POUCHES_PER_CASE);
  return { cases, loosePouches: pouches - cases * POUCHES_PER_CASE };
}

function formatKg(kg: number): string {
  const rounded = Math.round(kg * 100) / 100;
  return `${rounded}kg`;
}

function plural(n: number, word: string): string {
  if (n === 1) return `${n} ${word}`;
  return `${n} ${word.endsWith("ch") ? `${word}es` : `${word}s`}`;
}

/**
 * Display a pouch quantity the way the team talks about it:
 *   20 → "2 cases (4kg)" · 5 → "5 pouches (1kg)" · 13 → "1 case + 3 pouches (2.6kg)"
 */
export function formatPouchQty(pouches: number): string {
  const { cases, loosePouches } = splitCases(pouches);
  const kg = formatKg(pouchesToKg(pouches));
  if (cases > 0 && loosePouches > 0) {
    return `${plural(cases, "case")} + ${plural(loosePouches, "pouch")} (${kg})`;
  }
  if (cases > 0) return `${plural(cases, "case")} (${kg})`;
  return `${plural(loosePouches, "pouch")} (${kg})`;
}

export function formatSampleQty(qty: number): string {
  return plural(qty, "sample");
}

/**
 * Reply phrasing for one line: "2 cases of Kasane", "5 pouches of Shizu",
 * "1 case and 3 pouches of Kasane", "2 samples of Takumi".
 */
export function describeLine(title: string, form: "pouch" | "sample", qty: number): string {
  if (form === "sample") return `${plural(qty, "sample")} of ${title}`;
  const { cases, loosePouches } = splitCases(qty);
  if (cases > 0 && loosePouches > 0) {
    return `${plural(cases, "case")} and ${plural(loosePouches, "pouch")} of ${title}`;
  }
  if (cases > 0) return `${plural(cases, "case")} of ${title}`;
  return `${plural(loosePouches, "pouch")} of ${title}`;
}

/** "a, b, and c" (serial comma, natural join). */
export function joinNaturally(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** "₱12,500" · keeps centavos only when non-zero: "₱1,555.50". */
export function formatPeso(amount: number): string {
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  return `₱${amount.toLocaleString("en-PH", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  })}`;
}
