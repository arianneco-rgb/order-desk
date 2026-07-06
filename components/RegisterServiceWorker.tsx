"use client";

import { useEffect } from "react";

/** Registers the install-ability service worker; no-op if unsupported. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
