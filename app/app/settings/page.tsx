"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useMe } from "@/lib/me";
import { DEFAULT_SETTINGS, type Settings } from "@/src/account/settings";
import { ErrorBox } from "@/components/states";
import { Icon, pct, shortAddr, usd, when } from "@/components/ui";
import s from "../pages.module.css";

export default function SettingsPage() {
  const { me, error, update } = useMe();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (me) setDraft(me.user.settings);
  }, [me]);

  if (error) return <ErrorBox message={error} />;
  if (!me || !draft) return <p className="small">Loading your settings…</p>;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((d) => ({ ...d!, [k]: v }));
    setStatus(null);
  };
  const changed = JSON.stringify(draft) !== JSON.stringify(me.user.settings);
  const connected = Boolean(me.user.sodex);

  return (
    <>
      <div className={s.head}>
        <div>
          <h1 className="h2">Settings</h1>
          <p>What you hold, the limits Buffer must stay inside, and where it trades. Saved to your account and enforced on the server.</p>
        </div>
      </div>

      <form
        className={s.form}
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await update({ settings: draft, confirmHoldings: true });
            setStatus("Settings saved. Your holdings count as confirmed for the next 7 days.");
          } catch (err) {
            setStatus((err as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <h2 className="h3">Holdings</h2>
        <p className="small" style={{ margin: "-6px 0 0" }}>
          Your coins can be anywhere: a hardware wallet, an exchange, an ETF. Buffer only needs the amounts to size the offset. It never moves them.
        </p>
        <Num id="btc" title="Bitcoin" hint={me.holdingsSource.BTC === "synced" ? `Synced from your wallet: ${me.holdings.BTC} BTC. This typed amount is ignored while synced.` : "How much BTC you want protected"} value={draft.btc} step="0.001" onChange={(v) => set("btc", v)} />
        <Num id="eth" title="Ether" hint={me.holdingsSource.ETH === "synced" ? `Synced from your wallet: ${me.holdings.ETH} ETH. This typed amount is ignored while synced.` : "How much ETH you want protected"} value={draft.eth} step="0.01" onChange={(v) => set("eth", v)} />

        <h2 className="h3" style={{ marginTop: 10 }}>
          Limits
        </h2>
        <Range id="maxRatio" title="Largest hedge" hint="Share of your holdings Buffer may offset" min={0} max={1} step={0.05} value={draft.maxRatio} fmt={(v) => pct(v, 0)} onChange={(v) => set("maxRatio", v)} />
        <Num id="maxUsd" title="Largest hedge per coin" hint="Dollar cap for any single release" value={draft.maxUsd} step="100" onChange={(v) => set("maxUsd", v)} />
        <Range id="aggr" title="Aggressiveness" hint="Scales hedge size before the limits apply" min={0} max={1.5} step={0.05} value={draft.aggr} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => set("aggr", v)} />
        <Range id="lev" title="Leverage cap" hint="Isolated margin on SoDEX. Lower means more USDC needed, less liquidation risk." min={1} max={5} step={1} value={draft.lev} fmt={(v) => `${v}×`} onChange={(v) => set("lev", v)} />
        <Range id="lead" title="Open the hedge" hint="Minutes before the release" min={15} max={240} step={15} value={draft.lead} fmt={(v) => `${v} min`} onChange={(v) => set("lead", v)} />
        <Range id="hold" title="Longest hold" hint="The hedge always comes off by this point" min={1} max={24} step={1} value={draft.hold} fmt={(v) => `${v} h`} onChange={(v) => set("hold", v)} />

        <h2 className="h3" style={{ marginTop: 10 }}>
          Trading mode
        </h2>
        <div className={`glass ${s.field}`}>
          <div>
            <b style={{ fontWeight: 500 }}>Mode</b>
            <span className="small" style={{ display: "block" }}>
              {connected ? "Practice runs every step and logs it without sending orders. Live sends real orders to SoDEX." : "Practice runs every step and logs it without sending orders. Connect SoDEX below to unlock Live."}
            </span>
          </div>
          <div className={s.switch} role="radiogroup" aria-label="Trading mode">
            <button type="button" role="radio" aria-checked={!draft.live} className={!draft.live ? s.switchOn : undefined} onClick={() => set("live", false)}>
              Practice
            </button>
            <button type="button" role="radio" aria-checked={draft.live} className={draft.live ? s.switchOn : undefined} disabled={!connected} onClick={() => set("live", true)} style={!connected ? { opacity: 0.45, cursor: "not-allowed" } : undefined}>
              Live
            </button>
          </div>
        </div>
        {draft.live && !me.user.settings.live && (
          <p className="small" role="note" style={{ margin: 0, color: "#ffd98a" }}>
            Live mode places real orders on SoDEX {me.user.sodex?.network}. Keep at least {usd((2 * draft.maxUsd) / draft.lev)} USDC in your SoDEX perps account to cover margin at your current limits.
          </p>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
          <button className="btn btn-primary" disabled={!changed || saving} style={{ opacity: changed ? 1 : 0.5 }}>
            {saving ? "Saving…" : "Save settings"}
            <span className="chip">
              <Icon name="check" />
            </span>
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft({ ...DEFAULT_SETTINGS, btc: draft.btc, eth: draft.eth, live: draft.live })}>
            Reset limits to defaults
          </button>
          {status && (
            <span className="small" role="status">
              {status}
            </span>
          )}
        </div>
      </form>

      <WalletSync />
      <SodexConnect />
    </>
  );
}

function WalletSync() {
  const { me, update, call, refresh } = useMe();
  const [btc, setBtc] = useState(me?.user.sync?.btcAddress ?? "");
  const [eth, setEth] = useState(me?.user.sync?.ethAddress ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const sync = me.user.sync;
  return (
    <section className={s.form} style={{ marginTop: 34 }}>
      <h2 className="h3">Sync from a wallet (optional)</h2>
      <p className="small" style={{ margin: "-6px 0 0" }}>
        Paste a public address and Buffer reads its balance every 30 minutes, so your holdings stay right without typing. Read-only: Buffer can&rsquo;t move these coins.
      </p>
      <div className={`glass ${s.field}`}>
        <label htmlFor="btcAddr">
          <b>Bitcoin address</b>
          <span className="small">{sync?.btcAddress && sync.btc != null ? `Balance: ${sync.btc} BTC` : "bc1…, 1… or 3…"}</span>
        </label>
        <input id="btcAddr" type="text" spellCheck={false} placeholder="bc1q…" value={btc} onChange={(e) => setBtc(e.target.value)} className={s.text} />
      </div>
      <div className={`glass ${s.field}`}>
        <label htmlFor="ethAddr">
          <b>Ethereum address</b>
          <span className="small">{sync?.ethAddress && sync.eth != null ? `Balance: ${sync.eth} ETH` : "0x…"}</span>
        </label>
        <input id="ethAddr" type="text" spellCheck={false} placeholder="0x…" value={eth} onChange={(e) => setEth(e.target.value)} className={s.text} />
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const r = await update({ sync: { btcAddress: btc.trim() || null, ethAddress: eth.trim() || null } });
              setMsg(r.user.sync?.error ?? (btc || eth ? "Addresses saved and synced." : "Wallet sync turned off."));
            } catch (e) {
              setMsg((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Syncing…" : "Save and sync"}
        </button>
        {(sync?.btcAddress || sync?.ethAddress) && (
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await call("/api/me/sync", "POST");
                await refresh();
                setMsg("Balances refreshed.");
              } catch (e) {
                setMsg((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Sync now
          </button>
        )}
        {sync?.at && <span className="small">Last synced {when(sync.at)}</span>}
        {msg && (
          <span className="small" role="status">
            {msg}
          </span>
        )}
      </div>
    </section>
  );
}

function SodexConnect() {
  const auth = useAuth();
  const { me, call, refresh } = useMe();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [imp, setImp] = useState({ address: "", keyName: "", privateKey: "" });
  if (!me) return null;
  const c = me.user.sodex;
  const canSign = Boolean(auth.signTypedData && auth.user?.wallet);

  const connectWallet = async () => {
    setBusy("wallet");
    setMsg(null);
    try {
      const start = await call<{ typedData: Record<string, unknown>; network: string; accountID: number }>("/api/sodex/connect/start", "POST", { address: auth.user!.wallet });
      const signature = await auth.signTypedData!(start.typedData);
      await call("/api/sodex/connect/finish", "POST", { signature });
      await refresh();
      setMsg(`Connected to SoDEX ${start.network}, account ${start.accountID}.`);
    } catch (e) {
      // SoDEX's officially supported path is a key made in its own UI, so fall back to that.
      setShowImport(true);
      setMsg(`${(e as Error).message} You can still connect: create an API key on SoDEX, then paste it below.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={s.form} style={{ marginTop: 34, marginBottom: 20 }}>
      <h2 className="h3">SoDEX account</h2>
      {c ? (
        <div className={`glass ${s.field}`}>
          <div>
            <b style={{ fontWeight: 500 }}>
              Connected to SoDEX {c.network}, account {c.accountID}
            </b>
            <span className="small" style={{ display: "block" }}>
              Wallet {shortAddr(c.address)}, trading key &ldquo;{c.keyName}&rdquo; ({shortAddr(c.keyAddress)}). The key can trade perps but can&rsquo;t withdraw. Connected {when(c.connectedAt)}.
            </span>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy != null}
            onClick={async () => {
              setBusy("disconnect");
              try {
                await call("/api/sodex/connect/import", "DELETE");
                await refresh();
                setMsg(`Disconnected and switched to practice. Buffer deleted its copy of the key. To revoke "${c.keyName}" completely, remove it under API keys on SoDEX.`);
              } catch (e) {
                setMsg((e as Error).message);
              } finally {
                setBusy(null);
              }
            }}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <>
          <p className="small" style={{ margin: "-6px 0 0" }}>
            Buffer needs a trading key on your SoDEX account to place hedges. Create one on SoDEX and paste it here, or let your Buffer wallet sign to make one (experimental). The key stays encrypted on Buffer&rsquo;s server, can open and close perps, and can&rsquo;t withdraw. Your SoDEX perps account needs USDC for margin.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-sm" onClick={() => setShowImport((v) => !v)} aria-expanded={showImport}>
              <Icon name="wallet" /> Use an API key from SoDEX
            </button>
            <button className="btn btn-ghost btn-sm" disabled={!canSign || busy != null} onClick={connectWallet} title={canSign ? undefined : "Sign in with Google to get a Buffer wallet"}>
              {busy === "wallet" ? "Waiting for your signature…" : "Connect with my Buffer wallet (experimental)"}
            </button>
          </div>
          {!canSign && <p className="small" style={{ margin: 0 }}>Preview sign-in has no wallet, so only the API-key route is available here.</p>}
          {showImport && (
            <form
              className={s.form}
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy("import");
                setMsg(null);
                try {
                  await call("/api/sodex/connect/import", "POST", imp);
                  await refresh();
                  setImp({ address: "", keyName: "", privateKey: "" });
                  setShowImport(false);
                  setMsg("API key checked with SoDEX and connected.");
                } catch (err) {
                  setMsg((err as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              <p className="small" style={{ margin: 0 }}>
                On SoDEX, open API keys and create one. Copy its name and private key here. Buffer checks the key belongs to your account before saving it.{" "}
                <a href={me.env?.network === "mainnet" ? "https://sodex.com/apikeys" : "https://testnet.sodex.com/apikeys"} target="_blank" rel="noreferrer" style={{ color: "var(--flare-hi)" }}>
                  Open SoDEX API keys
                </a>
              </p>
              <Text id="impAddr" title="Wallet address" hint="The wallet that owns the SoDEX account" value={imp.address} onChange={(v) => setImp({ ...imp, address: v })} placeholder="0x…" />
              <Text id="impName" title="API key name" hint="Exactly as shown on SoDEX" value={imp.keyName} onChange={(v) => setImp({ ...imp, keyName: v })} placeholder="my-key" />
              <Text id="impPk" title="API key private key" hint="Stored encrypted. Never your wallet's own key." value={imp.privateKey} onChange={(v) => setImp({ ...imp, privateKey: v })} placeholder="0x…" secret />
              <div>
                <button className="btn btn-primary btn-sm" disabled={busy != null}>
                  {busy === "import" ? "Checking with SoDEX…" : "Check and connect"}
                </button>
              </div>
            </form>
          )}
        </>
      )}
      {me.env && !me.env.encryption && <p className="small" style={{ margin: 0, color: "#ffd98a" }}>The server has no BUFFER_ENCRYPTION_KEY yet, so it can&rsquo;t hold a trading key.</p>}
      {msg && (
        <p className="small" role="status" style={{ margin: 0 }}>
          {msg}
        </p>
      )}
    </section>
  );
}

function Num(p: { id: string; title: string; hint: string; value: number; step: string; onChange: (v: number) => void }) {
  return (
    <div className={`glass ${s.field}`}>
      <label htmlFor={p.id}>
        <b>{p.title}</b>
        <span className="small">{p.hint}</span>
      </label>
      <input id={p.id} type="number" min={0} step={p.step} value={p.value} onChange={(e) => p.onChange(Math.max(0, Number(e.target.value)))} />
    </div>
  );
}

function Text(p: { id: string; title: string; hint: string; value: string; placeholder: string; secret?: boolean; onChange: (v: string) => void }) {
  return (
    <div className={`glass ${s.field}`}>
      <label htmlFor={p.id}>
        <b>{p.title}</b>
        <span className="small">{p.hint}</span>
      </label>
      <input id={p.id} type={p.secret ? "password" : "text"} autoComplete="off" spellCheck={false} placeholder={p.placeholder} value={p.value} onChange={(e) => p.onChange(e.target.value)} className={s.text} />
    </div>
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
