import type { Tier } from "./ui";

export interface WireNode {
  id: string;
  label: string;
  at: number;
  tier: Tier;
}

const AMP: Record<Tier, number> = { HIGH: 34, MEDIUM: 20, LOW: 8 };

/** One heartbeat (P wave, QRS spike, T wave) centred on x, scaled by amplitude a. Returns path segments. */
function beat(x: number, y: number, a: number) {
  const k = a / 34;
  return [
    `L${x - 22 * k} ${y}`,
    `L${x - 17 * k} ${y - 4 * k}`,
    `L${x - 12 * k} ${y}`,
    `L${x - 5 * k} ${y}`,
    `L${x - 1.5 * k} ${y - a}`,
    `L${x + 3 * k} ${y + a * 0.55}`,
    `L${x + 7 * k} ${y}`,
    `L${x + 13 * k} ${y}`,
    `L${x + 19 * k} ${y - 6 * k}`,
    `L${x + 25 * k} ${y}`,
  ].join(" ");
}

/**
 * The lifeline: a heart-monitor trace across the next 14 days. Each day with a macro release beats;
 * the riskier the day, the bigger the spike. Labels alternate above/below so neighbours don't collide.
 */
export function Wire({ nodes, now, days = 14 }: { nodes: WireNode[]; now: number; days?: number }) {
  const W = 1200;
  const H = 190;
  const y = 98;
  const span = days * 86_400_000;
  const x = (t: number) => 40 + ((t - now) / span) * (W - 80);
  const visible = nodes.filter((n) => n.at >= now && n.at <= now + span);

  // One beat per day: the riskiest release names it, the rest are counted.
  const rank: Record<Tier, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const groups = new Map<string, WireNode[]>();
  for (const n of visible) {
    const k = new Date(n.at).toDateString();
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  const placed = [...groups.values()]
    .map((g) => {
      const top = [...g].sort((a, b) => rank[b.tier] - rank[a.tier] || a.at - b.at)[0];
      return { ...top, label: g.length > 1 ? `${top.label} +${g.length - 1}` : top.label, x: x(top.at) };
    })
    .sort((a, b) => a.x - b.x)
    .map((n, k) => ({ ...n, up: k % 2 === 0 }));

  let d = `M0 ${y}`;
  for (const n of placed) d += " " + beat(n.x, y, AMP[n.tier]);
  d += ` L${W} ${y}`;

  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Macro releases in the next ${days} days`} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id="trace" x1="0" x2="1">
          <stop offset="0" stopColor="#ff6a2b" stopOpacity="0" />
          <stop offset="0.1" stopColor="#ff6a2b" stopOpacity="0.95" />
          <stop offset="0.9" stopColor="#ff6a2b" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ff6a2b" stopOpacity="0" />
        </linearGradient>
        <filter id="glow" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      {Array.from({ length: days + 1 }, (_, i) => (
        <line key={i} x1={x(now + i * 86_400_000)} x2={x(now + i * 86_400_000)} y1={y - 3} y2={y + 3} stroke="rgba(255,255,255,0.16)" />
      ))}
      <path d={d} fill="none" stroke="url(#trace)" strokeWidth="6" filter="url(#glow)" opacity="0.55" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="url(#trace)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <text x={x(now)} y={y + 22} fontSize="12" fill="var(--muted)">
        Today
      </text>
      <text x={x(now + span)} y={y + 22} fontSize="12" fill="var(--muted)" textAnchor="end">
        +{days} days
      </text>
      {placed.map((n) => {
        const hot = n.tier === "HIGH";
        const ly = n.up ? y - AMP.HIGH - 30 : y + 46;
        return (
          <g key={n.id}>
            <circle cx={n.x - 1.5 * (AMP[n.tier] / 34)} cy={y - AMP[n.tier]} r={hot ? 3.5 : 2.5} fill={hot ? "#ffb08a" : n.tier === "MEDIUM" ? "#fab219" : "rgba(255,255,255,0.6)"} />
            <text x={n.x} y={ly} fontSize="13" textAnchor="middle" fill={hot ? "var(--ink)" : "var(--ink-2)"} fontWeight={hot ? 500 : 400}>
              {n.label}
            </text>
            <text x={n.x} y={ly + 15} fontSize="11" textAnchor="middle" fill="var(--muted)">
              {day(n.at)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
