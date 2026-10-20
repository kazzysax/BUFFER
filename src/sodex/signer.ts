import { concatHex, hexToBytes, bytesToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { payloadHash } from "./payload";
import { CHAIN_ID, type Action, type Network } from "./types";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export function perpsDomain(network: Network) {
  return { name: "futures", version: "1", chainId: CHAIN_ID[network], verifyingContract: ZERO } as const;
}

export const EXCHANGE_ACTION_TYPES = {
  ExchangeAction: [
    { name: "payloadHash", type: "bytes32" },
    { name: "nonce", type: "uint64" },
  ],
} as const;

/**
 * v-byte convention. The Go SDK uses go-ethereum's crypto.Sign, which emits v ∈ {0,1},
 * and the server recovers with crypto.SigToPub (which needs {0,1}). viem emits {27,28}.
 * Default "go" normalizes to {0,1}. Flip to "eth" only if the server ever rejects it.
 */
export type VMode = "go" | "eth";

function normalizeV(sig: Hex, mode: VMode): Hex {
  const b = hexToBytes(sig);
  if (b.length !== 65) throw new Error(`expected 65-byte signature, got ${b.length}`);
  const v = b[64];
  if (mode === "go" && v >= 27) b[64] = v - 27;
  if (mode === "eth" && v < 27) b[64] = v + 27;
  return bytesToHex(b);
}

export interface SignedHeaders {
  "X-API-Sign": Hex;
  "X-API-Nonce": string;
  "X-API-Key"?: string;
}

export async function signAction(opts: {
  action: Action;
  privateKey: Hex;
  network: Network;
  nonce?: bigint;
  apiKeyName?: string; // omit when signing with the master wallet directly
  vMode?: VMode;
}): Promise<{ headers: SignedHeaders; payloadHash: Hex; nonce: bigint; signer: Hex }> {
  const account = privateKeyToAccount(opts.privateKey);
  const nonce = opts.nonce ?? BigInt(Date.now());
  const ph = payloadHash(opts.action);
  const raw = await account.signTypedData({
    domain: perpsDomain(opts.network),
    types: EXCHANGE_ACTION_TYPES,
    primaryType: "ExchangeAction",
    message: { payloadHash: ph, nonce },
  });
  const sig = concatHex(["0x01", normalizeV(raw, opts.vMode ?? "go")]);
  const headers: SignedHeaders = { "X-API-Sign": sig, "X-API-Nonce": nonce.toString() };
  if (opts.apiKeyName) headers["X-API-Key"] = opts.apiKeyName;
  return { headers, payloadHash: ph, nonce, signer: account.address };
}
