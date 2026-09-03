import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  MessageDto,
  RegexScriptDto,
  SceneDto,
  ScriptTestDto,
} from "../shared/types.ts";

/**
 * Regex scripts through the real system (SPEC §14, §20 phase 33).
 *
 * The engine has its own unit tests. What these cover is the seam the engine
 * cannot: that each of the four stages touches what it is supposed to touch and
 * leaves the rest alone. That distinction is the whole design — `display_only`
 * changing the prompt, or `prompt` changing the stored message, would each be a
 * silent corruption of a scene the reader thought they were only styling.
 */

let harness: TestHarness | null = null;
let adapter: ScriptedAdapter;

async function signedIn(): Promise<TestHarness> {
  if (harness === null) {
    adapter = new ScriptedAdapter();
    harness = createHarness({ adapter });
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

async function statusOf(t: TestHarness, method: string, path: string, body?: unknown) {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return response.status;
}

async function scene(t: TestHarness): Promise<{ sceneId: string; characterId: string }> {
  const form = new FormData();
  form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
  const { character } = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };
  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "The pass",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  return { sceneId: created.id, characterId: character.id };
}

function add(t: TestHarness, over: Partial<RegexScriptDto> & { name: string; pattern: string }) {
  return json<RegexScriptDto>(t, "POST", "/api/scripts", {
    replacement: "",
    flags: "g",
    applyTo: "ai_output",
    scope: "global",
    ...over,
  });
}

describe("the surface", () => {
  test("a script round-trips, and a new one lands at the end of its stage", async () => {
    const t = await signedIn();
    const first = await add(t, { name: "one", pattern: "a" });
    const second = await add(t, { name: "two", pattern: "b" });
    expect(second.runOrder).toBeGreaterThan(first.runOrder);

    const all = await json<RegexScriptDto[]>(t, "GET", "/api/scripts");
    expect(all.map((s) => s.name)).toEqual(["one", "two"]);
  });

  test("a pattern that will not compile is refused at save time", async () => {
    const t = await signedIn();
    expect(
      await statusOf(t, "POST", "/api/scripts", {
        name: "broken",
        pattern: "(unclosed",
        applyTo: "ai_output",
      }),
    ).toBe(400);
  });

  test("an edit is validated as a pair, so a bad flag cannot be slipped in later", async () => {
    const t = await signedIn();
    const script = await add(t, { name: "sticky", pattern: "\\w+", flags: "g" });
    expect(await statusOf(t, "PATCH", `/api/scripts/${script.id}`, { flags: "gd" })).toBe(400);
    expect(await statusOf(t, "PATCH", `/api/scripts/${script.id}`, { pattern: "(" })).toBe(400);
    expect(await statusOf(t, "PATCH", `/api/scripts/${script.id}`, { flags: "gi" })).toBe(200);
  });

  test("a character-scoped script needs a character that exists", async () => {
    const t = await signedIn();
    expect(
      await statusOf(t, "POST", "/api/scripts", {
        name: "nobody",
        pattern: "x",
        applyTo: "ai_output",
        scope: "character",
        characterId: "01NOTREAL",
      }),
    ).toBe(404);
  });

  test("deleting a character takes its scripts with it", async () => {
    const t = await signedIn();
    const { characterId } = await scene(t);
    await add(t, { name: "theirs", pattern: "x", scope: "character", characterId });
    await t.fetch(`/api/characters/${characterId}`, { method: "DELETE" });
    expect(await json<RegexScriptDto[]>(t, "GET", "/api/scripts")).toEqual([]);
  });
});

describe("the test panel", () => {
  test("runs the live engine and reports what each script did", async () => {
    const t = await signedIn();
    await add(t, { name: "dashes", pattern: "--", replacement: "—" });
    await add(t, { name: "quiet", pattern: "zzz", replacement: "!" });

    const result = await json<ScriptTestDto>(t, "POST", "/api/scripts/test", {
      applyTo: "ai_output",
      text: "she paused -- then went on",
    });
    expect(result.after).toBe("she paused — then went on");
    expect(result.runs.map((run) => [run.name, run.replacements])).toEqual([
      ["dashes", 1],
      ["quiet", 0],
    ]);
  });

  test("it writes nothing - the point of a dry run", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await add(t, { name: "shout", pattern: "quiet", replacement: "loud", applyTo: "display_only" });
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "a quiet room",
    });
    await json<ScriptTestDto>(t, "POST", "/api/scripts/test", {
      applyTo: "display_only",
      sceneId,
      text: "a quiet room",
    });
    const stored = t.ctx.db
      .query("SELECT content FROM messages ORDER BY id DESC LIMIT 1")
      .get() as { content: string };
    expect(stored.content).toBe("a quiet room");
  });

  test("a scene-scoped script only fires in its own scene", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await add(t, { name: "here", pattern: "x", replacement: "y", scope: "scene", sceneId });

    const inside = await json<ScriptTestDto>(t, "POST", "/api/scripts/test", {
      applyTo: "ai_output",
      sceneId,
      text: "x",
    });
    const outside = await json<ScriptTestDto>(t, "POST", "/api/scripts/test", {
      applyTo: "ai_output",
      text: "x",
    });
    expect(inside.after).toBe("y");
    expect(outside.after).toBe("x");
  });
});

describe("the stages differ in what they touch", () => {
  test("user_input rewrites the message before it is stored", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await add(t, { name: "tidy", pattern: "\\bteh\\b", replacement: "the", applyTo: "user_input" });

    const message = await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "teh door was open",
    });
    expect(message.content).toBe("the door was open");
    const stored = t.ctx.db
      .query("SELECT content FROM messages WHERE ulid = $u")
      .get({ u: message.id }) as { content: string };
    expect(stored.content).toBe("the door was open");
  });

  test("display_only changes what is read back and not what is stored", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await add(t, {
      name: "emphasis",
      pattern: "\\*(\\w+)\\*",
      replacement: "$1",
      applyTo: "display_only",
    });
    const message = await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "she was *very* still",
    });
    expect(message.content).toBe("she was very still");

    const stored = t.ctx.db
      .query("SELECT content FROM messages WHERE ulid = $u")
      .get({ u: message.id }) as { content: string };
    expect(stored.content).toBe("she was *very* still");

    // And again on the path the log actually reads.
    const path = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    expect(path.at(-1)?.content).toBe("she was very still");
  });

  test("ai_output rewrites the turn the model wrote", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await add(t, { name: "cut", pattern: "\\s+And then$", replacement: "", applyTo: "ai_output" });
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "go on",
    });

    const snapshot = await json<{ id: string }>(
      t,
      "POST",
      `/api/scenes/${sceneId}/generate`,
      {},
    );
    await adapter.started;
    adapter.push("She set the glass down. And then");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    const path = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    expect(path.at(-1)?.content).toBe("She set the glass down.");
  });

  test("prompt changes what the model reads and not what is stored", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await add(t, {
      name: "strip",
      pattern: "\\[ooc:[^\\]]*\\]",
      replacement: "",
      applyTo: "prompt",
    });
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "she left [ooc: keep it short]",
    });

    const before = adapter.prompts.length;
    const snapshot = await json<{ id: string }>(
      t,
      "POST",
      `/api/scenes/${sceneId}/generate`,
      {},
    );
    await adapter.started;
    adapter.push("The door closed.");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    // The first prompt this generation built - the pipeline's side calls share
    // the adapter, so `at(-1)` would be one of theirs.
    const sent = JSON.stringify(adapter.prompts[before]);
    expect(sent).toContain("she left");
    expect(sent).not.toContain("keep it short");

    const path = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    expect(path.some((m) => m.content.includes("keep it short"))).toBe(true);
  });
});
