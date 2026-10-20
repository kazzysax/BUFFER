/**
 * The macro feed gives dates and names only. This table supplies release time (US Eastern)
 * and which direction of surprise is risk-off for crypto. Documented, deterministic, editable.
 *
 * riskOffWhen: "higher" → actual above forecast is risk-off (hot inflation, strong jobs → hawkish).
 *              "lower"  → actual below forecast is risk-off (weak growth / sentiment).
 */
export interface EventMeta {
  key: string;
  label: string;
  timeET: string; // HH:MM
  timeKnown: boolean;
  riskOffWhen: "higher" | "lower" | "unknown";
}

const TABLE: Array<[RegExp, Omit<EventMeta, "key">]> = [
  [/\bcore\s*cpi\b/i, { label: "Core CPI", timeET: "08:30", timeKnown: true, riskOffWhen: "higher" }],
  [/\bcpi\b|consumer price/i, { label: "CPI", timeET: "08:30", timeKnown: true, riskOffWhen: "higher" }],
  [/\bcore\s*pce\b/i, { label: "Core PCE", timeET: "08:30", timeKnown: true, riskOffWhen: "higher" }],
  [/\bpce\b/i, { label: "PCE", timeET: "08:30", timeKnown: true, riskOffWhen: "higher" }],
  [/\bppi\b|producer price/i, { label: "PPI", timeET: "08:30", timeKnown: true, riskOffWhen: "higher" }],
  [/non-?farm|nfp|payroll/i, { label: "Nonfarm Payrolls", timeET: "08:30", timeKnown: true, riskOffWhen: "higher" }],
  [/unemployment rate/i, { label: "Unemployment Rate", timeET: "08:30", timeKnown: true, riskOffWhen: "lower" }],
  [/jobless|initial claims/i, { label: "Jobless Claims", timeET: "08:30", timeKnown: true, riskOffWhen: "lower" }],
  [/retail sales/i, { label: "Retail Sales", timeET: "08:30", timeKnown: true, riskOffWhen: "higher" }],
  [/\bgdp\b/i, { label: "GDP", timeET: "08:30", timeKnown: true, riskOffWhen: "lower" }],
  [/fomc|fed.*(rate|decision)|interest rate decision/i, { label: "FOMC Rate Decision", timeET: "14:00", timeKnown: true, riskOffWhen: "higher" }],
  [/\bism\b|pmi/i, { label: "ISM / PMI", timeET: "10:00", timeKnown: true, riskOffWhen: "lower" }],
  [/jolts|job openings/i, { label: "JOLTS", timeET: "10:00", timeKnown: true, riskOffWhen: "higher" }],
  [/consumer (sentiment|confidence)/i, { label: "Consumer Sentiment", timeET: "10:00", timeKnown: true, riskOffWhen: "lower" }],
];

export function eventMeta(name: string): EventMeta {
  for (const [re, m] of TABLE) if (re.test(name)) return { key: name, ...m };
  return { key: name, label: name, timeET: "10:00", timeKnown: false, riskOffWhen: "unknown" };
}

/** UTC offset (minutes) of America/New_York at a given instant, DST-aware. */
function nyOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")!.value; // "GMT-4"
  const m = parts.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!m) return 0;
  const h = Number(m[1]);
  return h * 60 + Math.sign(h) * Number(m[2] ?? 0);
}

/** Release instant (ms UTC) for an event on a calendar date. */
export function releaseTime(date: string, name: string): number {
  return releaseTimeAt(date, eventMeta(name).timeET);
}

/** Release instant (ms UTC) for a calendar date at an explicit US Eastern HH:MM. */
export function releaseTimeAt(date: string, timeET: string): number {
  const [hh, mm] = timeET.split(":").map(Number);
  const naiveUtc = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), hh, mm);
  const off = nyOffsetMinutes(new Date(naiveUtc));
  return naiveUtc - off * 60_000;
}
