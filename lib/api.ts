"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth";
import { useMe } from "./me";

/** Authenticated GET with loading / error states. Re-runs when `path` changes. */
export function useApi<T>(path: string | null) {
  const { token, authenticated } = useAuth();
  const { version } = useMe();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!path || !authenticated) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const t = await token();
        const res = await fetch(path, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
        const body = await res.json().catch(() => ({ error: `Request failed (${res.status}).` }));
        if (cancelled) return;
        if (!res.ok) setError(body.error ?? `Request failed (${res.status}).`);
        else setData(body as T);
      } catch {
        if (!cancelled) setError("Can't reach the Buffer server. Check your connection and retry.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, authenticated, token, n, version]);

  const retry = useCallback(() => setN((x) => x + 1), []);
  return { data, error, loading, retry };
}
