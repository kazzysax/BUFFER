import "server-only";
import type { Hex } from "viem";
import { SodexPerps, SodexError } from "@/src/sodex/client";
import type { Network } from "@/src/sodex/types";
import { decrypt } from "./crypto";
import type { SodexConnection } from "./users";

export const NETWORK: Network = (process.env.SODEX_NETWORK as Network) === "mainnet" ? "mainnet" : "testnet";

/** Account ID for a wallet, or a plain-English reason it has none yet. */
export async function lookupAccount(network: Network, address: string): Promise<{ ok: true; accountID: number } | { ok: false; error: string }> {
  try {
    const st = await new SodexPerps(network).state(address);
    const aid = Number(st.aid);
    if (!Number.isFinite(aid) || aid <= 0) return { ok: false, error: noAccount(network) };
    return { ok: true, accountID: aid };
  } catch (e) {
    if (e instanceof SodexError && e.status < 500) return { ok: false, error: noAccount(network) };
    return { ok: false, error: `Couldn't reach SoDEX ${network}: ${(e as Error).message}` };
  }
}

function noAccount(network: Network) {
  return network === "testnet"
    ? "This wallet has no SoDEX testnet account yet. Open testnet.sodex.com with it, claim test USDC from the faucet, and move some into Perps. Then connect again."
    : "This wallet has no SoDEX account yet. Deposit on sodex.com first, then connect again.";
}

/** A signing client for a connected user. */
export function tradingClient(c: SodexConnection) {
  return new SodexPerps(c.network, { privateKey: decrypt(c.encKey) as Hex, apiKeyName: c.keyName });
}
