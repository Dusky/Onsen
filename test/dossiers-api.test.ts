import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import type { CharacterDto, ConnectionProfileDto, SceneDto } from "../shared/types.ts";

/**
 * Dossiers through the real system (SPEC §11, §20 phase 32).
 *
 * The design's whole claim is that a dossier is two things at once — an
 * editable record, and a lore entry that reaches the prompt by §10's relevance
 * rules. So what these test is the seam: that an edit reaches the prompt, that
 * the entry never drifts from the fields, and that the buried tier does not
 * travel.
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

async function scene(t: TestHarness) {
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
  for (const line of [
    "Hollis poured without being asked.",
    "Hollis said the pass was closed until spring.",
    "I asked Hollis what it would take.",
  ]) {
    await json(t, "POST", `/api/scenes/${created.id}/messages`, {
      kind: "user",
      authorType: "user",
      content: line,
    });
  }
  return created.id;
}

interface DossierDto {
  id: string;
  name: string;
  role: string;
  knowledge: { public: string; private: string; buried: string };
  injected: string;
  promoted: boolean;
  entry: { id: string; content: string; keys: string[]; enabled: boolean } | null;
}

const FULL = {
  name: "Hollis",
  role: "Keeps the inn at the pass.",
  voice: "Short sentences. Never asks twice.",
  canonLock: "Has a limp from the winter.",
  standing: "Wary but civil.",
  knowledge: { public: "Runs the inn.", private: "Knows the pass is open.", buried: "Took the bribe." },
};

describe("noticing who recurs", () => {
  test("a name the scene keeps returning to is offered", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const found = await json<{ names: { name: string; mentions: number }[] }>(
      t,
      "GET",
      `/api/authoring/scenes/${sceneId}/recurring?threshold=3`,
    );
    expect(found.names.map((row) => row.name)).toContain("Hollis");
  });

  test("someone who already has a dossier is not offered again", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    await json<DossierDto>(t, "POST", `/api/dossiers/scenes/${sceneId}`, FULL);
    const found = await json<{ names: { name: string }[] }>(
      t,
      "GET",
      `/api/authoring/scenes/${sceneId}/recurring?threshold=3`,
    );
    expect(found.names.map((row) => row.name)).not.toContain("Hollis");
  });
});

describe("the record and the entry", () => {
  test("saving one renders a lore entry keyed on the name", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const made = await json<DossierDto>(t, "POST", `/api/dossiers/scenes/${sceneId}`, FULL);

    expect(made.entry).not.toBeNull();
    expect(made.entry!.keys).toEqual(["Hollis"]);
    expect(made.entry!.enabled).toBe(true);
    expect(made.entry!.content).toContain("Keeps the inn at the pass.");
  });

  test("the buried tier is kept but never rendered", async () => {
    // §11 tiers knowledge into public, private and buried. Buried means the
    // author knows it and has not revealed it; putting it in the prompt every
    // time the name is mentioned is exactly how a secret gets spoken aloud.
    const t = await signedIn();
    const sceneId = await scene(t);
    const made = await json<DossierDto>(t, "POST", `/api/dossiers/scenes/${sceneId}`, FULL);

    expect(made.knowledge.buried).toBe("Took the bribe.");
    expect(made.injected).not.toContain("bribe");
    expect(made.entry!.content).not.toContain("bribe");
    // The two tiers that are not secret do travel.
    expect(made.entry!.content).toContain("Runs the inn.");
    expect(made.entry!.content).toContain("Knows the pass is open.");
  });

  test("an edit reaches the entry, because the entry is derived", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const made = await json<DossierDto>(t, "POST", `/api/dossiers/scenes/${sceneId}`, FULL);
    const edited = await json<DossierDto>(t, "PATCH", `/api/dossiers/${made.id}`, {
      role: "Keeps the inn, and the road tolls.",
    });

    expect(edited.entry!.content).toContain("and the road tolls");
    expect(edited.entry!.content).not.toContain("Keeps the inn at the pass.");
    // Same entry, rewritten — not a second one left beside the first.
    expect(edited.entry!.id).toBe(made.entry!.id);
  });

  test("two dossiers for one name are refused", async () => {
    // Both would render entries keyed on the same name, and the reader would
    // edit one and be confused by the other.
    const t = await signedIn();
    const sceneId = await scene(t);
    await json<DossierDto>(t, "POST", `/api/dossiers/scenes/${sceneId}`, FULL);
    expect(await statusOf(t, "POST", `/api/dossiers/scenes/${sceneId}`, FULL)).toBe(409);
  });

  test("deleting one takes its entry with it", async () => {
    // The foreign key runs the other way — the dossier points at the entry — so
    // nothing collects it, and an orphan keyed on a name still fires.
    const t = await signedIn();
    const sceneId = await scene(t);
    const made = await json<DossierDto>(t, "POST", `/api/dossiers/scenes/${sceneId}`, FULL);
    const books = await json<{ id: string; name: string }[]>(t, "GET", "/api/lorebooks");
    const book = books.find((row) => row.name === "Dossiers")!;

    expect(await statusOf(t, "DELETE", `/api/dossiers/${made.id}`)).toBe(200);
    const after = await json<{ entries: unknown[] }>(t, "GET", `/api/lorebooks/${book.id}`);
    expect(after.entries).toHaveLength(0);
  });
});

describe("promotion", () => {
  test("a dossier becomes a character, and stops being injected", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const made = await json<DossierDto>(t, "POST", `/api/dossiers/scenes/${sceneId}`, FULL);

    const promoted = await json<{ character: CharacterDto; dossier: DossierDto }>(
      t,
      "POST",
      `/api/dossiers/${made.id}/promote`,
    );
    expect(promoted.character.name).toBe("Hollis");
    expect(promoted.character.description).toBe("Keeps the inn at the pass.");
    // The card is the author's own reference, so the buried tier travels there.
    expect(promoted.character.personality).toContain("Took the bribe.");

    // And the entry is off: the card now carries the same material, and two
    // copies of one character in a prompt is the failure this avoids.
    expect(promoted.dossier.promoted).toBe(true);
    expect(promoted.dossier.entry!.enabled).toBe(false);
  });

  test("promoting twice is refused", async () => {
    const t = await signedIn();
    const sceneId = await scene(t);
    const made = await json<DossierDto>(t, "POST", `/api/dossiers/scenes/${sceneId}`, FULL);
    await json(t, "POST", `/api/dossiers/${made.id}/promote`);
    expect(await statusOf(t, "POST", `/api/dossiers/${made.id}/promote`)).toBe(409);
  });
});

describe("what reaches the prompt", () => {
  test("the dossier fires when its name is mentioned, and not otherwise", async () => {
    // The whole reason a dossier is a lore entry: §10's relevance rules, not a
    // second injection path written for this feature.
    const t = await signedIn();
    const sceneId = await scene(t);
    await json<DossierDto>(t, "POST", `/api/dossiers/scenes/${sceneId}`, FULL);

    const trace = await json<{ title: string; skipped: string | null; matchedKey: string | null }[]>(
      t,
      "GET",
      `/api/scenes/${sceneId}/lore`,
    );
    const row = trace.find((entry) => entry.title === "Hollis");
    expect(row).toBeDefined();
    expect(row!.skipped).toBeNull();
    expect(row!.matchedKey).toBe("Hollis");
  });
});
