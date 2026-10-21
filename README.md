# Buffer

Automatic hedging for BTC and ETH holders around CPI, jobs and Fed days. SoSoValue tells Buffer what is coming and how those releases have surprised before; SoDEX perps klines show how hard bitcoin moved each time. An hour before a risky release Buffer shorts SoDEX perps against part of your holdings, with its own stop and target on SoDEX, then unwinds or holds depending on the actual number. A Claude agent reads the news going in and explains every decision.

Built for the SoSoValue Buildathon (AKINDO). Design: [SPEC.md](SPEC.md).

## Run it
```bash
npm install          # .npmrc sets legacy-peer-deps (Privy's optional smart-wallet peers)
npm run dev          # http://localhost:3000
npm test             # 49 tests
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
| `/app/hedge` | Your hedges (practice or live), Run a practice drill, Check now, Close all hedges; plus the track record replay |
| `/app/receipts` | Hash-chained decision log, re-verified in your browser |
| `/app/settings` | Holdings, limits, practice/live, wallet balance sync, Connect SoDEX. Stored per user on the server |

## How the executor works
Every 5 minutes `/api/cron/tick` advances each user's hedges one step:

```
  (planned) ──1h before──▶ open ──number out──▶ closed      in line or good news
                             │               └──▶ holding ──time limit──▶ closed   bad news (stop moved to break-even)
                             └──────── time limit / kill switch ─────────▶ closed
```
- Each hedge is a SoDEX perps bracket: market short plus its own stop and target, so it stays protected even if Buffer is offline.
- Closing cancels the resting stop and target, then flattens with a reduce-only buy. Hedges can only ever reduce exposure.
- Live hedges only open on **trusted holdings**: confirmed in the last 7 days, or synced from a wallet in the last 24 hours. A hedge can't outgrow coins you've sold.
- **Practice mode** runs the identical path and signs every order, but sends nothing. **Run a practice drill** replays the latest risky release through the real executor so you can watch a full cycle without waiting for CPI.
- Every step is appended to your hash-chained receipts.

## Connecting SoDEX
Settings → SoDEX account offers two routes:
1. **Use an existing API key (recommended).** Create a key on SoDEX → API keys, paste its name and private key. Buffer checks with SoDEX that the key belongs to your account, then stores it encrypted (AES-256-GCM). This is SoDEX's officially supported flow.
2. **Connect with my Buffer wallet (experimental).** Buffer generates a trading key and your Privy wallet signs SoDEX's `AddAPIKey` message to register it. SoDEX documents the endpoint, but its SDK notes say externally generated keys may not be accepted yet; if it fails, Buffer opens route 1 for you.

Either way the key can open and close perps but can't withdraw. Your SoDEX perps account needs USDC for margin (about hedge size ÷ leverage).

## Deploy (Vercel)
1. Import `kazzysax/BUFFER` on Vercel. `vercel.json` already sets the install command.
2. Storage → add **Upstash Redis**. It fills in `KV_REST_API_URL` / `KV_REST_API_TOKEN`. Without it nothing persists between requests.
3. Environment variables: `BUFFER_ENCRYPTION_KEY`, `CRON_SECRET`, `SODEX_NETWORK=testnet`, plus the Privy, SoSoValue and Anthropic keys above.
4. Heartbeat: Vercel Hobby crons only run daily, so use the included GitHub Action (`.github/workflows/executor.yml`). Add repo secrets `BUFFER_URL` (your Vercel URL) and `CRON_SECRET`. On Vercel Pro you can use a Vercel Cron on `/api/cron/tick` every 5 minutes instead.
5. Privy dashboard → allowed origins → add the Vercel URL.

## Status (Oct 21)
- [x] SoDEX perps signing client + order builders (bracket hedge, reduce-only unwind, break-even stop)
- [x] Engine: DST-aware times, per-event playbook, guardrailed sizing, post-release decision, receipts
- [x] Agent layer (Claude): news analyst, event classifier, explainer, clamped with rules-only fallback
- [x] Executor: 5-minute heartbeat, practice/live, drill, check now, kill switch
- [x] Per-user server storage (Redis or file), encrypted trading keys, Connect SoDEX (two routes)
- [x] Holdings trust check + optional read-only BTC/ETH wallet sync
- [x] Frontend in the reference style + Privy Google login with embedded wallet
- [ ] **First live perps testnet order** (`npm run test-order`), needs a funded testnet account
- [ ] Deploy with real keys, record demo, submit on AKINDO (see [DEMO.md](DEMO.md))

## Scripts
```bash
npm run test-order   # sign (and with SEND=1, place) one testnet perps hedge
npm run playbook     # print the live plan for the next 14 days
```

## Layout
```
app/            Next.js pages + API routes (timeline, event, replay, me, hedges, run, drill, sodex/*, cron/tick)
components/     UI kit, charts (validated palette), the lifeline
lib/            Privy auth bridge, account hook, API hook
lib/server/     auth (jose), store (Redis/file), users, executor wiring, crypto, SoDEX account, wallet sync
src/sodex/      types, canonical payloads, signer, REST client, order builders
src/sosovalue/  macro calendar, event history, featured news
src/engine/     events, playbook, policy, pipeline, replay, receipts, executor (state machine)
src/account/    settings clamping, trusted-holdings rule, read-only balance lookups
src/agent/      Claude client (forced tool output) + three advisors
src/sources/    live (SoSoValue + SoDEX) and sample data sources
test/           sodex, engine, agent, replay, executor
verify/go/      optional cross-check against the official SoDEX Go SDK
```
