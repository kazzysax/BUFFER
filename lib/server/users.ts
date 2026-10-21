import "server-only";
import { DEFAULT_SETTINGS, clampSettings, effectiveHoldings, holdingsTrusted, toGuardrails, type Settings, type WalletSync } from "@/src/account/settings";
import type { Network } from "@/src/sodex/types";
import { getStore } from "./store";

export interface SodexConnection {
  network: Network;
  address: string; // master wallet that owns the SoDEX account
  accountID: number;
  keyName: string;
  keyAddress: string; // public half of the trading key
  encKey: string; // AES-GCM encrypted private key — never leaves the server
  via: "wallet" | "imported";
  connectedAt: number;
}

export interface PendingConnect {
  network: Network;
  address: string;
  accountID: number;
  keyName: string;
  keyAddress: string;
  encKey: string;
  nonce: number;
  createdAt: number;
}

export interface User {
  id: string;
  email?: string;
  wallet?: string;
  createdAt: number;
  settings: Settings;
  settingsAt?: number;
  confirmedAt?: number;
  sync?: WalletSync;
  sodex?: SodexConnection;
  pending?: PendingConnect;
}

/** What the browser is allowed to see. */
export type PublicUser = Omit<User, "sodex" | "pending"> & {
  sodex?: Omit<SodexConnection, "encKey">;
};

const k = (id: string) => `user:${id}`;
export const USERS_SET = "users";

export async function getUser(id: string): Promise<User | null> {
  return getStore().get<User>(k(id));
}

export async function saveUser(u: User) {
  await getStore().set(k(u.id), u);
}

export async function ensureUser(id: string): Promise<User> {
  const existing = await getUser(id);
  if (existing) return existing;
  const u: User = { id, createdAt: Date.now(), settings: { ...DEFAULT_SETTINGS } };
  await saveUser(u);
  await getStore().sadd(USERS_SET, id);
  return u;
}

export async function listUserIds(): Promise<string[]> {
  return getStore().smembers(USERS_SET);
}

export function publicUser(u: User): PublicUser {
  const { sodex, pending: _pending, ...rest } = u;
  if (!sodex) return rest;
  const { encKey: _e, ...safe } = sodex;
  return { ...rest, sodex: safe };
}

export function userView(u: User, now = Date.now()) {
  const h = effectiveHoldings(u.settings, u.sync);
  return {
    user: publicUser(u),
    holdings: { BTC: h.BTC, ETH: h.ETH },
    holdingsSource: h.source,
    holdingsTrusted: holdingsTrusted({ settings: u.settings, sync: u.sync, confirmedAt: u.confirmedAt, now }),
    guard: toGuardrails(u.settings),
  };
}

export function applySettings(u: User, raw: unknown): User {
  return { ...u, settings: clampSettings(raw as Partial<Settings>, u.settings), settingsAt: Date.now() };
}
