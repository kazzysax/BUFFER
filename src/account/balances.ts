/** Read-only balance lookups for wallet auto-sync. Buffer never needs control of these addresses. */

const BTC_RE = /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/;
const ETH_RE = /^0x[0-9a-fA-F]{40}$/;

export const isBtcAddress = (a: string) => BTC_RE.test(a.trim());
export const isEthAddress = (a: string) => ETH_RE.test(a.trim());

const BTC_API = process.env.BUFFER_BTC_API || "https://mempool.space/api";
const ETH_RPC = process.env.BUFFER_ETH_RPC || "https://ethereum-rpc.publicnode.com";

async function withTimeout(url: string, init: RequestInit = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

/** Confirmed + mempool balance in BTC. */
export async function btcBalance(address: string, fetchImpl: typeof fetch = withTimeout as typeof fetch): Promise<number> {
  if (!isBtcAddress(address)) throw new Error("That doesn't look like a bitcoin address.");
  const res = await fetchImpl(`${BTC_API}/address/${address.trim()}`);
  if (!res.ok) throw new Error(`Bitcoin lookup failed (${res.status}).`);
  const j = (await res.json()) as { chain_stats: { funded_txo_sum: number; spent_txo_sum: number }; mempool_stats?: { funded_txo_sum: number; spent_txo_sum: number } };
  const sats = j.chain_stats.funded_txo_sum - j.chain_stats.spent_txo_sum + (j.mempool_stats ? j.mempool_stats.funded_txo_sum - j.mempool_stats.spent_txo_sum : 0);
  return sats / 1e8;
}

/** Native ETH balance on Ethereum mainnet. */
export async function ethBalance(address: string, fetchImpl: typeof fetch = withTimeout as typeof fetch): Promise<number> {
  if (!isEthAddress(address)) throw new Error("That doesn't look like an Ethereum address.");
  const res = await fetchImpl(ETH_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address.trim(), "latest"] }),
  });
  if (!res.ok) throw new Error(`Ethereum lookup failed (${res.status}).`);
  const j = (await res.json()) as { result?: string; error?: { message: string } };
  if (!j.result) throw new Error(`Ethereum lookup failed: ${j.error?.message ?? "no result"}.`);
  const wei = BigInt(j.result);
  return Number(wei / 10n ** 12n) / 1e6; // 6-decimal precision without float overflow
}
