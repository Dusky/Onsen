import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { V1_CARD, V2_CARD_SILENT, charxCard, jsonBytes, pngCard } from "./card-fixtures.ts";
import {
  cleanRefinement,
  lockCheckQuestion,
  parseVerdict,
  refineQuestion,
  voiceCheckQuestion,
} from "../server/passes/prompts.ts";
import { listTaskRuns } from "../server/db/queries/tasks.ts";
import type {
  AuthorDto,
  CharacterDto,
  ConnectionProfileDto,
  MessageDto,
  PersonaDto,
  SceneDto,
  SceneWithHistoryDto,
  TaskDto,
} from "../shared/types.ts";
import type { GenerationSnapshot } from "../server/generation/service.ts";

/**
 * The post-generation pipeline (SPEC §7.5, §20 phase 14).
 *
 * ReCast's rationale: a model cannot go back once it has committed to a
 * response, but a second model reading the finished text can catch what the
 * first one got wrong. Three rules run through the suite — the pipeline never
 * delays a turn, a pass that cannot be read says nothing, and only one pass
 * rewrites and it keeps the original.
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

async function importCharacter(t: TestHarness, bytes: Uint8Array, filename: string) {
  const form = new FormData();
  form.append("file", new File([bytes as unknown as BlobPart], filename));
  return (
    (await (
      await t.fetch("/api/characters/import", { method: "POST", body: form })
    ).json()) as { character: CharacterDto }
  ).character;
}

async function scene(t: TestHarness) {
  const author = await json<AuthorDto>(t, "POST", "/api/authors", { name: "Kestrel" });
  const persona = await json<PersonaDto>(t, "POST", "/api/personas", {
    name: "Wren",
    description: "A surveyor waiting out the weather.",
  });
  const bell = await importCharacter(t, pngCard({ chara: V2_CARD_SILENT }), "bell.png");
  const aldan = await importCharacter(t, jsonBytes(V1_CARD), "aldan.json");
  const mira = await importCharacter(
    t,
    charxCard({ ...V2_CARD_SILENT, data: { ...V2_CARD_SILENT.data, name: "Mira Vance" } }),
    "mira.charx",
  );

  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "Ridge station",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PATCH", `/api/scenes/${created.id}`, {
    authorId: author.id,
    personaId: persona.id,
  });
  for (const character of [bell, aldan, mira]) {
    await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  }
  await json(t, "POST", `/api/scenes/${created.id}/messages`, {
    kind: "user",
    authorType: "user",
    content: "Has anyone counted the lamp oil?",
  });
  return { sceneId: created.id, persona };
}

async function generate(t: TestHarness, sceneId: string, output: string, body = {}) {
  const started = await json<GenerationSnapshot>(t, "POST", `/api/scenes/${sceneId}/generate`, body);
  await adapter.started;
  adapter.push(output);
  adapter.end();
  await until(() => t.generation.get(started.id)?.status === "complete");
  const messages = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
  return messages.at(-1)!;
}

/** Route each pass to its own scripted answer — they share one adapter. */
function scriptPasses(replies: { voice?: string; lock?: string; refine?: string }) {
  adapter.taskReplyFor = (prompt) => {
    const question = prompt.messages[0]?.content ?? "";
    if (question.startsWith("Does this sound like")) return replies.voice ?? null;
    if (question.includes("belongs to the reader")) return replies.lock ?? null;
    if (question.startsWith("Here is a passage")) return replies.refine ?? null;
    return null;
  };
}

async function enablePasses(t: TestHarness, sceneId: string, keys: string[]) {
  await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, { autoPasses: true });
  for (const key of keys) {
    await json<TaskDto>(t, "PATCH", `/api/tasks/${key}`, { autoTrigger: true });
  }
}

/** The pipeline runs behind the turn, so a test has to wait for it to settle. */
async function settled(t: TestHarness, sceneId: string): Promise<MessageDto> {
  await until(async () => {
    const messages = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    return messages.at(-1)?.passesPending === false;
  });
  return (await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`)).at(-1)!;
}

const BEAT = [
  "**Aldan Roe:** He set the lamp down. \"Two thirds.\"",
  "",
  "**Mira Vance:** \"Two thirds of a barrel is not a number, it is a shrug.\"",
].join("\n");

/* ------------------------------------------------------------------ */
/* The questions and their answers                                     */
/* ------------------------------------------------------------------ */

describe("what each pass asks", () => {
  test("the voice check judges the voice, not the events", () => {
    const question = voiceCheckQuestion({
      character: { name: "Sister Bell", description: "Keeps the chapel.", voiceNotes: "Plain sentences." },
      text: "She said something.",
      earlier: ["Earlier line."],
    });
    expect(question).toContain("Keeps the chapel.");
    expect(question).toContain("Plain sentences.");
    expect(question).toContain("Earlier line.");
    // The distinction that makes the pass useful rather than annoying.
    expect(question).toContain("a character doing something surprising is not drift");
  });

  test("the lock check separates being addressed from being taken over", () => {
    const question = lockCheckQuestion({
      persona: { name: "Wren", description: "A surveyor." },
      text: "She turned to Wren.",
    });
    expect(question).toContain("Wren belongs to the reader");
    expect(question).toContain("speaking *to* Wren, or reacting to something Wren already did, is");
  });

  test("refinement is told to keep everything that happens", () => {
    const question = refineQuestion({ text: "She shrugged.", speaker: "Sister Bell" });
    expect(question).toContain("this is a polish, not a rewrite");
    expect(question).toContain("Keep every event");
  });

  test("a verdict is read from the format, or from a model that ignored it", () => {
    expect(parseVerdict("VERDICT: drifted\nWHY: reads as somebody else.", "drift")).toEqual({
      flagged: true,
      detail: "reads as somebody else.",
    });
    expect(parseVerdict("VERDICT: ok", "drift")).toEqual({ flagged: false, detail: null });
    expect(parseVerdict("drifted, because the rhythm changed", "drift")?.flagged).toBe(true);
  });

  test("an unreadable verdict is not a flag", () => {
    // A pass that shouts because a small model rambled is worse than a quiet one.
    expect(parseVerdict("I'm not sure I can judge that.", "drift")?.flagged).toBe(false);
    expect(parseVerdict("", "drift")).toBeNull();
  });

  test("refinement strips the wrapping a model puts around a passage", () => {
    expect(cleanRefinement("Here is the polished version:\n\nShe shrugged.")).toBe("She shrugged.");
    expect(cleanRefinement('"She shrugged."')).toBe("She shrugged.");
  });
});

/* ------------------------------------------------------------------ */
/* The rule: never delay or fail the turn                              */
/* ------------------------------------------------------------------ */

describe("the pipeline never costs the turn", () => {
  test("the turn lands before any pass has run", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await enablePasses(t, sceneId, ["voice_check"]);
    scriptPasses({ voice: "VERDICT: ok\nWHY: sounds like her." });

    const message = await generate(t, sceneId, "She did not look up.");
    // The message exists the moment the generation completes; §7 forbids three
    // extra model calls sitting in front of every reply.
    expect(message.content).toBe("She did not look up.");
    await settled(t, sceneId);
  });

  test("a failing pass is recorded and the message is untouched", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await enablePasses(t, sceneId, ["voice_check"]);
    adapter.taskFails = true;

    await generate(t, sceneId, "She did not look up.");
    const message = await settled(t, sceneId);
    adapter.taskFails = false;

    expect(message.content).toBe("She did not look up.");
    expect(message.annotations[0]).toMatchObject({ passKey: "voice_check", status: "failed" });
    expect(message.annotations[0]!.detail).toContain("unreachable");
  });

  test("nothing runs when the scene has not asked", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await json<TaskDto>(t, "PATCH", "/api/tasks/voice_check", { autoTrigger: true });
    scriptPasses({ voice: "VERDICT: drifted\nWHY: no." });

    const message = await generate(t, sceneId, "She did not look up.");
    expect(message.annotations).toEqual([]);
    expect(message.passesPending).toBe(false);
  });

  test("a pass not on the automatic list sits out the automatic run", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await enablePasses(t, sceneId, ["voice_check"]);
    scriptPasses({ voice: "VERDICT: ok", lock: "VERDICT: taken\nWHY: it wrote her." });

    await generate(t, sceneId, "She did not look up.");
    const message = await settled(t, sceneId);
    expect(message.annotations.map((note) => note.passKey)).toEqual(["voice_check"]);
  });
});

/* ------------------------------------------------------------------ */
/* Voice validation — the flagship                                     */
/* ------------------------------------------------------------------ */

describe("voice validation", () => {
  test("reads a beat part by part and names which one drifted", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await enablePasses(t, sceneId, ["voice_check"]);
    adapter.taskReplyFor = (prompt) => {
      const question = prompt.messages[0]?.content ?? "";
      if (!question.startsWith("Does this sound like")) return null;
      // Only Mira's part is judged to have drifted.
      return question.includes("Mira Vance")
        ? "VERDICT: drifted\nWHY: that is Aldan's dry register, not hers."
        : "VERDICT: ok\nWHY: sounds like him.";
    };

    await generate(t, sceneId, BEAT, { scope: "beat" });
    const message = await settled(t, sceneId);

    // One annotation per part, and the flagged one carries the ordinal — this
    // is the whole point: not "the exchange felt off" but "this line did".
    const notes = message.annotations.filter((note) => note.passKey === "voice_check");
    expect(notes).toHaveLength(2);
    const flagged = notes.find((note) => note.status === "flagged")!;
    expect(flagged.segmentOrdinal).toBe(1);
    expect(flagged.detail).toContain("Aldan's dry register");
    expect(notes.find((note) => note.status === "ok")!.segmentOrdinal).toBe(0);
  });

  test("a spotlight turn gets one note with no ordinal", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await enablePasses(t, sceneId, ["voice_check"]);
    scriptPasses({ voice: "VERDICT: ok\nWHY: that is her." });

    await generate(t, sceneId, "She did not look up.");
    const message = await settled(t, sceneId);
    expect(message.annotations).toHaveLength(1);
    expect(message.annotations[0]).toMatchObject({ segmentOrdinal: null, status: "ok" });
  });

  test("it is shown what the character said earlier, so the judgement has a reference", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await enablePasses(t, sceneId, ["voice_check"]);
    scriptPasses({ voice: "VERDICT: ok" });

    // The same character twice, so there is something earlier to compare
    // against — the director would otherwise pick somebody else the second time.
    const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);
    const bell = read.scene.cast[0]!.characterId;
    await generate(t, sceneId, "First thing she said.", { characterId: bell });
    await settled(t, sceneId);
    await generate(t, sceneId, "Second thing.", { characterId: bell });
    await settled(t, sceneId);

    const asked = adapter.prompts
      .map((prompt) => prompt.messages[0]?.content ?? "")
      .filter((question) => question.startsWith("Does this sound like"));
    expect(asked.at(-1)).toContain("has said earlier in this scene");
  });

  test("an ok verdict is recorded too", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await enablePasses(t, sceneId, ["voice_check"]);
    scriptPasses({ voice: "VERDICT: ok\nWHY: fine." });

    await generate(t, sceneId, "Fine.");
    const message = await settled(t, sceneId);
    // "The pass ran and was happy" and "the pass never ran" are different
    // things, and a pipeline whose silence is ambiguous is not trusted.
    expect(message.annotations[0]!.status).toBe("ok");
  });
});

/* ------------------------------------------------------------------ */
/* User-lock check                                                     */
/* ------------------------------------------------------------------ */

describe("the user-lock check", () => {
  test("flags rather than rewriting", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await enablePasses(t, sceneId, ["lock_check"]);
    scriptPasses({ lock: 'VERDICT: taken\nWHY: it has Wren saying "fine".' });

    await generate(t, sceneId, 'She looked over. "Fine," said Wren.');
    const message = await settled(t, sceneId);

    // SPEC §7.5 is deliberate: a pass that silently rewrites a turn is a second
    // author nobody hired. The fix is a regeneration the user asks for.
    expect(message.content).toBe('She looked over. "Fine," said Wren.');
    expect(message.annotations[0]).toMatchObject({
      passKey: "lock_check",
      status: "flagged",
      revertable: false,
    });
  });
});

/* ------------------------------------------------------------------ */
/* Prose refinement — the only pass that replaces                      */
/* ------------------------------------------------------------------ */

describe("prose refinement", () => {
  test("replaces the message and keeps the original", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await enablePasses(t, sceneId, ["prose_refine"]);
    scriptPasses({ refine: "She did not look up, and did not stop writing." });

    await generate(t, sceneId, "She did not look up.");
    const message = await settled(t, sceneId);

    expect(message.content).toBe("She did not look up, and did not stop writing.");
    expect(message.annotations[0]).toMatchObject({ status: "revised", revertable: true });
  });

  test("the change can be put back", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await enablePasses(t, sceneId, ["prose_refine"]);
    scriptPasses({ refine: "Something else entirely." });

    await generate(t, sceneId, "The original words.");
    const message = await settled(t, sceneId);
    const note = message.annotations[0]!;

    const reverted = await json<MessageDto>(
      t,
      "POST",
      `/api/scenes/${sceneId}/annotations/${note.id}/revert`,
    );
    expect(reverted.content).toBe("The original words.");
    // A revert is the finding being rejected, not a finding to keep.
    expect(reverted.annotations).toEqual([]);
  });

  test("a refinement that changed nothing is not recorded as a revision", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await enablePasses(t, sceneId, ["prose_refine"]);
    scriptPasses({ refine: "She did not look up." });

    await generate(t, sceneId, "She did not look up.");
    const message = await settled(t, sceneId);
    // A revision nobody can see, with a revert button on it, is noise.
    expect(message.annotations[0]).toMatchObject({ status: "ok", revertable: false });
    expect(message.content).toBe("She did not look up.");
  });

  test("a revised beat is re-parsed, so its parts describe the new text", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await enablePasses(t, sceneId, ["prose_refine"]);
    scriptPasses({
      refine: '**Mira Vance:** "Two thirds is a shrug."\n\n**Aldan Roe:** He wrote it down anyway.',
    });

    await generate(t, sceneId, BEAT, { scope: "beat" });
    const message = await settled(t, sceneId);
    expect(message.segments!.map((segment) => segment.speakerName)).toEqual([
      "Mira Vance",
      "Aldan Roe",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Running them by hand                                                */
/* ------------------------------------------------------------------ */

describe("running the passes by hand", () => {
  test("every enabled pass runs, whether or not it is on the automatic list", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    scriptPasses({
      voice: "VERDICT: ok\nWHY: her.",
      lock: "VERDICT: clear\nWHY: nobody taken.",
      refine: "Polished.",
    });

    const message = await generate(t, sceneId, "Rough.");
    const checked = await json<MessageDto>(
      t,
      "POST",
      `/api/scenes/${sceneId}/messages/${message.id}/passes`,
    );

    // Asked for by hand, so the answer comes back with the response rather than
    // making the user poll for something they just pressed a button for.
    expect(checked.annotations.map((note) => note.passKey)).toEqual([
      "voice_check",
      "lock_check",
      "prose_refine",
    ]);
    expect(checked.content).toBe("Polished.");
  });

  test("a disabled pass stays out of it", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await json<TaskDto>(t, "PATCH", "/api/tasks/prose_refine", { enabled: false });
    scriptPasses({ voice: "VERDICT: ok", lock: "VERDICT: clear" });

    const message = await generate(t, sceneId, "Rough.");
    const checked = await json<MessageDto>(
      t,
      "POST",
      `/api/scenes/${sceneId}/messages/${message.id}/passes`,
    );
    expect(checked.annotations.map((note) => note.passKey)).toEqual(["voice_check", "lock_check"]);
    expect(checked.content).toBe("Rough.");
  });

  test("running twice leaves one verdict per pass, not a pile", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    scriptPasses({ voice: "VERDICT: ok", lock: "VERDICT: clear", refine: "Polished." });

    const message = await generate(t, sceneId, "Rough.");
    await json(t, "POST", `/api/scenes/${sceneId}/messages/${message.id}/passes`);
    const twice = await json<MessageDto>(
      t,
      "POST",
      `/api/scenes/${sceneId}/messages/${message.id}/passes`,
    );
    expect(twice.annotations.filter((note) => note.passKey === "voice_check")).toHaveLength(1);
  });

  test("refuses to read the reader's own message", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const own = (await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`))[0]!;
    expect(
      await statusOf(t, "POST", `/api/scenes/${sceneId}/messages/${own.id}/passes`),
    ).toBe(400);
  });

  test("reverting something that changed nothing is refused", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    scriptPasses({ voice: "VERDICT: ok" });
    await json<TaskDto>(t, "PATCH", "/api/tasks/lock_check", { enabled: false });
    await json<TaskDto>(t, "PATCH", "/api/tasks/prose_refine", { enabled: false });

    const message = await generate(t, sceneId, "Rough.");
    const checked = await json<MessageDto>(
      t,
      "POST",
      `/api/scenes/${sceneId}/messages/${message.id}/passes`,
    );
    expect(
      await statusOf(
        t,
        "POST",
        `/api/scenes/${sceneId}/annotations/${checked.annotations[0]!.id}/revert`,
      ),
    ).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
/* The log                                                             */
/* ------------------------------------------------------------------ */

describe("passes are side calls like any other", () => {
  test("each run reaches the task log", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    scriptPasses({ voice: "VERDICT: ok\nWHY: her." });
    await json<TaskDto>(t, "PATCH", "/api/tasks/lock_check", { enabled: false });
    await json<TaskDto>(t, "PATCH", "/api/tasks/prose_refine", { enabled: false });

    const message = await generate(t, sceneId, "Rough.");
    await json(t, "POST", `/api/scenes/${sceneId}/messages/${message.id}/passes`);

    const runs = listTaskRuns(t.ctx.db, "voice_check");
    expect(runs[0]).toMatchObject({ status: "ok" });
    expect(runs[0]!.prompt).toContain("Does this sound like");
  });

  test("a pass can be routed at its own model", async () => {
    const t = await signedIn();
    const routed = await json<TaskDto>(t, "PATCH", "/api/tasks/voice_check", {
      autoTrigger: true,
    });
    expect(routed.autoTrigger).toBe(true);
    expect(routed.effect).toBe("flag");
    expect(routed.stage).toBe("post_generation");
  });

  test("the scene says whether it runs them unasked", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    const on = await json<SceneDto>(t, "PATCH", `/api/scenes/${sceneId}`, { autoPasses: true });
    expect(on.autoPasses).toBe(true);
    const read = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${sceneId}`);
    expect(read.scene.autoPasses).toBe(true);
  });
});
