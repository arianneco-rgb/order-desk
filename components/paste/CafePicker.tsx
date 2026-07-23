"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { CafeCustomer } from "@/lib/types";
import { parseProfileMessage } from "@/lib/profile-parser";

const inputClass =
  "w-full rounded-md border border-forest-300 px-3 py-2 text-sm focus:border-forest-600 focus:outline-none";

/**
 * Searchable combobox over /api/customers (150+ cafes) with an inline
 * "Add new cafe" modal that POSTs to /api/customers and selects the result.
 * The modal's paste box turns a customer's chat message (template or
 * free-form) into prefilled fields — chat-to-profile, always user-confirmed.
 */
export function CafePicker({
  selected,
  onSelect,
  onLeftoverOrderText,
}: {
  selected: CafeCustomer | null;
  onSelect: (cafe: CafeCustomer | null) => void;
  /** Lines of the pasted profile message that look like an order (fed into the message box). */
  onLeftoverOrderText?: (text: string) => void;
}) {
  const [customers, setCustomers] = useState<CafeCustomer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // "Add new cafe" modal state.
  const [modalOpen, setModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [cafeName, setCafeName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [zip, setZip] = useState("");
  const [leftover, setLeftover] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  // Fields the user edited by hand — re-parsing the paste box must never
  // clobber a manual correction.
  const touchedRef = useRef<Set<string>>(new Set());

  const loadCustomers = useCallback(async () => {
    try {
      const res = await fetch("/api/customers");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't load the cafe list.");
      setCustomers(Array.isArray(data.customers) ? data.customers : []);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Couldn't load the cafe list."
      );
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  // Close the dropdown on outside click.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Match the cafe name OR the contact person — "Marco" should find Marco's
  // profile even when no company name is set on it.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.contactName ?? "").toLowerCase().includes(q)
    );
  }, [customers, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  function pick(cafe: CafeCustomer) {
    onSelect(cafe);
    setQuery("");
    setOpen(false);
  }

  function openModal() {
    setPasteText("");
    setCafeName(query.trim());
    setContactName("");
    setEmail("");
    setPhone("");
    setAddress1("");
    setAddress2("");
    setCity("");
    setProvince("");
    setZip("");
    setLeftover("");
    setModalError(null);
    // The search-box prefill is a convenience, not a hand-edit — an explicit
    // "Cafe:" label in the pasted message should still win over it.
    touchedRef.current = new Set();
    setModalOpen(true);
    setOpen(false);
  }

  /** Mark a field as hand-edited so re-parsing never overwrites it. */
  function touch(field: string, setter: (v: string) => void) {
    return (v: string) => {
      touchedRef.current.add(field);
      setter(v);
    };
  }

  /** Live chat-to-profile: parse the pasted message into the untouched fields. */
  function onPaste(text: string) {
    setPasteText(text);
    const parsed = parseProfileMessage(text);
    const touched = touchedRef.current;
    if (parsed.cafeName && !touched.has("cafeName")) setCafeName(parsed.cafeName);
    if (parsed.contactName && !touched.has("contactName")) setContactName(parsed.contactName);
    if (parsed.email && !touched.has("email")) setEmail(parsed.email);
    if (parsed.phone && !touched.has("phone")) setPhone(parsed.phone);
    if (parsed.address1 && !touched.has("address1")) setAddress1(parsed.address1);
    if (parsed.address2 && !touched.has("address2")) setAddress2(parsed.address2);
    if (parsed.city && !touched.has("city")) setCity(parsed.city);
    if (parsed.province && !touched.has("province")) setProvince(parsed.province);
    if (parsed.zip && !touched.has("zip")) setZip(parsed.zip);
    setLeftover(parsed.unmatched.join("\n"));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(matches.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const match = matches[highlight];
      if (match) pick(match);
    }
  }

  async function submitNewCafe(e: React.FormEvent) {
    e.preventDefault();
    if (!cafeName.trim() || modalBusy) return;
    setModalBusy(true);
    setModalError(null);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cafeName: cafeName.trim(),
          contactName: contactName.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          address:
            address1.trim() || address2.trim() || city.trim() || province.trim() || zip.trim()
              ? {
                  address1: address1.trim() || undefined,
                  address2: address2.trim() || undefined,
                  city: city.trim() || undefined,
                  province: province.trim() || undefined,
                  zip: zip.trim() || undefined,
                }
              : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status !== 201) {
        throw new Error(data.error ?? "Couldn't create the cafe.");
      }
      setModalOpen(false);
      pick(data.customer as CafeCustomer);
      // Whatever wasn't profile info is usually their sample order — hand
      // it to the message box so one paste covers profile AND order.
      if (leftover.trim() && onLeftoverOrderText) onLeftoverOrderText(leftover.trim());
      loadCustomers();
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : "Couldn't create the cafe."
      );
    } finally {
      setModalBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      {selected ? (
        <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-forest-100 py-1.5 pl-3.5 pr-2 text-sm font-medium text-forest-900">
          <span className="truncate">{selected.name}</span>
          {selected.city && (
            <span className="shrink-0 font-normal text-forest-600">
              · {selected.city}
            </span>
          )}
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-label="Clear selected cafe"
            className="shrink-0 rounded-full px-1.5 text-forest-500 transition-colors hover:bg-forest-200 hover:text-forest-900"
          >
            ✕
          </button>
        </span>
      ) : (
        <>
          <input
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search cafes or contact names…"
            className={inputClass}
          />
          {loadError && (
            <p className="mt-2 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <span className="flex-1">{loadError}</span>
              <button
                type="button"
                onClick={loadCustomers}
                className="shrink-0 font-semibold underline"
              >
                Retry
              </button>
            </p>
          )}
          {open && (
            <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-forest-200 bg-white shadow-lg">
              <ul className="max-h-72 overflow-y-auto py-1">
                {matches.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-forest-500">
                    {!loaded
                      ? "Loading cafes…"
                      : query.trim()
                        ? `No cafes match “${query.trim()}”.`
                        : "No cafes yet."}
                  </li>
                ) : (
                  matches.map((cafe, i) => (
                    <li key={cafe.shopifyId}>
                      <button
                        type="button"
                        onClick={() => pick(cafe)}
                        onMouseEnter={() => setHighlight(i)}
                        className={clsx(
                          "flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm",
                          i === highlight
                            ? "bg-forest-50 text-forest-900"
                            : "text-forest-800"
                        )}
                      >
                        <span className="min-w-0 truncate font-medium">
                          {cafe.name}
                          {cafe.contactName && cafe.contactName !== cafe.name && (
                            <span className="font-normal text-forest-500">
                              {" "}
                              · {cafe.contactName}
                            </span>
                          )}
                        </span>
                        {cafe.city && (
                          <span className="shrink-0 text-xs text-forest-500">
                            {cafe.city}
                          </span>
                        )}
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <button
                type="button"
                onClick={openModal}
                className="block w-full border-t border-forest-200 bg-forest-50 px-3 py-2 text-left text-sm font-semibold text-forest-700 transition-colors hover:bg-forest-100"
              >
                + Add new cafe (paste their details)
              </button>
            </div>
          )}
        </>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-forest-950/40 p-4">
          <form
            onSubmit={submitNewCafe}
            className="my-8 w-full max-w-md rounded-xl border border-forest-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-lg font-semibold text-forest-900">
              Add new cafe
            </h2>
            <p className="mt-1 text-sm text-forest-700">
              Paste the customer&apos;s message below — name, number, cafe, and
              address fill themselves in. Check the fields, then create. This
              makes the Shopify profile in one step.
            </p>

            <textarea
              value={pasteText}
              onChange={(e) => onPaste(e.target.value)}
              rows={4}
              placeholder={"Paste their chat message, e.g.\nName: Maria Santos\nContact: 0917 123 4567\nCafe: Slow Mornings\nAddress: 12 Mabini St, San Juan"}
              className={clsx(inputClass, "mt-3 font-normal")}
            />
            {leftover && (
              <p className="mt-1 text-xs text-forest-500">
                Lines that look like an order will be moved to the message box
                after creating.
              </p>
            )}

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-forest-900 sm:col-span-2">
                Cafe name <span className="text-red-600">*</span>
                <input
                  type="text"
                  value={cafeName}
                  onChange={(e) => touch("cafeName", setCafeName)(e.target.value)}
                  placeholder="e.g. Slow Mornings Cafe"
                  className={clsx(inputClass, "mt-1 font-normal")}
                />
              </label>
              <label className="block text-sm font-medium text-forest-900">
                Contact name
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => touch("contactName", setContactName)(e.target.value)}
                  placeholder="Optional"
                  className={clsx(inputClass, "mt-1 font-normal")}
                />
              </label>
              <label className="block text-sm font-medium text-forest-900">
                Phone
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => touch("phone", setPhone)(e.target.value)}
                  placeholder="Optional"
                  className={clsx(inputClass, "mt-1 font-normal")}
                />
              </label>
              <label className="block text-sm font-medium text-forest-900 sm:col-span-2">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => touch("email", setEmail)(e.target.value)}
                  placeholder="Optional"
                  className={clsx(inputClass, "mt-1 font-normal")}
                />
              </label>
              <label className="block text-sm font-medium text-forest-900 sm:col-span-2">
                Street address
                <input
                  type="text"
                  value={address1}
                  onChange={(e) => touch("address1", setAddress1)(e.target.value)}
                  placeholder="House/building no. + street (optional)"
                  className={clsx(inputClass, "mt-1 font-normal")}
                />
              </label>
              <label className="block text-sm font-medium text-forest-900 sm:col-span-2">
                Barangay / subdivision / landmark
                <input
                  type="text"
                  value={address2}
                  onChange={(e) => touch("address2", setAddress2)(e.target.value)}
                  placeholder="e.g. Brgy. Poblacion (optional)"
                  className={clsx(inputClass, "mt-1 font-normal")}
                />
              </label>
              <label className="block text-sm font-medium text-forest-900">
                City
                <input
                  type="text"
                  value={city}
                  onChange={(e) => touch("city", setCity)(e.target.value)}
                  placeholder="Optional"
                  className={clsx(inputClass, "mt-1 font-normal")}
                />
              </label>
              <label className="block text-sm font-medium text-forest-900">
                Province / ZIP
                <span className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={province}
                    onChange={(e) => touch("province", setProvince)(e.target.value)}
                    placeholder="Province"
                    className={clsx(inputClass, "font-normal")}
                  />
                  <input
                    type="text"
                    value={zip}
                    onChange={(e) => touch("zip", setZip)(e.target.value)}
                    placeholder="ZIP"
                    className={clsx(inputClass, "w-20 shrink-0 font-normal")}
                  />
                </span>
              </label>
            </div>

            {modalError && (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {modalError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={modalBusy}
                className="rounded-md border border-forest-300 bg-white px-4 py-2 text-sm font-semibold text-forest-800 transition-colors hover:bg-forest-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={modalBusy || !cafeName.trim()}
                className="rounded-md bg-forest-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-forest-800 disabled:opacity-50"
              >
                {modalBusy ? "Creating profile…" : "Create Shopify profile"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
