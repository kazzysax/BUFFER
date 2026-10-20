import type { TimelineItem } from "@/src/engine/pipeline";
import type { MacroRelease, NewsItem } from "@/src/sosovalue/client";
import type { Receipt } from "@/src/engine/receipts";
import type { PostDecision } from "@/src/engine/policy";
import type { ReplayPoint } from "@/components/charts";

export interface SourceInfo {
  data: "live" | "sample";
  agent: string | null;
}

export interface TimelineResponse extends SourceInfo {
  prices: { BTC: number; ETH: number };
  holdings: { BTC: number; ETH: number };
  items: TimelineItem[];
}

export interface EventResponse extends SourceInfo {
  prices: { BTC: number; ETH: number };
  item: TimelineItem;
  history: MacroRelease[];
  news: NewsItem[];
}

export interface ReplayRun {
  key: string;
  label: string;
  date: string;
  tier: "HIGH" | "MEDIUM" | "LOW";
  action: PostDecision["action"];
  closeReason: string;
  savedUsd: number;
  worstUnhedgedUsd: number;
  worstHedgedUsd: number;
}

export interface ReplayResponse extends SourceInfo {
  summary: { runs: number; netUsd: number; cushionedUsd: number };
  runs: ReplayRun[];
  detail?: {
    key: string;
    label: string;
    date: string;
    releaseAt: number;
    openedAt: number;
    closedAt: number;
    closeReason: string;
    decision: PostDecision;
    entry: number;
    exit: number;
    qty: number;
    points: ReplayPoint[];
    savedUsd: number;
    receipts: Receipt[];
    chain: { ok: true } | { ok: false; brokenAt: number };
    head: string;
  };
}
