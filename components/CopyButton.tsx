"use client";

import { useState } from "react";
import clsx from "clsx";

/** Copy-to-clipboard with a brief "Copied ✓" confirmation. */
export function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers / non-secure contexts.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={clsx(
        "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
        copied
          ? "border-forest-600 bg-forest-600 text-white"
          : "border-forest-300 bg-white text-forest-800 hover:bg-forest-50",
        className
      )}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
