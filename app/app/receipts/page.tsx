"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/api";
import type { ReplayResponse } from "@/lib/types";
import { verifyChain } from "@/lib/verify-client";
import type { Receipt } from "@/src/engine/receipts";
import { ErrorBox, Loading } from "@/components/states";
import { Icon, pct, signedUsd, usd, when } from "@/components/ui";
import s from "../pages.module.css";

type IconName = "doc" | "bolt" | "clock" | "chart" | "check" | "alert" | "shield" | "wallet";
const KIND: Record<string, { title: string; icon: IconName }> = {
  plan: { title: "Plan written", icon: "doc" },
  hedge_open: { title: "Hedge opened", icon: "bolt" },
  hedge_open_failed: { title: "Order rejected", icon: "alert" },
  hedge_skipped: { title: "Hedge skipped", icon: "alert" },
  release: { title: "Number read", icon: "chart" },
  hedge_close: { title: "Hedge closed", icon: "check" },
  kill_switch: { title: "Kill switch", icon: "shield" },
  sodex_connected: { title: "SoDEX connected", icon: "wallet" },
  sodex_disconnected: { title: "SoDEX disconnected", icon: "wallet" },
};

const REASON: Record<string, string> = {
  in_line: "the number came in line",
  good_news: "the number was good for crypto",
  max_hold: "it reached the time limit",
  kill_switch: "the kill switch",
  benign_unwind: "the number came in line",
  risk_on_unwind: "the number was good for crypto",
};

function summary(kind: string, d: Record<string, any>) {
  const mode = d.mode === "live" ? "Sent to SoDEX" : d.mode === "practice" ? "Practice, not sent" : "Signed, not sent";
  switch (kind) {
    case "plan":
      return `${d.tier === "HIGH" ? "High" : d.tier === "MEDIUM" ? "Medium" : "Low"} risk, hedge ${Math.round(Number(d.hedgeRatio) * 100)}% of holdings. ${(d.reasons as string[])?.[0] ?? ""}`;
    case "hedge_open":
      return `${d.event ? `${d.event}: ` : ""}short ${d.qty} ${d.symbol} at ${usd(Number(d.entry), 1)}${d.stopLossPct != null ? `, stop +${pct(Number(d.stopLossPct))}, target −${pct(Number(d.takeProfitPct))}` : `, stop ${usd(Number(d.stopLoss), 1)}, target ${usd(Number(d.takeProfit), 1)}`}. ${mode}${d.orderIDs?.length ? `, order IDs ${d.orderIDs.join(", ")}` : ""}.`;
    case "hedge_open_failed":
      return `${d.event}: ${d.symbol} order failed. ${d.error}`;
    case "hedge_skipped":
      return d.reason === "holdings_unconfirmed" ? `${d.event}: no live hedge, because your holdings weren't confirmed this week.` : `${d.event}: skipped.`;
    case "release":
      return String(d.reason);
    case "hedge_close":
      return `${d.symbol ? `${d.symbol} ` : ""}closed at ${usd(Number(d.exit), 1)}${d.reason ? ` because ${REASON[d.reason] ?? d.reason}` : ""}. The hedge made ${signedUsd(Number(d.pnlUsd))}.`;
    case "kill_switch":
      return `Closed ${d.closed} hedge${d.closed === 1 ? "" : "s"}.`;
    case "sodex_connected":
      return `Trading key "${d.keyName}" on SoDEX ${d.network}, account ${d.accountID}${d.via === "imported" ? ", imported" : ""}.`;
    case "sodex_disconnected":
      return `Buffer deleted its copy of "${d.keyName}".`;
    default:
      return "";
  }
}

function Chain({ title, entries, empty }: { title: string; entries: Receipt[]; empty: string }) {
  const [check, setCheck] = useState<"checking" | "ok" | "broken" | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (!entries.length) return;
    setCheck("checking");
    verifyChain(entries).then((r) => setCheck(r.ok ? "ok" : "broken"));
  }, [entries]);
  return (
    <section className={`glass ${s.panel}`} style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {entries.length > 0 && (
          <span className="tag" role="status">
            <span className="dot" style={{ color: check === "ok" ? "var(--good)" : check === "broken" ? "var(--critical)" : "var(--muted)" }} />
            {check === "ok" ? `${entries.length} entries, chain verified in your browser` : check === "broken" ? "Chain broken" : "Checking chain…"}
          </span>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="small">{empty}</p>
      ) : (
        <>
          <ol className={s.chain}>
            {[...entries].reverse().map((r) => {
              const k = KIND[r.kind] ?? { title: r.kind, icon: "doc" as const };
              return (
                <li key={r.seq} className={s.link}>
                  <span className={s.node}>
                    <Icon name={k.icon} />
                  </span>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <b style={{ fontWeight: 500 }}>{k.title}</b>
                      <span className="small">{when(r.at)}</span>
                    </div>
                    <p style={{ margin: "4px 0", color: "var(--ink-2)", fontSize: 14 }}>{summary(r.kind, r.data as Record<string, unknown>)}</p>
                    <div className={`num ${s.hash}`}>hash {r.hash}</div>
                    <button className="small" style={{ background: "none", border: 0, padding: 0, marginTop: 6, cursor: "pointer", color: "var(--flare-hi)" }} onClick={() => setOpen(open === r.seq ? null : r.seq)} aria-expanded={open === r.seq}>
                      {open === r.seq ? "Hide raw entry" : "Show raw entry"}
                    </button>
                    {open === r.seq && <pre>{JSON.stringify(r, null, 2)}</pre>}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className={`num ${s.hash}`} style={{ marginTop: 10 }}>
            Head {entries.at(-1)!.hash}
          </p>
        </>
      )}
    </section>
  );
}

export default function Receipts() {
  const mine = useApi<{ receipts: Receipt[] }>("/api/hedges");
  const sample = useApi<ReplayResponse>("/api/replay");
  return (
    <>
      <div className={s.head}>
        <div>
          <h1 className="h2">Receipts</h1>
          <p>Every decision is written to a hash-chained log. Change any entry and every hash after it stops matching. Newest first.</p>
        </div>
      </div>
      {mine.error && <ErrorBox message={mine.error} retry={mine.retry} />}
      {mine.loading && !mine.data && <Loading rows={3} />}
      {mine.data && <Chain title="Your account" entries={mine.data.receipts} empty="Nothing yet. Entries appear when Buffer opens its first hedge, or when you connect SoDEX." />}
      {sample.data?.detail && <Chain title={`Example: replay of ${sample.data.detail.label}, ${sample.data.detail.date}`} entries={sample.data.detail.receipts} empty="" />}
    </>
  );
}
