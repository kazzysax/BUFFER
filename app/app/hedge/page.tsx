"use client";

import { useState } from "react";
import { useApi } from "@/lib/api";
import { toQuery, useSettings } from "@/lib/settings";
import type { ReplayResponse } from "@/lib/types";
import { ReplayChart } from "@/components/charts";
import { DataNote, ErrorBox, Loading } from "@/components/states";
import { Icon, TierBadge, signedUsd, usd, when } from "@/components/ui";
import s from "../pages.module.css";

const CLOSE: Record<string, string> = {
  benign_unwind: "Number in line, hedge removed",
  risk_on_unwind: "Good news, hedge removed",
  max_hold: "Bad news, held to the time limit",
  stop_loss: "Price spiked, stop closed the hedge",
  take_profit: "Target hit",
};

export default function Hedge() {
  const { settings, loaded } = useSettings();
  const [pick, setPick] = useState<string | null>(null);
  const q = loaded ? `/api/replay?${toQuery(settings)}${pick ? `&pick=${encodeURIComponent(pick)}` : ""}` : null;
  const { data, error, loading, retry } = useApi<ReplayResponse>(q);
  const d = data?.detail;

  return (
    <>
      <div className={s.head}>
        <div>
          <h1 className="h2">Track record</h1>
          <p>Buffer replayed on the last {data?.summary.runs ?? 10} risky releases, using only what it would have known at the time. BTC leg only.</p>
        </div>
        {data && <DataNote data={data.data} agent={data.agent} />}
      </div>

      {error && <ErrorBox message={error} retry={retry} />}
      {loading && !data && <Loading rows={4} />}

      {data && (
        <div className={s.stats}>
          <div className={`glass ${s.stat}`}>
            <span className="small">Net vs holding only</span>
            <b className="num" style={{ color: data.summary.netUsd >= 0 ? "var(--ink)" : "#ffb0b0" }}>
              {signedUsd(data.summary.netUsd)}
            </b>
          </div>
          <div className={`glass ${s.stat}`}>
            <span className="small">Worst dips cushioned</span>
            <b className="num">{usd(data.summary.cushionedUsd)}</b>
          </div>
          <div className={`glass ${s.stat}`}>
            <span className="small">Releases replayed</span>
            <b className="num">{data.summary.runs}</b>
          </div>
        </div>
      )}

      {data && (
        <div className={s.grid2}>
          <section className={`glass ${s.panel}`}>
            {d ? (
              <>
                <h2>
                  {d.label}, {d.date}
                </h2>
                <ReplayChart points={d.points} releaseAt={d.releaseAt} />
                <dl className={s.kv} style={{ marginTop: 16 }}>
                  <dt>Opened</dt>
                  <dd className="num">
                    {when(d.openedAt)}, short {d.qty} BTC at {usd(d.entry)}
                  </dd>
                  <dt>The number</dt>
                  <dd>{d.decision.reason}</dd>
                  <dt>Closed</dt>
                  <dd className="num">
                    {when(d.closedAt)} at {usd(d.exit)}
                  </dd>
                  <dt>Outcome</dt>
                  <dd>{CLOSE[d.closeReason]}</dd>
                  <dt>Versus holding only</dt>
                  <dd className="num">{signedUsd(d.savedUsd)}</dd>
                </dl>
              </>
            ) : (
              <p className="small">No past releases with enough price history to replay yet.</p>
            )}
          </section>

          <section className={`glass ${s.panel}`}>
            <h2>Recent releases</h2>
            <div className={s.runs}>
              {data.runs.map((r) => (
                <button key={r.key} className={`${s.run} ${d?.key === r.key ? s.runOn : ""}`} onClick={() => setPick(r.key)} aria-pressed={d?.key === r.key}>
                  <span>
                    <b style={{ fontWeight: 500 }}>{r.label}</b> <span className="small">{r.date}</span>
                  </span>
                  <b className="num" style={{ fontWeight: 500, color: r.savedUsd >= 0 ? "var(--ink)" : "#ffb0b0" }}>
                    {signedUsd(r.savedUsd)}
                  </b>
                  <span className="small">{CLOSE[r.closeReason]}</span>
                  <TierBadge tier={r.tier} />
                </button>
              ))}
            </div>
            <div className="inset" style={{ marginTop: 18, padding: 16 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                <Icon name="shield" />
                <b style={{ fontWeight: 500 }}>Kill switch</b>
              </div>
              <p className="small" style={{ margin: "0 0 12px" }}>
                Cancels every open order and closes any hedge with reduce-only orders. Available once live trading is connected.
              </p>
              <button className="btn btn-danger btn-sm" disabled aria-disabled title="Connect SoDEX in Settings first">
                Close all hedges
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
