"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { MeProvider, useMe } from "@/lib/me";
import { Icon, Logo, shortAddr } from "@/components/ui";
import s from "./shell.module.css";

const NAV = [
  { href: "/app", label: "Timeline", icon: "clock" as const },
  { href: "/app/hedge", label: "Hedges", icon: "shield" as const },
  { href: "/app/receipts", label: "Receipts", icon: "doc" as const },
  { href: "/app/settings", label: "Settings", icon: "gear" as const },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (!auth.ready) return <div className={s.loading}>Loading your session…</div>;
  if (!auth.authenticated) return <SignIn />;
  return (
    <MeProvider>
      <Shell>{children}</Shell>
    </MeProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const path = usePathname();
  const { me } = useMe();
  const live = Boolean(me?.user.settings.live && me.user.sodex);

  return (
    <div className={s.shell}>
      <aside className={s.side}>
        <a href="/" aria-label="Buffer home">
          <Logo />
        </a>
        <nav className={s.nav}>
          {NAV.map((n) => {
            const on = n.href === "/app" ? path === "/app" || path.startsWith("/app/event") : path.startsWith(n.href);
            return (
              <a key={n.href} href={n.href} className={on ? s.on : undefined} aria-current={on ? "page" : undefined}>
                <Icon name={n.icon} />
                {n.label}
              </a>
            );
          })}
        </nav>
        <div className={s.me}>
          <div className={s.avatar}>{(auth.user?.name ?? auth.user?.email ?? "?").slice(0, 1).toUpperCase()}</div>
          <div className={s.meText}>
            <b>{auth.user?.name ?? auth.user?.email}</b>
            <span className="small">{auth.user?.wallet ? shortAddr(auth.user.wallet) : auth.mode === "preview" ? "Preview session" : "Creating wallet…"}</span>
          </div>
          <button className={s.out} onClick={() => auth.logout()} aria-label="Sign out" title="Sign out">
            <Icon name="out" />
          </button>
        </div>
      </aside>
      <div className={s.main}>
        <header className={s.top}>
          <span className="tag">
            <span className="dot" style={{ color: live ? "var(--critical)" : "var(--good)" }} />
            {live ? `Live on SoDEX ${me!.user.sodex!.network}` : "Practice mode, no real orders"}
          </span>
          {auth.mode === "preview" && <span className="tag">Preview sign-in: add a Privy app ID to enable Google</span>}
          {me?.env && !me.env.store.durable && <span className="tag">Storage resets on restart: add Redis to keep accounts</span>}
        </header>
        <ConfirmHoldings />
        <div className={s.content}>{children}</div>
      </div>
    </div>
  );
}

/** Before Buffer sizes a hedge off typed holdings, it checks they're still true. */
function ConfirmHoldings() {
  const { me, update } = useMe();
  const [busy, setBusy] = useState(false);
  if (!me || me.holdingsTrusted || (me.holdings.BTC === 0 && me.holdings.ETH === 0)) return null;
  const parts = [me.holdings.BTC ? `${me.holdings.BTC} BTC` : "", me.holdings.ETH ? `${me.holdings.ETH} ETH` : ""].filter(Boolean).join(" and ");
  return (
    <div className={s.confirm} role="region" aria-label="Confirm holdings">
      <div>
        <b>You&rsquo;re protecting {parts}. Still right?</b>
        <span className="small">Buffer sizes every hedge from this. Live hedges only open on holdings confirmed in the last 7 days, or synced from a wallet.</span>
      </div>
      <div className={s.confirmActions}>
        <button
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await update({ confirmHoldings: true });
            } finally {
              setBusy(false);
            }
          }}
        >
          Yes, that&rsquo;s right
        </button>
        <a href="/app/settings" className="btn btn-ghost btn-sm">
          Change holdings
        </a>
      </div>
    </div>
  );
}

function SignIn() {
  const { login, mode } = useAuth();
  return (
    <main className={s.signin}>
      <div className="glow" />
      <div className={`glass ${s.signinCard}`}>
        <Logo size={34} />
        <h1 className="h2" style={{ margin: "22px 0 8px" }}>
          Sign in to Buffer
        </h1>
        <p className="small" style={{ margin: "0 0 24px" }}>
          Use your Google account. We create a wallet for you on first sign-in, and you start in practice mode.
        </p>
        <button className="btn btn-primary" onClick={login} style={{ width: "100%", justifyContent: "space-between" }}>
          {mode === "privy" ? "Continue with Google or email" : "Continue in preview"}
          <span className="chip">
            <Icon name="arrow" />
          </span>
        </button>
        {mode === "preview" && (
          <p className="small" style={{ marginTop: 16 }}>
            Google sign-in turns on when <code>NEXT_PUBLIC_PRIVY_APP_ID</code> is set.
          </p>
        )}
        <a href="/" className="small" style={{ display: "block", marginTop: 18 }}>
          Back to home
        </a>
      </div>
    </main>
  );
}
