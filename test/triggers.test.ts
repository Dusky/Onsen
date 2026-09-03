import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import { triggersFor, type EventTrigger } from "../server/triggers/select.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  MessageDto,
  RegexScriptDto,
  SceneDto,
} from "../shared/types.ts";

/**
 * Event triggers (SPEC §14, §20 phase 33).
 *
 * The selector is pure and tested as such. What the rest cover is the seam: a
 * trigger is a schedule, so what matters is that it fires at the moment it
 * names and does nothing at the moments it does not.
 */

function trigger(over: Partial<EventTrigger> = {}): EventTrigger {
  return {
    id: "01AAA",
    name: "test",
    event: "user_message",
    action: "guide",
    actionRef: "situational",
    automationId: null,
    scope: "global",
    sceneId: null,
    enabled: true,
    runOrder: 0,
    ...over,
  };
}

describe("which triggers fire", () => {
  test("an event takes only its own, and never a disabled one", () => {
    const all = [
      trigger({ id: "a", event: "user_message" }),
      trigger({ id: "b", event: "after_generation" }),
      trigger({ id: "c", event: "user_message", enabled: false }),
    ];
    expect(triggersFor(all, { event: "user_message", sceneId: null }).map((t) => t.id)).toEqual([
      "a",
    ]);
  });

  test("a scene-scoped trigger fires in its own scene only", () => {
    const all = [
      trigger({ id: "g", scope: "global" }),
      trigger({ id: "s", scope: "scene", sceneId: "scene-1" }),
    ];
    expect(
      triggersFor(all, { event: "user_message", sceneId: "scene-1" }).map((t) => t.id),
    ).toEqual(["g", "s"]);
    expect(
      triggersFor(all, { event: "user_message", sceneId: "scene-2" }).map((t) => t.id),
    ).toEqual(["g"]);
  });

  test("a lore trigger needs its automation id, not merely an activation", () => {
    const all = [
      trigger({ id: "x", event: "lore_activation", automationId: "storm" }),
      trigger({ id: "y", event: "lore_activation", automationId: "calm" }),
    ];
    expect(
      triggersFor(all, {
        event: "lore_activation",
        sceneId: null,
        automationIds: ["storm"],
      }).map((t) => t.id),
    ).toEqual(["x"]);
    expect(
      triggersFor(all, { event: "lore_activation", sceneId: null, automationIds: [] }),
    ).toEqual([]);
  });

  test("run order decides, with identity breaking a tie", () => {
    const all = [
      trigger({ id: "z", runOrder: 1 }),
      trigger({ id: "a", runOrder: 1 }),
      trigger({ id: "m", runOrder: 0 }),
    ];
    expect(triggersFor(all, { event: "user_message", sceneId: null }).map((t) => t.id)).toEqual([
      "m",
      "a",
      "z",
    ]);
  });
});

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

async function scene(t: TestHarness): Promise<string> {
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
  return created.id;
}

interface TriggerDto {
  id: string;
  name: string;
  event: string;
  action: string;
  actionRef: string;
  enabled: boolean;
  runOrder: number;
}

describe("the surface refuses a trigger that could never work", () => {
  test("an action must name something that exists", async () => {
    const t = await signedIn();
    for (const bad of [
      { action: "guide", actionRef: "nonsense" },
      { action: "tracker", actionRef: "nonsense" },
      { action: "script", actionRef: "01NOTASCRIPT" },
    ]) {
      expect(
        await statusOf(t, "POST", "/api/triggers", {
          name: "bad",
          event: "user_message",
          ...bad,
        }),
      ).toBe(400);
    }
  });

  test("a lore trigger without an automation id is refused", async () => {
    const t = await signedIn();
    expect(
      await statusOf(t, "POST", "/api/triggers", {
        name: "lore",
        event: "lore_activation",
        action: "guide",
        actionRef: "situational",
      }),
    ).toBe(400);
  });

  test("a valid one round-trips and lands at the end of its event", async () => {
    const t = await signedIn();
    const first = await json<TriggerDto>(t, "POST", "/api/triggers", {
      name: "one",
      event: "user_message",
      action: "guide",
      actionRef: "clothes",
    });
    const second = await json<TriggerDto>(t, "POST", "/api/triggers", {
      name: "two",
      event: "user_message",
      action: "tracker",
      actionRef: "scene",
    });
    expect(second.runOrder).toBeGreaterThan(first.runOrder);
    expect((await json<TriggerDto[]>(t, "GET", "/api/triggers")).map((x) => x.name)).toEqual([
      "one",
      "two",
    ]);
  });

  test("the editor can ask what an action may point at", async () => {
    const t = await signedIn();
    const options = await json<{
      guide: { value: string; label: string }[];
      tracker: { value: string; label: string }[];
      events: string[];
    }>(t, "GET", "/api/triggers/actions");
    expect(options.guide.map((ref) => ref.value)).toContain("situational");
    expect(options.tracker.map((ref) => ref.value)).toContain("scene");
    expect(options.events).toContain("lore_activation");
    // Named as the rest of the app names them, not as the enum.
    expect(options.guide.every((ref) => ref.label !== ref.value)).toBe(true);
  });

  test("deleting a scene takes its scene-scoped triggers", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await json<TriggerDto>(t, "POST", "/api/triggers", {
      name: "here",
      event: "user_message",
      action: "guide",
      actionRef: "state",
      scope: "scene",
      sceneId,
    });
    await t.fetch(`/api/scenes/${sceneId}`, { method: "DELETE" });
    expect(await json<TriggerDto[]>(t, "GET", "/api/triggers")).toEqual([]);
  });
});

describe("firing", () => {
  async function scriptTrigger(t: TestHarness, event: string, sceneId?: string) {
    const script = await json<RegexScriptDto>(t, "POST", "/api/scripts", {
      name: "shout",
      pattern: "quiet",
      replacement: "LOUD",
      flags: "g",
      applyTo: "prompt",
      scope: "global",
      // Off on the automatic paths: this one exists to be fired by hand, and a
      // script that is both would run twice.
      enabled: false,
    });
    return json<TriggerDto>(t, "POST", "/api/triggers", {
      name: `on ${event}`,
      event,
      action: "script",
      actionRef: script.id,
      ...(sceneId === undefined ? {} : { scope: "scene", sceneId }),
    });
  }

  test("a user message fires its trigger, and the rewrite lands on the turn", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await scriptTrigger(t, "user_message");

    await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "a quiet room",
    });
    await until(async () => {
      const path = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
      return path.at(-1)?.content === "a LOUD room";
    });
  });

  test("scene start fires once, on the first thing written into it", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await scriptTrigger(t, "scene_start");

    await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "a quiet start",
    });
    await until(async () => {
      const path = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
      return path[0]?.content === "a LOUD start";
    });

    // The second message is not a start, so the script must leave it alone.
    await json<MessageDto>(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "another quiet line",
    });
    // Nothing to wait for, so wait for the write to have settled the other way.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const path = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    expect(path.at(-1)?.content).toBe("another quiet line");
  });

  test("a trigger scoped to one scene does not fire in another", async () => {
    const t = await signedIn();
    const mine = await scene(t);
    const theirs = await scene(t);
    await scriptTrigger(t, "user_message", mine);

    await json<MessageDto>(t, "POST", `/api/scenes/${theirs}/messages`, {
      kind: "user",
      authorType: "user",
      content: "a quiet room",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const path = await json<MessageDto[]>(t, "GET", `/api/scenes/${theirs}/messages`);
    expect(path.at(-1)?.content).toBe("a quiet room");
  });

  test("a turn fires before_generation and after_generation", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await scriptTrigger(t, "after_generation");
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "go on",
    });

    const snapshot = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await adapter.started;
    adapter.push("She said it was quiet up there.");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    // The turn that just landed is the active leaf, so the trigger's script
    // rewrites it - which is how "after the generation" is observable at all.
    await until(async () => {
      const path = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
      return path.at(-1)?.content === "She said it was LOUD up there.";
    });
  });

  test("an entry's automation id fires its trigger, and only its own", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);

    const created = await json<{ id: string }>(t, "POST", "/api/lorebooks", { name: "The ridge" });
    const made = await json<{ id: string }>(t, "POST", `/api/lorebooks/${created.id}/entries`, {
      content: "The pass closes in the first week of snow.",
    });
    await json(t, "PATCH", `/api/lorebooks/${created.id}/entries/${made.id}`, {
      keys: ["pass"],
      automationId: "storm",
    });
    await json(t, "POST", `/api/lorebooks/${created.id}/bindings`, {
      scope: "scene",
      targetId: sceneId,
    });

    const script = await json<RegexScriptDto>(t, "POST", "/api/scripts", {
      name: "shout",
      pattern: "quiet",
      replacement: "LOUD",
      flags: "g",
      applyTo: "prompt",
      enabled: false,
    });
    // Bound to an id no entry carries, and pointing at a different rewrite so
    // its firing would be visible rather than a second no-op over the same text.
    const other = await json<RegexScriptDto>(t, "POST", "/api/scripts", {
      name: "thaw",
      pattern: "thaw",
      replacement: "FLOOD",
      flags: "g",
      applyTo: "prompt",
      enabled: false,
    });
    await json<TriggerDto>(t, "POST", "/api/triggers", {
      name: "wrong id",
      event: "lore_activation",
      action: "script",
      actionRef: other.id,
      automationId: "calm",
    });
    await json<TriggerDto>(t, "POST", "/api/triggers", {
      name: "right id",
      event: "lore_activation",
      action: "script",
      actionRef: script.id,
      automationId: "storm",
    });

    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "is the pass open?",
    });
    const snapshot = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await adapter.started;
    adapter.push("It has been quiet since the thaw.");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    await until(async () => {
      const path = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
      return path.at(-1)?.content === "It has been LOUD since the thaw.";
    });
    // "thaw" survives, so the trigger bound to an id nothing carried stayed put.
    const path = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    expect(path.at(-1)?.content).toContain("thaw");
  });

  test("before_generation runs early enough to change the prompt", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await scriptTrigger(t, "before_generation");
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "a quiet room",
    });

    const before = adapter.prompts.length;
    const snapshot = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await adapter.started;
    adapter.push("She nodded.");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    // The turn's own prompt, not one of the pipeline's side calls.
    const sent = JSON.stringify(adapter.prompts[before]);
    expect(sent).toContain("a LOUD room");
  });
});

describe("running a trigger by hand", () => {
  test("reports the rewrite, and refuses a roleplay it does not apply to", async () => {
    const t = await signedIn();
    const mine = await scene(t);
    const theirs = await scene(t);
    const script = await json<RegexScriptDto>(t, "POST", "/api/scripts", {
      name: "shout",
      pattern: "quiet",
      replacement: "LOUD",
      flags: "g",
      applyTo: "prompt",
      enabled: false,
    });
    const made = await json<TriggerDto>(t, "POST", "/api/triggers", {
      name: "by hand",
      event: "lore_activation",
      action: "script",
      actionRef: script.id,
      automationId: "storm",
      scope: "scene",
      sceneId: mine,
    });

    await json(t, "POST", `/api/scenes/${mine}/messages`, {
      kind: "user",
      authorType: "user",
      content: "a quiet room",
    });

    const ran = await json<{ ran: boolean; detail: string }>(
      t,
      "POST",
      `/api/triggers/${made.id}/run`,
      { sceneId: mine },
    );
    expect(ran.ran).toBe(true);
    expect(ran.detail).toContain("1 match");

    const elsewhere = await json<{ ran: boolean; detail: string }>(
      t,
      "POST",
      `/api/triggers/${made.id}/run`,
      { sceneId: theirs },
    );
    expect(elsewhere.ran).toBe(false);
    expect(elsewhere.detail).toContain("does not apply");
  });

  test("a script deleted out from under a trigger is reported, not thrown", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const script = await json<RegexScriptDto>(t, "POST", "/api/scripts", {
      name: "gone",
      pattern: "x",
      replacement: "y",
      applyTo: "prompt",
    });
    const made = await json<TriggerDto>(t, "POST", "/api/triggers", {
      name: "orphan",
      event: "after_generation",
      action: "script",
      actionRef: script.id,
    });
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "x",
    });
    await t.fetch(`/api/scripts/${script.id}`, { method: "DELETE" });

    const ran = await json<{ ran: boolean; detail: string }>(
      t,
      "POST",
      `/api/triggers/${made.id}/run`,
      { sceneId },
    );
    expect(ran.ran).toBe(false);
    expect(ran.detail).toContain("deleted");
  });
});
