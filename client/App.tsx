import { useCallback, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SetupScreen } from "./screens/SetupScreen.tsx";
import { LoginScreen } from "./screens/LoginScreen.tsx";
import { ScenesScreen } from "./screens/ScenesScreen.tsx";
import { ChatScreen } from "./screens/ChatScreen.tsx";
import { CharactersScreen } from "./screens/CharactersScreen.tsx";
import { CharacterEditorScreen } from "./screens/CharacterEditorScreen.tsx";
import { AuthorsScreen, AuthorEditorScreen } from "./screens/AuthorsScreen.tsx";
import { SceneSetupScreen } from "./screens/SceneSetupScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import { api } from "./lib/api.ts";
import { strings } from "./strings.ts";
import { useRoute } from "./lib/router.ts";
import { useIsDesktop } from "./lib/breakpoint.ts";
import { Sidebar } from "./components/Sidebar.tsx";
import { useViewportHeight } from "./lib/viewport.ts";
import type { BootstrapDto } from "@shared/types.ts";

/**
 * Server state is cached but never stale for long: the message tree is
 * authoritative on the server, and a generation can change it without this
 * client asking.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

type Phase = { status: "loading" } | { status: "error" } | { status: "ready"; boot: BootstrapDto };

/**
 * UI state lives in memory only. No localStorage or sessionStorage anywhere in
 * this app (HANDOFF non-negotiable 8) — server state is in SQLite, and what
 * survives a reload is the session cookie and nothing else.
 */
export function App() {
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  useViewportHeight();

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
      <div className="flex screen-height items-center justify-center">
        <p className="chrome text-[9px] tracking-[0.18em] text-ink-dim uppercase">
          {strings.common.working}
        </p>
      </div>
    );
  }

  if (phase.status === "error") {
    return (
      <div className="flex screen-height items-center justify-center px-[22px]">
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
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}

/**
 * The shell (design `4a`, SPEC §16).
 *
 * On a phone a screen is the whole window and navigation is the tab bar at the
 * bottom. With room, the tab bar unrolls into a persistent sidebar beside every
 * screen — same destinations, same treatment, more space — and the screens
 * themselves are unchanged: each one still renders its own header, body and
 * footer into whatever column it is given.
 */
function Shell() {
  const isDesktop = useIsDesktop();
  if (!isDesktop) return <Routed />;
  return (
    <div className="flex screen-height bg-bg">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Routed />
      </div>
    </div>
  );
}

function Routed() {
  const route = useRoute();
  switch (route.name) {
    case "chat":
      return <ChatScreen sceneId={route.sceneId} />;
    case "characters":
      return <CharactersScreen />;
    case "character":
      return <CharacterEditorScreen characterId={route.characterId} />;
    case "authors":
      return <AuthorsScreen />;
    case "author":
      return <AuthorEditorScreen authorId={route.authorId} />;
    case "setup":
      return <SceneSetupScreen sceneId={route.sceneId} />;
    case "settings":
      return <SettingsScreen />;
    case "scenes":
    case "unknown":
      return <ScenesScreen />;
  }
}
