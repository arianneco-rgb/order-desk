// Proof-screenshot reading — Claude vision extracts the amount, reference,
// sender, and date from an uploaded payment screenshot so the UI can compare
// them against the order total instead of Joey eyeballing every image.
//
// Key-gated: without ANTHROPIC_API_KEY this whole module is dormant and
// uploads behave exactly as before. Analysis is best-effort — a failure
// must never block the upload itself (the caller catches and moves on).
//
// Golden rule still applies: this only ANNOTATES the proof. It never
// confirms a payment — that stays Joey's click.

import type { ProofAnalysis } from "./types";

export function proofReaderEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const ANTHROPIC_VERSION = "2023-06-01";
/** Vision extraction is a small, structured task — Haiku is plenty. */
const MODEL = process.env.PROOF_READER_MODEL || "claude-haiku-4-5-20251001";

const PROMPT = `This is a screenshot a cafe sent as proof of a bank transfer (usually BPI, GCash, or InstaPay in the Philippines). Extract what is actually legible in the image and reply with ONLY a JSON object, no other text:

{"amount": <number in PHP, digits only, or null>, "ref": <reference/transaction number as a string, or null>, "senderName": <sender or account name as a string, or null>, "date": <transfer date/time as written, or null>, "unreadable": <true only if this is not a payment slip or nothing is legible>}

Rules: never guess — use null for anything not clearly visible. "amount" is the transfer amount, not the balance or fee.`;

export async function analyzeProof(dataUrl: string): Promise<ProofAnalysis | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,(.+)$/);
  if (!match) return null;
  const mediaType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const base64 = match[2];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const body = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = body.content?.find((b) => b.type === "text")?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { unreadable: true };

  const raw = JSON.parse(jsonMatch[0]) as {
    amount?: number | string | null;
    ref?: string | null;
    senderName?: string | null;
    date?: string | null;
    unreadable?: boolean;
  };

  const amount =
    typeof raw.amount === "number"
      ? raw.amount
      : typeof raw.amount === "string"
        ? Number(raw.amount.replace(/[^\d.]/g, ""))
        : NaN;

  const analysis: ProofAnalysis = {};
  if (Number.isFinite(amount) && amount > 0) analysis.amount = amount;
  if (raw.ref) analysis.ref = String(raw.ref);
  if (raw.senderName) analysis.senderName = String(raw.senderName);
  if (raw.date) analysis.date = String(raw.date);
  if (raw.unreadable || Object.keys(analysis).length === 0) analysis.unreadable = true;
  return analysis;
}
