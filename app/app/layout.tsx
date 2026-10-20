"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { Icon, Logo, shortAddr } from "@/components/ui";
import s from "./shell.module.css";

const NAV = [
  { href: "/app", label: "Timeline", icon: "clock" as const },
  { href: "/app/hedge", label: "Hedge", icon: "shield" as const },
  { href: "/app/receipts", label: "Receipts", icon: "doc" as const },
  { href: "/app/settings", label: "Settings", icon: "gear" as const },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const path = usePathname();
  const { settings } = useSettings();

  if (!auth.ready) return <div className={s.loading}>Loading your session…</div>;
  if (!auth.authenticated) return <SignIn />;

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
            <span className="dot" style={{ color: settings.live ? "var(--critical)" : "var(--good)" }} />
            {settings.live ? "Live trading" : "Practice mode, no real orders"}
          </span>
          {auth.mode === "preview" && <span className="tag">Preview sign-in: add a Privy app ID to enable Google</span>}
        </header>
        <div className={s.content}>{children}</div>
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
