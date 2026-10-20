import type { ReactNode } from "react";

export function Logo({ size = 28 }: { size?: number }) {
  // lifeline: baseline, small P wave, sharp QRS spike, T wave, baseline — no container
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, letterSpacing: "-0.02em", fontSize: 17 }}>
      <svg width={size * 1.5} height={size} viewBox="0 0 42 28" aria-hidden style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="lifeline" x1="0" x2="1">
            <stop offset="0" stopColor="#ff8a4c" stopOpacity="0.35" />
            <stop offset="0.35" stopColor="#ff8a4c" />
            <stop offset="1" stopColor="#e2470f" />
          </linearGradient>
        </defs>
        <path
          d="M1 15H11l2-3 2 3h1.5l3-11.5 3.5 21 2.6-9.5 1.4 2H30l1.8-3 1.8 3H41"
          fill="none"
          stroke="url(#lifeline)"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Buffer
    </span>
  );
}

export function Icon({ name, size = 16 }: { name: "arrow" | "shield" | "bolt" | "spark" | "doc" | "clock" | "wallet" | "x" | "check" | "alert" | "chart" | "gear" | "out"; size?: number }) {
  const p: Record<string, ReactNode> = {
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    shield: <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />,
    bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
    spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />,
    doc: <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" />,
    clock: <path d="M12 7v5l3 2M12 21a9 9 0 110-18 9 9 0 010 18z" />,
    wallet: <path d="M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm0 0l2-3h11v3M16 13h2" />,
    x: <path d="M6 6l12 12M18 6L6 18" />,
    check: <path d="M5 12l5 5 9-10" />,
    alert: <path d="M12 3l10 18H2L12 3zM12 10v5M12 18v.5" />,
    chart: <path d="M3 20h18M6 16l4-5 3 3 5-7" />,
    gear: <path d="M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-1V5h-4v2l-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4-2-1z" />,
    out: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {p[name]}
    </svg>
  );
}

export type Tier = "HIGH" | "MEDIUM" | "LOW";
const TIER_TEXT: Record<Tier, string> = { HIGH: "High risk", MEDIUM: "Medium risk", LOW: "Low risk" };
export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className={`tier tier-${tier}`}>
      <Icon name={tier === "LOW" ? "check" : "alert"} />
      {TIER_TEXT[tier]}
    </span>
  );
}

export const usd = (n: number, digits = 0) =>
  (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const signedUsd = (n: number) => (n > 0 ? "+" : "") + usd(n);
export const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

export function when(ms: number) {
  const d = new Date(ms);
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function countdown(ms: number, now = Date.now()) {
  const s = Math.round((ms - now) / 60000);
  if (s < 0) return "released";
  const d = Math.floor(s / 1440);
  const h = Math.floor((s % 1440) / 60);
  const m = s % 60;
  return d > 0 ? `in ${d}d ${h}h` : h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}
export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
