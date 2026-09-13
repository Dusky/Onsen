import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROVIDER_PRESETS } from "@shared/providers.ts";
import { PROVIDER_KINDS } from "@shared/types.ts";
import type { ConnectionProfileDto, ProviderDto, SceneDto } from "@shared/types.ts";
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
    expect(ROUTE).toContain("model?: string | null;");
    expect(ROUTE).toContain("providerId?: number | null;");
    // The scene's choice first; then the profile's, unless the scene moved the
    // provider, in which case the profile's model does not apply.
    expect(ROUTE).toContain("const model = request.model ?? (overridden ?");
  });

  test("a scene that moves provider does not inherit the profile's model", () => {
    /*
     * A model id belongs to the provider that serves it. Carrying `gpt-4o`
     * across to Anthropic because the profile happened to name it would fail
     * the turn with a model nobody chose — so the chain skips a step, on the
     * server and in the panel alike.
     */
    expect(ROUTE).toContain("overridden ? row.provider_model : (profile.profile_model ?? row.provider_model)");
    expect(PANEL).toContain("sceneProviderId === null");
    // And changing the provider clears the stale model rather than keeping it.
    expect(SCENES).toContain('if ("providerId" in input) {');
    expect(SCENES).toContain("UPDATE scenes SET model = NULL WHERE id = $id");
  });

  test("the provider and the profile are fetched apart, not joined", () => {
    // The join hardcoded "the profile's provider", which is the thing a scene
    // can now override.
    expect(ROUTE).not.toContain("JOIN providers p ON p.id = cp.provider_id");
    expect(ROUTE).toContain("FROM providers WHERE id = $id");
  });

  test("a background task follows the roleplay only when it has no profile of its own", () => {
    /*
     * An op with its own profile is a deliberate routing choice (§7); dragging
     * the scene's provider onto it would quietly undo that. An op with none is
     * running "wherever this roleplay runs", which is exactly what the
     * overrides mean.
     */
    const runner = read("server", "tasks", "runner.ts");
    expect(runner).toContain("const usingScenes = chosen === null;");
    expect(runner).toContain("...(usingScenes");
    expect(runner).toContain("sceneProviderId?: number | null;");
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

  test("every readout reads one resolved answer instead of re-deriving it", () => {
    /*
     * The composer's chip had to be corrected twice — once when a roleplay
     * could choose its own model (§180), again when it could choose its own
     * provider (§181) — and a sweep then found two more doing the same
     * re-derivation: the status bar and the roleplay list. Three clients each
     * reimplementing `resolveRoute` is three chances to disagree with the
     * turn, so the server resolves it once into `SceneDto.runsOn` and they all
     * read that.
     */
    const chat = read("client", "screens", "ChatScreen.tsx");
    expect(chat).toContain("const runsOn = scene.data?.scene.runsOn ?? null;");
    expect(chat).toContain("`${runsOn.providerName}${runsOn.model === null");
    expect(chat).toContain("profileName={runsOn === null ? null : runsOn.providerName}");
    expect(read("client", "screens", "ScenesScreen.tsx")).toContain("scene.runsOn.providerName");
    // And nothing re-derives it from the profile any more.
    expect(chat).not.toContain("sceneProfile.model");
  });

  test("and the panel says which step a model came from, accurately", () => {
    // "From the profile" about a value that came from an overridden provider
    // is the same lie in a quieter place.
    expect(PANEL).toContain("strings.models.modelFromProvider");
    expect(PANEL).toContain("sceneProviderId === null\n                  ? strings.models.modelFromProfile");
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

  test("a roleplay can be pointed at a provider it has no profile for", async () => {
    /*
     * The whole point of the override, and the thing switching profiles could
     * not do: reaching a second provider used to mean making a profile for it
     * first, which is bookkeeping in service of a two-click change.
     */
    const t = await signedIn();
    const second = await body<ProviderDto>(t, "POST", "/api/connections/providers", {
      name: "Second",
      kind: "openai_compatible",
      baseUrl: "http://127.0.0.1:9/v1",
      model: "second-default",
    });
    // Deliberately no profile for it.
    const profiles = await body<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    expect(profiles.some((profile) => profile.providerId === second.id)).toBe(false);

    const scene = await body<SceneDto>(t, "POST", "/api/scenes", {
      title: "Moved",
      connectionProfileId: profiles[0]!.id,
    });
    expect(scene.providerId).toBeNull();

    await body(t, "PATCH", `/api/scenes/${scene.id}`, { providerId: second.id });
    const after = await body<{ scene: SceneDto }>(t, "GET", `/api/scenes/${scene.id}`);
    expect(after.scene.providerId).toBe(second.id);
    // Still on the same profile: the provider moved, the preset did not.
    expect(after.scene.connectionProfileId).toBe(profiles[0]!.id);

    // And the turn would actually run there.
    const row = t.ctx.db.query("SELECT id, provider_id FROM scenes WHERE ulid = $u").get({
      u: scene.id,
    }) as { id: number; provider_id: number };
    const profileRow = t.ctx.db
      .query("SELECT id FROM connection_profiles LIMIT 1")
      .get() as { id: number };
    const route = resolveRoute(t.ctx.db, t.ctx.keyring, {
      profileId: profileRow.id,
      providerId: row.provider_id,
      model: null,
    });
    expect(route.providerName).toBe("Second");
    // The profile's model did not come across — it belongs to the old
    // provider. The new provider's own default is what serves.
    expect(route.model).toBe("second-default");
  });

  test("moving the provider clears a model that belonged to the old one", async () => {
    const t = await signedIn();
    const profiles = await body<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    const scene = await body<SceneDto>(t, "POST", "/api/scenes", {
      title: "Stale",
      connectionProfileId: profiles[0]!.id,
    });
    await body(t, "PATCH", `/api/scenes/${scene.id}`, { model: "belongs-to-the-old-one" });
    expect((await body<{ scene: SceneDto }>(t, "GET", `/api/scenes/${scene.id}`)).scene.model).toBe(
      "belongs-to-the-old-one",
    );

    const target = await body<ProviderDto>(t, "POST", "/api/connections/providers", {
      name: "Elsewhere",
      kind: "openai_compatible",
      baseUrl: "http://127.0.0.1:9/v1",
      model: "elsewhere-default",
    });
    await body(t, "PATCH", `/api/scenes/${scene.id}`, { providerId: target.id });

    const after = await body<{ scene: SceneDto }>(t, "GET", `/api/scenes/${scene.id}`);
    expect(after.scene.providerId).toBe(target.id);
    // Cleared, so the next turn asks the new provider rather than failing on a
    // model it has never heard of.
    expect(after.scene.model).toBeNull();
  });

  test("deleting a provider hands its roleplays back rather than stranding them", async () => {
    /*
     * `ON DELETE SET NULL`, and worth an executed test rather than a reading of
     * the migration: SQLite only enforces a foreign key when
     * `PRAGMA foreign_keys = ON`, which this app sets at open
     * (`server/db/index.ts`). Without it the column would keep a dangling id
     * and every turn on that roleplay would fail with "that provider no longer
     * exists" — a deletion elsewhere breaking a roleplay that still had a
     * perfectly good profile.
     */
    const t = await signedIn();
    const profiles = await body<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    const doomed = await body<ProviderDto>(t, "POST", "/api/connections/providers", {
      name: "Doomed",
      kind: "openai_compatible",
      baseUrl: "http://127.0.0.1:9/v1",
      model: "doomed-default",
    });
    const scene = await body<SceneDto>(t, "POST", "/api/scenes", {
      title: "Orphan",
      connectionProfileId: profiles[0]!.id,
    });
    await body(t, "PATCH", `/api/scenes/${scene.id}`, { providerId: doomed.id });
    expect((await body<{ scene: SceneDto }>(t, "GET", `/api/scenes/${scene.id}`)).scene.providerId).toBe(
      doomed.id,
    );

    await t.fetch(`/api/connections/providers/${doomed.id}`, { method: "DELETE" });

    // Null in the column itself, not merely null in the DTO because the ulid
    // lookup missed — those look identical from the API and are not the same.
    const row = t.ctx.db.query("SELECT provider_id FROM scenes WHERE ulid = $u").get({
      u: scene.id,
    }) as { provider_id: number | null };
    expect(row.provider_id).toBeNull();

    // And the roleplay still runs, on its profile.
    const profileRow = t.ctx.db.query("SELECT id FROM connection_profiles LIMIT 1").get() as {
      id: number;
    };
    expect(() =>
      resolveRoute(t.ctx.db, t.ctx.keyring, { profileId: profileRow.id, providerId: null }),
    ).not.toThrow();
  });

  test("runsOn and resolveRoute agree, across every combination", async () => {
    /*
     * `SceneDto.runsOn` exists so three readouts stop re-deriving the chain,
     * and it is a *second* implementation of it — kept separate because
     * `resolveRoute` decrypts a key and throws on every unroutable state,
     * neither of which a list of roleplays wants. What it must not do is
     * disagree, so this walks the combinations rather than trusting a comment.
     */
    const t = await signedIn();
    const profiles = await body<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    const second = await body<ProviderDto>(t, "POST", "/api/connections/providers", {
      name: "Agreeing",
      kind: "openai_compatible",
      baseUrl: "http://127.0.0.1:9/v1",
      model: "agreeing-default",
    });
    const scene = await body<SceneDto>(t, "POST", "/api/scenes", {
      title: "Agreement",
      connectionProfileId: profiles[0]!.id,
    });
    const profileRow = t.ctx.db.query("SELECT id FROM connection_profiles LIMIT 1").get() as {
      id: number;
    };

    for (const patch of [
      {},
      { model: "picked-by-hand" },
      { providerId: second.id },
      // A provider *and* a model, the narrowest case.
      { providerId: second.id, model: "picked-on-the-new-one" },
      // And all the way back.
      { providerId: null, model: null },
    ]) {
      await body(t, "PATCH", `/api/scenes/${scene.id}`, patch);
      const dto = (await body<{ scene: SceneDto }>(t, "GET", `/api/scenes/${scene.id}`)).scene;
      const row = t.ctx.db
        .query("SELECT provider_id, model FROM scenes WHERE ulid = $u")
        .get({ u: scene.id }) as { provider_id: number | null; model: string | null };
      const route = resolveRoute(t.ctx.db, t.ctx.keyring, {
        profileId: profileRow.id,
        providerId: row.provider_id,
        model: row.model,
      });
      expect(dto.runsOn).not.toBeNull();
      expect({ providerName: dto.runsOn!.providerName, model: dto.runsOn!.model }).toEqual({
        providerName: route.providerName,
        model: route.model,
      });
    }
  });

  test("and a provider that does not exist is refused", async () => {
    const t = await signedIn();
    const profiles = await body<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    const scene = await body<SceneDto>(t, "POST", "/api/scenes", {
      title: "Bad ref",
      connectionProfileId: profiles[0]!.id,
    });
    const response = await t.fetch(`/api/scenes/${scene.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "01ZZZZZZZZZZZZZZZZZZZZZZZZ" }),
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
