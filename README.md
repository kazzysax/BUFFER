# Buffer

Automatic hedging for BTC and ETH holders around CPI, jobs and Fed days. SoSoValue tells Buffer what is coming and how those releases have surprised before; SoDEX perps klines show how hard bitcoin moved each time. An hour before a risky release Buffer shorts SoDEX perps against part of your holdings, with a stop, a target and an auto-cancel, then unwinds or holds depending on the actual number. A Claude agent reads the news going in and explains every decision.

Built for the SoSoValue Buildathon (AKINDO). Design: [SPEC.md](SPEC.md).

## Run it
```bash
npm install          # .npmrc sets legacy-peer-deps (Privy's optional smart-wallet peers)
npm run dev          # http://localhost:3000
npm test             # 34 tests
```
With no keys at all, everything works on **sample data** with a **preview sign-in**, both labelled in the UI.

## Turn on Google login (Privy)
1. Create an app at dashboard.privy.io.
2. **Login methods**: enable Google and Email.
3. **Embedded wallets**: enable Ethereum, create on login for users without wallets.
4. **Allowed origins**: add `http://localhost:3000` and your Vercel URL.
5. Copy the **App ID** to `NEXT_PUBLIC_PRIVY_APP_ID` and the **verification key** (Configuration → App settings) to `PRIVY_VERIFICATION_KEY`.

Every API route verifies the Privy access token (ES256, issuer `privy.io`, audience = your app ID) before returning data.

## Turn on live data and the agent
```
SOSOVALUE_API_KEY=...      # macro calendar, event history, featured news
ANTHROPIC_API_KEY=...      # news analyst, event classifier, explainer
```
Prices and hourly BTC candles come from SoDEX mainnet public market data (no key needed).

## What's in the app
| Page | What it shows |
|---|---|
| `/` | Landing: the lifeline, a heart-monitor trace of the next 14 days that spikes on risky releases, live plan cards, playbook chart |
| `/app` | Timeline: every release, risk rating, plain-English plan |
| `/app/event/[id]` | Surprise-vs-move chart, plan, reasons, past releases, agent read with cited news |
| `/app/hedge` | Track record: Buffer replayed on the last 10 risky releases (BTC leg), hedged vs unhedged chart |
| `/app/receipts` | Hash-chained decision log, re-verified in your browser |
| `/app/settings` | Holdings and limits (also clamped server-side), practice/live mode |

## Status (Oct 20)
- [x] SoDEX perps signing client + order builders (bracket hedge, reduce-only unwind, schedule-cancel)
- [x] Engine: DST-aware times, per-event playbook, sizing under guardrails, post-release decision, receipts
- [x] Agent layer (Claude): news analyst, unknown-event classifier, explainer, all clamped with rules-only fallback
- [x] Replay / track record on past releases
- [x] Frontend in the reference style + Privy Google login with embedded wallet
- [ ] **First live perps testnet order** (`npm run test-order`) ← still the riskiest unknown
- [ ] Executor (scheduled job that actually opens/closes hedges) + "Connect SoDEX" (wallet authorises a trading API key) + kill switch
- [ ] Settings stored per user on the server (currently per browser)
- [ ] Deploy to Vercel, demo video

## Scripts
```bash
npm run test-order   # sign (and with SEND=1, place) one testnet perps hedge
npm run playbook     # print the live plan for the next 14 days
```

## Layout
```
app/            Next.js pages + API routes (timeline, event, replay)
components/     UI kit, charts (validated palette), the wire
lib/            Privy auth bridge, server auth (jose), data selection, settings
src/sodex/      types, canonical payloads, signer, REST client, order builders
src/sosovalue/  macro calendar, event history, featured news
src/engine/     events, playbook, policy, pipeline, replay, receipts
src/agent/      Claude client (forced tool output) + three advisors
src/sources/    live (SoSoValue + SoDEX) and sample data sources
test/           sodex, engine, agent, replay
verify/go/      optional cross-check against the official SoDEX Go SDK
```
