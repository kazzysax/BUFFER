"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Settings, WalletSync } from "@/src/account/settings";
import type { Guardrails } from "@/src/engine/policy";
import { useAuth } from "./auth";

export interface MeResponse {
  user: {
    id: string;
    email?: string;
    wallet?: string;
    settings: Settings;
    settingsAt?: number;
    confirmedAt?: number;
    sync?: WalletSync;
    sodex?: { network: "testnet" | "mainnet"; address: string; accountID: number; keyName: string; keyAddress: string; via: "wallet" | "imported"; connectedAt: number };
  };
  holdings: { BTC: number; ETH: number };
  holdingsSource: { BTC: "typed" | "synced"; ETH: "typed" | "synced" };
  holdingsTrusted: boolean;
  guard: Guardrails;
  env?: { store: { kind: "redis" | "file"; durable: boolean }; encryption: boolean; cron: boolean; network?: "testnet" | "mainnet" };
}

interface MeCtx {
  me: MeResponse | null;
  error: string | null;
  /** Bumps whenever settings change, so data views refetch. */
  version: number;
  call: <T = MeResponse>(path: string, method?: string, body?: unknown) => Promise<T>;
  update: (body: Record<string, unknown>) => Promise<MeResponse>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<MeCtx | null>(null);

export function useMe() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useMe outside MeProvider");
  return c;
}

export function MeProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const call = useCallback(
    async <T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
      const t = await auth.token();
      const res = await fetch(path, {
        method,
        headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const j = await res.json().catch(() => ({ error: `Request failed (${res.status}).` }));
      if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status}).`);
      return j as T;
    },
    [auth],
  );

  const refresh = useCallback(async () => {
    try {
      setMe(await call<MeResponse>("/api/me"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [call]);

  const update = useCallback(
    async (body: Record<string, unknown>) => {
      const next = await call<MeResponse>("/api/me", "PUT", body);
      setMe((prev) => ({ ...next, env: next.env ?? prev?.env }));
      setVersion((v) => v + 1);
      return next;
    },
    [call],
  );

  // first load, and tell the server who we are (display only)
  useEffect(() => {
    if (!auth.authenticated) return;
    (async () => {
      try {
        const profile = { email: auth.user?.email, wallet: auth.user?.wallet };
        const next = await call<MeResponse>("/api/me", "PUT", { profile });
        setMe(next);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [auth.authenticated, auth.user?.email, auth.user?.wallet, call]);

  return createElement(Ctx.Provider, { value: { me, error, version, call, update, refresh } }, children);
}
