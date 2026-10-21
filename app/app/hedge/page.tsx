"use client";

import { useState } from "react";
import { useApi } from "@/lib/api";
import { useMe } from "@/lib/me";
import type { ReplayResponse } from "@/lib/types";
import type { HedgeState } from "@/src/engine/executor";
import { ReplayChart } from "@/components/charts";
import { DataNote, ErrorBox, Loading } from "@/components/states";
import { Icon, TierBadge, countdown, pct, signedUsd, usd, when } from "@/components/ui";
import s from "../pages.module.css";

const CLOSE: Record<string, string> = {
  benign_unwind: "Number in line, hedge removed",
  risk_on_unwind: "Good news, hedge removed",
  in_line: "Number in line, hedge removed",
  good_news: "Good news, hedge removed",
  max_hold: "Held to the time limit",
  stop_loss: "Price spiked, stop closed the hedge",
  take_profit: "Target hit",
  kill_switch: "Closed by kill switch",
};

const STATUS: Record<HedgeState["status"], string> = {
  open: "Open, waiting for the number",
  holding: "Holding through bad news",
  closed: "Closed",
  skipped: "Skipped",
  failed: "Couldn't open",
};

interface HedgesResponse {
  hedges: HedgeState[];
  cron: boolean;
}

export default function Hedges() {
  const { me, call } = useMe();
  const live = useApi<HedgesResponse>("/api/hedges");
  const [busy, setBusy] = useState<"run" | "kill" | "drill" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmKill, setConfirmKill] = useState(false);

  const active = (live.data?.hedges ?? []).filter((h) => h.status === "open" || h.status === "holding");
  const past = (live.data?.hedges ?? []).filter((h) => h.status !== "open" && h.status !== "holding");
  const isLive = Boolean(me?.user.settings.live && me.user.sodex);

  const run = async () => {
    setBusy("run");
    setMsg(null);
    try {
      const r = await call<{ changed: number; open: number }>("/api/run", "POST");
      setMsg(r.changed ? `Checked. ${r.changed} hedge${r.changed > 1 ? "s" : ""} updated.` : "Checked. Nothing to do right now; the next hedge opens on schedule.");
      live.retry();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const drill = async () => {
    setBusy("drill");
    setMsg(null);
    try {
      const r = await call<{ hedge: HedgeState }>("/api/drill", "POST");
      const pnl = r.hedge.legs.reduce((a, l) => a + (l.pnlUsd ?? 0), 0);
      setMsg(`Drill done on ${r.hedge.label} (${r.hedge.date}): opened, read the number, ${r.hedge.closeReason === "max_hold" ? "held through it" : "stepped aside"}, closed. Hedge ${signedUsd(pnl)}. See Receipts for every step.`);
      live.retry();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const kill = async () => {
    setBusy("kill");
    setMsg(null);
    try {
      const r = await call<{ closed: number }>("/api/sodex/kill", "POST");
      setMsg(r.closed ? `Kill switch closed ${r.closed} hedge${r.closed > 1 ? "s" : ""}.` : "Kill switch ran. There was nothing open.");
      live.retry();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
      setConfirmKill(false);
    }
  };

  return (
    <>
      <div className={s.head}>
        <div>
          <h1 className="h2">Your hedges</h1>
          <p>
            {isLive ? "Live on SoDEX. " : "Practice mode: Buffer runs every step and logs it, without sending orders. "}
            {live.data?.cron ? "Buffer checks every 5 minutes." : "The automatic 5-minute check isn't switched on for this server yet, so use Check now."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-ghost btn-sm" disabled={busy != null} onClick={drill} title="Runs a full hedge cycle on the latest risky release, in practice mode">
            {busy === "drill" ? "Running drill…" : "Run a practice drill"}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy != null} onClick={run}>
            {busy === "run" ? "Checking…" : "Check now"}
          </button>
          {!confirmKill ? (
            <button className="btn btn-danger btn-sm" disabled={busy != null} onClick={() => setConfirmKill(true)}>
              Close all hedges
            </button>
          ) : (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <span className="small">{isLive ? "Close everything on SoDEX now?" : "Close all practice hedges?"}</span>
              <button className="btn btn-danger btn-sm" disabled={busy != null} onClick={kill}>
                {busy === "kill" ? "Closing…" : "Yes, close all"}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmKill(false)}>
                Cancel
              </button>
            </span>
          )}
        </div>
      </div>
      {msg && (
        <p className="small" role="status" style={{ marginTop: -8 }}>
          {msg}
        </p>
      )}
      {live.error && <ErrorBox message={live.error} retry={live.retry} />}
      {live.loading && !live.data && <Loading rows={2} />}

      {live.data && (
        <div className={s.rows} style={{ marginBottom: 34 }}>
          {active.length === 0 && (
            <div className={`glass ${s.empty}`} style={{ padding: 26 }}>
              <h2 className="h3">No hedge open right now</h2>
              <p className="small" style={{ margin: "6px 0 0" }}>
                The next one opens {me ? `${me.user.settings.lead} minutes` : "an hour"} before the next risky release on your <a href="/app" style={{ color: "var(--flare-hi)" }}>timeline</a>.
              </p>
            </div>
          )}
          {active.map((h) => (
            <HedgeCard key={h.id} h={h} />
          ))}
          {past.slice(0, 8).map((h) => (
            <HedgeCard key={h.id} h={h} />
          ))}
        </div>
      )}

      <TrackRecord />
    </>
  );
}

function HedgeCard({ h }: { h: HedgeState }) {
  const legs = h.legs.filter((l) => l.qty > 0);
  const pnl = legs.reduce((a, l) => a + (l.pnlUsd ?? 0), 0);
  const activeNow = h.status === "open" || h.status === "holding";
  return (
    <article className={`glass ${s.row} ${activeNow ? s.hot : ""}`} style={{ gridTemplateColumns: "1fr auto" }}>
      <div>
        <h3>
          {h.label} <span className="small">{when(h.releaseAt)}</span>
        </h3>
        <p>
          {STATUS[h.status]}
          {h.closeReason ? `: ${CLOSE[h.closeReason]}` : ""}
          {h.status === "open" ? ` (number ${countdown(h.releaseAt)})` : ""}
          {h.status === "holding" ? ` until ${when(h.closeBy)}` : ""}
          {h.note ? `. ${h.note}` : ""}
          {h.decision ? ` ${h.decision.reason}` : ""}
        </p>
        {legs.length > 0 && (
          <p className="num" style={{ color: "var(--muted)" }}>
            {legs.map((l) => `Short ${l.qty} ${l.symbol} at ${usd(l.entry, 1)}${l.exit ? `, closed at ${usd(l.exit, 1)}` : `, stop +${pct(l.stopLossPct)}`}`).join(" · ")}
          </p>
        )}
        {h.legs.some((l) => l.error) && <p style={{ color: "#ffb0b0" }}>{h.legs.map((l) => l.error).filter(Boolean).join(" ")}</p>}
      </div>
      <div className={s.rowRight}>
        <span className="tag">
          <span className="dot" style={{ color: h.mode === "live" ? "var(--critical)" : "var(--good)" }} />
          {h.mode === "live" ? "Live" : "Practice"}
        </span>
        {h.status === "closed" && legs.length > 0 && (
          <b className="num" style={{ fontWeight: 500, color: pnl >= 0 ? "var(--ink)" : "#ffb0b0" }}>
            Hedge {signedUsd(pnl)}
          </b>
        )}
      </div>
    </article>
  );
}

function TrackRecord() {
  const [pick, setPick] = useState<string | null>(null);
  const { data, error, loading, retry } = useApi<ReplayResponse>(`/api/replay${pick ? `?pick=${encodeURIComponent(pick)}` : ""}`);
  const d = data?.detail;
  return (
    <>
      <div className={s.head}>
        <div>
          <h2 className="h2">Track record</h2>
          <p>Buffer replayed on the last {data?.summary.runs ?? 10} risky releases, using only what it would have known at the time. BTC leg only.</p>
        </div>
        {data && <DataNote data={data.data} agent={data.agent} />}
      </div>
      {error && <ErrorBox message={error} retry={retry} />}
      {loading && !data && <Loading rows={3} />}
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
            <p className="small" style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center" }}>
              <Icon name="shield" /> Every hedge carries its own stop and target on SoDEX, so it stays protected even if Buffer is offline.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
