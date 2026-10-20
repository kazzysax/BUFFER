# Buffer — Macro-Event Auto-Hedger on SoDEX

SoSoValue Buildathon (AKINDO) · Wave 3 · due Oct 30, 2026 · builder: Kazzysax

## One line
Buffer watches the macro calendar from SoSoValue, learns how hard each kind of release (CPI, NFP, FOMC…) has historically moved crypto, and automatically hedges your BTC/ETH holdings with SoDEX perps before the release, then unwinds or holds based on the actual surprise.

## Who it is for
A one-person on-chain operator (buildathon theme: "one-person on-chain finance business") holding spot BTC/ETH who does not want to sit up at 8:30 ET every CPI day.

## Decisions locked (2026-10-20)
- Exposure: the **user's declared holdings** (enter BTC/ETH amounts; later: read a wallet address). Buffer shorts SoDEX perps to offset them.
- Autonomy: **auto with guardrails** — executes on its own inside user caps; dead-man switch + kill button.
- Surface: **web dashboard** (Next.js on Vercel).

## Core loop
1. **Calendar** — `GET /macro/events` (SoSoValue) → upcoming events by date. Feed has dates only, so release times come from a fixed table (CPI / NFP / PPI / Retail Sales 08:30 ET; FOMC decision 14:00 ET; others default 10:00 ET, flagged "time estimated").
2. **Event playbook** (per event type) — `GET /macro/events/{event}/history` gives actual / forecast / previous for past releases.
   - surprise_i = actual − forecast; z-score against that event's own surprise history.
   - reaction_i = |BTC return| from T−1h to T+4h, from SoDEX perps klines (`/markets/BTC-USD/klines?interval=1h`).
   - Outputs per event type: median abs move, p90 abs move, and slope of |move| vs |surprise z| (does a bigger surprise move crypto more?).
   - Risk tier: HIGH if p90 move ≥ 3%, MEDIUM ≥ 1.5%, else LOW (thresholds configurable).
3. **Pre-event hedge** (T − lead, default 60 min) for HIGH/MEDIUM events:
   - hedge_ratio = base_ratio(tier) × user aggressiveness (HIGH 0.5, MEDIUM 0.25 by default), capped by `max_hedge_ratio`.
   - notional = hedge_ratio × holdings value; place a SoDEX perps **market short** (IOC) with attached **TP and SL** (bracket order): SL at +p90 move above entry (hedge itself stops out if price rips), TP at −p90 below.
   - Set **schedule-cancel** to T + max_hold (dead-man switch: if Buffer goes offline, resting orders are wiped).
4. **Post-event** (T + 5 min): read `actual` from event history.
   - |surprise z| < 0.5 → benign → unwind hedge (reduce-only market buy).
   - surprise z in the risk-off direction (e.g. hot CPI) → hold, tighten SL to break-even, unwind at T + max_hold.
   - risk-on surprise → unwind immediately.
   - Direction map per event (hot CPI/PPI = risk-off; strong NFP = risk-off; hawkish FOMC = risk-off) is a fixed, documented table.
5. **Receipts** — every decision (inputs, rule fired, order payload, SoDEX order ID, result) is appended to a decision log; each entry hash-chained (sha256 of prev hash + entry) so the log is tamper-evident. Stretch: anchor daily head hash on ValueChain.

## Agent layer (added 2026-10-20)
Claude advises; deterministic rules and guardrails decide.
- **News analyst** — reads SoSoValue featured news before each MEDIUM/HIGH event, returns regime + a size multiplier clamped to 0.75–1.25×, must cite real news ids or it is ignored.
- **Event classifier** — for calendar events not in the fixed table: label, US release time, which surprise direction is risk-off. Used only when confident.
- **Explainer** — two-sentence plain-English note for every receipt; template fallback.
- Every agent output is logged in receipts with model id and `source: agent | fallback`.

## Guardrails (all user-set, enforced before any write)
- max_hedge_ratio (default 0.5), max_notional_usd, max_leverage (default 2, set via updateLeverage, isolated margin).
- Only reduce exposure: hedges are shorts sized ≤ holdings; unwinds are reduceOnly.
- Stale-data gate: no trade if SoSoValue or SoDEX data is older than its TTL.
- Daily action cap; kill switch (cancel all + close hedge, reduce-only).
- Dry-run mode (default for demo visitors): full pipeline, order payload signed and shown, not submitted.

## Screens
1. **Timeline** — next 14 days of events, each with tier badge, release time, historical move stats, planned action.
2. **Event detail** — surprise vs move scatter for that event, past releases table, the rule that will fire.
3. **Hedge state** — holdings, live hedge position (SoDEX positions), PnL of hedge vs unhedged, guardrail settings, kill switch.
4. **Receipts** — hash-chained decision log with SoDEX order IDs.

## API map
SoSoValue (base `https://openapi.sosovalue.com/openapi/v1`, header `x-soso-api-key`):
- `GET /macro/events`, `GET /macro/events/{event}/history?start_date&end_date&limit`
- (stretch) news/featured for event-day context; ETF flows as a second signal.

SoDEX perps (testnet `https://testnet-gw.sodex.dev/api/v1/perps`, mainnet `https://mainnet-gw.sodex.dev/api/v1/perps`):
- Reads: `/markets/symbols`, `/markets/mark-prices`, `/markets/{symbol}/klines`, `/accounts/{addr}/state|positions|orders|balances`
- Writes (EIP-712 signed): `POST /trade/orders` (newOrder), `DELETE /trade/orders` (cancelOrder), `POST /trade/orders/schedule-cancel`, `POST /trade/leverage`
- Signing: payloadHash = keccak256(compact JSON `{type, params}` in Go-struct key order); EIP-712 `ExchangeAction{payloadHash, nonce}` under domain `{name:"futures", version:"1", chainId:138565 testnet / 286623 mainnet, verifyingContract:0x0}`; wire sig = `0x01 ‖ r ‖ s ‖ v` with v ∈ {0,1} (Go SDK convention); headers `X-API-Key` (key name), `X-API-Sign`, `X-API-Nonce` (ms timestamp).

## Judging map
- User value 30% — removes the most stressful recurring risk for a spot holder; one setup, then it runs.
- Working demo 25% — real SoDEX testnet perps orders with IDs; replay mode runs a past CPI end-to-end on recorded data.
- Logic / workflow 20% — documented, deterministic rules; per-event learned playbook; guardrails; dead-man switch.
- Data / API 15% — SoSoValue macro calendar + event history + SoDEX klines, positions, bracket orders, schedule-cancel, leverage.
- UX 10% — timeline-first dashboard, plain-English "what will happen and why" per event.

## Risks and checks (in order)
1. **Perps testnet funding** — another builder could not demo perps because the testnet perps ledger was unfunded. First task: place one perps testnet order. Fallback: spot de-risk (sell a slice of spot on SoDEX spot, buy back after).
2. Macro feed has no times → fixed time table, flagged in UI.
3. History depth per event may be shallow → show sample size, fall back to tier defaults when n < 6.
4. SoSoValue rate limits (~20/min per key) → cache history (it changes once per release).
5. No real event lands before the deadline window? → replay mode on the last CPI/NFP so the demo always shows a full cycle.

## Build order
1. SoDEX signing client, cross-checked against the official Go SDK; test-order script. ← now
2. SoSoValue client + playbook engine (pure functions, unit-tested).
3. Scheduler/executor with guardrails + receipts.
4. Dashboard.
5. Replay mode, deploy to Vercel, demo video, README with judging map.
