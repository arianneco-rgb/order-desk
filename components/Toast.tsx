"use client";

import { createContext, useCallback, useContext, useState } from "react";
import clsx from "clsx";

type ToastTone = "success" | "error" | "info";
interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

let seq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: ToastTone = "success") => {
    const id = ++seq;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={clsx(
              "od-toast pointer-events-auto flex max-w-sm items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-[var(--shadow-pop)]",
              t.tone === "success" && "bg-forest-800 text-white",
              t.tone === "error" && "bg-red-700 text-white",
              t.tone === "info" && "bg-forest-700 text-white"
            )}
          >
            <span aria-hidden>
              {t.tone === "success" ? "✓" : t.tone === "error" ? "✕" : "ℹ"}
            </span>
            {t.message}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes od-toast-in {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .od-toast { animation: od-toast-in 0.18s ease-out; }
        @media (prefers-reduced-motion: reduce) { .od-toast { animation: none; } }
      `}</style>
    </ToastContext.Provider>
  );
}

/** Fire a toast. Safe to call outside the provider (no-op) so components stay portable. */
export function useToast(): (message: string, tone?: ToastTone) => void {
  const ctx = useContext(ToastContext);
  return ctx ?? (() => {});
}

