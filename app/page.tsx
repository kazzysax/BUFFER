import { dataSource } from "@/lib/server/data";
import { buildTimeline } from "@/src/engine/pipeline";
import { DEFAULT_GUARDRAILS } from "@/src/engine/policy";
import { buildPlaybook } from "@/src/engine/playbook";
import { replayRelease, type ReplayResult } from "@/src/engine/replay";
import { sampleSource } from "@/src/sources/sample";
import { StartButton, SignInLink } from "@/components/cta";
import { Spark, SurpriseScatter } from "@/components/charts";
import { Wire } from "@/components/wire";
import { Icon, Logo, TierBadge, countdown, pct, signedUsd, usd } from "@/components/ui";
import s from "./landing.module.css";

export const revalidate = 3600;

const HOLD = { BTC: 0.2, ETH: 3 };

async function load() {
  let src = dataSource();
  let t;
  try {
    t = await buildTimeline({ src, holdings: HOLD, guard: DEFAULT_GUARDRAILS });
  } catch {
    src = sampleSource();
    t = await buildTimeline({ src, holdings: HOLD, guard: DEFAULT_GUARDRAILS });
  }
  const candles = await src.btcCandles();
  let showcase: ReplayResult | null = null;
  for (const ev of ["CPI", "Nonfarm Payrolls", "FOMC Rate Decision"]) {
    for (const rel of (await src.history(ev)).slice(0, 6)) {
      const r = replayRelease({ event: ev, release: rel, history: await src.history(ev), candles, btc: HOLD.BTC, guard: DEFAULT_GUARDRAILS });
      if (r && r.qty > 0 && r.decision.action === "HOLD_TIGHTEN" && (!showcase || r.releaseAt > showcase.releaseAt)) showcase = r;
    }
  }
  const cpi = t.items.find((i) => i.playbook.tier === "HIGH") ?? t.items[0];
  const cpiHist = cpi ? await src.history(cpi.event) : [];
  const cpiPb = cpi ? buildPlaybook(cpi.event, cpiHist, candles) : null;
  return { t, mode: src.mode, showcase, cpi, cpiPb };
}

export default async function Landing() {
  const now = Date.now();
  const { t, mode, showcase, cpi, cpiPb } = await load();
  const next = t.items.filter((i) => i.playbook.tier !== "LOW").slice(0, 3);
  const nextHedge = t.items.find((i) => !i.plan.skip);
  const leg = nextHedge?.plan.legs.find((l) => l.asset === "BTC");
  const protectedNow = HOLD.BTC * t.prices.BTC + HOLD.ETH * t.prices.ETH;

  return (
    <main>
      <section className={s.hero}>
        <div className="glow" />
        <nav className={s.nav}>
          <Logo />
          <div className={s.pillnav}>
            <a href="#how" className={s.active}>
              How it works
            </a>
            <a href="#playbook">Playbook</a>
            <a href="#agent">Agent</a>
            <a href="#safety">Safety</a>
          </div>
          <SignInLink />
        </nav>

        <div className={s.floaters} aria-hidden>
          <span className={s.floater} style={{ left: "6%", top: 150 }}>
            SoSoValue <i>
              <Icon name="chart" size={13} />
            </i>
          </span>
          <span className={s.floater} style={{ left: "13%", top: 228 }}>
            Privy <i>
              <Icon name="wallet" size={13} />
            </i>
          </span>
          <span className={s.floater} style={{ right: "6%", top: 150 }}>
            <i>
              <Icon name="bolt" size={13} />
            </i>{" "}
            SoDEX
          </span>
          <span className={s.floater} style={{ right: "12%", top: 228 }}>
            <i>
              <Icon name="spark" size={13} />
            </i>{" "}
            Claude
          </span>
        </div>

        <div className={s.heroCopy}>
          <h1 className="display">
            Hedge the headline
            <br />
            before it hits
          </h1>
          <p className={s.sub}>
            Buffer watches CPI, jobs and Fed days, shields your BTC and ETH with SoDEX perps an hour before the number lands, and steps aside once it&rsquo;s safe.
          </p>
          <StartButton />
        </div>

        <div className={s.wire}>
          <Wire now={now} nodes={t.items.map((i) => ({ id: i.id, label: i.meta.label, at: i.releaseAt, tier: i.playbook.tier }))} />
        </div>

        <div className={s.cards}>
          <article className={`glass ${s.card}`}>
            <header className={s.cardHead}>
              <span>Coming up</span>
              <a href="/app" className={s.seeAll}>
                Open timeline
              </a>
            </header>
            <ul className={s.list}>
              {next.map((i) => (
                <li key={i.id} className="inset">
                  <div>
                    <b>{i.meta.label}</b>
                    <span className="small">{countdown(i.releaseAt, now)}</span>
                  </div>
                  <TierBadge tier={i.playbook.tier} />
                </li>
              ))}
            </ul>
          </article>

          <article className={`glass ${s.card} ${s.center}`}>
            <header className={s.cardHead}>
              <span>Protected value</span>
              <span className="tag">
                <span className="dot" style={{ color: "var(--good)" }} />
                Watching
              </span>
            </header>
            <div className={s.big}>
              <span className="num">{usd(protectedNow)}</span>
              <span className="small">
                {HOLD.BTC} BTC + {HOLD.ETH} ETH
              </span>
            </div>
            {showcase && (
              <>
                <Spark values={showcase.points.map((p) => p.hedged - p.unhedged)} width={300} height={70} color="var(--series-hedged)" />
                <p className="small" style={{ margin: "6px 0 0" }}>
                  Last risk-off {showcase.event === "CPI" ? "CPI" : showcase.event} ({showcase.date}): hedge kept you{" "}
                  <b style={{ color: "var(--ink)" }} className="num">
                    {signedUsd(showcase.savedUsd)}
                  </b>{" "}
                  ahead of holding alone.
                </p>
              </>
            )}
          </article>

          <article className={`glass ${s.card}`}>
            <header className={s.cardHead}>
              <span>Next hedge</span>
              <span className="small">{nextHedge ? countdown(nextHedge.plan.openAt, now) : "none planned"}</span>
            </header>
            {nextHedge && leg ? (
              <div className={s.ticket}>
                <div className="inset">
                  <span className="small">Short</span>
                  <b className="num">{leg.quantity.toFixed(4)} BTC-USD</b>
                </div>
                <div className={s.split}>
                  <div className="inset">
                    <span className="small">Stop</span>
                    <b className="num">+{pct(leg.stopLossPct)}</b>
                  </div>
                  <div className="inset">
                    <span className="small">Target</span>
                    <b className="num">−{pct(leg.takeProfitPct)}</b>
                  </div>
                </div>
                <p className="small" style={{ margin: 0 }}>
                  Before {nextHedge.meta.label}. The stop and target sit on SoDEX, so the hedge stays protected even if Buffer is offline.
                </p>
              </div>
            ) : (
              <p className="small">Nothing risky in the next two weeks.</p>
            )}
          </article>
        </div>
        {mode === "sample" && <p className={s.note}>Showing sample market data. Add API keys to see live releases.</p>}
      </section>

      <section className={s.runsOn} aria-label="Built on">
        <p className="small">Built on</p>
        <div>
          <span>SoSoValue</span>
          <span>SoDEX</span>
          <span>ValueChain</span>
          <span>Privy</span>
          <span>Claude</span>
        </div>
      </section>

      <section id="how" className={s.section}>
        <h2 className="h2" style={{ textAlign: "center" }}>
          Four moves, every release
        </h2>
        <ol className={s.steps}>
          <li>
            <span className={s.stepNo}>1</span>
            <h3 className="h3">Read the calendar</h3>
            <p>SoSoValue lists every CPI, jobs report and Fed decision for the next two weeks.</p>
          </li>
          <li>
            <span className={s.stepNo}>2</span>
            <h3 className="h3">Learn the damage</h3>
            <p>Past releases show how far each number has moved bitcoin, and whether bigger surprises hit harder.</p>
          </li>
          <li>
            <span className={s.stepNo}>3</span>
            <h3 className="h3">Shield an hour early</h3>
            <p>A sized short on SoDEX offsets part of your holdings, with its own stop and target.</p>
          </li>
          <li>
            <span className={s.stepNo}>4</span>
            <h3 className="h3">Step aside on the print</h3>
            <p>In line or good news, the hedge comes off at once. Bad news, it stays on until the dust settles.</p>
          </li>
        </ol>
      </section>

      <section id="playbook" className={s.section}>
        <div className={`glass ${s.feature}`}>
          <div className={s.featureCopy}>
            <h2 className="h2">A playbook for every release</h2>
            <p className="lede">
              {cpiPb
                ? `${cpiPb.label} has moved bitcoin ${pct(cpiPb.medianAbsMove)} on a typical release and ${pct(cpiPb.p90AbsMove)} on a bad one. When it came in hotter than forecast, bitcoin fell ${cpiPb.riskOffHitRate != null ? Math.round(cpiPb.riskOffHitRate * 100) : "—"}% of the time.`
                : "Each event type gets its own read of how hard it has moved crypto."}
            </p>
            <StartButton label="See this week's plan" />
          </div>
          <div className={`inset ${s.featureChart}`}>{cpiPb && <SurpriseScatter samples={cpiPb.samples} />}</div>
        </div>

        <div className={s.pair}>
          <article id="agent" className={`glass ${s.pairCard}`}>
            <div className={s.agentRows}>
              {(cpi?.read?.value.citedIds.length ? t.news.filter((n) => cpi.read!.value.citedIds.includes(n.id)) : t.news).slice(0, 3).map((n, k) => (
                <div key={n.id} className="inset" style={{ marginLeft: k % 2 ? 40 : 0 }}>
                  <span className={s.avatar}>
                    <Icon name="doc" size={14} />
                  </span>
                  <span>{n.title}</span>
                </div>
              ))}
            </div>
            <h3 className="h3">An agent that reads the room</h3>
            <p className="small">
              Claude reads SoSoValue news before each release and nudges the hedge between 0.75× and 1.25×. It has to cite the articles it used, and it can never move past your limits.
            </p>
          </article>
          <article id="safety" className={`glass ${s.pairCard}`}>
            <div className={s.shield}>
              <div className="inset">
                <span className="small">Max hedge</span>
                <b>{pct(DEFAULT_GUARDRAILS.maxHedgeRatio, 0)}</b>
              </div>
              <span className={s.shieldIcon}>
                <Icon name="shield" size={26} />
              </span>
              <div className="inset">
                <span className="small">Leverage cap</span>
                <b>{DEFAULT_GUARDRAILS.maxLeverage}×</b>
              </div>
            </div>
            <h3 className="h3">Limits you set, enforced in code</h3>
            <p className="small">Hedges never exceed what you hold, every hedge carries its own stop on SoDEX, and one button closes everything.</p>
          </article>
        </div>
      </section>

      <section className={s.final}>
        <div className="side-ember" style={{ top: -120 }} />
        <h2 className="h2">Sleep through the next CPI</h2>
        <p className="lede" style={{ margin: "12px auto 28px", textAlign: "center" }}>
          Sign in with Google. Buffer creates a wallet for you and starts in practice mode, so nothing trades until you say so.
        </p>
        <StartButton />
      </section>

      <footer className={s.footer}>
        <Logo size={22} />
        <span className="small">Built for the SoSoValue Buildathon. Not financial advice.</span>
      </footer>
    </main>
  );
}
