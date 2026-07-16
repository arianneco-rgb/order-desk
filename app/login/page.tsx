"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      setError("Wrong password — try again.");
    } catch {
      setError("Couldn't reach the server — check your connection and retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-forest-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-xl font-semibold text-forest-900">
          Ritual Matcha · Order Desk
        </h1>
        <p className="mt-1 text-sm text-forest-700">
          Enter the shared dashboard password.
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-4 w-full rounded-md border border-forest-300 px-3 py-2 text-sm focus:border-forest-600 focus:outline-none"
          placeholder="Password"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 w-full rounded-md bg-forest-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-forest-800 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
