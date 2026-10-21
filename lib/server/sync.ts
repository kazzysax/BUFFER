import "server-only";
import { btcBalance, ethBalance } from "@/src/account/balances";
import type { User } from "./users";

/** Refresh synced wallet balances. Errors are recorded on the user, never thrown. */
export async function syncBalances(u: User): Promise<User> {
  const sync = { ...(u.sync ?? {}) };
  const errors: string[] = [];
  const [b, e] = await Promise.allSettled([
    sync.btcAddress ? btcBalance(sync.btcAddress) : Promise.resolve(null),
    sync.ethAddress ? ethBalance(sync.ethAddress) : Promise.resolve(null),
  ]);
  if (b.status === "fulfilled") sync.btc = b.value;
  else errors.push((b.reason as Error).message);
  if (e.status === "fulfilled") sync.eth = e.value;
  else errors.push((e.reason as Error).message);
  sync.at = Date.now();
  sync.error = errors.length ? errors.join(" ") : undefined;
  return { ...u, sync };
}
