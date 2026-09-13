import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROVIDER_PRESETS } from "@shared/providers.ts";
import { PROVIDER_KINDS } from "@shared/types.ts";
import type { ConnectionProfileDto, SceneDto } from "@shared/types.ts";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { resolveRoute } from "../server/generation/route.ts";

/**
 * Known endpoints, a way back to the roleplay, and a model per roleplay
 * (§20 phase 180).
 *
 * Three asks in one report, and the common thread is that each was a thing the
 * app made you do the long way round: hunt a base URL, navigate to the
 * roleplay list to get back to a roleplay, or keep one connection profile per
 * model.
 */

const ROOT = join(import.meta.dir, "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const FIELDS = read("client", "components", "ConnectionFields.tsx");
const HEADER = read("client", "components", "Header.tsx");
const PANEL = read("client", "components", "ModelsPanel.tsx");
const ROUTE = read("server", "generation", "route.ts");
const SERVICE = read("server", "generation", "service.ts");
const SCENES = read("server", "routes", "scenes.ts");

describe("the preset catalogue", () => {
  test("covers the five that were named, and then some", () => {
    const keys = PROVIDER_PRESETS.map((preset) => preset.key);
    // The stated minimum.
    for (const required of ["deepseek", "anthropic", "openai", "nanogpt", "zai"]) {
      expect(keys).toContain(required);
    }
    // "BARE minimum" was the phrasing, so the bar is well clear of five.
    expect(PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(15);
  });

  test("every key is unique, since the picker addresses by it", () => {
    const keys = PROVIDER_PRESETS.map((preset) => preset.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("every kind is one the app can actually speak", () => {
    // A preset naming a kind the adapters do not have would fill a form that
    // cannot generate.
    for (const preset of PROVIDER_PRESETS) {
      expect(PROVIDER_KINDS).toContain(preset.kind);
    }
  });

  test("every address is absolute, and none carries a trailing slash", () => {
    /*
     * The adapters build `${baseUrl}/chat/completions` and friends
     * (`server/routes/connections.ts`), so a trailing slash yields a double
     * slash and a relative address yields nothing at all. Both fail at the
     * first generation, which is exactly the surprise a preset exists to
     * prevent.
     */
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.baseUrl).toMatch(/^https?:\/\//);
      expect(preset.baseUrl.endsWith("/")).toBe(false);
    }
  });

  test("no preset carries a key, or anything shaped like one", () => {
    // Presets travel in the client bundle. A credential has no business here.
    const serialised = JSON.stringify(PROVIDER_PRESETS);
    expect(serialised).not.toMatch(/sk-|api[_-]?key|bearer/i);
  });

  test("a local preset points at this computer and a hosted one does not", () => {
    for (const preset of PROVIDER_PRESETS) {
      const isLoopback = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(preset.baseUrl);
      expect(isLoopback).toBe(preset.where === "local");
    }
    // Both groups have something in them, or the picker draws an empty group.
    for (const where of ["hosted", "local"] as const) {
      expect(PROVIDER_PRESETS.some((preset) => preset.where === where)).toBe(true);
    }
  });

  test("the picker fills the form and only the form", () => {
    expect(FIELDS).toContain("PROVIDER_PRESETS.find");
    // Name, address, kind and the first known model.
    expect(FIELDS).toContain("nameRef.current.value = picked.name");
    expect(FIELDS).toContain("baseUrlRef.current.value = picked.baseUrl");
    expect(FIELDS).toContain("kindRef.current.value = picked.kind");
    // Never a key: nothing in the picker's handler touches that field.
    expect(FIELDS).not.toMatch(/picked\.(apiKey|key)/);
  });

  test("and it is offered only when adding, never when editing", () => {
    // On an existing provider it would offer to overwrite a working address.
    expect(FIELDS).toMatch(/provider === null \? \($/m);
    expect(FIELDS).toContain("strings.settings.providerPreset");
  });
});

describe("the way back to the roleplay", () => {
  test("the header reads the base route, so an overlay cannot hide it", () => {
    /*
     * The bug: `route.name === "chat"` meant opening Settings — an overlay over
     * a still-mounted chat since phase 171 — emptied the header of the roleplay
     * it was reading, leaving nothing pointing back at it.
     */
    expect(HEADER).toContain("useShellRoute()");
    expect(HEADER).toContain('base.name === "chat" ? base.sceneId : null');
    expect(HEADER).not.toContain("useRoute()");
  });

  test("the scene chip goes to the roleplay; the wordmark goes to the list", () => {
    // They used to be one button, and it went to the list — so the only thing
    // in the header naming the open roleplay navigated away from it.
    expect(HEADER).toContain("onClick={() => navigate(base)}");
    expect(HEADER).toContain('onClick={() => navigate({ name: "scenes" })}');
    expect(HEADER).toContain("strings.header.backToScene");
  });

  test("and it says it is a way back while an overlay is up", () => {
    expect(HEADER).toContain('overlay === null ? "\\u00b7" : "\\u2039"');
  });
});

describe("a model for one roleplay", () => {
  test("the narrowest choice wins, and the server says so in one place", () => {
    expect(ROUTE).toContain("const model = request.model ?? row.profile_model ?? row.provider_model;");
    expect(ROUTE).toContain("model?: string | null;");
  });

  test("the turn and the preview resolve the same way", () => {
    // A preview naming a model the turn will not use is worse than no preview.
    expect(SERVICE).toContain("model: scene.model,");
    expect(read("server", "routes", "generation.ts")).toContain("model: scene.model,");
  });

  test("empty clears it back to the profile, rather than storing blank", () => {
    expect(SCENES).toContain('if ("model" in input) {');
    expect(SCENES).toContain('model: model === null || model.trim() === "" ? null : model.trim()');
  });

  test("the panel picks from what the provider serves", () => {
    expect(PANEL).toContain("<ModelPicker");
    expect(PANEL).toContain("updateScene.mutate({ model })");
    // And offers the way back to the profile's choice.
    expect(PANEL).toContain("updateScene.mutate({ model: null })");
    expect(PANEL).toContain("strings.models.modelClear");
  });

  test("the composer chip names what the turn will use, not the profile", () => {
    // A status readout that disagrees with the turn is worse than none.
    const chat = read("client", "screens", "ChatScreen.tsx");
    expect(chat).toContain("scene.data?.scene.model ?? sceneProfile.model");
  });

  test("the rails read the base route, so an overlay does not blank them", () => {
    /*
     * Found by driving it: with Settings open, every docked panel was told
     * there was no roleplay — "This roleplay" went blank, the prompt panel
     * stopped previewing — because the rails scoped to the current route and
     * every non-base screen is an overlay over a still-mounted base.
     */
    for (const file of ["LeftRail.tsx", "RightRail.tsx"]) {
      const source = read("client", "components", file);
      expect(source).toContain("useShellRoute()");
      expect(source).toContain('base.name === "chat" ? base.sceneId : null');
      expect(source).not.toContain("useRoute()");
    }
  });

  test("and every caller agrees on which roleplay is open", () => {
    // The base route was a `useRef`, which is per component instance: the
    // header and the shell each remembered only the base routes they were
    // themselves mounted for, and could disagree.
    const router = read("client", "lib", "router.ts");
    expect(router).toContain("let lastBase: Route =");
    expect(router).not.toMatch(/const baseRef = useRef<Route>/);
  });

  test("it shows the same three-step chain the server resolves", () => {
    expect(PANEL).toContain("activeProfile?.model ?? activeProvider?.model ?? null");
    expect(PANEL).toContain("strings.models.modelFromProfile");
  });
});

/* ------------------------------------------------------------------ */
/* Executed, not read as text                                          */
/* ------------------------------------------------------------------ */

describe("the override does what it says, against a real database", () => {
  let harness: TestHarness | null = null;

  afterEach(() => {
    harness?.cleanup();
    harness = null;
  });

  async function signedIn(): Promise<TestHarness> {
    if (harness === null) {
      harness = createHarness();
      await completeSetup(harness);
    }
    return harness;
  }

  const body = async <T>(t: TestHarness, method: string, path: string, payload?: unknown): Promise<T> => {
    const response = await t.fetch(path, {
      method,
      ...(payload === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    });
    return (await response.json()) as T;
  };

  test("one roleplay's model does not become another's", async () => {
    /*
     * The whole reason this is an override on the scene rather than an edit to
     * the profile: editing the profile changes every roleplay pointed at it,
     * and the ask was to change the model for *this* one.
     */
    const t = await signedIn();
    const profiles = await body<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    const profileId = profiles[0]!.id;

    const one = await body<SceneDto>(t, "POST", "/api/scenes", { title: "One", connectionProfileId: profileId });
    const two = await body<SceneDto>(t, "POST", "/api/scenes", { title: "Two", connectionProfileId: profileId });
    expect(one.model).toBeNull();
    expect(two.model).toBeNull();

    await body(t, "PATCH", `/api/scenes/${one.id}`, { model: "some-other-model" });

    const afterOne = await body<{ scene: SceneDto }>(t, "GET", `/api/scenes/${one.id}`);
    const afterTwo = await body<{ scene: SceneDto }>(t, "GET", `/api/scenes/${two.id}`);
    expect(afterOne.scene.model).toBe("some-other-model");
    // The sibling is untouched, and so is the profile they share.
    expect(afterTwo.scene.model).toBeNull();
    const stillProfiles = await body<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    expect(stillProfiles[0]!.model).toBe(profiles[0]!.model);
  });

  test("blank hands the choice back to the profile", async () => {
    const t = await signedIn();
    const profiles = await body<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    const scene = await body<SceneDto>(t, "POST", "/api/scenes", {
      title: "Cleared",
      connectionProfileId: profiles[0]!.id,
    });
    await body(t, "PATCH", `/api/scenes/${scene.id}`, { model: "temporary" });
    expect((await body<{ scene: SceneDto }>(t, "GET", `/api/scenes/${scene.id}`)).scene.model).toBe(
      "temporary",
    );
    // Whitespace is not a model name — one state for "no override", not three.
    await body(t, "PATCH", `/api/scenes/${scene.id}`, { model: "   " });
    expect((await body<{ scene: SceneDto }>(t, "GET", `/api/scenes/${scene.id}`)).scene.model).toBeNull();
  });

  test("a model that is not text is refused rather than stored", async () => {
    const t = await signedIn();
    const profiles = await body<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    const scene = await body<SceneDto>(t, "POST", "/api/scenes", {
      title: "Refused",
      connectionProfileId: profiles[0]!.id,
    });
    const response = await t.fetch(`/api/scenes/${scene.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: 42 }),
    });
    expect(response.status).toBe(400);
  });

  test("and resolveRoute prefers it over the profile's and the provider's", async () => {
    // The chain itself, called rather than read: scene, then profile, then
    // provider.
    const t = await signedIn();
    const row = t.ctx.db
      .query("SELECT id, model FROM connection_profiles LIMIT 1")
      .get() as { id: number; model: string | null };

    const withOverride = resolveRoute(t.ctx.db, t.ctx.keyring, {
      profileId: row.id,
      model: "chosen-for-this-scene",
    });
    expect(withOverride.model).toBe("chosen-for-this-scene");

    const without = resolveRoute(t.ctx.db, t.ctx.keyring, { profileId: row.id, model: null });
    expect(without.model).not.toBe("chosen-for-this-scene");
    // Absent behaves as null, so every existing caller keeps its meaning.
    expect(resolveRoute(t.ctx.db, t.ctx.keyring, { profileId: row.id }).model).toBe(without.model);
  });
});
