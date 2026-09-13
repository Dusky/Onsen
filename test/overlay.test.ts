import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Settings — and every other non-base screen — as an overlay over a
 * persistent base (§20 phase 171).
 *
 * Before this, `Routed()` was one flat switch: navigating to Settings, or
 * Characters, or a lorebook, fully unmounted whatever was showing. Nothing
 * about that was inherent — the rails and header already stay mounted across
 * every navigation; only the routed content itself was ever torn down.
 *
 * Structural, like the rest of this project's UI guards: no DOM rendering,
 * the source is read as text and the decisions are asserted where they are
 * written (`test/document-mode.test.ts`, `test/vanish.test.ts` are the
 * models).
 */

const ROOT = join(import.meta.dir, "..");
const ROUTER = readFileSync(join(ROOT, "client", "lib", "router.ts"), "utf8");
const APP = readFileSync(join(ROOT, "client", "App.tsx"), "utf8");
const OVERLAY = readFileSync(join(ROOT, "client", "components", "RouteOverlay.tsx"), "utf8");

describe("which screens are the persistent base", () => {
  test("only scenes, chat and unknown — everything else floats", () => {
    expect(ROUTER).toContain(
      'return route.name === "scenes" || route.name === "chat" || route.name === "unknown";',
    );
  });

  test("Route itself is untouched — every navigate() call site still just names a URL", () => {
    // The split is rendering-only. If parsing or pathFor had to change, that
    // would mean some overlay route needed URL shape it doesn't have.
    expect(ROUTER).toContain("export function parseRoute(pathname: string): Route {");
    expect(ROUTER).toContain("export function pathFor(route: Route): string {");
  });

  test("the base is written during render, not in an effect", () => {
    // An effect runs one render late — the first paint of a fresh load
    // straight into an overlay route would see no base yet. Writing it
    // inline is what makes that first paint already correct.
    expect(ROUTER).toContain("if (isBase) lastBase = route;");
    expect(ROUTER).not.toMatch(/useEffect\(\(\) => \{\s*lastBase = route/);
  });

  test("and it is module state, so every caller agrees", () => {
    /*
     * It was a `useRef`, which was the same thing while `Shell` was the only
     * caller and stopped being the same thing the moment anything else asked:
     * a ref is per component instance, so each caller remembered only the
     * base routes it was itself mounted for. Phase 180 had the header and both
     * rails start asking, and the header — mounted on an overlay route —
     * answered "no roleplay" while a chat was mounted behind it.
     */
    expect(ROUTER).toContain("let lastBase: Route =");
    expect(ROUTER).not.toContain("baseRef");
  });
});

describe("Shell keeps the base mounted and layers the overlay on top", () => {
  test("both layouts render the base unconditionally and the overlay conditionally", () => {
    expect(APP.match(/<Routed route={base} \/>/g)).toHaveLength(2);
    expect(APP.match(/<RouteOverlay label={overlayLabel} onClose={\(\) => navigate\(base\)}>/g))
      .toHaveLength(2);
  });

  test("the base is hidden, not unmounted, while an overlay covers it", () => {
    // `hidden`, the same convention `MessageBlock.tsx` uses for a still-
    // mounted element that should not paint — not a conditional `? : null`,
    // which would tear the component down along with its state.
    expect(APP.match(/<div hidden={overlay !== null}>\s*<Routed route={base} \/>/g)).toHaveLength(2);
  });

  test("closing an overlay navigates back to the base route it opened over", () => {
    expect(APP).toContain("onClose={() => navigate(base)}");
  });

  test("Routed takes its route as a parameter rather than reading useRoute() itself", () => {
    // The whole reason: Shell needs to call it twice in one render — once for
    // the base, once for whatever floats on top of it.
    expect(APP).toContain("function Routed({ route }: { route: Route }) {");
  });
});

describe("the overlay's own chrome", () => {
  test("it reuses Sheet's keyboard obligations rather than a second focus mechanism", () => {
    expect(OVERLAY).toContain("useModalFocus(dialog, onClose)");
  });

  test("it fills the content area, not the whole viewport — the rails stay reachable", () => {
    // `absolute inset-0` against the shell's own `relative` wrapper, not
    // `fixed inset-0` (Sheet's own choice, which covers everything). The
    // rails and header are outside that wrapper and are meant to stay usable
    // while an overlay is open.
    expect(OVERLAY).toContain('className="absolute inset-0 z-40');
    expect(OVERLAY).not.toContain("fixed inset-0");
  });

  test("it sits below the notice region and the vanish handle, not above them", () => {
    expect(OVERLAY).toContain("z-40");
    const noticeRegion = readFileSync(
      join(ROOT, "client", "components", "NoticeRegion.tsx"),
      "utf8",
    );
    expect(noticeRegion).toContain("z-50");
    expect(APP).toMatch(/VanishHandle[\s\S]{0,600}z-50/);
  });

  test("it names itself for a screen reader, from the same labels the nav already uses", () => {
    expect(OVERLAY).toContain("aria-label={label}");
    expect(APP).toContain("function overlayLabelFor(route: Route): string {");
    expect(APP).toContain("return strings.nav.settings;");
  });
});

describe("what the bleed-through bug taught", () => {
  /*
   * Found in a browser, not by reading the code: this app's surface tokens
   * are deliberately translucent so the shared `<Background/>` artwork shows
   * through every screen. Stacked on top of a second, fully rendered screen
   * instead of just that artwork, the same translucency let the base
   * screen's own text stay legible behind an overlay that looked opaque.
   * `hidden` on the base is the fix, and it is why the base is hidden rather
   * than the overlay being given a hand-picked opaque colour: the fix holds
   * for every theme without needing to know which are translucent.
   */
  test("the fix is documented where it was made, not just left as a diff", () => {
    expect(APP).toMatch(/hidden.{0,20}not unmounted[\s\S]{0,600}translucent/);
  });
});
