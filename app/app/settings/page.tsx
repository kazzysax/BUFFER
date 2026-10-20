"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { DEFAULT_SETTINGS, useSettings, type Settings } from "@/lib/settings";
import { Icon, pct, shortAddr, usd } from "@/components/ui";
import s from "../pages.module.css";

export default function SettingsPage() {
  const { settings, save, loaded } = useSettings();
  const { user, mode } = useAuth();
  const [draft, setDraft] = useState<Settings>(settings);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaved(false);
  };
  const changed = JSON.stringify(draft) !== JSON.stringify(settings);
  if (!loaded) return null;

  return (
    <>
      <div className={s.head}>
        <div>
          <h1 className="h2">Settings</h1>
          <p>What you hold, and the limits Buffer must stay inside. Every number here is also enforced on the server.</p>
        </div>
      </div>

      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          save(draft);
          setSaved(true);
        }}
      >
        <h2 className="h3">Holdings</h2>
        <div className={`glass ${s.field}`}>
          <label htmlFor="btc">
            <b>Bitcoin</b>
            <span className="small">How much BTC you want protected</span>
          </label>
          <input id="btc" type="number" min={0} step="0.001" value={draft.btc} onChange={(e) => set("btc", Math.max(0, Number(e.target.value)))} />
        </div>
        <div className={`glass ${s.field}`}>
          <label htmlFor="eth">
            <b>Ether</b>
            <span className="small">How much ETH you want protected</span>
          </label>
          <input id="eth" type="number" min={0} step="0.01" value={draft.eth} onChange={(e) => set("eth", Math.max(0, Number(e.target.value)))} />
        </div>

        <h2 className="h3" style={{ marginTop: 10 }}>
          Limits
        </h2>
        <Range id="maxRatio" title="Largest hedge" hint="Share of your holdings Buffer may offset" min={0} max={1} step={0.05} value={draft.maxRatio} fmt={(v) => pct(v, 0)} onChange={(v) => set("maxRatio", v)} />
        <div className={`glass ${s.field}`}>
          <label htmlFor="maxUsd">
            <b>Largest hedge per coin</b>
            <span className="small">Dollar cap for any single release</span>
          </label>
          <input id="maxUsd" type="number" min={0} step="100" value={draft.maxUsd} onChange={(e) => set("maxUsd", Math.max(0, Number(e.target.value)))} />
        </div>
        <Range id="aggr" title="Aggressiveness" hint="Scales hedge size before the limits apply" min={0} max={1.5} step={0.05} value={draft.aggr} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => set("aggr", v)} />
        <Range id="lev" title="Leverage cap" hint="Isolated margin on SoDEX" min={1} max={5} step={1} value={draft.lev} fmt={(v) => `${v}×`} onChange={(v) => set("lev", v)} />
        <Range id="lead" title="Open the hedge" hint="Minutes before the release" min={15} max={240} step={15} value={draft.lead} fmt={(v) => `${v} min`} onChange={(v) => set("lead", v)} />
        <Range id="hold" title="Longest hold" hint="Hedge closes and orders auto-cancel after this" min={1} max={24} step={1} value={draft.hold} fmt={(v) => `${v} h`} onChange={(v) => set("hold", v)} />

        <h2 className="h3" style={{ marginTop: 10 }}>
          Trading
        </h2>
        <div className={`glass ${s.field}`}>
          <div>
            <b style={{ fontWeight: 500 }}>Mode</b>
            <span className="small" style={{ display: "block" }}>
              Practice signs every order and logs it without sending. Live needs a connected SoDEX account.
            </span>
          </div>
          <div className={s.switch} role="radiogroup" aria-label="Trading mode">
            <button type="button" role="radio" aria-checked={!draft.live} className={!draft.live ? s.switchOn : undefined} onClick={() => set("live", false)}>
              Practice
            </button>
            <button type="button" role="radio" aria-checked={draft.live} disabled title="Connect SoDEX first" style={{ opacity: 0.45, cursor: "not-allowed" }}>
              Live
            </button>
          </div>
        </div>
        <div className={`glass ${s.field}`}>
          <div>
            <b style={{ fontWeight: 500 }}>SoDEX account</b>
            <span className="small" style={{ display: "block" }}>
              {user?.wallet
                ? `Your wallet ${shortAddr(user.wallet)} will authorise a trading key for Buffer. It can trade perps but never withdraw.`
                : mode === "preview"
                  ? "Sign in with Google to get a wallet, then connect it here."
                  : "Your wallet is being created."}
            </span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" disabled title="Arrives with the executor">
            <Icon name="wallet" /> Connect SoDEX
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
          <button className="btn btn-primary" disabled={!changed} style={{ opacity: changed ? 1 : 0.5 }}>
            Save settings
            <span className="chip">
              <Icon name="check" />
            </span>
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(DEFAULT_SETTINGS)}>
            Reset to defaults
          </button>
          {saved && !changed && (
            <span className="small" role="status">
              Settings saved. Plans now use {usd(draft.maxUsd)} and {pct(draft.maxRatio, 0)} as limits.
            </span>
          )}
        </div>
      </form>
    </>
  );
}

function Range(p: { id: string; title: string; hint: string; min: number; max: number; step: number; value: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div className={`glass ${s.field}`}>
      <label htmlFor={p.id}>
        <b>
          {p.title}: <span className="num">{p.fmt(p.value)}</span>
        </b>
        <span className="small">{p.hint}</span>
      </label>
      <input id={p.id} type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </div>
  );
}
