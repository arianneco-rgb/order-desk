"use client";

import { BuildOrder } from "@/components/paste/BuildOrder";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { CafeCustomer, Order } from "@/lib/types";
import { CafePicker } from "@/components/paste/CafePicker";
import { CafeOrderHistory } from "@/components/paste/CafeOrderHistory";
import { NewCustomerPanel } from "@/components/paste/NewCustomerPanel";
import { Kbd, isMac } from "@/components/Kbd";

type PasteMode = "existing" | "new" | "build";

export default function PastePage() {
  const [mode, setMode] = useState<PasteMode>("existing");
  const [cafe, setCafe] = useState<CafeCustomer | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Sent to queue" notice that fades out after ~4s.
  const [notice, setNotice] = useState(false);
  const [noticeFading, setNoticeFading] = useState(false);
  const noticeTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Live hint: how many messages are still queued/processing.
  const [parsingCount, setParsingCount] = useState(0);

  // Detected client-side only, to avoid a server/client hydration mismatch —
  // defaults to the Ctrl label until mounted.
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(isMac());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/orders");
        if (!res.ok) return;
        const data = (await res.json()) as { orders?: Order[] };
        if (cancelled || !Array.isArray(data.orders)) return;
        setParsingCount(
          data.orders.filter(
            (o) => o.status === "queued" || o.status === "processing"
          ).length
        );
      } catch {
        // Polling is a hint only — leave the last known count alone.
      }
    }
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    return () => noticeTimers.current.forEach(clearTimeout);
  }, []);

  function showNotice() {
    noticeTimers.current.forEach(clearTimeout);
    setNoticeFading(false);
    setNotice(true);
    noticeTimers.current = [
      setTimeout(() => setNoticeFading(true), 3300),
      setTimeout(() => setNotice(false), 4000),
    ];
  }

  const submit = useCallback(async () => {
    if (!cafe || !message.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: cafe.name,
          customerId: cafe.shopifyId,
          rawMessage: message,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status !== 201) {
        throw new Error(data.error ?? "Couldn't send to the queue.");
      }
      // Keep the cafe selected — Joey pastes the next message from the same chat.
      setMessage("");
      setParsingCount((n) => n + 1);
      showNotice();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't send to the queue."
      );
    } finally {
      setBusy(false);
    }
  }, [cafe, message, busy]);

  // Cmd+Enter (Mac) / Ctrl+Enter (other) submits, mirroring the Send button —
  // plain Enter still just inserts a newline in the textarea, unchanged.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      const modifierHeld = isMac() ? e.metaKey : e.ctrlKey;
      if (!modifierHeld) return;
      e.preventDefault();
      submit();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [submit]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight text-forest-900">
        Paste order
      </h1>
      <p className="mt-1 text-sm text-forest-700">
        Pick the cafe, paste the Viber message, send it to the queue.
      </p>

      {/* Existing cafe ↔ New customer (feedback round 4: a dedicated
          paste→parse→flag→submit step for customer profiles) */}
      <div className="mt-4 inline-flex rounded-lg border border-forest-200 bg-white p-0.5 shadow-sm">
        {(
          [
            { key: "existing", label: "Existing cafe" },
            { key: "build", label: "Build order" },
            { key: "new", label: "New customer" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setMode(tab.key)}
            className={clsx(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              mode === tab.key
                ? "bg-forest-700 text-white"
                : "text-forest-700 hover:bg-forest-50"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === "new" && (
        <div className="mt-4 rounded-xl border border-forest-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-forest-900">
            New customer profile
          </h2>
          <p className="mt-1 text-sm text-forest-600">
            Paste the client&apos;s reply → the profile fields fill in → fix
            anything flagged → create the Shopify profile → their order starts
            right after.
          </p>
          <div className="mt-4">
            <NewCustomerPanel
              onCreated={(customer, leftoverOrderText) => {
                setCafe(customer);
                setMode("existing");
                if (leftoverOrderText) {
                  setMessage((prev) => (prev.trim() ? prev : leftoverOrderText));
                }
                setTimeout(() => document.getElementById("raw-message")?.focus(), 50);
              }}
            />
          </div>
        </div>
      )}

      <div className={clsx("mt-4 rounded-xl border border-forest-200 bg-white p-6 shadow-sm", mode === "new" && "hidden")}>
        <h2 className="text-base font-semibold text-forest-900">
          {mode === "build" ? "Pick the cafe" : "Paste an order message"}
        </h2>

        <label className="mt-4 block text-sm font-medium text-forest-900">
          Cafe / customer{" "}
          <span className="font-normal text-forest-500">
            (from the Customers sheet)
          </span>
        </label>
        <div className="mt-1.5">
          <CafePicker
            selected={cafe}
            onSelect={setCafe}
            onLeftoverOrderText={(text) => {
              // The non-profile lines of the pasted message are usually the
              // sample order itself — drop them into the message box.
              setMessage((prev) => (prev.trim() ? prev : text));
              document.getElementById("raw-message")?.focus();
            }}
          />
        </div>
        <p className="mt-1.5 text-xs text-forest-500">
          New cafes are added in Shopify — they sync into the Customers sheet
          and appear here automatically. First time ordering?{" "}
          <button
            type="button"
            onClick={() => setMode("new")}
            className="font-semibold text-forest-700 underline hover:text-forest-900"
          >
            Use the New customer tab
          </button>
          .
        </p>

        {cafe && (
          <CafeOrderHistory
            cafe={cafe}
            messageEmpty={!message.trim()}
            onUse={(itemsText) => {
              setMessage(itemsText);
              document.getElementById("raw-message")?.focus();
            }}
          />
        )}

        <div className={clsx(mode === "build" && "hidden")}>
        <label
          htmlFor="raw-message"
          className="mt-5 block text-sm font-medium text-forest-900"
        >
          Message
        </label>
        <textarea
          id="raw-message"
          rows={7}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Paste the Viber order message here — a whole conversation works too, the parser skips the chatter…"
          className="mt-1.5 min-h-[9rem] w-full rounded-md border border-forest-300 px-3 py-2 text-sm text-forest-900 placeholder:text-forest-400 focus:border-forest-600 focus:outline-none"
        />

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={busy || !cafe || !message.trim()}
          className="mt-4 w-full rounded-lg bg-forest-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-forest-900 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send to queue"}
        </button>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-xs text-forest-500">
            Sends to the queue and clears the box so you can paste the next
            one. The dashboard parses it, then it waits in the Queue for you
            to review and finalize.
          </p>
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-forest-500">
            <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>+<Kbd>Enter</Kbd> to send
          </span>
        </div>

        {notice && (
          <p
            className={clsx(
              "mt-2 text-sm text-forest-700 transition-opacity duration-700",
              noticeFading ? "opacity-0" : "opacity-100"
            )}
          >
            Sent to queue — parsing now ·{" "}
            <Link
              href="/queue"
              className="font-semibold text-forest-800 underline"
            >
              View queue →
            </Link>
          </p>
        )}
        </div>
      </div>

      {mode === "build" && <BuildOrder cafe={cafe} />}

      {parsingCount > 0 && (
        <p className="mt-4 text-sm">
          <Link
            href="/queue"
            className="inline-flex items-center gap-2 text-forest-600 transition-colors hover:text-forest-800"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-600" />
            {parsingCount === 1
              ? "1 message parsing in the queue"
              : `${parsingCount} messages parsing in the queue`}{" "}
            →
          </Link>
        </p>
      )}
    </div>
  );
}
