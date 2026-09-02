import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { charxCard, pngCard, V2_CARD } from "./card-fixtures.ts";
import {
  parseDeclaredExpression,
  splitExpr,
  type DeclaredExpression,
} from "../server/generation/expression.ts";
import type {
  CharacterDto,
  ConnectionProfileDto,
  ExpressionPackDto,
  MessageDto,
  SceneDto,
  SceneWithHistoryDto,
} from "../shared/types.ts";

/**
 * Expressions, sprite packs and VN staging (SPEC §12, §20 phase 29).
 *
 * The parser's promise is read first — the tag is lifted, never leaked — and
 * then again through a real generation, where the stripped prose lands on the
 * message and the label lands on the message or the segment it named.
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

async function importCard(t: TestHarness, bytes: Uint8Array, filename: string): Promise<CharacterDto> {
  const form = new FormData();
  form.append("file", new File([bytes as unknown as BlobPart], filename));
  const body = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };
  return body.character;
}

describe("the expression parser (pure)", () => {
  test("reads a labelled and an unlabelled tag", () => {
    expect(parseDeclaredExpression("ana:worried")).toEqual({ character: "ana", label: "worried" });
    expect(parseDeclaredExpression("worried")).toEqual({ character: null, label: "worried" });
    expect(parseDeclaredExpression("Joy")).toEqual({ character: null, label: "joy" });
    expect(parseDeclaredExpression("")).toBe(null);
    expect(parseDeclaredExpression(":")).toBe(null);
  });

  test("strips a tag and keeps an unclosed one as prose", () => {
    const split = splitExpr("She <expr>worried</expr>watched the road.");
    expect(split.prose).toBe("She watched the road.");
    expect(split.expressions).toEqual([{ character: null, label: "worried" }] satisfies DeclaredExpression[]);

    const open = splitExpr("She <expr>worried watched the road.");
    expect(open.prose).toBe("She <expr>worried watched the road.");
    expect(open.expressions).toEqual([]);
  });
});

describe("expressions through a generation (SPEC §12)", () => {
  test("a spotlight turn keeps the prose and stores the label", async () => {
    const t = await signedIn();
    const bell = await importCard(t, pngCard({ chara: V2_CARD }), "bell.png");
    const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    const scene = await json<SceneDto>(t, "POST", "/api/scenes", {
      title: "Ridge",
      connectionProfileId: profiles[0]!.id,
    });
    await json<SceneDto>(t, "PUT", `/api/scenes/${scene.id}/cast/${bell.id}`);

    // The tag is split across chunks to prove the stream is the single-token
    // path, not a whole-string afterthought.
    adapter.push("<expr>wor");
    adapter.push("ried</expr>She watched the road.");
    adapter.end();
    const generation = await json<{ id: string }>(t, "POST", `/api/scenes/${scene.id}/generate`, {});
    await until(async () => {
      const snapshot = await json<{ status: string }>(t, "GET", `/api/generations/${generation.id}`);
      return snapshot.status === "complete";
    });

    const history = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    const message = history.messages.at(-1)!;
    expect(message.content).toBe("She watched the road.");
    expect(message.expression).toBe("worried");
  });

  test("a beat's tags land on the segment they name", async () => {
    const t = await signedIn();
    const bell = await importCard(t, pngCard({ chara: V2_CARD }), "bell.png");
    const aldan = await importCard(
      t,
      charxCard({ ...V2_CARD, data: { ...V2_CARD.data, name: "Aldan Marsh" } }),
      "aldan.charx",
    );
    const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
    const scene = await json<SceneDto>(t, "POST", "/api/scenes", {
      title: "Two of them",
      connectionProfileId: profiles[0]!.id,
    });
    await json<SceneDto>(t, "PUT", `/api/scenes/${scene.id}/cast/${bell.id}`);
    await json<SceneDto>(t, "PUT", `/api/scenes/${scene.id}/cast/${aldan.id}`);

    adapter.push("<expr>Aldan Marsh:grim</expr>\nSister Bell: The road is quiet.\nAldan Marsh: Too quiet.");
    adapter.end();
    const generation = await json<{ id: string }>(t, "POST", `/api/scenes/${scene.id}/generate`, {
      scope: "beat",
    });
    await until(async () => {
      const snapshot = await json<{ status: string }>(t, "GET", `/api/generations/${generation.id}`);
      return snapshot.status === "complete";
    });

    const history = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    const message = history.messages.at(-1)!;
    expect(message.kind).toBe("beat");
    // The tag never leaks into the text.
    expect(message.content).not.toContain("<expr>");
    const aldanSegment = message.segments?.find((segment) => segment.speakerName === "Aldan Marsh");
    expect(aldanSegment?.expression).toBe("grim");
  });
});

describe("sprite packs (SPEC §12)", () => {
  test("upload, list, serve and delete a labelled sprite", async () => {
    const t = await signedIn();
    const bell = await importCard(t, pngCard({ chara: V2_CARD }), "bell.png");
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

    const form = new FormData();
    form.append("label", "worried");
    form.append("file", new File([bytes as unknown as BlobPart], "worried.png"));
    await t.fetch(`/api/characters/${bell.id}/expressions`, { method: "POST", body: form });

    const pack = await json<ExpressionPackDto>(t, "GET", `/api/characters/${bell.id}/expressions`);
    expect(pack.expressions.map((entry) => entry.label)).toEqual(["worried"]);
    const expression = pack.expressions[0]!;

    const image = await t.fetch(`/api/characters/expressions/${expression.id}/image`);
    expect(image.status).toBe(200);

    expect((await t.fetch(`/api/characters/expressions/${expression.id}`, { method: "DELETE" })).status).toBe(204);
    const after = await json<ExpressionPackDto>(t, "GET", `/api/characters/${bell.id}/expressions`);
    expect(after.expressions).toEqual([]);
  });
});

describe("visual novel mode (SPEC §12)", () => {
  test("a scene toggles staging and takes a background", async () => {
    const t = await signedIn();
    const scene = await json<SceneDto>(t, "POST", "/api/scenes", { title: "Stage" });
    expect(scene.vnModeEnabled).toBe(false);

    const toggled = await json<SceneDto>(t, "PATCH", `/api/scenes/${scene.id}`, {
      vnModeEnabled: true,
    });
    expect(toggled.vnModeEnabled).toBe(true);
    expect(toggled.hasBackground).toBe(false);

    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3, 4]) as unknown as BlobPart], "bg.png"));
    const upload = await t.fetch(`/api/scenes/${scene.id}/background`, { method: "POST", body: form });
    expect(upload.status).toBe(200);
    const uploaded = (await upload.json()) as SceneDto;
    expect(uploaded.hasBackground).toBe(true);

    const final = await json<SceneWithHistoryDto>(t, "GET", `/api/scenes/${scene.id}`);
    expect(final.scene.hasBackground).toBe(true);

    const image = await t.fetch(`/api/scenes/${scene.id}/background`);
    expect(image.status).toBe(200);
  });
});
