import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import type { SceneDto, SceneWithHistoryDto } from "../shared/types.ts";

/**
 * Describing an empty scene (SPEC §15, §20 phase 157).
 *
 * The reader gives a couple of sentences; the model sets the scene up — title,
 * scenario, and a narrator opening the scene lands on. This pins the route and
 * the apply, not the prompt's exact wording.
 */

let harness: TestHarness | null = null;
let adapter: ScriptedAdapter;

async function signedIn(): Promise<TestHarness> {
  harness = createHarness({ adapter: (adapter = new ScriptedAdapter()) });
  await completeSetup(harness);
  return harness;
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

async function newScene(t: TestHarness): Promise<SceneDto> {
  const profiles = (await (await t.fetch("/api/connections/profiles")).json()) as Array<{ id: string }>;
  const response = await t.fetch("/api/scenes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Untitled", connectionProfileId: profiles[0]!.id }),
  });
  return (await response.json()) as SceneDto;
}

describe("describing an empty scene", () => {
  test("the premise becomes a title, scenario and narrator opening", async () => {
    const t = await signedIn();
    const scene = await newScene(t);

    adapter.taskReplyFor = () =>
      JSON.stringify({
        title: "The Fuel Ration",
        scenario: "A tense negotiation over fuel rationing aboard a station.",
        opening: "The lights in the depot flickered as the council filed in.",
      });

    const described = await t.fetch(`/api/scenes/${scene.id}/describe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ premise: "a negotiation over fuel rationing on a station" }),
    });
    expect(described.status).toBe(200);

    const after = (await (await t.fetch(`/api/scenes/${scene.id}`)).json()) as SceneWithHistoryDto;
    expect(after.scene.title).toBe("The Fuel Ration");
    expect(after.scene.scenarioOverride).toContain("fuel rationing");
    // The opening is the one narrator turn, so the scene opens on the setup.
    expect(after.messages).toHaveLength(1);
    expect(after.messages[0]!.kind).toBe("narrator");
    expect(after.messages[0]!.content).toContain("flickered");
  });

  test("a non-string premise is refused before anything runs", async () => {
    const t = await signedIn();
    const scene = await newScene(t);

    const bad = await t.fetch(`/api/scenes/${scene.id}/describe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ premise: 42 }),
    });
    expect(bad.status).toBe(400);
    expect(adapter.taskCalls).toBe(0);
  });
});
