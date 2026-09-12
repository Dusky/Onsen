import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { V2_CARD_SILENT, pngCard } from "./card-fixtures.ts";
import { READER_DEFAULTS, readReader } from "../shared/types.ts";
import type { CharacterDto, ConnectionProfileDto, ReaderDto, SceneDto } from "../shared/types.ts";

/**
 * The reader's own controls (§20 phase 166).
 *
 * Eight things the app decided for the reader until now. Every default is what
 * it already did, so the property worth proving first is that a fresh install
 * behaves exactly as it did — a settings group that changes behaviour by
 * existing is a settings group nobody asked for.
 *
 * The rest is the shape every preference in this app has to hold: stored per
 * field, merged rather than replaced, and validated on the way *out* of the
 * database as well as in.
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

async function preferences(t: TestHarness): Promise<{ reader: ReaderDto }> {
  return json(t, "GET", "/api/system/preferences");
}

describe("readReader", () => {
  test("an empty request is the shipped defaults", () => {
    expect(readReader({})).toEqual(READER_DEFAULTS);
  });

  test("every default is what the app already did", () => {
    // Return sent, the marks were unbound but harmless to bind, there were no
    // timestamps, a streaming turn was followed, and pictures were stacked.
    expect(READER_DEFAULTS.send).toBe("enter");
    expect(READER_DEFAULTS.timestamps).toBe(false);
    expect(READER_DEFAULTS.autoScroll).toBe(true);
    expect(READER_DEFAULTS.media).toBe("list");
    expect(READER_DEFAULTS.motion).toBe("system");
    expect(READER_DEFAULTS.clickToEdit).toBe(false);
  });

  test("one bad field costs only that field", () => {
    // `clampReading`'s rule, and for the same reason: a settings screen is the
    // worst place to be strict, and refusing the request would lose the other
    // seven values over one typo.
    const out = readReader({ send: "telepathy", timestamps: true, media: 7, motion: null });
    expect(out.send).toBe(READER_DEFAULTS.send);
    expect(out.media).toBe(READER_DEFAULTS.media);
    expect(out.motion).toBe(READER_DEFAULTS.motion);
    expect(out.timestamps).toBe(true);
  });

  test("a false is a false, not a missing value", () => {
    // The bug this is written against: reading a stored boolean by comparing
    // to "1" makes an absent row and an explicit `false` the same thing, so a
    // default-on switch can never be turned off.
    expect(readReader({ autoScroll: false }).autoScroll).toBe(false);
    expect(readReader({ marks: false }).marks).toBe(false);
  });
});

describe("the preference round-trips", () => {
  test("a fresh install reports the defaults", async () => {
    const t = await signedIn();
    expect((await preferences(t)).reader).toEqual(READER_DEFAULTS);
  });

  test("one switch sent does not reset the other seven", async () => {
    const t = await signedIn();
    await json(t, "PATCH", "/api/system/preferences", { reader: { send: "button" } });
    await json(t, "PATCH", "/api/system/preferences", { reader: { timestamps: true } });
    const { reader } = await preferences(t);
    expect(reader.send).toBe("button");
    expect(reader.timestamps).toBe(true);
    // Untouched, and still the defaults rather than false.
    expect(reader.autoScroll).toBe(true);
    expect(reader.marks).toBe(true);
  });

  test("a default-on switch can actually be turned off", async () => {
    const t = await signedIn();
    await json(t, "PATCH", "/api/system/preferences", { reader: { autoScroll: false } });
    expect((await preferences(t)).reader.autoScroll).toBe(false);
  });

  test("a value written by hand cannot put the app somewhere it does not offer", async () => {
    // Validated on the way out as well as in — the reason `reading` clamps on
    // read: the failure mode of a bad preference is a screen you cannot get to
    // a settings page to fix.
    const t = await signedIn();
    t.ctx.db
      .query("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ($k, $v, 0)")
      .run({ k: "reader_send", v: "whistle" });
    expect((await preferences(t)).reader.send).toBe("enter");
  });
});

describe("the unsent turn", () => {
  async function scene(t: TestHarness): Promise<string> {
    const form = new FormData();
    form.append(
      "file",
      new File([pngCard({ chara: V2_CARD_SILENT }) as unknown as BlobPart], "bell.png"),
    );
    const { character } = (await (
      await t.fetch("/api/characters/import", { method: "POST", body: form })
    ).json()) as { character: CharacterDto };
    const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    const created = await json<SceneDto>(t, "POST", "/api/scenes", {
      title: "The pass",
      connectionProfileId: profiles[0]!.id,
    });
    await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
    return created.id;
  }

  test("comes back with the scene", async () => {
    const t = await signedIn();
    const id = await scene(t);
    const saved = await t.fetch(`/api/scenes/${id}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "I shrug the pack off my shoulder" }),
    });
    // No body: it arrives on a debounce while somebody types, and returning
    // the history would have the client refetch the log to learn nothing.
    expect(saved.status).toBe(204);
    const { scene: after } = await json<{ scene: SceneDto }>(t, "GET", `/api/scenes/${id}`);
    expect(after.draft).toBe("I shrug the pack off my shoulder");
  });

  test("does not reorder the roleplay list", async () => {
    /*
     * The point of `saveDraft` being its own statement. A keystroke in the
     * composer is not activity in the roleplay; routing it through the general
     * patch would have every half-typed sentence bump `updated_at`, and the
     * newest-first list would follow the cursor instead of the story.
     */
    const t = await signedIn();
    const id = await scene(t);
    const before = (await json<{ scene: SceneDto }>(t, "GET", `/api/scenes/${id}`)).scene.updatedAt;
    await t.fetch(`/api/scenes/${id}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "typing" }),
    });
    const after = (await json<{ scene: SceneDto }>(t, "GET", `/api/scenes/${id}`)).scene.updatedAt;
    expect(after).toBe(before);
  });

  test("is truncated rather than refused", async () => {
    // A draft is the reader's own words arriving by accident of length.
    // Refusing would mean the composer quietly stopped saving with nothing to
    // say so, and the first they would hear of it is an empty composer.
    const t = await signedIn();
    const id = await scene(t);
    const response = await t.fetch(`/api/scenes/${id}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(200_000) }),
    });
    expect(response.status).toBe(204);
    const { scene: after } = await json<{ scene: SceneDto }>(t, "GET", `/api/scenes/${id}`);
    expect(after.draft.length).toBe(100_000);
  });

  test("goes with the roleplay when it is deleted", async () => {
    // Why this is a column and not a key in the settings table: a key per
    // scene would outlive every scene it named, with nothing to notice.
    const t = await signedIn();
    const id = await scene(t);
    await t.fetch(`/api/scenes/${id}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "half a sentence" }),
    });
    await t.fetch(`/api/scenes/${id}`, { method: "DELETE" });
    expect(t.ctx.db.query("SELECT count(*) AS n FROM scenes WHERE draft != ''").get()).toEqual({ n: 0 });
  });
});

const ROOT = join(import.meta.dir, "..");
const CHAT = readFileSync(join(ROOT, "client", "screens", "ChatScreen.tsx"), "utf8");
const COMPOSER = readFileSync(join(ROOT, "client", "components", "Composer.tsx"), "utf8");
const APP_CSS = readFileSync(join(ROOT, "client", "styles", "app.css"), "utf8");

describe("where the switches actually reach", () => {
  test("the phone's return key is a newline in all three send modes", () => {
    // `Composer.tsx` has said so in a comment since phase 45; this is the
    // first time the comment has had a choice to be wrong about. None of the
    // three branches can fire without a physical key event.
    expect(COMPOSER).toContain('sendKey === "enter"');
    expect(COMPOSER).toContain('sendKey === "modEnter"');
    expect(COMPOSER).toContain("event.metaKey || event.ctrlKey");
    // Either modifier, rather than sniffing the platform.
    expect(COMPOSER).not.toContain("navigator.platform");
  });

  test("a new turn scrolls even with following turned off", () => {
    // Otherwise a log that stopped moving when a message landed would read as
    // a broken log rather than as a setting. Two effects, and only the
    // streaming one is gated.
    expect(CHAT).toMatch(/\}, \[logMessages\.length\]\);/);
    expect(CHAT).toContain("if (element === null || !reader.autoScroll) return;");
  });

  test("the motion override can only add reduction, never remove it", () => {
    // A reader who has asked their OS for less motion gets it whatever this
    // app is set to: the media query stays, and the attribute is a second way
    // in to the same rules rather than a replacement for them.
    expect(APP_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(APP_CSS).toContain(':root[data-motion="reduced"] *');
    expect(APP_CSS).not.toContain('data-motion="system"');
  });

  test("a keystroke is not a save", () => {
    expect(CHAT).toContain("draftSaved.current === draft");
    expect(CHAT).toMatch(/setTimeout\(\(\) => \{\s*draftSaved\.current = draft;/);
  });

  test("a late refetch cannot overwrite a sentence being typed", () => {
    // The request that carries the draft is the one that carries the log, and
    // it runs whenever the window regains focus.
    expect(CHAT).toContain('if (storedDraft !== "" && draft === "") setDraft(storedDraft);');
    expect(CHAT).toContain("if (restoredFor.current === sceneId) return;");
  });
});
