"use client";

import { useCallback, useEffect, useState } from "react";

export interface Settings {
  btc: number;
  eth: number;
  maxRatio: number;
  maxUsd: number;
  lev: number;
  lead: number;
  hold: number;
  aggr: number;
  live: boolean;
}

export const DEFAULT_SETTINGS: Settings = { btc: 0.2, eth: 3, maxRatio: 0.5, maxUsd: 5000, lev: 2, lead: 60, hold: 6, aggr: 1, live: false };

const KEY = "buffer.settings";

export function toQuery(s: Settings) {
  const q = new URLSearchParams({
    btc: String(s.btc),
    eth: String(s.eth),
    maxRatio: String(s.maxRatio),
    maxUsd: String(s.maxUsd),
    lev: String(s.lev),
    lead: String(s.lead),
    hold: String(s.hold),
    aggr: String(s.aggr),
  });
  if (s.live) q.set("live", "1");
  return q.toString();
}

/** Per-browser settings for now; moves to the server with the executor. */
export function useSettings() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setS({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
    } catch {}
    setLoaded(true);
  }, []);
  const save = useCallback((next: Settings) => {
    setS(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  }, []);
  return { settings: s, save, loaded };
}
