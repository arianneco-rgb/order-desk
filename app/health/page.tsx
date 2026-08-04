"use client";

import { useCallback, useEffect, useState } from "react";

type Check = { ok: boolean; diagnosis: string; fix?: string; detail?: string };
type Health = {
  ok: boolean;
  info?: { urlFingerprint: string; secretLength: number; probes?: number; transientFailures?: number };
  checks: Check[];
};

export default function HealthPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/health/apps-script", { cache: "no-store" });
      setHealth((await res.json()) as Health);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold text-forest-900">Connection check</h1>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="rounded-md border border-forest-300 bg-white px-3 py-1.5 text-sm font-semibold text-forest-800 transition-colors hover:bg-forest-50 disabled:opacity-50"
        >
          {loading ? "Checking…" : "Re-check"}
        </button>
      </div>
      <p className="mt-1 text-sm text-forest-600">
        Tests the Google Sheets / Apps Script bridge and says exactly what to fix if it&apos;s down.
      </p>

      {error && (
        <p className="mt-6 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>
      )}

      {health && (
        <>
          <div
            className={
              health.ok
                ? "mt-6 rounded-lg border border-forest-300 bg-forest-50 p-4"
                : "mt-6 rounded-lg border border-red-300 bg-red-50 p-4"
            }
          >
            <p className={health.ok ? "font-semibold text-forest-900" : "font-semibold text-red-900"}>
              {health.ok ? "✓ Apps Script bridge is working" : "✕ Apps Script bridge is down"}
            </p>
          </div>

          {health.checks.map((check, i) => (
            <div key={i} className="mt-4 rounded-lg border border-forest-200 bg-white p-4">
              <p className="text-sm font-semibold text-forest-900">What&apos;s happening</p>
              <p className="mt-1 text-sm text-forest-700">{check.diagnosis}</p>
              {check.fix && (
                <>
                  <p className="mt-3 text-sm font-semibold text-forest-900">How to fix it</p>
                  <p className="mt-1 text-sm text-forest-700">{check.fix}</p>
                </>
              )}
              {check.detail && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-forest-500">
                    Raw response
                  </summary>
                  <pre className="mt-1.5 overflow-x-auto rounded bg-forest-50 p-2 text-[11px] text-forest-700">
                    {check.detail}
                  </pre>
                </details>
              )}
            </div>
          ))}

          {health.info && (
            <p className="mt-4 text-xs text-forest-500">
              Calling deployment {health.info.urlFingerprint} · secret is {health.info.secretLength} characters
              {health.info.probes !== undefined &&
                ` · ${health.info.probes - (health.info.transientFailures ?? 0)}/${health.info.probes} probe calls succeeded`}
              . Compare that deployment ending against Apps Script → Deploy → Manage deployments.
            </p>
          )}
        </>
      )}
    </main>
  );
}
