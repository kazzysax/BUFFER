"use client";

import { use } from "react";
import { useApi } from "@/lib/api";
import { toQuery, useSettings } from "@/lib/settings";
import type { EventResponse } from "@/lib/types";
import { SurpriseScatter } from "@/components/charts";
import { DataNote, ErrorBox, Loading } from "@/components/states";
import { Icon, TierBadge, countdown, pct, usd, when } from "@/components/ui";
import s from "../../pages.module.css";

const REGIME: Record<string, string> = { risk_off: "Nervous", neutral: "Calm", risk_on: "Complacent" };

export default function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { settings, loaded } = useSettings();
  const { data, error, loading, retry } = useApi<EventResponse>(loaded ? `/api/event/${encodeURIComponent(id)}?${toQuery(settings)}` : null);
  const i = data?.item;

  return (
    <>
      <a href="/app" className="small" style={{ display: "inline-block", marginBottom: 14 }}>
        Back to timeline
      </a>
      {error && <ErrorBox message={error} retry={retry} />}
      {loading && !data && <Loading rows={4} />}
      {i && data && (
        <>
          <div className={s.head}>
            <div>
              <h1 className="h2">{i.meta.label}</h1>
              <p>
                {when(i.releaseAt)} ({countdown(i.releaseAt)}){!i.meta.timeKnown && ", time estimated"}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <TierBadge tier={i.playbook.tier} />
              <DataNote data={data.data} agent={data.agent} />
            </div>
          </div>

          <p className={s.quote}>{i.explanation.text}</p>

          <div className={s.grid2}>
            <section className={`glass ${s.panel}`}>
              <h2>How past releases moved bitcoin</h2>
              <SurpriseScatter samples={i.playbook.samples} />
            </section>

            <section className={`glass ${s.panel}`}>
              <h2>The plan</h2>
              <dl className={s.kv}>
                <dt>Typical move</dt>
                <dd className="num">{pct(i.playbook.medianAbsMove)}</dd>
                <dt>Bad-day move (1 in 10)</dt>
                <dd className="num">{pct(i.playbook.p90AbsMove)}</dd>
                <dt>Fell after a risk-off surprise</dt>
                <dd className="num">{i.playbook.riskOffHitRate == null ? "Not enough data" : pct(i.playbook.riskOffHitRate, 0)}</dd>
                <dt>Releases learned from</dt>
                <dd className="num">{i.playbook.n}</dd>
                <dt>Hedge size</dt>
                <dd className="num">{pct(i.plan.hedgeRatio, 0)} of holdings</dd>
                <dt>Opens</dt>
                <dd>{i.plan.skip ? "No hedge" : when(i.plan.openAt)}</dd>
                <dt>Closes by</dt>
                <dd>{i.plan.skip ? "—" : when(i.plan.closeBy)}</dd>
              </dl>
              {i.plan.legs.length > 0 && (
                <table className={s.table} style={{ marginTop: 18 }}>
                  <thead>
                    <tr>
                      <th>Short</th>
                      <th>Size</th>
                      <th>Value</th>
                      <th>Stop / target</th>
                    </tr>
                  </thead>
                  <tbody className="num">
                    {i.plan.legs.map((l) => (
                      <tr key={l.asset}>
                        <td>{l.symbol}</td>
                        <td>{l.quantity.toFixed(4)}</td>
                        <td>{usd(l.notionalUsd)}</td>
                        <td>±{pct(l.stopLossPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <div className={s.grid2} style={{ marginTop: 16 }}>
            <section className={`glass ${s.panel}`}>
              <h2>Why</h2>
              <ul className={s.reasons}>
                {i.plan.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <h2 style={{ marginTop: 22 }}>Past releases</h2>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Forecast</th>
                    <th>Actual</th>
                    <th>BTC after</th>
                  </tr>
                </thead>
                <tbody className="num">
                  {data.history.map((h) => {
                    const sample = i.playbook.samples.find((x) => x.date === h.date);
                    return (
                      <tr key={h.date}>
                        <td>{h.date}</td>
                        <td>{h.forecast ?? "—"}</td>
                        <td>{h.actual ?? "—"}</td>
                        <td>{sample ? `${sample.move > 0 ? "+" : ""}${pct(sample.move)}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <section className={`glass ${s.panel}`}>
              <h2>Agent read</h2>
              {i.read ? (
                <>
                  <dl className={s.kv} style={{ marginBottom: 14 }}>
                    <dt>Market mood</dt>
                    <dd>{REGIME[i.read.value.regime]}</dd>
                    <dt>Size adjustment</dt>
                    <dd className="num">×{i.read.value.sizeMultiplier.toFixed(2)}</dd>
                    <dt>Source</dt>
                    <dd>{i.read.source === "agent" ? i.read.model : "Rules only"}</dd>
                  </dl>
                  <p className="small" style={{ marginTop: 0 }}>
                    {i.read.value.rationale}
                  </p>
                </>
              ) : (
                <p className="small">Low-risk release, so the agent wasn&rsquo;t asked.</p>
              )}
              <ul className={s.news}>
                {data.news.map((n) => {
                  const cited = i.read?.value.citedIds.includes(n.id);
                  return (
                    <li key={n.id} className={`inset ${cited ? s.cited : ""}`}>
                      <Icon name={cited ? "check" : "doc"} />
                      <span>
                        {n.link ? (
                          <a href={n.link} target="_blank" rel="noreferrer">
                            {n.title}
                          </a>
                        ) : (
                          n.title
                        )}
                        {cited && <span className="small"> (cited)</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </>
      )}
    </>
  );
}
