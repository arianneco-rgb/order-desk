// Print-safe chart primitives for the Reports page — pure SVG/divs, no
// chart library, so window.print() → Save as PDF renders them perfectly.

import clsx from "clsx";
import type { ReportBucket, ReportStat } from "@/lib/reports";
import { formatPeso } from "@/lib/conversions";

/** "₱12,500" → "₱12.5k", "₱1,250,000" → "₱1.25M" — axis/bar labels. */
export function compactPeso(n: number): string {
  if (n >= 1_000_000) return `₱${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2)}M`;
  if (n >= 1_000) return `₱${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return formatPeso(n);
}

/** ▲ 12% / ▼ 5% / — vs the previous period. */
export function Delta({ stat, downIsGood = false }: { stat: ReportStat; downIsGood?: boolean }) {
  if (stat.previous === 0) {
    return stat.current > 0 ? (
      <span className="text-xs font-semibold text-forest-600">new</span>
    ) : (
      <span className="text-xs text-forest-400">—</span>
    );
  }
  const pct = ((stat.current - stat.previous) / stat.previous) * 100;
  if (Math.abs(pct) < 0.5) return <span className="text-xs text-forest-400">±0%</span>;
  const up = pct > 0;
  const good = downIsGood ? !up : up;
  return (
    <span
      className={clsx(
        "text-xs font-semibold",
        good ? "text-forest-700" : "text-red-700"
      )}
    >
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(Math.abs(pct) >= 10 ? 0 : 1)}%
    </span>
  );
}

/** One headline number with its previous-period delta. */
export function StatCard({
  label,
  value,
  stat,
  sub,
  downIsGood = false,
}: {
  label: string;
  value: string;
  stat?: ReportStat;
  sub?: string;
  downIsGood?: boolean;
}) {
  return (
    <div className="break-inside-avoid rounded-xl border border-forest-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-forest-500">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-2">
        <span className="text-xl font-bold text-forest-900">{value}</span>
        {stat && <Delta stat={stat} downIsGood={downIsGood} />}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-forest-500">{sub}</p>}
    </div>
  );
}

/**
 * Revenue-over-time vertical bars (SVG). Zero-filled buckets keep quiet
 * stretches honest; sparse x labels so long ranges stay legible.
 */
export function TimeBars({ series }: { series: ReportBucket[] }) {
  const W = 720;
  const H = 200;
  const PAD_L = 52;
  const PAD_B = 24;
  const PAD_T = 12;
  const plotW = W - PAD_L - 8;
  const plotH = H - PAD_T - PAD_B;

  const max = Math.max(...series.map((b) => b.revenue), 1);
  const n = series.length;
  const step = plotW / n;
  const barW = Math.max(2, Math.min(step * 0.7, 40));
  const labelEvery = Math.ceil(n / 8);

  const gridLines = [0.5, 1].map((f) => ({
    y: PAD_T + plotH * (1 - f),
    value: max * f,
  }));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-3 w-full"
      role="img"
      aria-label="Revenue over time"
    >
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={PAD_L} y1={g.y} x2={W - 8} y2={g.y} stroke="#d8e3dc" strokeWidth={1} />
          <text x={PAD_L - 6} y={g.y + 3.5} textAnchor="end" fontSize={10} fill="#5f7a6c">
            {compactPeso(g.value)}
          </text>
        </g>
      ))}
      <line x1={PAD_L} y1={PAD_T + plotH} x2={W - 8} y2={PAD_T + plotH} stroke="#9db4a7" strokeWidth={1} />

      {series.map((b, i) => {
        const h = max > 0 ? (b.revenue / max) * plotH : 0;
        const x = PAD_L + i * step + (step - barW) / 2;
        return (
          <g key={i}>
            <rect
              x={x}
              y={PAD_T + plotH - h}
              width={barW}
              height={Math.max(h, b.revenue > 0 ? 2 : 0)}
              rx={2}
              fill="#2f6b4f"
            />
            {i % labelEvery === 0 && (
              <text
                x={PAD_L + i * step + step / 2}
                y={H - 8}
                textAnchor="middle"
                fontSize={9.5}
                fill="#5f7a6c"
              >
                {b.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal bar list — top products / top cafes. Plain divs, prints cleanly. */
export function HBars({
  items,
}: {
  items: { label: string; value: number; display: string; sub?: string }[];
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="mt-3 space-y-2">
      {items.map((item) => (
        <div key={item.label} className="break-inside-avoid">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-forest-900">
              {item.label}
              {item.sub && <span className="text-xs text-forest-500"> · {item.sub}</span>}
            </span>
            <span className="shrink-0 font-semibold text-forest-900">{item.display}</span>
          </div>
          <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-forest-100">
            <div
              className="h-full rounded-full bg-forest-600"
              style={{ width: `${Math.max((item.value / max) * 100, 1)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
