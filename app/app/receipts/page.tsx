"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/api";
import { toQuery, useSettings } from "@/lib/settings";
import type { ReplayResponse } from "@/lib/types";
import { verifyChain } from "@/lib/verify-client";
import { DataNote, ErrorBox, Loading } from "@/components/states";
import { Icon, signedUsd, usd, when } from "@/components/ui";
import s from "../pages.module.css";

const KIND: Record<string, { title: string; icon: "doc" | "bolt" | "clock" | "chart" | "check" }> = {
  plan: { title: "Plan written", icon: "doc" },
  hedge_open: { title: "Hedge order signed", icon: "bolt" },
  dead_man_armed: { title: "Auto-cancel armed", icon: "clock" },
  release: { title: "Number read", icon: "chart" },
  hedge_close: { title: "Hedge closed", icon: "check" },
};

function summary(kind: string, d: Record<string, unknown>) {
  switch (kind) {
    case "plan":
      return `${d.tier === "HIGH" ? "High" : d.tier === "MEDIUM" ? "Medium" : "Low"} risk, hedge ${Math.round(Number(d.hedgeRatio) * 100)}% of holdings. ${(d.reasons as string[])[0] ?? ""}`;
    case "hedge_open":
      return `Short ${d.qty} ${d.symbol} at ${usd(Number(d.entry), 1)}, stop ${usd(Number(d.stopLoss), 1)}, target ${usd(Number(d.takeProfit), 1)}. Practice mode, signed but not sent.`;
    case "dead_man_armed":
      return `If Buffer goes quiet, every open order cancels at ${when(Number(d.cancelAllAt))}.`;
    case "release":
      return String(d.reason);
    case "hedge_close":
      return `Closed at ${usd(Number(d.exit), 1)}. The hedge made ${signedUsd(Number(d.pnlUsd))}.`;
    default:
      return "";
  }
}

export default function Receipts() {
  const { settings, loaded } = useSettings();
  const { data, error, loading, retry } = useApi<ReplayResponse>(loaded ? `/api/replay?${toQuery(settings)}` : null);
  const d = data?.detail;
  const [check, setCheck] = useState<"checking" | "ok" | "broken" | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (!d) return;
    setCheck("checking");
    verifyChain(d.receipts).then((r) => setCheck(r.ok ? "ok" : "broken"));
  }, [d]);

  return (
    <>
      <div className={s.head}>
        <div>
          <h1 className="h2">Receipts</h1>
          <p>Every decision is written to a hash-chained log. Change any entry and every hash after it stops matching.</p>
        </div>
        {data && <DataNote data={data.data} agent={data.agent} />}
      </div>
      {error && <ErrorBox message={error} retry={retry} />}
      {loading && !data && <Loading rows={5} />}
      {d && (
        <section className={`glass ${s.panel}`}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>
              {d.label}, {d.date}
            </h2>
            <span className="tag" role="status">
              <span className="dot" style={{ color: check === "ok" ? "var(--good)" : check === "broken" ? "var(--critical)" : "var(--muted)" }} />
              {check === "ok" ? "Chain verified in your browser" : check === "broken" ? "Chain broken" : "Checking chain…"}
            </span>
          </div>
          <ol className={s.chain}>
            {d.receipts.map((r) => {
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
            Head {d.head}
          </p>
        </section>
      )}
    </>
  );
}
