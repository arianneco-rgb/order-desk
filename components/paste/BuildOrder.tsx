"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CafeAddress, CafeCustomer, CatalogProduct, ItemForm } from "@/lib/types";
import { formatPeso } from "@/lib/conversions";
import { DELIVERY_METHODS, defaultDeliveryFee } from "@/lib/delivery";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/StagedProgress";
import { useToast } from "@/components/Toast";

/** A line in the cart. `form` decides which Shopify variant it becomes. */
type Line = { productKey: string; form: ItemForm; qty: number };

/** 10 pouches to a case — the "Case" button adds a case's worth of pouches. */
const POUCHES_PER_CASE = 10;
const MOQ_POUCHES = 10;

/** Which buttons a product offers, in the order the team thinks about them. */
function sizesFor(p: CatalogProduct): { form: ItemForm; label: string; step: number; price: number }[] {
  const out: { form: ItemForm; label: string; step: number; price: number }[] = [];
  // Cases aren't a separate line type — pricing already bills every full 10
  // pouches at the case rate, so this just adds 10 pouches.
  if (p.case) out.push({ form: "pouch", label: "Case", step: POUCHES_PER_CASE, price: p.case.price });
  if (p.pouch) out.push({ form: "pouch", label: "200g", step: 1, price: p.pouch.price });
  if (p.sample) out.push({ form: "sample", label: "Sample", step: 1, price: p.sample.price });
  if (p.piece) out.push({ form: "piece", label: "Piece", step: 1, price: p.piece.price });
  return out;
}

export function BuildOrder({ cafe }: { cafe: CafeCustomer | null }) {
  const router = useRouter();
  const toast = useToast();
  const [catalog, setCatalog] = useState<CatalogProduct[] | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [chargeVat, setChargeVat] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [deliveryFee, setDeliveryFee] = useState("");
  const [addresses, setAddresses] = useState<CafeAddress[]>([]);
  const [addressLabel, setAddressLabel] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productQuery, setProductQuery] = useState("");

  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCatalog(d?.catalog ?? []))
      .catch(() => setCatalog([]));
  }, []);

  // Branches load per cafe — see getCustomerAddresses for why they aren't
  // bundled with the customer list.
  useEffect(() => {
    setAddresses([]);
    setAddressLabel("");
    if (!cafe?.shopifyId) return;
    let alive = true;
    fetch(`/api/customers/${encodeURIComponent(cafe.shopifyId)}/addresses`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const list: CafeAddress[] = d?.addresses ?? [];
        setAddresses(list);
        if (list.length > 0) setAddressLabel(list[0].label);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [cafe?.shopifyId]);

  const byKey = useMemo(
    () => new Map((catalog ?? []).map((p) => [p.key, p])),
    [catalog]
  );

  const shown = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    const list = catalog ?? [];
    return q ? list.filter((p) => p.title.toLowerCase().includes(q)) : list;
  }, [catalog, productQuery]);

  function add(productKey: string, form: ItemForm, step: number) {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.productKey === productKey && l.form === form);
      if (i === -1) return [...prev, { productKey, form, qty: step }];
      const next = [...prev];
      next[i] = { ...next[i], qty: next[i].qty + step };
      return next;
    });
  }

  function setQty(index: number, qty: number) {
    setLines((prev) =>
      qty <= 0 ? prev.filter((_, i) => i !== index) : prev.map((l, i) => (i === index ? { ...l, qty } : l))
    );
  }

  const totals = useMemo(() => {
    let amount = 0;
    let pouches = 0;
    for (const l of lines) {
      const p = byKey.get(l.productKey);
      if (!p) continue;
      if (l.form === "sample") amount += (p.sample?.price ?? 0) * l.qty;
      else if (l.form === "piece") amount += (p.piece?.price ?? 0) * l.qty;
      else {
        // Mirrors lib/pricing.ts: full cases at the case rate, remainder
        // at the single-pouch rate — so this preview matches the invoice.
        const cases = Math.floor(l.qty / POUCHES_PER_CASE);
        const loose = l.qty % POUCHES_PER_CASE;
        amount += cases * (p.case?.price ?? 0) + loose * (p.pouch?.price ?? 0);
        pouches += l.qty;
      }
    }
    return { amount, pouches };
  }, [lines, byKey]);

  const belowMoq = totals.pouches > 0 && totals.pouches < MOQ_POUCHES;

  async function submit() {
    if (!cafe) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orders/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: cafe.name,
          customerId: cafe.shopifyId,
          items: lines,
          chargeVat,
          deliveryMethod: deliveryMethod || undefined,
          deliveryFee: deliveryFee === "" ? undefined : Number(deliveryFee),
          shippingAddress: addressLabel || undefined,
          confirm: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (HTTP ${res.status}).`);
      if (data.sheetWarning) toast(data.sheetWarning, "error");
      toast(`${cafe.name} — order created and marked paid.`, "success");
      setConfirmOpen(false);
      setLines([]);
      router.push("/history");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fast-track failed.");
    } finally {
      setBusy(false);
    }
  }

  const label = (l: Line): string => {
    const p = byKey.get(l.productKey);
    const title = p?.title ?? l.productKey;
    if (l.form === "sample") return `${title} · ${l.qty} sample${l.qty === 1 ? "" : "s"}`;
    if (l.form === "piece") return `${title} · ${l.qty} pc`;
    const cases = Math.floor(l.qty / POUCHES_PER_CASE);
    const loose = l.qty % POUCHES_PER_CASE;
    const parts = [
      cases > 0 ? `${cases} case${cases === 1 ? "" : "s"}` : "",
      loose > 0 ? `${loose} pouch${loose === 1 ? "" : "es"}` : "",
    ].filter(Boolean);
    return `${title} · ${parts.join(" + ")} (${(l.qty * 0.2).toFixed(1)}kg)`;
  };

  return (
    <div className="mt-4 rounded-xl border border-forest-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-forest-900">Build order</h2>
      <p className="mt-1 text-sm text-forest-600">
        Tap products to add them. Creating the order marks it paid immediately — no draft review,
        no BPI match.
      </p>

      {!cafe && (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Pick a cafe above first.
        </p>
      )}

      {cafe && (
        <>
          {addresses.length > 0 && (
            <div className="mt-4">
              <label className="text-xs font-semibold uppercase tracking-wide text-forest-500">
                Deliver to {addresses.length > 1 && `(${addresses.length} branches)`}
              </label>
              <select
                value={addressLabel}
                onChange={(e) => setAddressLabel(e.target.value)}
                className="mt-1 w-full rounded-md border border-forest-300 px-2 py-1.5 text-sm"
              >
                {addresses.map((a) => (
                  <option key={a.id} value={a.label}>
                    {a.isStub ? `${a.label} (no street address)` : a.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-4">
            <input
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              placeholder="Filter products…"
              className="w-full rounded-md border border-forest-200 px-3 py-2 text-sm"
            />
          </div>

          {catalog === null ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-forest-600">
              <Spinner className="h-4 w-4" /> Loading products…
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {shown.map((p) => (
                <div key={p.key} className="rounded-lg border border-forest-200 p-3">
                  <p className="text-sm font-semibold text-forest-900">{p.title}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sizesFor(p).map((s) => (
                      <button
                        key={`${s.form}-${s.label}`}
                        type="button"
                        onClick={() => add(p.key, s.form, s.step)}
                        className="rounded-md border border-forest-300 bg-white px-2 py-1 text-xs font-semibold text-forest-800 transition-colors hover:bg-forest-50"
                      >
                        + {s.label}
                        <span className="ml-1 font-normal text-forest-500">{formatPeso(s.price)}</span>
                      </button>
                    ))}
                    {sizesFor(p).length === 0 && (
                      <span className="text-xs text-forest-400">No orderable variant</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Cart */}
          <div className="mt-5 border-t border-forest-100 pt-4">
            <p className="text-sm font-semibold text-forest-900">
              Order {lines.length > 0 && <span className="font-normal text-forest-500">({lines.length} lines)</span>}
            </p>
            {lines.length === 0 ? (
              <p className="mt-2 text-sm text-forest-500">Nothing added yet.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {lines.map((l, i) => (
                  <div key={`${l.productKey}-${l.form}`} className="flex items-center gap-2 rounded-md border border-forest-200 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm text-forest-900">{label(l)}</span>
                    <button type="button" onClick={() => setQty(i, l.qty - 1)}
                      className="h-6 w-6 rounded border border-forest-300 text-sm font-bold text-forest-700 hover:bg-forest-50">−</button>
                    <input
                      type="number" min={0} value={l.qty}
                      onChange={(e) => setQty(i, Number(e.target.value))}
                      className="w-16 rounded border border-forest-300 px-1.5 py-0.5 text-center text-sm"
                      aria-label="Quantity"
                    />
                    <button type="button" onClick={() => setQty(i, l.qty + 1)}
                      className="h-6 w-6 rounded border border-forest-300 text-sm font-bold text-forest-700 hover:bg-forest-50">+</button>
                  </div>
                ))}
              </div>
            )}

            {belowMoq && (
              <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                Below MOQ — {totals.pouches * 200}g, minimum is 2kg (1 case).
              </p>
            )}

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-forest-700">
                <input type="checkbox" checked={chargeVat} onChange={(e) => setChargeVat(e.target.checked)} />
                Charge VAT (12%)
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={deliveryMethod}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDeliveryMethod(v);
                    if (v && deliveryFee === "") {
                      const f = defaultDeliveryFee(v as keyof typeof DELIVERY_METHODS);
                      if (f > 0) setDeliveryFee(String(f));
                    }
                  }}
                  className="flex-1 rounded-md border border-forest-300 px-2 py-1.5 text-sm"
                >
                  <option value="">— delivery —</option>
                  {(Object.keys(DELIVERY_METHODS) as (keyof typeof DELIVERY_METHODS)[]).map((k) => (
                    <option key={k} value={k}>{DELIVERY_METHODS[k].label}</option>
                  ))}
                </select>
                <input
                  type="number" min={0} value={deliveryFee}
                  onChange={(e) => setDeliveryFee(e.target.value)}
                  placeholder="fee ₱0"
                  className="w-24 rounded-md border border-forest-300 px-2 py-1.5 text-sm"
                  aria-label="Delivery fee"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-forest-700">
                Estimated total{" "}
                <span className="text-lg font-bold text-forest-900">{formatPeso(totals.amount)}</span>
                <span className="ml-1 text-xs text-forest-500">(Shopify confirms on create)</span>
              </p>
              <button
                type="button"
                disabled={lines.length === 0 || busy}
                onClick={() => setConfirmOpen(true)}
                className="rounded-md bg-forest-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-forest-800 disabled:opacity-50"
              >
                Create order · mark paid
              </button>
            </div>
            {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
        </>
      )}

      <Modal open={confirmOpen} onClose={() => !busy && setConfirmOpen(false)} title="Create order and mark it paid?">
        <p className="text-sm text-forest-700">
          This creates a <strong>real Shopify order</strong> for <strong>{cafe?.name}</strong> and marks
          it <strong>paid immediately</strong>. There is no draft review and no BPI payment match.
        </p>
        <ul className="mt-3 space-y-1 rounded-md bg-forest-50 p-3 text-sm text-forest-800">
          {lines.map((l) => (
            <li key={`${l.productKey}-${l.form}`}>{label(l)}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-forest-900">
          Total <strong>{formatPeso(totals.amount)}</strong>
          {chargeVat && " · VAT charged"}
          {deliveryMethod && ` · ${DELIVERY_METHODS[deliveryMethod as keyof typeof DELIVERY_METHODS].label}`}
        </p>
        {addressLabel && <p className="mt-1 text-xs text-forest-600">Deliver to: {addressLabel}</p>}
        {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmOpen(false)} disabled={busy}
            className="rounded-md border border-forest-300 px-3 py-1.5 text-sm font-semibold text-forest-800 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={() => void submit()} disabled={busy}
            className="flex items-center gap-2 rounded-md bg-forest-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy && <Spinner className="h-4 w-4 text-white" />}
            {busy ? "Creating…" : "Yes, create and mark paid"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
