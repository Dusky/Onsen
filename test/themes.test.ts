import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import {
  completeTokens,
  cssConcerns,
  isSafeToken,
  safeTokens,
  themeCss,
} from "../server/themes/index.ts";
import { BUILTIN_THEMES, DEFAULT_THEME_NAME } from "../server/themes/builtin.ts";
import type { ThemeDto, ThemeImportDto } from "../shared/types.ts";

/**
 * Themes (SPEC §20 phase 45).
 *
 * The client already exposed every colour as a custom property and mapped them
 * into Tailwind with `@theme inline`, whose comment promised that a switch on
 * `:root` re-colours the whole app. Nothing ever switched one.
 */

let harness: TestHarness | null = null;

async function signedIn(): Promise<TestHarness> {
  if (harness === null) {
    harness = createHarness();
    await completeSetup(harness);
  }
  return harness;
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

async function json<T>(t: TestHarness, method: string, path: string, body?: unknown): Promise<T> {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return (await response.json()) as T;
}

const listThemes = (t: TestHarness) =>
  json<{ themes: ThemeDto[]; activeId: string | null }>(t, "GET", "/api/themes");

async function mine(t: TestHarness, from?: string): Promise<ThemeDto> {
  const body: Record<string, unknown> = { name: `Mine ${Math.random().toString(36).slice(2, 8)}` };
  if (from !== undefined) body["from"] = from;
  return json<ThemeDto>(t, "POST", "/api/themes", body);
}

describe("a token is data, and only data", () => {
  test("colours, lengths and shadows are allowed", () => {
    expect(isSafeToken("color-bg", "#0d1712")).toBe(true);
    expect(isSafeToken("radius", "9px")).toBe(true);
    expect(isSafeToken("shadow-card", "0 3px 10px rgba(0, 0, 0, 0.55)")).toBe(true);
  });

  test("a value that would close the declaration is refused", () => {
    // A theme is interpolated into a stylesheet. Without this, a "value" is a
    // way to write arbitrary CSS from a field that cannot otherwise.
    expect(isSafeToken("color-bg", "red } body { display: none")).toBe(false);
    expect(isSafeToken("color-bg", "red; position: fixed")).toBe(false);
    expect(isSafeToken("x</style><script>", "#fff")).toBe(false);
  });

  test("a token can never reach the network", () => {
    // That is what the separate, confirmed custom-CSS path is for.
    expect(isSafeToken("color-bg", "url(https://elsewhere/pixel.png)")).toBe(false);
    expect(isSafeToken("color-bg", "URL( https://elsewhere )")).toBe(false);
    expect(isSafeToken("x", "@import 'https://elsewhere'")).toBe(false);
  });

  test("the unsafe ones are dropped, not thrown", () => {
    const kept = safeTokens({ "color-bg": "#111", bad: "red } * { color: red" });
    expect(kept).toEqual({ "color-bg": "#111" });
  });
});

describe("a theme only has to name what it cares about", () => {
  test("the values that follow a primary are filled in", () => {
    const full = completeTokens({ "color-bg-raised": "#12201a", "color-rule": "#1e3227" });
    expect(full["color-bg-card"]).toBe("#12201a");
    expect(full["color-border-quiet"]).toBe("#1e3227");
  });

  test("a value the theme set itself is never overwritten", () => {
    const full = completeTokens({ "color-bg-raised": "#111", "color-bg-card": "#222" });
    expect(full["color-bg-card"]).toBe("#222");
  });

  test("a follower of a follower resolves too", () => {
    // ooc-reader-bg follows bg-inset, which follows bg-raised.
    const full = completeTokens({ "color-bg-raised": "#12201a" });
    expect(full["color-ooc-reader-bg"]).toBe("#12201a");
  });

  test("nothing is invented for a theme that sets nothing", () => {
    expect(completeTokens({})).toEqual({});
  });

  test("every shipped theme resolves the tokens that made the tan bleed through", () => {
    // The first light theme came out with tan button borders and cream bars,
    // because these fall through to the base and the base's light values are
    // the original warm palette.
    const bleeders = [
      "color-border-quiet",
      "color-bg-sunken",
      "color-text-bright",
      "color-red-text",
    ];
    for (const theme of BUILTIN_THEMES) {
      if (theme.name === "Ledger") continue; // It *is* the warm palette.
      const full = completeTokens(theme.tokens);
      for (const token of bleeders) {
        expect(`${theme.name}:${token}`).toBe(`${theme.name}:${full[token] === undefined ? "MISSING" : token}`);
      }
    }
  });
});

describe("the stylesheet", () => {
  const theme = (over: Partial<ThemeDto> = {}): ThemeDto => ({
    id: "t",
    name: "T",
    base: "dark",
    tokens: { "color-bg": "#0d1712", radius: "9px" },
    customCss: "",
    pendingCss: "",
    isBuiltin: false,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  });

  test("writes the tokens under their real names", () => {
    const css = themeCss(theme());
    expect(css).toContain("--onsen-color-bg: #0d1712;");
    expect(css).toContain("--onsen-radius: 9px;");
  });

  test("outranks the stylesheet's own values wherever the bundler puts them", () => {
    // tokens.css sets its light values behind `:root:not([data-theme="dark"])`,
    // which ties any single-attribute :root selector on specificity — so source
    // order decides, the bundler owns source order, and a theme written the
    // obvious way loses silently. The browser drive found this; nothing here
    // could have.
    expect(themeCss(theme())).toContain(":root:root:root");
  });

  test("approved CSS is appended last, so it can reach anything", () => {
    const css = themeCss(theme({ customCss: ".prose { color: red }" }));
    expect(css.indexOf(".prose")).toBeGreaterThan(css.indexOf("--onsen-color-bg"));
  });

  test("pending CSS is never in it", () => {
    // The whole point: it is stored so it can be shown, not so it can run.
    expect(themeCss(theme({ pendingCss: ".prose { color: red }" }))).not.toContain(".prose");
  });
});

describe("what imported CSS would be allowed to do", () => {
  test("a fetch is named, because that is the one that leaves the machine", () => {
    expect(cssConcerns("a { background: url(https://elsewhere/p.png) }").join(" ")).toContain(
      "Fetches a URL",
    );
    expect(cssConcerns("@import url(x)").join(" ")).toContain("another stylesheet");
  });

  test("ordinary CSS raises nothing", () => {
    expect(cssConcerns(".prose em { color: #b9c3ce; font-style: italic }")).toEqual([]);
  });
});

describe("the shipped themes", () => {
  test("are seeded, and one of them is on", async () => {
    const t = await signedIn();
    const { themes, activeId } = await listThemes(t);
    expect(themes.length).toBe(BUILTIN_THEMES.length);
    expect(themes.every((theme) => theme.isBuiltin)).toBe(true);

    const active = themes.find((theme) => theme.id === activeId)!;
    expect(active.name).toBe(DEFAULT_THEME_NAME);
  });

  test("the original flat palette is still one of them", async () => {
    // Moving the default off it must not make it unreachable.
    const t = await signedIn();
    const { themes } = await listThemes(t);
    expect(themes.map((theme) => theme.name)).toContain("Ledger");
  });

  test("cannot be edited or deleted", async () => {
    const t = await signedIn();
    const { themes } = await listThemes(t);
    const shipped = themes[0]!;
    const patched = await t.fetch(`/api/themes/${shipped.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "no" }),
    });
    expect(patched.status).toBe(409);
    expect((await t.fetch(`/api/themes/${shipped.id}`, { method: "DELETE" })).status).toBe(409);
  });

  test("seeding twice adds nothing", async () => {
    const t = await signedIn();
    const before = (await listThemes(t)).themes.length;
    const { seedBuiltinThemes } = await import("../server/db/queries/themes.ts");
    expect(seedBuiltinThemes(t.ctx.db)).toBe(0);
    expect((await listThemes(t)).themes.length).toBe(before);
  });
});

describe("making one your own", () => {
  test("duplicating a shipped theme copies its values", async () => {
    const t = await signedIn();
    const { themes } = await listThemes(t);
    const bottle = themes.find((theme) => theme.name === "Bottle")!;
    const copy = await mine(t, bottle.id);

    expect(copy.isBuiltin).toBe(false);
    expect(copy.tokens).toEqual(bottle.tokens);
  });

  test("a token edit lands in the stylesheet", async () => {
    const t = await signedIn();
    const copy = await mine(t);
    await json<ThemeDto>(t, "PATCH", `/api/themes/${copy.id}`, {
      tokens: { "color-bg": "#123456" },
    });
    await json<ThemeDto>(t, "POST", `/api/themes/${copy.id}/activate`, {});

    const css = await (await t.fetch("/api/themes/active.css")).text();
    expect(css).toContain("--onsen-color-bg: #123456;");
  });

  test("the stylesheet is readable without a session", async () => {
    // It is the login screen's colours too, and it discloses nothing but taste.
    // A fresh harness has never signed in, which is the real test: every other
    // route under /api answers 401 to it.
    const anon = createHarness();
    const guarded = await anon.fetch("/api/themes");
    expect(guarded.status).toBe(401);

    const sheet = await anon.fetch("/api/themes/active.css");
    expect(sheet.status).toBe(200);
    expect(sheet.headers.get("content-type")).toContain("text/css");
    expect(sheet.headers.get("cache-control")).toBe("no-store");
    anon.cleanup();
  });

  test("deleting the active one falls back rather than leaving no colours", async () => {
    const t = await signedIn();
    const copy = await mine(t);
    await json<ThemeDto>(t, "POST", `/api/themes/${copy.id}/activate`, {});
    expect((await t.fetch(`/api/themes/${copy.id}`, { method: "DELETE" })).status).toBe(204);

    const after = await listThemes(t);
    expect(after.themes.find((theme) => theme.id === after.activeId)!.name).toBe(
      DEFAULT_THEME_NAME,
    );
  });

  test("two themes cannot share a name", async () => {
    const t = await signedIn();
    const first = await mine(t);
    const clash = await t.fetch("/api/themes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: first.name }),
    });
    expect(clash.status).toBe(409);
  });
});

describe("importing somebody else's theme", () => {
  const file = (doc: unknown) => {
    const form = new FormData();
    form.append("file", new File([JSON.stringify(doc)], "theme.json"));
    return form;
  };

  async function importTheme(t: TestHarness, doc: unknown) {
    const response = await t.fetch("/api/themes/import", { method: "POST", body: file(doc) });
    return { status: response.status, body: (await response.json()) as ThemeImportDto };
  }

  test("its tokens land and its CSS does not", async () => {
    const t = await signedIn();
    const { status, body } = await importTheme(t, {
      onsenTheme: 1,
      name: "Someone's",
      base: "dark",
      tokens: { "color-bg": "#010203" },
      customCss: "body { background: url(https://elsewhere/p.png) }",
    });

    expect(status).toBe(201);
    expect(body.theme.tokens["color-bg"]).toBe("#010203");
    // Stored so it can be read, not so it can run.
    expect(body.theme.customCss).toBe("");
    expect(body.theme.pendingCss).toContain("url(");
    expect(body.concerns.join(" ")).toContain("Fetches a URL");

    await json<ThemeDto>(t, "POST", `/api/themes/${body.theme.id}/activate`, {});
    const css = await (await t.fetch("/api/themes/active.css")).text();
    expect(css).toContain("#010203");
    expect(css).not.toContain("elsewhere");
  });

  test("approving it is what makes it run", async () => {
    const t = await signedIn();
    const { body } = await importTheme(t, {
      name: "Someone's",
      tokens: {},
      customCss: ".prose { letter-spacing: 0.01em }",
    });
    await json<ThemeDto>(t, "PATCH", `/api/themes/${body.theme.id}`, { approvePendingCss: true });
    await json<ThemeDto>(t, "POST", `/api/themes/${body.theme.id}/activate`, {});

    const css = await (await t.fetch("/api/themes/active.css")).text();
    expect(css).toContain("letter-spacing: 0.01em");
  });

  test("discarding it leaves nothing behind", async () => {
    const t = await signedIn();
    const { body } = await importTheme(t, { name: "S", tokens: {}, customCss: ".x { color: red }" });
    const after = await json<ThemeDto>(t, "PATCH", `/api/themes/${body.theme.id}`, {
      discardPendingCss: true,
    });
    expect(after.pendingCss).toBe("");
    expect(after.customCss).toBe("");
  });

  test("a token that is really a CSS injection is reported, not stored", async () => {
    const t = await signedIn();
    const { body } = await importTheme(t, {
      name: "Hostile",
      tokens: { "color-bg": "#fff", evil: "red } body { display: none" },
    });
    expect(body.theme.tokens["evil"]).toBeUndefined();
    expect(body.droppedTokens).toContain("evil");
  });

  test("an imported name that clashes is given its own", async () => {
    const t = await signedIn();
    const first = await importTheme(t, { name: "Twice", tokens: {} });
    const second = await importTheme(t, { name: "Twice", tokens: {} });
    expect(second.body.theme.name).not.toBe(first.body.theme.name);
  });

  test("a round trip through export keeps the values", async () => {
    const t = await signedIn();
    const copy = await mine(t);
    await json<ThemeDto>(t, "PATCH", `/api/themes/${copy.id}`, {
      tokens: { "color-bg": "#0a0b0c", radius: "9px" },
    });
    const exported = await json<{ tokens: Record<string, string> }>(
      t,
      "GET",
      `/api/themes/${copy.id}/export`,
    );
    const { body } = await importTheme(t, { ...exported, name: "Round trip" });
    expect(body.theme.tokens).toEqual({ "color-bg": "#0a0b0c", radius: "9px" });
  });
});
