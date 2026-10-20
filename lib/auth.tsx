"use client";

import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  wallet?: string;
}

export interface Auth {
  mode: "privy" | "preview";
  ready: boolean;
  authenticated: boolean;
  user: AuthUser | null;
  login: () => void;
  logout: () => Promise<void>;
  token: () => Promise<string | null>;
}

const Ctx = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const a = useContext(Ctx);
  if (!a) throw new Error("useAuth outside AuthProvider");
  return a;
}

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

function PrivyBridge({ children }: { children: ReactNode }) {
  const p = usePrivy();
  const value = useMemo<Auth>(
    () => ({
      mode: "privy",
      ready: p.ready,
      authenticated: p.authenticated,
      user: p.user
        ? {
            id: p.user.id,
            email: p.user.google?.email ?? p.user.email?.address,
            name: p.user.google?.name ?? undefined,
            wallet: p.user.wallet?.address,
          }
        : null,
      login: () => p.login(),
      logout: () => p.logout(),
      token: () => p.getAccessToken(),
    }),
    [p.ready, p.authenticated, p.user, p.login, p.logout, p.getAccessToken], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const PREVIEW_KEY = "buffer.preview-session";

/** Used only when NEXT_PUBLIC_PRIVY_APP_ID is not set, so the app can be explored locally. */
function PreviewAuth({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      setOn(localStorage.getItem(PREVIEW_KEY) === "1");
    } catch {}
    setReady(true);
  }, []);
  const set = useCallback((v: boolean) => {
    setOn(v);
    try {
      v ? localStorage.setItem(PREVIEW_KEY, "1") : localStorage.removeItem(PREVIEW_KEY);
    } catch {}
  }, []);
  const value = useMemo<Auth>(
    () => ({
      mode: "preview",
      ready,
      authenticated: on,
      user: on ? { id: "preview", email: "preview@buffer.app", name: "Preview user" } : null,
      login: () => set(true),
      logout: async () => set(false),
      token: async () => null,
    }),
    [ready, on, set],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!APP_ID) return <PreviewAuth>{children}</PreviewAuth>;
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ["google", "email"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        appearance: { theme: "dark", accentColor: "#FF6A2B", landingHeader: "Sign in to Buffer", showWalletLoginFirst: false },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}
