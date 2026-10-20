"use client";

import { useApi } from "@/lib/api";
import { toQuery, useSettings } from "@/lib/settings";
import type { TimelineResponse } from "@/lib/types";
import { DataNote, ErrorBox, Loading } from "@/components/states";
import { TierBadge, countdown, usd } from "@/components/ui";
import s from "./pages.module.css";

export default function Timeline() {
  const { settings, loaded } = useSettings();
  const { data, error, loading, retry } = useApi<TimelineResponse>(loaded ? `/api/timeline?${toQuery(settings)}` : null);

  const items = data?.items ?? [];
  const hedges = items.filter((i) => !i.plan.skip);
  const value = data ? data.holdings.BTC * data.prices.BTC + data.holdings.ETH * data.prices.ETH : 0;
  const next = hedges[0];

  const byDay = new Map<string, typeof items>();
  for (const i of items) {
    const k = new Date(i.releaseAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    byDay.set(k, [...(byDay.get(k) ?? []), i]);
  }

  return (
    <>
      <div className={s.head}>
        <div>
          <h1 className="h2">Next two weeks</h1>
          <p>Every scheduled release, how risky it has been for bitcoin, and what Buffer will do about it.</p>
        </div>
        {data && <DataNote data={data.data} agent={data.agent} />}
      </div>

      {data && (
        <div className={s.stats}>
          <div className={`glass ${s.stat}`}>
            <span className="small">Holdings watched</span>
            <b className="num">{usd(value)}</b>
          </div>
          <div className={`glass ${s.stat}`}>
            <span className="small">Hedges planned</span>
            <b className="num">
              {hedges.length} of {items.length} releases
            </b>
          </div>
          <div className={`glass ${s.stat}`}>
            <span className="small">Next hedge opens</span>
            <b className="num">{next ? countdown(next.plan.openAt) : "None planned"}</b>
          </div>
        </div>
      )}

      {error && <ErrorBox message={error} retry={retry} />}
      {loading && !data && <Loading rows={5} />}
      {data && items.length === 0 && (
        <div className={`glass ${s.empty}`}>
          <h2 className="h3">No releases in the next 14 days</h2>
          <p className="small">Buffer checks the calendar every 30 minutes. New events will appear here.</p>
        </div>
      )}

      <div className={s.days}>
        {[...byDay].map(([day, list]) => (
          <section key={day} className={s.day}>
            <h2>{day}</h2>
            <div className={s.rows}>
              {list.map((i) => (
                <a key={i.id} href={`/app/event/${i.id}`} className={`glass ${s.row} ${i.playbook.tier === "HIGH" ? s.hot : ""}`}>
                  <span className={`num ${s.time}`}>{new Date(i.releaseAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                  <div>
                    <h3>
                      {i.meta.label}
                      {!i.meta.timeKnown && <span className="small"> (time estimated)</span>}
                    </h3>
                    <p>{i.explanation.text}</p>
                  </div>
                  <div className={s.rowRight}>
                    <TierBadge tier={i.playbook.tier} />
                    <span className="small num">{i.plan.skip ? "No hedge" : `Hedge ${usd(i.plan.legs.reduce((a, l) => a + l.notionalUsd, 0))}`}</span>
                  </div>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
