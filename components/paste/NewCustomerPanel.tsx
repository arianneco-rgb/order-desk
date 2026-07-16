"use client";

import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { CafeCustomer } from "@/lib/types";
import { parseProfileMessage, splitName } from "@/lib/profile-parser";
import { PH_PROVINCES } from "@/lib/ph-locations";

const inputClass =
  "w-full rounded-md border border-forest-300 px-3 py-2 text-sm text-forest-900 placeholder:text-forest-400 focus:border-forest-600 focus:outline-none disabled:bg-forest-50 disabled:text-forest-400";

type FieldKey =
  | "firstName"
  | "lastName"
  | "phone"
  | "email"
  | "cafeName"
  | "address1"
  | "city"
  | "province"
  | "zip";

/** ✓ filled · ⚠ required-and-missing · ○ optional-and-missing. */
function FieldBadge({ filled, required }: { filled: boolean; required: boolean }) {
  if (filled) {
    return (
      <span className="rounded bg-forest-100 px-1 py-0.5 text-[10px] font-bold text-forest-700">✓</span>
    );
  }
  return required ? (
    <span className="rounded bg-red-100 px-1 py-0.5 text-[10px] font-bold text-red-700">⚠ required</span>
  ) : (
    <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-800">
      add if known
    </span>
  );
}

/**
 * The dedicated new-customer step (feedback round 4): paste the client's
 * reply — the labeled template OR a free-form line-by-line message — and the
 * full Shopify profile fields fill themselves. Missing fields are flagged;
 * the four template fields gate the submit (cafe skippable via the "no
 * cafe yet" toggle, matching profiles like "Jericho Liao" that predate a
 * cafe). City/province/postal are derived from the address when
 * recognisable, flagged for manual entry when not — never guessed.
 */
export function NewCustomerPanel({
  onCreated,
}: {
  /** Fires after the Shopify profile is created; leftover = probable order lines. */
  onCreated: (customer: CafeCustomer, leftoverOrderText: string) => void;
}) {
  const [pasteText, setPasteText] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [cafeName, setCafeName] = useState("");
  const [noCafe, setNoCafe] = useState(false);
  const [address1, setAddress1] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [zip, setZip] = useState("");
  const [leftover, setLeftover] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fields the user edited by hand — re-parsing must never clobber them.
  const touchedRef = useRef<Set<FieldKey>>(new Set());

  const setters: Record<FieldKey, (v: string) => void> = {
    firstName: setFirstName,
    lastName: setLastName,
    phone: setPhone,
    email: setEmail,
    cafeName: setCafeName,
    address1: setAddress1,
    city: setCity,
    province: setProvince,
    zip: setZip,
  };

  function touch(field: FieldKey) {
    return (v: string) => {
      touchedRef.current.add(field);
      setters[field](v);
    };
  }

  function onPaste(text: string) {
    setPasteText(text);
    const p = parseProfileMessage(text);
    const t = touchedRef.current;
    const split = p.contactName ? splitName(p.contactName) : undefined;
    if ((p.firstName || split?.firstName) && !t.has("firstName"))
      setFirstName(p.firstName ?? split?.firstName ?? "");
    if ((p.lastName || split?.lastName) && !t.has("lastName"))
      setLastName(p.lastName ?? split?.lastName ?? "");
    if (p.phone && !t.has("phone")) setPhone(p.phone);
    if (p.email && !t.has("email")) setEmail(p.email);
    if (p.cafeName && !t.has("cafeName")) setCafeName(p.cafeName);
    if (p.address1 && !t.has("address1")) setAddress1(p.address1);
    if (p.city && !t.has("city")) setCity(p.city);
    if (p.province && !t.has("province")) setProvince(p.province);
    if (p.zip && !t.has("zip")) setZip(p.zip);
    setLeftover(p.unmatched.join("\n"));
  }

  const cafeRequired = !noCafe;
  const missing = useMemo(() => {
    const list: string[] = [];
    if (!firstName.trim()) list.push("First name");
    if (!phone.trim()) list.push("Contact number");
    if (cafeRequired && !cafeName.trim()) list.push("Cafe/Company");
    if (!address1.trim()) list.push("Delivery address");
    return list;
  }, [firstName, phone, cafeRequired, cafeName, address1]);

  const softMissing = useMemo(() => {
    const list: string[] = [];
    if (!city.trim()) list.push("City");
    if (!province.trim()) list.push("Province/Region");
    if (!zip.trim()) list.push("Postal code");
    return list;
  }, [city, province, zip]);

  const canSubmit = missing.length === 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // No cafe yet → the profile is created under the person's name,
          // same shape as existing person-profiles in Shopify.
          cafeName: noCafe ? fullName : cafeName.trim(),
          contactName: fullName,
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          address: {
            address1: address1.trim() || undefined,
            city: city.trim() || undefined,
            province: province.trim() || undefined,
            zip: zip.trim() || undefined,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status !== 201) throw new Error(data.error ?? "Couldn't create the profile.");
      onCreated(data.customer as CafeCustomer, leftover.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label htmlFor="profile-paste" className="block text-sm font-medium text-forest-900">
        Customer&apos;s reply{" "}
        <span className="font-normal text-forest-500">
          (the profile template, or however they sent it — even unlabeled lines work)
        </span>
      </label>
      <textarea
        id="profile-paste"
        rows={6}
        value={pasteText}
        onChange={(e) => onPaste(e.target.value)}
        placeholder={
          "Paste their message, e.g.\nName: Maria Santos\nContact number: 0917 123 4567\nCafe/Company Name: Slow Mornings\nDelivery Address with barangay: 12 Mabini St, Brgy. Poblacion, San Juan\n\n…or simply:\nMaria Santos\n09171234567\nSlow Mornings\n12 Mabini St, San Juan"
        }
        className="mt-1.5 min-h-[9rem] w-full rounded-md border border-forest-300 px-3 py-2 text-sm text-forest-900 placeholder:text-forest-400 focus:border-forest-600 focus:outline-none"
      />

      {/* Parsed profile preview — every field editable, gaps flagged */}
      <div className="mt-4 rounded-xl border border-forest-200 bg-forest-50/50 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-forest-900">Customer profile preview</h3>
          {missing.length > 0 ? (
            <p className="text-xs font-semibold text-red-700">
              Missing before submit: {missing.join(", ")}
            </p>
          ) : softMissing.length > 0 ? (
            <p className="text-xs font-medium text-amber-800">
              Optional, add if known: {softMissing.join(", ")}
            </p>
          ) : (
            <p className="text-xs font-semibold text-forest-700">All fields complete ✓</p>
          )}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-forest-900">
            <span className="flex items-center gap-1.5">
              First name <FieldBadge filled={!!firstName.trim()} required />
            </span>
            <input type="text" value={firstName} onChange={(e) => touch("firstName")(e.target.value)} className={clsx(inputClass, "mt-1 font-normal")} />
          </label>
          <label className="block text-sm font-medium text-forest-900">
            <span className="flex items-center gap-1.5">
              Last name <FieldBadge filled={!!lastName.trim()} required={false} />
            </span>
            <input type="text" value={lastName} onChange={(e) => touch("lastName")(e.target.value)} className={clsx(inputClass, "mt-1 font-normal")} />
          </label>
          <label className="block text-sm font-medium text-forest-900">
            <span className="flex items-center gap-1.5">
              Contact number <FieldBadge filled={!!phone.trim()} required />
            </span>
            <input type="tel" value={phone} onChange={(e) => touch("phone")(e.target.value)} placeholder="+639…" className={clsx(inputClass, "mt-1 font-normal")} />
            <span className="mt-0.5 block text-[11px] font-normal text-forest-500">
              Also used as the delivery-address phone.
            </span>
          </label>
          <label className="block text-sm font-medium text-forest-900">
            <span className="flex items-center gap-1.5">
              Email <FieldBadge filled={!!email.trim()} required={false} />
            </span>
            <input type="email" value={email} onChange={(e) => touch("email")(e.target.value)} placeholder="Optional" className={clsx(inputClass, "mt-1 font-normal")} />
          </label>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-forest-900">
              <span className="flex items-center gap-1.5">
                Cafe / Company name{" "}
                <FieldBadge filled={noCafe || !!cafeName.trim()} required={cafeRequired} />
              </span>
              <input
                type="text"
                value={noCafe ? "" : cafeName}
                disabled={noCafe}
                onChange={(e) => touch("cafeName")(e.target.value)}
                placeholder={noCafe ? "Profile will use the person's name" : ""}
                className={clsx(inputClass, "mt-1 font-normal")}
              />
            </label>
            <label className="mt-1.5 flex items-center gap-2 text-xs text-forest-700">
              <input
                type="checkbox"
                checked={noCafe}
                onChange={(e) => setNoCafe(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-forest-300 accent-forest-700"
              />
              No cafe/company yet — create the profile under their own name
            </label>
          </div>
          <label className="block text-sm font-medium text-forest-900 sm:col-span-2">
            <span className="flex items-center gap-1.5">
              Delivery address (street + barangay) <FieldBadge filled={!!address1.trim()} required />
            </span>
            <input type="text" value={address1} onChange={(e) => touch("address1")(e.target.value)} className={clsx(inputClass, "mt-1 font-normal")} />
          </label>
          <label className="block text-sm font-medium text-forest-900">
            <span className="flex items-center gap-1.5">
              City <FieldBadge filled={!!city.trim()} required={false} />
            </span>
            <input type="text" value={city} onChange={(e) => touch("city")(e.target.value)} className={clsx(inputClass, "mt-1 font-normal")} />
          </label>
          <label className="block text-sm font-medium text-forest-900">
            <span className="flex items-center gap-1.5">
              Province / Region <FieldBadge filled={!!province.trim()} required={false} />
            </span>
            <input type="text" list="ph-provinces" value={province} onChange={(e) => touch("province")(e.target.value)} className={clsx(inputClass, "mt-1 font-normal")} />
            <datalist id="ph-provinces">
              {PH_PROVINCES.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <label className="block text-sm font-medium text-forest-900">
            <span className="flex items-center gap-1.5">
              Postal code <FieldBadge filled={!!zip.trim()} required={false} />
            </span>
            <input type="text" value={zip} onChange={(e) => touch("zip")(e.target.value)} placeholder="e.g. 1500" className={clsx(inputClass, "mt-1 font-normal")} />
          </label>
        </div>
        <p className="mt-2 text-[11px] text-forest-500">
          City, province, and postal code are derived from the address when
          recognisable — anything the message didn&apos;t contain stays flagged
          for manual entry, never guessed.
        </p>
      </div>

      {leftover && (
        <p className="mt-2 rounded-md bg-forest-50 px-3 py-2 text-xs text-forest-700">
          Looks like the message also contains an order — after creating the
          profile, these lines move to the order box: <span className="font-medium">“{leftover}”</span>
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!canSubmit}
        className="mt-4 w-full rounded-lg bg-forest-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-forest-900 disabled:opacity-50"
      >
        {busy
          ? "Creating profile…"
          : missing.length > 0
            ? `Fill in: ${missing.join(", ")}`
            : "Create Shopify profile → start their order"}
      </button>
      <p className="mt-2 text-xs text-forest-500">
        Creates the customer in Shopify (with the delivery address), selects
        them here, and moves on to order creation.
      </p>
    </div>
  );
}
