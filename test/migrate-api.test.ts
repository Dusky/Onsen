import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { V2_CARD, charxCard, pngCard } from "./card-fixtures.ts";
import {
  chatJsonl,
  charLine,
  contextJson,
  groupJson,
  instructJson,
  regexJson,
  settingsJson,
  userLine,
} from "./sillytavern-fixtures.ts";
import type {
  MigrationReportDto,
  PersonaDto,
  RegexScriptDto,
  SceneDto,
  SceneWithHistoryDto,
} from "../shared/types.ts";

/**
 * Importing a SillyTavern install over the wire (SPEC §20 phase 44).
 *
 * The parsers are proved next door without a database. What is proved here is
 * the half that could not be: that a chat lands as a tree the swipe carousel
 * can walk, that a group casts the right people, and that running the import
 * twice does not double everything.
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

async function json<T>(t: TestHarness, method: string, path: string): Promise<T> {
  return (await (await t.fetch(path, { method })).json()) as T;
}

/** Upload files under the paths they had inside SillyTavern's data folder. */
function folder(files: Array<[string, string | Uint8Array]>): FormData {
  const form = new FormData();
  for (const [path, body] of files) {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    // The path travels in the filename slot — the only field a multipart part
    // carries for it, and what the server classifies on.
    form.append("files", new File([bytes as unknown as BlobPart], path), path);
  }
  return form;
}

async function migrate(t: TestHarness, form: FormData) {
  const response = await t.fetch("/api/migrate/sillytavern", { method: "POST", body: form });
  return { status: response.status, body: (await response.json()) as MigrationReportDto };
}

const card = (name: string) => ({ ...V2_CARD, data: { ...V2_CARD.data, name } });
const bellPng = () => pngCard({ chara: card("Sister Bell") });

const CHAT = chatJsonl([
  charLine("Sister Bell", 'Bell does not look up. "Ridge."'),
  userLine("Is the road open?"),
  charLine("Sister Bell", "Closed since spring.", {
    swipes: ["Closed.", "Closed since spring.", "She shrugs."],
    swipe_id: 1,
  }),
]);

async function scenesOf(t: TestHarness) {
  return json<SceneDto[]>(t, "GET", "/api/scenes");
}

describe("importing a folder", () => {
  test("requires a session", async () => {
    const t = createHarness();
    const response = await t.fetch("/api/migrate/sillytavern", {
      method: "POST",
      body: folder([["settings.json", settingsJson()]]),
    });
    expect(response.status).toBe(401);
  });

  test("an empty upload is a bad request", async () => {
    const t = await signedIn();
    expect((await migrate(t, folder([]))).status).toBe(400);
  });

  test("a card and its chat land together, in one pass", async () => {
    const t = await signedIn();
    const { status, body } = await migrate(
      t,
      folder([
        ["characters/Sister Bell.png", bellPng()],
        ["chats/Sister Bell/2024-04-12 @18h 03m 21s.jsonl", CHAT],
      ]),
    );

    expect(status).toBe(201);
    expect(body.added).toBe(2);
    const chat = body.items.find((entry) => entry.kind === "chat")!;
    expect(chat.action).toBe("add");
    expect(chat.name).toBe("Sister Bell — 2024-04-12 @18h 03m 21s");
  });

  test("the swipes are siblings the carousel can walk", async () => {
    const t = await signedIn();
    await migrate(
      t,
      folder([
        ["characters/Sister Bell.png", bellPng()],
        ["chats/Sister Bell/a.jsonl", CHAT],
      ]),
    );

    const scene = (await scenesOf(t))[0]!;
    const history = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);

    // Three turns on the path, and the last one left where the reader left it.
    expect(history.messages).toHaveLength(3);
    expect(history.messages.at(-1)!.content).toBe("Closed since spring.");
    expect(history.messages.at(-1)!.siblingCount).toBe(3);
    expect(history.messages.at(-1)!.siblingIndex).toBe(1);

    const siblings = await json<Array<{ content: string }>>(
      t,
      "GET",
      `/api/scenes/${scene.id}/messages/${history.messages.at(-1)!.id}/siblings`,
    );
    expect(siblings.map((s) => s.content)).toEqual([
      "Closed.",
      "Closed since spring.",
      "She shrugs.",
    ]);
  });

  test("the reader's turns and the character's are told apart", async () => {
    const t = await signedIn();
    await migrate(
      t,
      folder([
        ["characters/Sister Bell.png", bellPng()],
        ["chats/Sister Bell/a.jsonl", CHAT],
      ]),
    );
    const scene = (await scenesOf(t))[0]!;
    const history = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);

    expect(history.messages.map((m) => m.kind)).toEqual(["spotlight", "user", "spotlight"]);
    expect(history.messages[0]!.speakerName).toBe("Sister Bell");
    expect(history.messages[1]!.speakerName).toBeNull();
  });

  test("an imported scene can generate — it carries the default profile", async () => {
    // Otherwise every migrated scene's status bar reads NO MODEL, which the
    // browser drive showed and which is a poor first minute in a new app.
    const t = await signedIn();
    await migrate(
      t,
      folder([
        ["characters/Sister Bell.png", bellPng()],
        ["chats/Sister Bell/a.jsonl", CHAT],
      ]),
    );
    const scene = (await scenesOf(t))[0]!;
    expect(scene.connectionProfileId).not.toBeNull();
    expect(scene.presetId).not.toBeNull();
  });

  test("a chat whose character is not here is skipped, and says how to fix it", async () => {
    const t = await signedIn();
    const { body } = await migrate(t, folder([["chats/Sister Bell/a.jsonl", CHAT]]));

    expect(body.added).toBe(0);
    const chat = body.items.find((entry) => entry.kind === "chat")!;
    expect(chat.action).toBe("skip");
    expect(chat.detail).toContain("Import the characters first");
    // Nothing half-landed.
    expect(await scenesOf(t)).toEqual([]);
  });

  test("running it again skips what is already in, rather than doubling it", async () => {
    // The expected flow: import, notice a card was missing, fix it, re-run.
    const t = await signedIn();
    const files = folder([
      ["characters/Sister Bell.png", bellPng()],
      ["chats/Sister Bell/a.jsonl", CHAT],
    ]);
    await migrate(t, files);
    const again = await migrate(
      t,
      folder([
        ["characters/Sister Bell.png", bellPng()],
        ["chats/Sister Bell/a.jsonl", CHAT],
      ]),
    );

    expect(again.body.added).toBe(0);
    expect(again.body.skipped).toBe(2);
    expect(again.body.items.find((e) => e.kind === "chat")!.detail).toBe("Already imported.");
    expect(await scenesOf(t)).toHaveLength(1);
  });

  test("files it does not understand are ignored, not reported as failures", async () => {
    const t = await signedIn();
    const { body } = await migrate(
      t,
      folder([
        ["characters/Sister Bell.png", bellPng()],
        ["thumbnails/bg/blur.png", "not an image really"],
        ["backups/chat_Bell_1.jsonl", CHAT],
        ["User Avatars/reader.png", "x"],
      ]),
    );
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.kind).toBe("character");
  });
});

describe("group chats", () => {
  const GROUP = chatJsonl([
    charLine("Sister Bell", "Bell nods at the newcomer."),
    userLine("Both of you, then."),
    charLine("Mira Vance", '"Short," she repeated.'),
  ]);

  async function importGroup(t: TestHarness) {
    return migrate(
      t,
      folder([
        ["characters/Sister Bell.png", bellPng()],
        ["characters/Mira Vance.charx", charxCard(card("Mira Vance"))],
        ["groups/The ridge.json", groupJson("The ridge", ["Sister Bell.png", "Mira Vance.charx"])],
        ["group chats/The ridge.jsonl", GROUP],
      ]),
    );
  }

  test("the cast comes from the group definition, by avatar filename", async () => {
    // `original_avatar` is SillyTavern's own identifier; the display name is
    // what a rename desynchronises.
    const t = await signedIn();
    const { body } = await importGroup(t);
    expect(body.items.find((e) => e.kind === "group_chat")!.action).toBe("add");

    const scene = (await scenesOf(t))[0]!;
    expect(scene.cast.map((member) => member.name).sort()).toEqual([
      "Mira Vance",
      "Sister Bell",
    ]);
  });

  test("each turn is attributed to the character who spoke it", async () => {
    const t = await signedIn();
    await importGroup(t);
    const scene = (await scenesOf(t))[0]!;
    const history = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    expect(history.messages.map((m) => m.speakerName)).toEqual([
      "Sister Bell",
      null,
      "Mira Vance",
    ]);
  });
});

describe("the rest of the install", () => {
  test("personas, world info, instruct templates and regex scripts all land", async () => {
    const t = await signedIn();
    const { body } = await migrate(
      t,
      folder([
        ["settings.json", settingsJson()],
        ["instruct/Ridge ChatML.json", instructJson()],
        ["regex/Strip.json", regexJson()],
        ["context/Ridge.json", contextJson()],
      ]),
    );

    const kinds = body.items.map((entry) => entry.kind);
    expect(kinds).toContain("persona");
    expect(kinds).toContain("instruct");
    expect(kinds).toContain("regex");

    const personas = await json<PersonaDto[]>(t, "GET", "/api/personas");
    expect(personas.map((p) => p.name).sort()).toEqual(["Second Face", "The Reader"]);

    const scripts = await json<RegexScriptDto[]>(t, "GET", "/api/scripts");
    expect(scripts[0]).toMatchObject({ name: "Strip stage directions", applyTo: "ai_output" });
  });

  test("running it again brings none of them in twice", async () => {
    // Chats dedupe on the file's bytes; these four have no hash of their own,
    // so they dedupe on the name — which the browser drive caught, because the
    // first cut re-added the lorebook, the template and the script every run.
    const t = await signedIn();
    const files = () =>
      folder([
        ["settings.json", settingsJson()],
        ["instruct/Ridge ChatML.json", instructJson()],
        ["regex/Strip.json", regexJson()],
      ]);
    const first = await migrate(t, files());
    expect(first.body.added).toBeGreaterThan(0);

    const again = await migrate(t, files());
    expect(again.body.added).toBe(0);
    expect(again.body.items.every((entry) => entry.action === "skip")).toBe(true);

    expect(await json<PersonaDto[]>(t, "GET", "/api/personas")).toHaveLength(2);
    expect(await json<RegexScriptDto[]>(t, "GET", "/api/scripts")).toHaveLength(1);
  });

  test("an instruct template says which of its fields did not survive", async () => {
    const t = await signedIn();
    const { body } = await migrate(t, folder([["instruct/Ridge ChatML.json", instructJson()]]));
    const template = body.items.find((entry) => entry.kind === "instruct")!;
    expect(template.action).toBe("add");
    expect(template.detail).toContain("wrap");
  });

  test("a context template is refused, with the native equivalent named", async () => {
    // It assembles the whole prompt as one text template; Onsen builds the
    // prompt from blocks and has nothing to paste one into.
    const t = await signedIn();
    const { body } = await migrate(t, folder([["context/Ridge.json", contextJson()]]));
    const context = body.items.find((entry) => entry.kind === "context")!;
    expect(context.action).toBe("skip");
    expect(context.detail).toContain("prompt options");
  });

  test("a regex whose pattern will not compile is refused rather than stored", async () => {
    const t = await signedIn();
    const { body } = await migrate(
      t,
      folder([["regex/Broken.json", regexJson({ findRegex: "/([unclosed/g" })]]),
    );
    const script = body.items.find((entry) => entry.kind === "regex")!;
    expect(script.action).toBe("skip");
    expect(script.detail).toContain("will not compile");
    expect(await json<RegexScriptDto[]>(t, "GET", "/api/scripts")).toEqual([]);
  });
});
