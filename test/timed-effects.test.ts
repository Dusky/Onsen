import { afterEach, describe, expect, test } from "bun:test";
import {
  completeSetup,
  createHarness,
  ScriptedAdapter,
  until,
  type TestHarness,
} from "./helpers.ts";
import type { CharacterDto, LoreEntryDto, LorebookDto, SceneDto } from "../shared/types.ts";

/**
 * Timed effects are armed by a generation (§10, §20 phase 77).
 *
 * `recordActivations` was the orphaned write half: `timedStateFor` read
 * `lore_timed_effects` and nothing ever inserted into it, so sticky, cooldown
 * and delay could never fire. The dead-export sweep (phase 76) found it; this
 * pins the wire — a turn that fires a lore entry records it against the
 * message that landed, which is what the next turn's activation reads.
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

async function json<T>(
  t: TestHarness,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return (await response.json()) as T;
}

describe("timed effects are armed by a generation", () => {
  test("a fired entry is recorded against the turn that landed", async () => {
    const t = await signedIn();
    const character = await json<CharacterDto>(t, "POST", "/api/characters", { name: "Bell" });
    const profiles = await json<{ id: string; isDefault?: boolean }[]>(
      t,
      "GET",
      "/api/connections/profiles",
    );
    const scene = await json<SceneDto>(t, "POST", "/api/scenes", {
      title: "Ridge station",
      connectionProfileId: profiles[0]!.id,
    });
    await json(t, "PUT", `/api/scenes/${scene.id}/cast/${character.id}`);

    const book = await json<LorebookDto>(t, "POST", "/api/lorebooks", { name: "The ridge" });
    const entry = await json<LoreEntryDto>(t, "POST", `/api/lorebooks/${book.id}/entries`, {
      content: "The station runs on lamp oil.",
    });
    await json<LoreEntryDto>(t, "PATCH", `/api/lorebooks/${book.id}/entries/${entry.id}`, {
      isConstant: true,
    });
    await json(t, "POST", `/api/lorebooks/${book.id}/bindings`, { scope: "global" });

    const started = await json<{ id: string }>(t, "POST", `/api/scenes/${scene.id}/generate`, {});
    await adapter.started;
    adapter.push("She set the glass down.");
    adapter.end();
    await until(() => t.generation.get(started.id)?.status === "complete");

    const rows = t.ctx.db
      .query("SELECT entry_id, message_id FROM lore_timed_effects")
      .all() as { entry_id: number; message_id: number }[];
    expect(rows.length).toBe(1);

    const entryRow = t.ctx.db
      .query("SELECT id FROM lore_entries WHERE ulid = $u")
      .get({ u: entry.id }) as { id: number };
    expect(rows[0]!.entry_id).toBe(entryRow.id);

    const message = t.ctx.db
      .query("SELECT id FROM messages ORDER BY id DESC LIMIT 1")
      .get() as { id: number };
    expect(rows[0]!.message_id).toBe(message.id);
  });
});
