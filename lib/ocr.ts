// Reads payment screenshots in Joey's own browser, with no API key and no
// per-image cost.
//
// Why client-side: Order Desk runs on Vercel, where a serverless function
// is billed by the second and capped at a few hundred MB — a bad home for
// a 5MB OCR engine that chews CPU. The screenshot is already sitting in
// the browser as a data URL, so the work happens where the image already
// is, costs nothing, and never leaves her laptop.
//
// Everything here is best-effort. A blocked CDN, a slow connection or an
// illegible slip all end the same way: no pre-fill, and Joey types the
// amount exactly as she did before. OCR must never be able to stop an
// upload.
//
// Tesseract is a real downgrade from Claude vision on messy images —
// see lib/proof-reader.ts, which does the same job better for about a
// centavo and a half per screenshot if the key is ever set.

import { parseSlipText } from "./slip-parse";
import type { ProofAnalysis } from "./types";

/**
 * First use pulls the worker, the wasm core and the English training data
 * (~5MB) from jsDelivr; tesseract.js then keeps them in IndexedDB, so
 * every later screenshot is local. Generous, because that download on a
 * café-office connection is the slow part — not the recognition.
 */
const INIT_TIMEOUT_MS = 60_000;
const RECOGNISE_TIMEOUT_MS = 30_000;

type TesseractWorker = {
  recognize: (image: string) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<unknown>;
};

/** One worker for the whole session — loading it is the expensive part. */
let workerPromise: Promise<TesseractWorker> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function startWorker(): Promise<TesseractWorker> {
  // Imported here rather than at module scope so the engine is only
  // fetched by browsers that actually reach the payment pane, and never
  // ends up in the server bundle.
  const loading = import("tesseract.js").then(({ createWorker }) =>
    createWorker("eng")
  ) as Promise<TesseractWorker>;

  return withTimeout(loading, INIT_TIMEOUT_MS, "Loading the screenshot reader").catch(
    (err) => {
      // Let the next attempt try again from scratch — a failed load is
      // usually a dropped connection, not a permanent state.
      workerPromise = null;
      throw err;
    }
  );
}

/**
 * Starts fetching the engine without reading anything yet.
 *
 * Called when Joey opens the file picker: choosing a screenshot takes her
 * a few seconds, which is most of the first-load download. By the time
 * she's picked one it's usually ready.
 */
export function warmUpOcr(): void {
  if (typeof window === "undefined") return;
  if (!workerPromise) workerPromise = startWorker();
  // Nothing waits on this; a failure here just means the real call retries.
  void workerPromise.catch(() => {});
}

/**
 * Reads one screenshot. Returns null when the engine couldn't run at all
 * (so the UI can stay quiet) versus `{unreadable: true}` when it ran and
 * the image wasn't a legible slip (so the UI can say so).
 */
export async function readSlip(dataUrl: string): Promise<ProofAnalysis | null> {
  if (typeof window === "undefined") return null;
  try {
    if (!workerPromise) workerPromise = startWorker();
    const worker = await workerPromise;
    const { data } = await withTimeout(
      worker.recognize(dataUrl),
      RECOGNISE_TIMEOUT_MS,
      "Reading the screenshot"
    );
    return parseSlipText(data.text);
  } catch (err) {
    console.warn("Local OCR failed — Joey types the amount instead.", err);
    return null;
  }
}
