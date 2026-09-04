import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import { parseNote } from "../server/memory/author.ts";
import type { AuthorDto, CharacterDto, ConnectionProfileDto, SceneDto } from "../shared/types.ts";

/**
 * Author memory (SPEC §11, §20 phase 39).
 *
 * §11's whole design is one sentence: "a lorebook with `owner_author_id` set,
 * so it reuses keyword activation, budgeting, and the editor". So what these
 * test is that it really is a lorebook — that an entry the author wrote
 * activates by §10's ordinary keyword rules and reaches a prompt — and that
 * the posture §11 insists on holds: strictly opt-in, never unasked.
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

interface Setup {
  sceneId: string;
  authorId: string;
}

async function scene(t: TestHarness): Promise<Setup> {
  const form = new FormData();
  form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
  const { character } = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };
  const author = await json<AuthorDto>(t, "POST", "/api/authors", { name: "Kestrel" });
  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "The pass",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  await json<SceneDto>(t, "PATCH", `/api/scenes/${created.id}`, { authorId: author.id });
  for (const line of ["We never did find out who paid.", "The pass is closed until spring."]) {
    await json(t, "POST", `/api/scenes/${created.id}/messages`, {
      kind: "user",
      authorType: "user",
      content: line,
    });
  }
  return { sceneId: created.id, authorId: author.id };
}

interface MemoryDto {
  enabled: boolean;
  bookId: string | null;
  entries: {
    id: string;
    title: string;
    content: string;
    keys: string[];
    writtenByAuthor: boolean;
    writtenInScene: string | null;
  }[];
}

const NOTE = JSON.stringify({
  title: "Who paid",
  keys: ["paid", "bribe"],
  content: "We never found out who paid off the road crew. They still wonder about it.",
});

describe("reading the author's answer", () => {
  test("the ordinary shape", () => {
    const note = parseNote(NOTE)!;
    expect(note.title).toBe("Who paid");
    expect(note.keys).toEqual(["paid", "bribe"]);
  });

  test("prose around the JSON is a habit, not a failure", () => {
    const note = parseNote('Sure!\n```json\n' + NOTE + '\n```')!;
    expect(note.title).toBe("Who paid");
  });

  test("a note with no keys still gets one, or it would never activate", () => {
    const note = parseNote(JSON.stringify({ title: "Who paid", content: "They wonder." }))!;
    // An entry with no keys is a note nobody ever sees again. The title is a
    // worse key than a considered one and a far better one than none.
    expect(note.keys).toEqual(["Who paid"]);
  });

  test("a reply with nothing in it is nothing", () => {
    expect(parseNote("I have nothing to add.")).toBeNull();
    expect(parseNote(JSON.stringify({ title: "x", content: "" }))).toBeNull();
  });
});

describe("the posture §11 insists on", () => {
  test("is off until asked for, and remembering is refused until then", async () => {
    const t = await signedIn();
    const { sceneId, authorId } = await scene(t);
    expect((await json<MemoryDto>(t, "GET", `/api/memory/authors/${authorId}`)).enabled).toBe(false);
    // "An author that silently accumulates notes about the user is a different
    // product with different expectations."
    expect(
      await statusOf(t, "POST", `/api/memory/authors/${authorId}/remember`, { sceneId }),
    ).toBe(400);
  });

  test("the book is made on first use, not at author creation", async () => {
    const t = await signedIn();
    const { authorId } = await scene(t);
    await json(t, "PATCH", `/api/memory/authors/${authorId}`, { enabled: true });
    // A book that existed from the start would appear in the lorebooks list as
    // an empty thing the reader did not make and cannot explain.
    expect((await json<MemoryDto>(t, "GET", `/api/memory/authors/${authorId}`)).bookId).toBeNull();
    expect(await json<{ id: string }[]>(t, "GET", "/api/lorebooks")).toHaveLength(0);
  });

  test("never runs unasked", async () => {
    const t = await signedIn();
    const { sceneId, authorId } = await scene(t);
    await json(t, "PATCH", `/api/memory/authors/${authorId}`, { enabled: true });

    adapter.taskReply = NOTE;
    const snapshot = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await adapter.started;
    adapter.push("She said nothing about it.");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    // A whole turn, with the op configured and memory on. Still nothing:
    // §11's opt-in means the reader asks, every time.
    expect((await json<MemoryDto>(t, "GET", `/api/memory/authors/${authorId}`)).entries).toEqual([]);
  });
});

describe("remembering", () => {
  async function ready(t: TestHarness): Promise<Setup> {
    const setup = await scene(t);
    await json(t, "PATCH", `/api/memory/authors/${setup.authorId}`, { enabled: true });
    return setup;
  }

  test("writes a note with provenance and a way back to its scene", async () => {
    const t = await signedIn();
    const { sceneId, authorId } = await ready(t);
    adapter.taskReply = NOTE;

    const result = await json<{ note: { title: string } | null }>(
      t,
      "POST",
      `/api/memory/authors/${authorId}/remember`,
      { sceneId },
    );
    expect(result.note?.title).toBe("Who paid");

    const memory = await json<MemoryDto>(t, "GET", `/api/memory/authors/${authorId}`);
    expect(memory.entries).toHaveLength(1);
    const entry = memory.entries[0]!;
    expect(entry.keys).toEqual(["paid", "bribe"]);
    // §11: "provenance showing the author wrote it".
    expect(entry.writtenByAuthor).toBe(true);
    expect(entry.writtenInScene).toBe("The pass");
  });

  test("it really is a lorebook — the note activates by §10's own rules", async () => {
    const t = await signedIn();
    const { sceneId, authorId } = await ready(t);
    adapter.taskReply = NOTE;
    await json(t, "POST", `/api/memory/authors/${authorId}/remember`, { sceneId });
    adapter.taskReply = null;

    // A message carrying one of the note's keys. Nothing here binds the book to
    // this scene: ownership is the binding, which is the point.
    await json(t, "POST", `/api/scenes/${sceneId}/messages`, {
      kind: "user",
      authorType: "user",
      content: "Do you remember who paid?",
    });

    const before = adapter.prompts.length;
    const snapshot = await json<{ id: string }>(t, "POST", `/api/scenes/${sceneId}/generate`, {});
    await adapter.started;
    adapter.push("She looked away.");
    adapter.end();
    await until(() => t.generation.get(snapshot.id)?.status === "complete");

    expect(JSON.stringify(adapter.prompts[before])).toContain("who paid off the road crew");
  });

  test("a roleplay with a different partner is refused", async () => {
    const t = await signedIn();
    const { sceneId, authorId } = await ready(t);
    const other = await json<AuthorDto>(t, "POST", "/api/authors", { name: "Wren" });
    await json(t, "PATCH", `/api/memory/authors/${other.id}`, { enabled: true });
    expect(
      await statusOf(t, "POST", `/api/memory/authors/${other.id}/remember`, { sceneId }),
    ).toBe(400);
  });

  test("a reply it cannot read writes nothing", async () => {
    const t = await signedIn();
    const { sceneId, authorId } = await ready(t);
    adapter.taskReply = "I'd rather not.";
    const result = await json<{ note: unknown }>(
      t,
      "POST",
      `/api/memory/authors/${authorId}/remember`,
      { sceneId },
    );
    expect(result.note).toBeNull();
    expect((await json<MemoryDto>(t, "GET", `/api/memory/authors/${authorId}`)).entries).toEqual([]);
  });
});

describe("the wipe §11 asks for", () => {
  test("empties the book and keeps it", async () => {
    const t = await signedIn();
    const { sceneId, authorId } = await scene(t);
    await json(t, "PATCH", `/api/memory/authors/${authorId}`, { enabled: true });
    adapter.taskReply = NOTE;
    await json(t, "POST", `/api/memory/authors/${authorId}/remember`, { sceneId });

    const removed = await json<{ removed: number }>(
      t,
      "DELETE",
      `/api/memory/authors/${authorId}/entries`,
    );
    expect(removed.removed).toBe(1);

    const after = await json<MemoryDto>(t, "GET", `/api/memory/authors/${authorId}`);
    expect(after.entries).toEqual([]);
    // The book survives, so the next note does not have to remake it and the
    // budget the reader set is still there.
    expect(after.bookId).not.toBeNull();
  });

  test("deleting the partner takes the book with it", async () => {
    const t = await signedIn();
    const { sceneId, authorId } = await scene(t);
    await json(t, "PATCH", `/api/memory/authors/${authorId}`, { enabled: true });
    adapter.taskReply = NOTE;
    await json(t, "POST", `/api/memory/authors/${authorId}/remember`, { sceneId });
    expect(await json<{ id: string }[]>(t, "GET", "/api/lorebooks")).toHaveLength(1);

    await t.fetch(`/api/authors/${authorId}`, { method: "DELETE" });
    expect(await json<{ id: string }[]>(t, "GET", "/api/lorebooks")).toEqual([]);
  });
});
