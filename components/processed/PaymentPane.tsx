"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BpiMatch, Order, ProofOfPayment } from "@/lib/types";
import { formatPeso } from "@/lib/conversions";
import { CopyButton } from "@/components/CopyButton";
import { TestBadge } from "@/components/TestBadge";
import { Modal } from "@/components/Modal";
import { FULFILMENT_TEMPLATES, fulfilmentReplyFor } from "@/lib/templates";
import { formatTime } from "./format";

const LARGE_PAYMENT_THRESHOLD = 100000;

/** Right pane: proof upload → BPI match → confirm payment → paid replies. */
export function PaymentPane({
  order,
  onOrderUpdate,
}: {
  order: Order | null;
  onOrderUpdate: (order: Order) => void;
}) {
  const [simulated, setSimulated] = useState(false);
  const [checking, setChecking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinct from "no match yet" — a genuine failure to reach the inbox
  // (bad Apps Script deployment/secret, wrong Gmail account, etc.), so it's
  // never silently indistinguishable from a search that ran and found
  // nothing. A 409 (another money-route action mid-flight) is excluded —
  // that's benign lock contention, not a real error, and clears itself on
  // the next poll.
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<ProofOfPayment | null>(null);
  const [candidates, setCandidates] = useState<BpiMatch[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const orderId = order?.id ?? null;
  const match = order?.payment.bpiMatch ?? null;
  const isPaid = order?.status === "paid";
  const proofs = order?.payment.proofs ?? [];

  // Reset per-order UI state when the selection changes.
  useEffect(() => {
    setManualOverride(false);
    setError(null);
    setSimulated(false);
    setInboxError(null);
    setLightbox(null);
    setCandidates([]);
    if (fileRef.current) fileRef.current.value = "";
  }, [orderId]);

  const checkInbox = useCallback(async () => {
    if (!orderId) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/bpi-match`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status !== 409) {
          setInboxError(
            typeof data.error === "string" ? data.error : `Couldn't check the inbox (HTTP ${res.status}).`
          );
        }
        return;
      }
      setInboxError(null);
      setSimulated(!!data.simulated);
      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      if (data.order) onOrderUpdate(data.order);
    } catch {
      setInboxError("Couldn't reach Order Desk to check the inbox — check your connection.");
    } finally {
      setChecking(false);
    }
  }, [orderId, onOrderUpdate]);

  async function pickCandidate(matchKey: string) {
    if (!orderId) return;
    setPicking(matchKey);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/bpi-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Couldn't apply that transaction (HTTP ${res.status}).`);
      }
      onOrderUpdate(data.order);
      setCandidates([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't apply that transaction.");
    } finally {
      setPicking(null);
    }
  }

  // Check on select, then poll every 5s while this order is selected & unmatched.
  const shouldPoll =
    !!order && order.status === "draft_created" && !match && !order.payment.confirmed;
  useEffect(() => {
    if (!shouldPoll) return;
    void checkInbox();
    const timer = setInterval(() => void checkInbox(), 5000);
    return () => clearInterval(timer);
  }, [shouldPoll, checkInbox]);

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Clear the input so choosing the same file again still fires onChange.
    e.target.value = "";
    if (!file || !orderId) return;
    setUploading(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/proof`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl: reader.result, fileName: file.name }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `Upload failed (HTTP ${res.status}).`);
        }
        onOrderUpdate(data.order);
        void checkInbox(); // re-check the inbox right after proof upload
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't upload the proof."
        );
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      setUploading(false);
      setError("Couldn't read that file.");
    };
    reader.readAsDataURL(file);
  }

  async function removeProof(index: number) {
    if (!orderId) return;
    setRemovingIndex(index);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/proof`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Remove failed (HTTP ${res.status}).`);
      }
      onOrderUpdate(data.order);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't remove the proof."
      );
    } finally {
      setRemovingIndex(null);
    }
  }

  async function confirmPayment() {
    if (!order) return;
    if (
      order.total > LARGE_PAYMENT_THRESHOLD &&
      !window.confirm(
        "₱100k+ payment — double-checked the transfer? (Large/delayed payments need a second look.)"
      )
    ) {
      return;
    }
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/confirm-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manualOverride ? { manualOverride: true } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Couldn't confirm (HTTP ${res.status}).`);
      }
      onOrderUpdate(data.order);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't confirm the payment."
      );
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-forest-500">
        Payment verification
      </h2>

      {!order && (
        <p className="mt-4 rounded-lg border-2 border-dashed border-forest-200 p-6 text-center text-sm text-forest-500">
          Select an order on the left to verify its payment.
        </p>
      )}

      {order && order.status === "processed" && (
        <div className="mt-4">
          <p className="text-sm">
            <span className="font-semibold text-forest-900">{order.company}</span>{" "}
            <span className="text-forest-500">· back in the Queue</span>
          </p>
          <p className="mt-3 rounded-lg border-2 border-dashed border-forest-200 p-6 text-center text-sm text-forest-500">
            This order isn&apos;t finalized (its draft was invalidated by an
            edit, or none was created yet). Finish it on the Queue — payment
            verification unlocks once the draft exists.
          </p>
        </div>
      )}

      {order && order.status === "draft_created" && (
        <div className="mt-4 space-y-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-forest-900">
            {order.company}
            {order.isTest && <TestBadge />}
          </p>

          {/* Proof from Viber */}
          <div>
            <p className="text-sm font-semibold text-forest-800">
              Proof from Viber
            </p>
            <label className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-forest-300 bg-forest-50/50 px-4 py-5 text-center transition-colors hover:border-forest-400 hover:bg-forest-50">
              <span className="text-sm font-medium text-forest-800">
                {uploading
                  ? "Uploading…"
                  : proofs.length
                    ? "Add another payment screenshot"
                    : "Upload / paste payment screenshot"}
              </span>
              <span className="mt-0.5 text-xs text-forest-500">
                Viber screenshot or bank slip (image)
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={onFileChosen}
                disabled={uploading}
                className="sr-only"
              />
            </label>
            {proofs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {proofs.map((proof, i) => (
                  <div key={i} className="group relative">
                    <button
                      type="button"
                      onClick={() => setLightbox(proof)}
                      title={proof.name}
                      className="block h-14 w-14 overflow-hidden rounded-md border border-forest-200 transition-colors hover:border-forest-400"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={proof.url}
                        alt={proof.name}
                        className="h-full w-full object-cover"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeProof(i)}
                      disabled={removingIndex !== null}
                      aria-label={`Remove ${proof.name}`}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-forest-200 bg-white text-xs font-bold text-red-600 shadow-sm transition-colors hover:bg-red-50 disabled:opacity-50"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* What Claude read off each screenshot (only when the reader ran). */}
            {proofs.some((p) => p.analysis) && (
              <div className="mt-2 space-y-1.5">
                {proofs.map((proof, i) => {
                  const a = proof.analysis;
                  if (!a) return null;
                  if (a.unreadable) {
                    return (
                      <p key={i} className="text-xs text-forest-500">
                        {proof.name}: couldn&apos;t read this image — check it by eye.
                      </p>
                    );
                  }
                  const amountMatches =
                    a.amount !== undefined &&
                    order !== null &&
                    Math.abs(a.amount - order.total) < 0.01;
                  return (
                    <div
                      key={i}
                      className={
                        a.amount === undefined
                          ? "rounded-md bg-forest-50 px-2.5 py-1.5 text-xs text-forest-700"
                          : amountMatches
                            ? "rounded-md border border-forest-300 bg-forest-50 px-2.5 py-1.5 text-xs text-forest-800"
                            : "rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900"
                      }
                    >
                      <span className="font-semibold">
                        {a.amount !== undefined
                          ? `Screenshot reads ${formatPeso(a.amount)}`
                          : "Screenshot read (no amount legible)"}
                      </span>
                      {a.amount !== undefined &&
                        (amountMatches
                          ? " — matches the order total ✓"
                          : ` — order total is ${formatPeso(order?.total ?? 0)} ⚠️`)}
                      {(a.senderName || a.ref || a.date) && (
                        <span className="text-forest-600">
                          {a.senderName ? ` · ${a.senderName}` : ""}
                          {a.ref ? ` · ref ${a.ref}` : ""}
                          {a.date ? ` · ${a.date}` : ""}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* BPI payment verification */}
          <div>
            <p className="text-sm font-semibold text-forest-800">
              BPI payment verification
            </p>
            {match ? (
              <div className="mt-2 rounded-lg border border-forest-300 bg-forest-50 p-3">
                <p className="flex items-center justify-between gap-2 text-sm font-semibold text-forest-800">
                  Transfer received
                  <span className="flex items-center gap-1.5">
                    {simulated && (
                      <span className="rounded bg-forest-200 px-1.5 py-0.5 text-[11px] font-medium text-forest-800">
                        simulated
                      </span>
                    )}
                    <span className="rounded bg-forest-700 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                      {match.matchedBy === "reference" ? "Ref match" : "Match"}
                    </span>
                  </span>
                </p>
                <p className="mt-1.5 text-sm font-semibold text-forest-900">
                  {formatPeso(match.amount)}
                  {match.fromAccountLast4 ? ` · account ending in ${match.fromAccountLast4}` : ""}
                  {match.sourceBank ? ` (${match.sourceBank})` : ""}
                </p>
                <p className="mt-0.5 text-xs text-forest-600">
                  {match.matchedBy === "reference" ? "✓ " : ""}Ref {match.ref} · {formatTime(match.date) || match.date}
                  {order.shopifyDraftName
                    ? ` · matched to Draft ${order.shopifyDraftName.replace(/ \((mock|test)\)$/, "")}`
                    : ""}
                </p>
                {!match.settled && (
                  <p className="mt-1.5 rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
                    ⚠️ Not yet credited — this is a pre-advice (PESONet says "will be credited within the day"), the money isn't in the account yet.
                  </p>
                )}
                {match.warnings.length > 0 && (
                  <p className="mt-1.5 rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
                    ⚠️ {match.warnings.join(", ")}
                  </p>
                )}
              </div>
            ) : inboxError ? (
              <div className="mt-2 rounded-lg border border-red-300 bg-red-50 p-3">
                <p className="text-sm font-semibold text-red-900">Couldn&apos;t check the inbox</p>
                <p className="mt-0.5 text-sm text-red-700">{inboxError}</p>
                <button
                  type="button"
                  onClick={() => void checkInbox()}
                  disabled={checking}
                  className="mt-2 rounded-md border border-red-400 bg-white px-2.5 py-1 text-xs font-semibold text-red-900 transition-colors hover:bg-red-100 disabled:opacity-50"
                >
                  {checking ? "Checking…" : "Try again"}
                </button>
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm text-amber-900">
                  No exact amount match yet — verify manually or wait.
                </p>
                <button
                  type="button"
                  onClick={() => void checkInbox()}
                  disabled={checking}
                  className="mt-2 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-50"
                >
                  {checking ? "Checking…" : "Re-check inbox"}
                </button>

                {candidates.length > 0 && (
                  <div className="mt-3 border-t border-amber-200 pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                      Or pick one manually
                    </p>
                    <div className="mt-1.5 space-y-1.5">
                      {candidates.map((c) => (
                        <div
                          key={c.matchKey}
                          className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-white px-2.5 py-1.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-forest-900">
                              {formatPeso(c.amount)}
                              {c.fromAccountLast4 ? ` · ···${c.fromAccountLast4}` : ""}
                            </p>
                            <p className="truncate text-[11px] text-forest-500">
                              Ref {c.ref} · {formatTime(c.date) || c.date}
                              {!c.settled ? " · not yet credited" : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void pickCandidate(c.matchKey)}
                            disabled={picking !== null}
                            className="shrink-0 rounded-md border border-forest-300 bg-white px-2 py-1 text-[11px] font-semibold text-forest-800 transition-colors hover:bg-forest-50 disabled:opacity-50"
                          >
                            {picking === c.matchKey ? "Applying…" : "Use this"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Confirm */}
          <div>
            {!match && (
              <label className="mt-2 flex items-start gap-2 text-sm text-forest-700">
                <input
                  type="checkbox"
                  checked={manualOverride}
                  onChange={(e) => setManualOverride(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-forest-300 accent-forest-700"
                />
                I verified this transfer manually (no BPI match)
              </label>
            )}
            <button
              type="button"
              onClick={confirmPayment}
              disabled={confirming || (!match && !manualOverride)}
              className="mt-3 w-full rounded-md bg-forest-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-forest-800 disabled:opacity-50"
            >
              {confirming ? "Confirming…" : "✓ Confirm payment · mark paid"}
            </button>
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      )}

      {order && isPaid && (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-forest-300 bg-forest-50 p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-forest-800">
              Paid ✓ {formatTime(order.paidAt)}
              {order.isTest && <TestBadge />}
            </p>
            <p className="mt-0.5 text-xs text-forest-600">
              {order.company} · {formatPeso(order.total)}
            </p>
          </div>

          {order.paidReply && (
            <div className="relative rounded-lg border border-forest-100 bg-forest-50 p-4">
              <CopyButton
                text={order.paidReply}
                label="Copy reply"
                className="absolute right-3 top-3"
              />
              <p className="whitespace-pre-wrap pr-24 text-sm text-forest-900">
                {order.paidReply}
              </p>
            </div>
          )}

          {/* Fulfilment reply, auto-matched to the order's delivery method —
              only the relevant one is shown; the rest stay collapsed. */}
          {(() => {
            const method = order.options.deliveryMethod;
            const active = method
              ? fulfilmentReplyFor(method, order.options.deliveryFee)
              : undefined;
            const others = FULFILMENT_TEMPLATES.filter((t) => t.key !== active?.key);
            return (
              <>
                {active && (
                  <div className="rounded-lg border border-forest-300 bg-forest-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-forest-600">
                        Fulfilment · {active.label}{" "}
                        <span className="normal-case font-normal">
                          (matched to the delivery method)
                        </span>
                      </p>
                      <CopyButton text={active.text} label="Copy" />
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-forest-900">
                      {active.text}
                    </p>
                    {method === "jnt_nationwide" &&
                      (order.options.deliveryFee ?? 0) > 0 && (
                        <p className="mt-2 border-t border-forest-200 pt-2 text-xs text-amber-800">
                          ⚠️ The {formatPeso(order.options.deliveryFee ?? 0)} fee
                          was already on the paid draft — drop the &ldquo;kindly
                          send&rdquo; part before sending.
                        </p>
                      )}
                  </div>
                )}
                <details className="rounded-lg border border-forest-200">
                  <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-forest-800 hover:bg-forest-50">
                    {active ? "Other fulfilment replies" : "Fulfilment replies"}
                  </summary>
                  <div className="space-y-3 border-t border-forest-100 p-3">
                    {others.map((tpl) => (
                      <div
                        key={tpl.key}
                        className="rounded-lg border border-forest-100 bg-forest-50 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-forest-600">
                            {tpl.label}
                          </p>
                          <CopyButton text={tpl.text} />
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-forest-900">
                          {tpl.text}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              </>
            );
          })()}

          <div>
            <a
              href="/history"
              className="text-sm font-semibold text-forest-700 hover:underline"
            >
              View in History →
            </a>
            <p className="mt-1 text-xs text-forest-500">Moved to History.</p>
          </div>
        </div>
      )}

      <p className="mt-5 border-t border-forest-100 pt-3 text-xs text-forest-500">
        Nothing is sent or marked paid automatically — you confirm every step.
      </p>

      <Modal
        open={!!lightbox}
        onClose={() => setLightbox(null)}
        title={lightbox?.name ?? "Payment proof"}
        maxWidthClassName="max-w-2xl"
      >
        {lightbox && (
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.url}
              alt={lightbox.name}
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
            <p className="mt-2 text-xs text-forest-500">
              Uploaded {formatTime(lightbox.uploadedAt) || lightbox.uploadedAt}
              {" · "}
              <a
                href={lightbox.url}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-forest-700 underline hover:text-forest-900"
              >
                Open in new tab ↗
              </a>
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
