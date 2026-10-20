"use client";

import { useMemo, useRef, useState } from "react";
import { pct, signedUsd, usd } from "./ui";

const W = 720;

function useHover() {
  const [i, setI] = useState<number | null>(null);
  return { i, setI };
}

function niceTicks(lo: number, hi: number, n = 4) {
  const span = hi - lo || 1;
  const step = 10 ** Math.floor(Math.log10(span / n));
  const err = (span / n) / step;
  const s = step * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
  const out: number[] = [];
  for (let v = Math.ceil(lo / s) * s; v <= hi + 1e-9; v += s) out.push(+v.toFixed(10));
  return out;
}

export interface ReplayPoint {
  t: number;
  price: number;
  unhedged: number;
  hedged: number;
  hedgeOpen: boolean;
}

/** Hedged vs unhedged portfolio change (USD) across one release. Two series, one axis. */
export function ReplayChart({ points, releaseAt, height = 300 }: { points: ReplayPoint[]; releaseAt: number; height?: number }) {
  const H = height;
  const pad = { l: 56, r: 92, t: 18, b: 30 };
  const svg = useRef<SVGSVGElement>(null);
  const { i, setI } = useHover();
  const m = useMemo(() => {
    const u0 = points[0].unhedged;
    const h0 = points[0].hedged;
    const un = points.map((p) => p.unhedged - u0);
    const he = points.map((p) => p.hedged - h0);
    const lo = Math.min(0, ...un, ...he);
    const hi = Math.max(0, ...un, ...he);
    const padY = (hi - lo) * 0.12 || 10;
    const y0 = lo - padY;
    const y1 = hi + padY;
    const t0 = points[0].t;
    const t1 = points.at(-1)!.t;
    const x = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
    const path = (vs: number[]) => vs.map((v, k) => `${k ? "L" : "M"}${x(points[k].t).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const openIdx = points.map((p, k) => (p.hedgeOpen ? k : -1)).filter((k) => k >= 0);
    return { un, he, x, y, path, ticks: niceTicks(y0, y1), openIdx };
  }, [points, H]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((p, k) => {
      if (Math.abs(m.x(p.t) - px) < Math.abs(m.x(points[best].t) - px)) best = k;
    });
    setI(best);
  };
  const last = points.length - 1;
  const band = m.openIdx.length ? [m.x(points[m.openIdx[0]].t), m.x(points[m.openIdx.at(-1)!].t)] : null;
  const fmtT = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <figure style={{ margin: 0 }}>
      <div style={{ display: "flex", gap: 18, fontSize: 13, color: "var(--ink-2)", marginBottom: 8, flexWrap: "wrap" }} aria-hidden>
        <Legend color="var(--series-hedged)" label="With Buffer" />
        <Legend color="var(--series-unhedged)" label="Holding only" />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 14, height: 10, background: "rgba(255,106,43,0.12)", border: "1px dashed rgba(255,106,43,0.5)", borderRadius: 3 }} />
          Hedge open
        </span>
      </div>
      <div style={{ position: "relative" }}>
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label="Portfolio change with and without the hedge around the release"
          onPointerMove={onMove}
          onPointerLeave={() => setI(null)}
          style={{ display: "block", touchAction: "none" }}
        >
          {m.ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={m.y(v)} y2={m.y(v)} stroke={v === 0 ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.06)"} />
              <text x={pad.l - 10} y={m.y(v) + 4} textAnchor="end" fontSize="13" fill="var(--muted)" className="num">
                {usd(v)}
              </text>
            </g>
          ))}
          {band && <rect x={band[0]} y={pad.t} width={Math.max(2, band[1] - band[0])} height={H - pad.t - pad.b} fill="rgba(255,106,43,0.07)" stroke="rgba(255,106,43,0.35)" strokeDasharray="4 4" rx="4" />}
          <line x1={m.x(releaseAt)} x2={m.x(releaseAt)} y1={pad.t} y2={H - pad.b} stroke="var(--ink-2)" strokeDasharray="2 4" />
          <text x={m.x(releaseAt) + 6} y={pad.t + 12} fontSize="13" fill="var(--ink-2)">
            Release
          </text>
          <path d={m.path(m.un)} fill="none" stroke="var(--series-unhedged)" strokeWidth="2" strokeLinejoin="round" />
          <path d={m.path(m.he)} fill="none" stroke="var(--series-hedged)" strokeWidth="2" strokeLinejoin="round" />
          {/* direct labels at the end */}
          <circle cx={m.x(points[last].t)} cy={m.y(m.he[last])} r="4" fill="var(--series-hedged)" stroke="var(--surface-chart)" strokeWidth="2" />
          <circle cx={m.x(points[last].t)} cy={m.y(m.un[last])} r="4" fill="var(--series-unhedged)" stroke="var(--surface-chart)" strokeWidth="2" />
          <EndLabel x={m.x(points[last].t) + 10} y={m.y(m.he[last])} other={m.y(m.un[last])} text={signedUsd(m.he[last])} />
          <EndLabel x={m.x(points[last].t) + 10} y={m.y(m.un[last])} other={m.y(m.he[last])} text={signedUsd(m.un[last])} />
          {[0, Math.floor(last / 2), last].map((k) => (
            <text key={k} x={m.x(points[k].t)} y={H - 8} fontSize="13" fill="var(--muted)" textAnchor={k === 0 ? "start" : k === last ? "end" : "middle"}>
              {fmtT(points[k].t)}
            </text>
          ))}
          {i != null && (
            <g>
              <line x1={m.x(points[i].t)} x2={m.x(points[i].t)} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.35)" />
              <circle cx={m.x(points[i].t)} cy={m.y(m.he[i])} r="5" fill="var(--series-hedged)" stroke="var(--surface-chart)" strokeWidth="2" />
              <circle cx={m.x(points[i].t)} cy={m.y(m.un[i])} r="5" fill="var(--series-unhedged)" stroke="var(--surface-chart)" strokeWidth="2" />
            </g>
          )}
        </svg>
        {i != null && (
          <Tip leftPct={(m.x(points[i].t) / W) * 100}>
            <div style={{ color: "var(--muted)", marginBottom: 4 }}>{fmtT(points[i].t)} · BTC {usd(points[i].price)}</div>
            <Row color="var(--series-hedged)" label="With Buffer" value={signedUsd(m.he[i])} />
            <Row color="var(--series-unhedged)" label="Holding only" value={signedUsd(m.un[i])} />
            <div style={{ color: "var(--muted)", marginTop: 4 }}>{points[i].hedgeOpen ? "Hedge open" : "No hedge"}</div>
          </Tip>
        )}
      </div>
      <details style={{ marginTop: 10 }}>
        <summary className="small" style={{ cursor: "pointer" }}>
          Show as table
        </summary>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", marginTop: 8 }} className="num">
          <thead>
            <tr style={{ color: "var(--muted)", textAlign: "left" }}>
              <th>Time</th>
              <th>BTC</th>
              <th>With Buffer</th>
              <th>Holding only</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, k) => (
              <tr key={p.t} style={{ borderTop: "1px solid var(--line)" }}>
                <td>{fmtT(p.t)}</td>
                <td>{usd(p.price)}</td>
                <td>{signedUsd(m.he[k])}</td>
                <td>{signedUsd(m.un[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function EndLabel({ x, y, other, text }: { x: number; y: number; other: number; text: string }) {
  const nudge = Math.abs(y - other) < 14 ? (y < other ? -7 : 7) : 0;
  return (
    <text x={x} y={y + 4 + nudge} fontSize="12" fill="var(--ink)" className="num">
      {text}
    </text>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 14, height: 3, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}
function Row({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
        {label}
      </span>
      <b className="num" style={{ fontWeight: 500 }}>
        {value}
      </b>
    </div>
  );
}
function Tip({ leftPct, children }: { leftPct: number; children: React.ReactNode }) {
  return (
    <div
      role="status"
      style={{
        position: "absolute",
        top: 8,
        left: `${leftPct}%`,
        transform: `translateX(${leftPct > 60 ? "calc(-100% - 12px)" : "12px"})`,
        background: "rgba(14,13,12,0.95)",
        border: "1px solid var(--line-2)",
        borderRadius: 12,
        padding: "10px 12px",
        fontSize: 12,
        minWidth: 190,
        pointerEvents: "none",
      }}
    >
      {children}
    </div>
  );
}

export interface Sample {
  date: string;
  surpriseZ: number | null;
  move: number;
  absMove: number;
}

/** Past releases: surprise size vs BTC move. Single series; marks are the data. */
export function SurpriseScatter({ samples, height = 260 }: { samples: Sample[]; height?: number }) {
  const H = height;
  const pad = { l: 48, r: 16, t: 14, b: 34 };
  const pts = samples.filter((s) => s.surpriseZ != null);
  const [i, setI] = useState<number | null>(null);
  const xMax = Math.max(1, ...pts.map((s) => Math.abs(s.surpriseZ!))) * 1.1;
  const yMax = Math.max(0.01, ...pts.map((s) => Math.abs(s.move))) * 1.15;
  const x = (z: number) => pad.l + ((z + xMax) / (2 * xMax)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v + yMax) / (2 * yMax)) * (H - pad.t - pad.b);
  const yt = niceTicks(-yMax, yMax, 4);
  if (!pts.length) return <p className="small">Not enough past releases with both a forecast and a price to chart.</p>;
  return (
    <figure style={{ margin: 0, position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Surprise versus BTC move for past releases" style={{ display: "block" }} onPointerLeave={() => setI(null)}>
        {yt.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.06)"} />
            <text x={pad.l - 8} y={y(v) + 4} fontSize="13" textAnchor="end" fill="var(--muted)" className="num">
              {pct(v, 0)}
            </text>
          </g>
        ))}
        <line x1={x(0)} x2={x(0)} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.14)" />
        <text x={pad.l} y={H - 10} fontSize="13" fill="var(--muted)">
          Cooler than forecast
        </text>
        <text x={W - pad.r} y={H - 10} fontSize="13" fill="var(--muted)" textAnchor="end">
          Hotter than forecast
        </text>
        {pts.map((s, k) => (
          <g key={s.date} onPointerEnter={() => setI(k)} style={{ cursor: "default" }}>
            <circle cx={x(s.surpriseZ!)} cy={y(s.move)} r="14" fill="transparent" />
            <circle cx={x(s.surpriseZ!)} cy={y(s.move)} r={i === k ? 7 : 5} fill="var(--series-hedged)" stroke="var(--surface-chart)" strokeWidth="2" />
          </g>
        ))}
      </svg>
      {i != null && (
        <Tip leftPct={(x(pts[i].surpriseZ!) / W) * 100}>
          <div style={{ color: "var(--muted)" }}>{pts[i].date}</div>
          <div className="num">Surprise {pts[i].surpriseZ!.toFixed(2)}σ</div>
          <div className="num">BTC {pts[i].move > 0 ? "+" : ""}{pct(pts[i].move)}</div>
        </Tip>
      )}
      <figcaption className="small" style={{ marginTop: 6 }}>
        Each dot is one past release: how far the number landed from forecast, and how BTC moved from 1 hour before to 4 hours after.
      </figcaption>
    </figure>
  );
}

/** Decorative sparkline for preview cards. */
export function Spark({ values, color = "var(--flare)", width = 90, height = 28 }: { values: number[]; color?: string; width?: number; height?: number }) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const d = values.map((v, k) => `${k ? "L" : "M"}${((k / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - lo) / (hi - lo || 1)) * (height - 4)).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
