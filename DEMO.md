# Buffer: demo script and submission

## Demo video (about 2½ minutes)

Record at 1440×900. Start signed out on the landing page.

| Time | Screen | Say |
|---|---|---|
| 0:00 | Landing hero | "If you hold bitcoin, a handful of days a month decide your P&L: CPI, jobs, the Fed. Buffer hedges you before the number lands and steps aside once it's safe." |
| 0:12 | Scroll the lifeline | "This is the next two weeks from SoSoValue's macro calendar. The spikes are how hard each release has historically moved bitcoin." |
| 0:22 | Click **Start protecting** → Google sign-in | "Sign in with Google. Privy creates a wallet, and you start in practice mode." |
| 0:32 | Timeline | "Every release gets a risk rating learned from its own history, and a plan in plain English." |
| 0:42 | Open the CPI event | "CPI: each dot is a past release. How far it missed forecast, how bitcoin moved. The plan: short half your holdings on SoDEX perps an hour before, with its own stop and target." |
| 1:00 | Agent read panel | "Claude reads SoSoValue's news going in and can nudge size between 0.75 and 1.25×, but only if it cites real articles, and never past your limits." |
| 1:12 | Hedges → **Run a practice drill** | "Rather than wait for the next CPI, run the real executor on the last one." |
| 1:22 | Drill result + track record chart | "It opened an hour early, read a hotter print, held with the stop at break-even, and closed at the time limit. Orange is with Buffer, blue is holding only." |
| 1:40 | Receipts | "Every step is in a hash-chained log, verified right here in the browser." |
| 1:50 | Settings → limits, wallet sync, SoDEX | "Your limits are enforced on the server. Coins can be anywhere; sync a wallet to keep amounts honest. Connect SoDEX with an API key that can trade but never withdraw." |
| 2:10 | Hedges → **Close all hedges** | "One button closes everything with reduce-only orders." |
| 2:18 | Back to landing | "Buffer: SoSoValue for the signal, SoDEX for the hedge, Claude for the judgment, and you stay in control." |

If the testnet order works, add a 10-second cut of `SEND=1 npm run test-order` returning a real SoDEX order ID after 1:22.

## AKINDO submission

**Name:** Buffer

**One line:** Automatic hedging for crypto holders around CPI, jobs and Fed days: SoSoValue data in, SoDEX perps hedge out, explained by an agent.

**Problem.** Spot holders take their biggest, least predictable hits on a few scheduled macro days a month. Pros hedge into them; retail sits up at 8:30 ET or eats the move.

**What Buffer does.**
1. Reads SoSoValue's macro calendar and each event's history (actual vs forecast).
2. Learns from SoDEX klines how hard each event type has moved bitcoin, and rates it.
3. An hour before a risky release, opens a sized SoDEX perps short with its own stop and target.
4. When the number lands: in line or good news → unwinds; bad news → holds with stop at break-even, then exits.
5. Logs every decision to a tamper-evident receipt chain.

**Agent.** Claude reads SoSoValue featured news before each release and may adjust size 0.75–1.25×, must cite real articles, and is applied before the user's caps. It also classifies unfamiliar events and explains each action. Any failure falls back to rules.

**Safety.** Hedges only reduce exposure (capped at declared holdings, reduce-only exits); every hedge carries its own stop and target on SoDEX; live hedges need holdings confirmed this week or wallet-synced today; trading keys can't withdraw and are encrypted at rest; practice mode by default; one-click kill switch.

**Judging fit.**
- *User value (30%)*: removes the most stressful recurring risk for a spot holder, set once.
- *Working demo (25%)*: live app, practice drill runs the real executor on the latest release; SoDEX order signing verified against SoDEX's documented payload.
- *Logic and design (20%)*: deterministic, tested state machine (49 tests); per-event learned playbooks; guardrails enforced server-side.
- *Data and API (15%)*: SoSoValue macro calendar, event history and featured news; SoDEX perps klines, mark prices, bracket orders, leverage, cancels, API-key registration.
- *UX (10%)*: timeline-first, plain-English plans, every number explained.

**Links:** repo https://github.com/kazzysax/BUFFER · live app: _add Vercel URL_ · video: _add link_

**Honest limits.** Release times come from a fixed table because the calendar feed has dates only. Track record uses BTC history only. Live trading has been exercised against a mocked SoDEX in tests; the first real testnet order is pending a funded account.
