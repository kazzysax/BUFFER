import { concatHex, hexToBytes, bytesToHex, type Hex } from "viem";
import { CHAIN_ID, type Network } from "./types";

export const PUBLIC_BASE: Record<Network, string> = {
  testnet: "https://testnet-gw.sodex.dev/api/v1",
  mainnet: "https://mainnet-gw.sodex.dev/api/v1",
};

const ZERO = "0x0000000000000000000000000000000000000000" as const;
export const API_KEY_TYPE_EVM = 1;

export interface AddApiKeyParams {
  accountID: number;
  name: string;
  publicKey: Hex; // the trading key's EVM address
  expiresAt: number; // ms; 0 = no expiry
}

/**
 * EIP-712 typed data the *master wallet* signs to authorise a trading key ("AddAPIKey",
 * universal domain). Mirrors sodex-go-sdk-public common/types/eip712.go AddAPIKey.
 */
export function addApiKeyTypedData(p: AddApiKeyParams, nonce: number, network: Network) {
  if (!/^[0-9a-zA-Z_-]{1,36}$/.test(p.name)) throw new Error("API key name must be 1–36 letters, digits, _ or -.");
  return {
    domain: { name: "universal", version: "1", chainId: CHAIN_ID[network], verifyingContract: ZERO },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      AddAPIKey: [
        { name: "accountID", type: "uint64" },
        { name: "name", type: "string" },
        { name: "keyType", type: "uint8" },
        { name: "publicKey", type: "bytes" },
        { name: "expiresAt", type: "uint64" },
        { name: "nonce", type: "uint64" },
      ],
    },
    primaryType: "AddAPIKey" as const,
    message: { accountID: p.accountID, name: p.name, keyType: API_KEY_TYPE_EVM, publicKey: p.publicKey, expiresAt: p.expiresAt, nonce },
  };
}

/** Request body: Go field order, `type` (not keyType) on the wire. */
export function addApiKeyBody(p: AddApiKeyParams) {
  return JSON.stringify({ accountID: p.accountID, name: p.name, type: API_KEY_TYPE_EVM, publicKey: p.publicKey, expiresAt: p.expiresAt });
}

/** Universal-domain signatures carry a 0x02 type prefix; v normalised to {0,1} like go-ethereum. */
export function universalWireSig(sig65: Hex): Hex {
  const b = hexToBytes(sig65);
  if (b.length !== 65) throw new Error(`Expected a 65-byte signature, got ${b.length}.`);
  if (b[64] >= 27) b[64] -= 27;
  return concatHex(["0x02", bytesToHex(b)]);
}

export async function registerApiKey(args: { network: Network; owner: string; params: AddApiKeyParams; nonce: number; walletSig: Hex; fetchImpl?: typeof fetch }) {
  const f = args.fetchImpl ?? fetch;
  const res = await f(`${PUBLIC_BASE[args.network]}/user/${args.owner}/api-keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-API-Chain": String(CHAIN_ID[args.network]),
      "X-API-Sign": universalWireSig(args.walletSig),
      "X-API-Nonce": String(args.nonce),
    },
    body: addApiKeyBody(args.params),
  });
  const text = await res.text();
  let j: { code?: number; error?: string } = {};
  try {
    j = JSON.parse(text);
  } catch {}
  if (!res.ok || j.code !== 0) throw new Error(`SoDEX rejected the key (${res.status}${j.code != null ? `, code ${j.code}` : ""}): ${j.error ?? text.slice(0, 160)}`);
}
