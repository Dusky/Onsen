import { useCallback, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SetupScreen } from "./screens/SetupScreen.tsx";
import { LoginScreen } from "./screens/LoginScreen.tsx";
import { ScenesScreen } from "./screens/ScenesScreen.tsx";
import { ChatScreen } from "./screens/ChatScreen.tsx";
import { CharactersScreen } from "./screens/CharactersScreen.tsx";
import { CharacterEditorScreen } from "./screens/CharacterEditorScreen.tsx";
import { AuthorsScreen, AuthorEditorScreen } from "./screens/AuthorsScreen.tsx";
import { PersonasScreen } from "./screens/PersonasScreen.tsx";
import { SceneSetupScreen } from "./screens/SceneSetupScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import { LoreScreen } from "./screens/LoreScreen.tsx";
import { BackgroundsScreen } from "./screens/BackgroundsScreen.tsx";
import { api } from "./lib/api.ts";
import { strings } from "./strings.ts";
import { navigate, useShellRoute, type Route } from "./lib/router.ts";
import { useAutoCollapseRails, useIsDesktop } from "./lib/breakpoint.ts";
import { LeftRail } from "./components/LeftRail.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { Header } from "./components/Header.tsx";
import { Background } from "./components/Background.tsx";
import { focusComposer } from "./components/Composer.tsx";
import { RightRail } from "./components/RightRail.tsx";
import { setChimeWanted, unlockAudio } from "./lib/chime.ts";
import { usePreferences, useReader, useReading } from "./lib/queries.ts";
import { useMotionPreference, useReadingVariables, useViewportHeight } from "./lib/viewport.ts";
import { NoticeRegion } from "./components/NoticeRegion.tsx";
import { RouteOverlay } from "./components/RouteOverlay.tsx";
import { useUiStore } from "./state/ui.ts";
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
      const boot = await api.get<BootstrapDto>("/bootstrap");
      // The theme's base is a document-level fact, applied before any branch
      // renders so the login screen's fall-through tokens are right — a theme
      // that names few colours renders dark or light as its `base` says,
      // rather than following the OS preference (§20 phase 75).
      if (boot.themeBase !== null) {
        document.documentElement.dataset.theme = boot.themeBase;
      }
      setPhase({ status: "ready", boot });
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
        <p className="chrome text-ui text-ink-dim">
          {strings.common.working}
        </p>
      </div>
    );
  }

  if (phase.status === "error") {
    return (
      <div className="flex screen-height items-center justify-center px-[22px]">
        <p className="chrome text-center text-ui-loose text-red-text">
          {strings.errors.network}
        </p>
      </div>
    );
  }

  if (!phase.boot.setupCompleted) {
    // The wizard uses ModelPicker, which needs the query client — so the
    // provider wraps every branch, not just the authenticated shell. Phase 65
    // found this the hard way: a first run landed on a blank page with
    // "No QueryClient set".
    return (
      <QueryClientProvider client={queryClient}>
        <SetupScreen onComplete={() => void refresh()} />
      </QueryClientProvider>
    );
  }
  if (!phase.boot.authenticated) {
    return (
      <QueryClientProvider client={queryClient}>
        <LoginScreen onAuthenticated={() => void refresh()} />
      </QueryClientProvider>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}

/**
 * The first tab stop on the page, and the only way past the rails (§20 phase
 * 191).
 *
 * Hidden until focused, which is the conventional shape: it costs a sighted
 * mouse user nothing and it is the first thing a keyboard user meets. It has
 * to be first in the DOM to be first in the tab order, which is why it sits
 * above `<Background/>` rather than inside the shell it skips.
 *
 * The rails come before the main content in DOM order, and the Prompt panel
 * alone is around seventy-eight tab stops — twenty-six blocks with a toggle
 * and two reorder arrows each. Reordering the shell so the content comes first
 * is the deeper fix and a larger one, since the rails are laid out as flex
 * siblings and their visual order would have to be restored. This is the part
 * that can ship now, and it is the part a keyboard user actually needs: one
 * press, from anywhere, to the thing the app is for.
 *
 * Desktop only, deliberately: the phone branch renders no rails at all, so the
 * composer is a handful of stops away and a skip link would be one more
 * control for a problem that width does not have.
 */
function SkipToWriting() {
  return (
    <button
      type="button"
      onClick={focusComposer}
      className="chrome sr-only focus:not-sr-only focus:absolute focus:top-[8px] focus:left-[8px] focus:z-50 focus:border focus:border-blue-border focus:bg-blue-bg focus:px-[12px] focus:py-[8px] focus:text-[13px] focus:text-blue-text"
    >
      {strings.chat.skipToWriting}
    </button>
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
  // Below the rails' own width bands (breakpoint.ts), collapse them to their
  // icon strips before the log's prose measure gets squeezed (design review
  // fix 6). Runs unconditionally — the phone branch below just never reads
  // the rail state this writes.
  useAutoCollapseRails();
  const preferences = usePreferences();
  // Here rather than in `App`, which renders the QueryClientProvider itself and
  // so is above the cache a preference hook needs.
  const reader = useReader();
  useReadingVariables(useReading());
  useMotionPreference(reader.motion);
  /*
   * Selected, not destructured whole (§20 phase 170).
   *
   * `Shell` sits above `<Routed/>`, and `ChatScreen` writes `sceneInspector`
   * into this same store on every render of its own by design (a
   * dependency-less layout effect — "refreshed every render", its own
   * comment says). `useUiStore()` with no selector subscribes to the whole
   * store, so if `Shell` used that form it would re-render on every one of
   * those writes — and since `Shell` is `ChatScreen`'s ancestor, that
   * re-render reaches `ChatScreen` again, which reruns the effect, which
   * writes the store again: a loop that does not exist today only because
   * nothing above `ChatScreen` currently subscribes to this store. Found by
   * driving this in a browser, not by reading the code: React's own
   * "Maximum update depth exceeded" is what a selector-less subscribe here
   * turns into.
   */
  const vanished = useUiStore((state) => state.vanished);
  const toggleVanished = useUiStore((state) => state.toggleVanished);

  /*
   * Vanish mode: `z`, unmodified, anywhere the reader isn't typing. Global —
   * at the Shell level rather than in `useCommandKeys`, because that hook is
   * chat-only and the rails/header exist on every screen. Same field-focus
   * guard that hook uses, so a literal "z" typed into a field is never eaten.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const inField = document.activeElement?.matches("input, textarea, [contenteditable]");
      if (inField === true) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "z") {
        event.preventDefault();
        toggleVanished();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleVanished]);

  // §5's chime, and the autoplay policy that shapes it. A browser will not let
  // a page make a sound before the person has interacted with it, so the audio
  // context is built on the first gesture the app sees and nothing before then
  // can ring.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    setChimeWanted(preferences.data?.completionChime === true);
  }, [preferences.data?.completionChime]);

  // The cross-screen generation indicator sits above whatever screen is
  // showing, on both layouts: a reader who wandered off gets one way back
  // wherever they wandered to (SPEC §5, design §403). It lives in the top bar
  // now, beside the destinations (§20 phase 80).
  const { base, overlay } = useShellRoute();
  const overlayLabel = overlay === null ? "" : overlayLabelFor(overlay);

  if (!isDesktop) {
    return (
      <div className="relative screen-height">
        <Background />
        <div className="relative z-10 flex h-full flex-col bg-bg">
          {/* On a phone there is no rail to lose — vanish still recovers the
              top bar's ~44px, which is worth having and not worth special-
              casing away just because it is the smaller half of the win. */}
          {vanished ? null : <TopBar />}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {/* `hidden`, not unmounted — `MessageBlock.tsx`'s own convention
                for the same shape: kept alive underneath, just not painted.
                Needed for more than the obvious reason. This app's surface
                tokens (`bg-bg` included) are deliberately translucent, so the
                shared `<Background/>` artwork shows through every screen —
                fine when only one screen is ever in the stack. Stacked on
                top of a *second*, fully rendered screen instead of just that
                artwork, the same translucency let the base screen's own text
                bleed through legibly behind the overlay. Hiding it rather
                than fighting the theme's opacity is also the more honest fix:
                it holds for every theme, translucent or not, without this
                needing to know which. */}
            <div hidden={overlay !== null}>
              <Routed route={base} />
            </div>
            {overlay === null ? null : (
              <RouteOverlay label={overlayLabel} onClose={() => navigate(base)}>
                <Routed route={overlay} />
              </RouteOverlay>
            )}
          </div>
        </div>
        {/* Above every screen on both layouts, mounted once: the live regions
            have to be watched before the first notice arrives (§167). */}
        <NoticeRegion position={reader.notices} />
        {vanished ? <VanishHandle onRestore={toggleVanished} /> : null}
      </div>
    );
  }
  return (
    <div className="relative screen-height">
      <SkipToWriting />
      <Background />
      <div className="relative z-10 flex h-full bg-bg">
        {vanished ? null : <LeftRail />}
        <div className="flex min-w-0 flex-1 flex-col">
          {vanished ? null : <Header />}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {/* `hidden`, not unmounted — see the same wrapper on the phone
                branch for why: this app's surface tokens are deliberately
                translucent for the shared `<Background/>` artwork, and left
                visible the base screen's own text bled through legibly
                behind an opaque-looking overlay stacked on top of it. */}
            <div hidden={overlay !== null}>
              <Routed route={base} />
            </div>
            {overlay === null ? null : (
              <RouteOverlay label={overlayLabel} onClose={() => navigate(base)}>
                <Routed route={overlay} />
              </RouteOverlay>
            )}
          </div>
        </div>
        {vanished ? null : <RightRail />}
      </div>
      <NoticeRegion position={reader.notices} />
      {vanished ? <VanishHandle onRestore={toggleVanished} /> : null}
    </div>
  );
}

/**
 * The dialog's accessible name (§20 phase 171).
 *
 * Each overlay screen already renders its own visible heading, but a
 * `role="dialog"` should still name itself for anyone not reading that
 * heading visually. Reuses `strings.nav`'s existing destination labels rather
 * than inventing a second set of names for the same screens.
 */
function overlayLabelFor(route: Route): string {
  switch (route.name) {
    case "characters":
    case "character":
      return strings.nav.characters;
    case "authors":
    case "author":
      return strings.nav.authors;
    case "personas":
      return strings.nav.personas;
    case "setup":
      return strings.sceneSetup.kicker;
    case "settings":
      return strings.nav.settings;
    case "lorebooks":
    case "lorebook":
      return strings.nav.lorebooks;
    case "backgrounds":
      return strings.nav.backgrounds;
    case "scenes":
    case "chat":
    case "unknown":
      // Never reached — these are the base routes `RouteOverlay` is never
      // rendered for — but exhaustive rather than a default that could
      // silently swallow a route added here later without a label.
      return "";
  }
}

/**
 * The way back in, always present while vanished (§20 phase 170).
 *
 * `z` is the fast path; this is the one a reader who forgot it, or is on a
 * phone with no keyboard, still has. Fixed at the opposite corner from where
 * a notice can land (`NoticeRegion`'s three positions are top-centre, top
 * right, bottom right), so the two can never sit on top of each other.
 *
 * An explicit 44px square, not `.tap`. That class exists for a *row* of
 * controls that can afford to shrink under a pointer (`@media (pointer:
 * fine)` relaxes its floor to nothing, on the theory that a mouse can aim at
 * something smaller) — but this is a single isolated floating control with
 * no row to spend the saved space on, and under a fine pointer `.tap` alone
 * left it a 6px × 24px sliver. Found by measuring the rendered button, not by
 * reading the class name.
 */
function VanishHandle({ onRestore }: { onRestore(): void }) {
  return (
    <button
      type="button"
      onClick={onRestore}
      aria-label={strings.common.showChrome}
      title={strings.common.showChrome}
      className="chrome fixed bottom-[12px] left-[12px] z-50 flex h-[44px] w-[44px] items-center justify-center border border-rule bg-bg-raised text-[15px] text-ink-dim opacity-60 hover:opacity-100"
      style={{ borderRadius: "var(--onsen-radius)" }}
    >
      {"›"}
    </button>
  );
}

/**
 * One screen for one route (§20 phase 171).
 *
 * Took `route` as a parameter rather than reading `useRoute()` itself once
 * `Shell` needed to call this twice in the same render — once for the
 * persistent base, once for whatever is layered on top of it as an overlay.
 * The switch itself is unchanged; only where the route comes from moved.
 */
function Routed({ route }: { route: Route }) {
  switch (route.name) {
    case "chat":
      return <ChatScreen sceneId={route.sceneId} />;
    case "characters":
      return <CharactersScreen />;
    case "character":
      return <CharacterEditorScreen characterId={route.characterId} />;
    case "authors":
      return <AuthorsScreen />;
    case "personas":
      return <PersonasScreen />;
    case "author":
      return <AuthorEditorScreen authorId={route.authorId} />;
    case "setup":
      return <SceneSetupScreen sceneId={route.sceneId} />;
    case "settings":
      return <SettingsScreen />;
    case "lorebooks":
      return <LoreScreen />;
    case "backgrounds":
      return <BackgroundsScreen />;
    case "lorebook":
      return <LoreScreen bookId={route.bookId} />;
    case "scenes":
    case "unknown":
      return <ScenesScreen />;
  }
}
