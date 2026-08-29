import { useCallback, useEffect, useState } from "react";
import { SetupScreen } from "./screens/SetupScreen.tsx";
import { LoginScreen } from "./screens/LoginScreen.tsx";
import { ReadyScreen } from "./screens/ReadyScreen.tsx";
import { api } from "./lib/api.ts";
import { strings } from "./strings.ts";
import type { BootstrapDto } from "@shared/types.ts";

type Phase = { status: "loading" } | { status: "error" } | { status: "ready"; boot: BootstrapDto };

/**
 * UI state lives in memory only. No localStorage or sessionStorage anywhere in
 * this app (HANDOFF non-negotiable 8) — server state is in SQLite, and what
 * survives a reload is the session cookie and nothing else.
 */
export function App() {
  const [phase, setPhase] = useState<Phase>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      setPhase({ status: "ready", boot: await api.get<BootstrapDto>("/bootstrap") });
    } catch {
      setPhase({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (phase.status === "loading") {
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <p className="chrome text-[9px] tracking-[0.18em] text-ink-dim uppercase">
          {strings.common.working}
        </p>
      </div>
    );
  }

  if (phase.status === "error") {
    return (
      <div className="flex h-[100dvh] items-center justify-center px-[22px]">
        <p className="chrome text-center text-[10px] tracking-[0.06em] text-red-text uppercase">
          {strings.errors.network}
        </p>
      </div>
    );
  }

  if (!phase.boot.setupCompleted) {
    return <SetupScreen onComplete={() => void refresh()} />;
  }
  if (!phase.boot.authenticated) {
    return <LoginScreen onAuthenticated={() => void refresh()} />;
  }
  return <ReadyScreen onSignedOut={() => void refresh()} />;
}
