"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { Icon } from "./ui";

/** Sends signed-in users to the app; opens the Privy sign-in for everyone else, then continues. */
export function StartButton({ label = "Start protecting" }: { label?: string }) {
  const { authenticated, ready, login } = useAuth();
  const router = useRouter();
  const pending = useRef(false);
  useEffect(() => {
    if (pending.current && authenticated) router.push("/app");
  }, [authenticated, router]);
  return (
    <button
      className="btn btn-primary"
      disabled={!ready}
      onClick={() => {
        if (authenticated) return router.push("/app");
        pending.current = true;
        login();
      }}
    >
      {label}
      <span className="chip">
        <Icon name="arrow" />
      </span>
    </button>
  );
}

export function SignInLink() {
  const { authenticated, ready, login } = useAuth();
  const router = useRouter();
  const pending = useRef(false);
  useEffect(() => {
    if (pending.current && authenticated) router.push("/app");
  }, [authenticated, router]);
  if (!ready) return <span className="btn btn-ghost btn-sm" aria-hidden style={{ opacity: 0.4 }}>Sign in</span>;
  return authenticated ? (
    <a href="/app" className="btn btn-ghost btn-sm">
      Open app
    </a>
  ) : (
    <button
      className="btn btn-ghost btn-sm"
      onClick={() => {
        pending.current = true;
        login();
      }}
    >
      Sign in
    </button>
  );
}
