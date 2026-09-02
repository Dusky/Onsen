import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { pngCard, V2_CARD } from "./card-fixtures.ts";
import { parseTrackerReply } from "../server/trackers/runner.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  PromptInspectorDto,
  SceneDto,
  TrackerDto,
} from "../shared/types.ts";

/**
 * Structured trackers (SPEC §8, §20 phase 31).
 *
 * The rule that shapes the feature is §8's last line: a parse failure keeps
 * the previous state and logs, never blocking generation. The tests read it
 * both ways — a good reply writes, a malformed one leaves the state standing.
 */

let harness: TestHarness | null = null;
let adapter: ScriptedAdapter;

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

async function signedIn(): Promise<TestHarness> {
  harness = createHarness({ adapter: (adapter = new ScriptedAdapter()) });
  await completeSetup(harness);
  return harness;
}

async function scene(t: TestHarness): Promise<string> {
  const form = new FormData();
  form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
  const { character } = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };
  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "Ridge",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  return created.id;
}

/** Answer tracker side calls with `reply`. */
function trackersAnswer(reply: string): void {
  adapter.taskReplyFor = (prompt) =>
    prompt.debug.blocks[0]?.label === "Tracker" ? reply : null;
}

describe("the tracker parser (pure)", () => {
  test("accepts an object, reads a fenced one, refuses prose", () => {
    expect(parseTrackerReply('{"location":"x"}')).toEqual({ location: "x" });
    expect(parseTrackerReply('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseTrackerReply("The location is the ridge.")).toBe(null);
    expect(parseTrackerReply("[1,2,3]")).toBe(null);
  });
});

describe("trackers through a generation (SPEC §8)", () => {
  test("a good reply writes, a malformed one leaves the state standing", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    trackersAnswer('{"location":"the ridge","time_of_day":"night","present":["Bell"]}');

    adapter.push("The lamps gutter.");
    adapter.end();
    const first = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await until(async () => {
      const snapshot = await json<{ status: string }>(t, "GET", `/api/generations/${first.id}`);
      return snapshot.status === "complete";
    });
    await until(async () => (await json<TrackerDto[]>(t, "GET", `/api/scenes/${sceneId}/trackers`)).length >= 2);
    const written = await json<TrackerDto[]>(t, "GET", `/api/scenes/${sceneId}/trackers`);
    const sceneTracker = written.find((tracker) => tracker.kind === "scene");
    expect(JSON.parse(sceneTracker!.content)).toEqual({ location: "the ridge", time_of_day: "night", present: ["Bell"] });

    // A malformed reply must not wipe the state.
    trackersAnswer("The location is the ridge, I think.");
    adapter.push("Another turn.");
    adapter.end();
    const second = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await until(async () => {
      const snapshot = await json<{ status: string }>(t, "GET", `/api/generations/${second.id}`);
      return snapshot.status === "complete";
    });
    // Give the (failed) refresh its chance to run, then read the state back.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const after = await json<TrackerDto[]>(t, "GET", `/api/scenes/${sceneId}/trackers`);
    const stillThere = after.find((tracker) => tracker.kind === "scene");
    expect(JSON.parse(stillThere!.content).location).toBe("the ridge");
  });

  test("trackers reach the prompt's trackers block and the inspector", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    trackersAnswer('{"location":"the ridge","time_of_day":"night","present":["Bell"]}');

    // Turn A produces the trackers — they refresh *after* it lands. Turn B's
    // prompt is the first one that carries them.
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "Bell, where are we?",
    });
    adapter.push("The ridge, at night.");
    adapter.end();
    const first = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await until(async () => {
      const snapshot = await json<{ status: string }>(t, "GET", `/api/generations/${first.id}`);
      return snapshot.status === "complete";
    });
    await until(async () => (await json<TrackerDto[]>(t, "GET", `/api/scenes/${sceneId}/trackers`)).length >= 2);

    adapter.push("The oil is low too.");
    adapter.end();
    const second = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await until(async () => {
      const snapshot = await json<{ status: string }>(t, "GET", `/api/generations/${second.id}`);
      return snapshot.status === "complete";
    });

    const history = await json<{ messages: { id: string }[] }>(t, "GET", `/api/scenes/${sceneId}`);
    const inspection = await json<PromptInspectorDto>(
      t,
      "GET",
      `/api/scenes/${sceneId}/inspector/${history.messages.at(-1)!.id}`,
    );
    expect(inspection.debug.blocks.some((block) => block.id === "trackers")).toBe(true);
  });
});
