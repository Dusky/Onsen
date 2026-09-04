import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, until, type TestHarness } from "./helpers.ts";
import { V2_CARD_SILENT, pngCard } from "./card-fixtures.ts";
import { WARNING_HEADER } from "../server/openai/double-assembly.ts";
import type { CharacterDto, ConnectionProfileDto, MessageDto, SceneDto } from "../shared/types.ts";

/**
 * The outbound OpenAI-compatible API through the real system (SPEC §19).
 *
 * The claim being tested is §19's own: another client can address a configured
 * scene as if it were a model, and the server runs the whole pipeline behind
 * it — creating ordinary message nodes in the tree, which is what makes the
 * phone-to-terminal handoff work rather than merely sound good.
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

/** A request the way an external client makes one: bearer token, no cookie. */
async function call(
  t: TestHarness,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<Response> {
  return t.app.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function scene(t: TestHarness): Promise<{ sceneId: string; characterName: string }> {
  const form = new FormData();
  form.append("file", new File([pngCard({ chara: V2_CARD_SILENT }) as unknown as BlobPart], "bell.png"));
  const { character } = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };
  const profiles = await json<ConnectionProfileDto[]>(t, "GET", "/api/connections/profiles");
  const created = await json<SceneDto>(t, "POST", "/api/scenes", {
    title: "The pass",
    connectionProfileId: profiles[0]!.id,
  });
  await json<SceneDto>(t, "PUT", `/api/scenes/${created.id}/cast/${character.id}`);
  return { sceneId: created.id, characterName: character.name };
}

async function enable(t: TestHarness, sceneId: string) {
  return json<{ enabled: boolean; slug: string; modelId: string }>(
    t,
    "PATCH",
    `/api/scene-api/${sceneId}`,
    { enabled: true },
  );
}

function mintKey(t: TestHarness, over: Record<string, unknown> = {}) {
  return json<{ id: string; token: string; hint: string }>(t, "POST", "/api/api-keys", {
    name: "A terminal",
    ...over,
  });
}

describe("auth", () => {
  test("no token is refused, in OpenAI's error shape so an SDK can read it", async () => {
    const t = await signedIn();
    const response = await call(t, "/v1/models", null);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { message: string; type: string } };
    expect(body.error.type).toBe("invalid_request_error");
  });

  test("a wrong token is refused, and a revoked one stops working", async () => {
    const t = await signedIn();
    const key = await mintKey(t);
    expect((await call(t, "/v1/models", "onsen_nonsense")).status).toBe(401);
    expect((await call(t, "/v1/models", key.token)).status).toBe(200);

    await json(t, "POST", `/api/api-keys/${key.id}/revoke`, {});
    expect((await call(t, "/v1/models", key.token)).status).toBe(401);
  });

  test("the token is returned once and is not readable afterwards", async () => {
    const t = await signedIn();
    const key = await mintKey(t);
    const listed = await json<{ hint: string }[]>(t, "GET", "/api/api-keys");
    expect(JSON.stringify(listed)).not.toContain(key.token);
    // Enough to recognise it in a list, far too little to reconstruct one.
    expect(key.token.startsWith(listed[0]!.hint)).toBe(true);
  });

  test("a session cookie does not open this surface", async () => {
    const t = await signedIn();
    // `t.fetch` carries the cookie the wizard set; `/v1` must not care.
    const response = await t.fetch("/v1/models");
    expect(response.status).toBe(401);
  });
});

describe("what it answers to", () => {
  test("a scene appears only once it has opted in", async () => {
    const t = await signedIn();
    const { sceneId, characterName } = await scene(t);
    const key = await mintKey(t);

    let listed = (await (await call(t, "/v1/models", key.token)).json()) as { data: { id: string }[] };
    expect(listed.data).toEqual([]);

    const enabled = await enable(t, sceneId);
    expect(enabled.modelId).toBe("scene/the-pass");

    listed = (await (await call(t, "/v1/models", key.token)).json()) as { data: { id: string }[] };
    const ids = listed.data.map((model) => model.id);
    expect(ids).toContain("scene/the-pass");
    // A forced speaker per cast member, because `scene/<slug>/<char>` is only
    // usable if a client can discover the names.
    expect(ids).toContain(
      `scene/the-pass/${characterName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    );
  });

  test("a key scoped to one roleplay is not told about the others", async () => {
    const t = await signedIn();
    const mine = await scene(t);
    const theirs = await scene(t);
    await enable(t, mine.sceneId);
    await enable(t, theirs.sceneId);
    const key = await mintKey(t, { sceneId: mine.sceneId });

    const listed = (await (await call(t, "/v1/models", key.token)).json()) as {
      data: { id: string }[];
    };
    // Only the scene this key can open. Listing the other would be telling the
    // holder about a roleplay it cannot reach — both a leak and a lie.
    const slugs = new Set(listed.data.map((model) => model.id.split("/")[1]));
    expect(slugs).toEqual(new Set(["the-pass"]));
  });

  test("a model this install does not answer to is a 404 naming the fix", async () => {
    const t = await signedIn();
    const key = await mintKey(t);
    const response = await call(t, "/v1/chat/completions", key.token, {
      model: "gpt-4",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("/v1/models");
  });

  test("a key scoped elsewhere cannot open this roleplay", async () => {
    const t = await signedIn();
    const mine = await scene(t);
    const theirs = await scene(t);
    // `theirs` opts in first, so it takes the plain slug; the key is scoped to
    // the other one.
    await enable(t, theirs.sceneId);
    const key = await mintKey(t, { sceneId: mine.sceneId });

    const response = await call(t, "/v1/chat/completions", key.token, {
      model: "scene/the-pass",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(response.status).toBe(403);
  });
});

describe("a completion", () => {
  async function ready(t: TestHarness) {
    const { sceneId } = await scene(t);
    await enable(t, sceneId);
    const key = await mintKey(t);
    return { sceneId, token: key.token };
  }

  test("runs the pipeline and lands an ordinary turn in the tree", async () => {
    const t = await signedIn();
    const { sceneId, token } = await ready(t);

    const pending = call(t, "/v1/chat/completions", token, {
      model: "scene/the-pass",
      messages: [{ role: "user", content: "is the pass open?" }],
    });
    await adapter.started;
    adapter.push("She shook her head. Not until the thaw.");
    adapter.end();

    const response = await pending;
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      object: string;
      choices: { message: { role: string; content: string }; finish_reason: string }[];
      usage: { completion_tokens: number };
    };
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0]?.message.role).toBe("assistant");
    expect(body.choices[0]?.message.content).toBe("She shook her head. Not until the thaw.");
    expect(body.choices[0]?.finish_reason).toBe("stop");

    // This is §19's payoff: the turn is in the tree, so a browser with the
    // scene open sees it over §5's head sync rather than as a separate world.
    const path = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    expect(path.map((message) => message.content)).toEqual([
      "is the pass open?",
      "She shook her head. Not until the thaw.",
    ]);
    expect(path[1]?.authorType).toBe("character");
  });

  test("streams in OpenAI's shape, deltas and a [DONE]", async () => {
    const t = await signedIn();
    const { token } = await ready(t);

    const pending = call(t, "/v1/chat/completions", token, {
      model: "scene/the-pass",
      stream: true,
      messages: [{ role: "user", content: "go on" }],
    });
    const response = await pending;
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    await adapter.started;
    adapter.push("She set ");
    adapter.push("the glass down.");
    adapter.end();

    const text = await response.text();
    const frames = text
      .split("\n\n")
      .filter((frame) => frame.startsWith("data: "))
      .map((frame) => frame.slice(6));
    expect(frames.at(-1)).toBe("[DONE]");

    const chunks = frames.slice(0, -1).map((frame) => JSON.parse(frame) as {
      object: string;
      choices: { delta: { role?: string; content?: string }; finish_reason: string | null }[];
    });
    expect(chunks[0]?.choices[0]?.delta.role).toBe("assistant");
    // Deltas out, not the absolute offsets this app streams internally.
    const content = chunks.map((chunk) => chunk.choices[0]?.delta.content ?? "").join("");
    expect(content).toBe("She set the glass down.");
    expect(chunks.at(-1)?.choices[0]?.finish_reason).toBe("stop");
  });

  test("only the last user message is taken; the rest of the array is ignored", async () => {
    const t = await signedIn();
    const { sceneId, token } = await ready(t);

    const pending = call(t, "/v1/chat/completions", token, {
      model: "scene/the-pass",
      messages: [
        { role: "user", content: "a line the client remembers" },
        { role: "assistant", content: "a reply the client remembers" },
        { role: "user", content: "the only one that counts" },
      ],
    });
    await adapter.started;
    adapter.push("Understood.");
    adapter.end();
    await pending;

    // `last_message` keeps the tree canonical: what the client thinks the
    // history is does not get written into it.
    const path = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    expect(path.map((message) => message.content)).toEqual([
      "the only one that counts",
      "Understood.",
    ]);
  });

  test("content sent as OpenAI's array-of-parts is understood", async () => {
    const t = await signedIn();
    const { sceneId, token } = await ready(t);
    const pending = call(t, "/v1/chat/completions", token, {
      model: "scene/the-pass",
      messages: [{ role: "user", content: [{ type: "text", text: "parts, not a string" }] }],
    });
    await adapter.started;
    adapter.push("Fine.");
    adapter.end();
    await pending;

    const path = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    expect(path[0]?.content).toBe("parts, not a string");
  });
});

describe("inline ops over the wire", () => {
  async function ready(t: TestHarness) {
    const { sceneId } = await scene(t);
    await enable(t, sceneId);
    const key = await mintKey(t);
    return { sceneId, token: key.token };
  }

  test("a command is acted on and stripped from what enters history", async () => {
    const t = await signedIn();
    const { sceneId, token } = await ready(t);

    const before = adapter.prompts.length;
    const pending = call(t, "/v1/chat/completions", token, {
      model: "scene/the-pass",
      messages: [
        { role: "user", content: "She opens the door. ((nudge: she is getting suspicious))" },
      ],
    });
    await adapter.started;
    adapter.push("Fine.");
    adapter.end();
    await pending;

    const path = await json<MessageDto[]>(t, "GET", `/api/scenes/${sceneId}/messages`);
    expect(path[0]?.content).toBe("She opens the door.");
    // The nudge reached the prompt rather than the log — which is what a nudge
    // is (§7): direction for one turn that never becomes a message.
    expect(JSON.stringify(adapter.prompts[before])).toContain("getting suspicious");
  });

  test("a steer is scene state, so it outlives the turn", async () => {
    const t = await signedIn();
    const { sceneId, token } = await ready(t);

    const pending = call(t, "/v1/chat/completions", token, {
      model: "scene/the-pass",
      messages: [{ role: "user", content: "((steer: slow the pacing)) go on" }],
    });
    await adapter.started;
    adapter.push("Fine.");
    adapter.end();
    await pending;

    const withHistory = await json<{ scene: SceneDto }>(t, "GET", `/api/scenes/${sceneId}`);
    expect(withHistory.scene.directorNote).toBe("slow the pacing");

    const cleared = call(t, "/v1/chat/completions", token, {
      model: "scene/the-pass",
      messages: [{ role: "user", content: "((clear steer)) and on" }],
    });
    await adapter.started;
    adapter.push("Fine.");
    adapter.end();
    await cleared;
    expect(
      (await json<{ scene: SceneDto }>(t, "GET", `/api/scenes/${sceneId}`)).scene.directorNote,
    ).toBeNull();
  });
});

describe("double assembly", () => {
  test("a client-assembled card is warned about, not refused", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await enable(t, sceneId);
    const key = await mintKey(t);

    const pending = call(t, "/v1/chat/completions", key.token, {
      model: "scene/the-pass",
      messages: [
        {
          role: "system",
          content: `You are {{char}}, talking to {{user}}.

Personality: guarded, dry, slow to trust.
Scenario: the pass has been closed for three weeks.

<START>
{{char}}: "We're full."`,
        },
        { role: "user", content: "hello" },
      ],
    });
    await adapter.started;
    adapter.push("Fine.");
    adapter.end();
    const response = await pending;

    // A warning and never a refusal: a false positive that rejected the request
    // would break a client over a heuristic.
    expect(response.status).toBe(200);
    expect(response.headers.get(WARNING_HEADER)).toBe("client-assembled-prompt");

    // And it is in the usage log, so the conflict is visible rather than
    // mysterious (§19).
    const keys = await json<{ requests: { warning: string | null }[] }[]>(t, "GET", "/api/api-keys");
    expect(keys[0]?.requests[0]?.warning).toBe("client-assembled-prompt");
  });

  test("an ordinary system prompt is not warned about", async () => {
    const t = await signedIn();
    const { sceneId } = await scene(t);
    await enable(t, sceneId);
    const key = await mintKey(t);

    const pending = call(t, "/v1/chat/completions", key.token, {
      model: "scene/the-pass",
      messages: [
        { role: "system", content: "Keep it short." },
        { role: "user", content: "hello" },
      ],
    });
    await adapter.started;
    adapter.push("Fine.");
    adapter.end();
    const response = await pending;
    expect(response.headers.get(WARNING_HEADER)).toBeNull();
  });
});

describe("the usage log", () => {
  test("records the failures too, which is the case worth debugging", async () => {
    const t = await signedIn();
    const key = await mintKey(t);
    await call(t, "/v1/chat/completions", key.token, {
      model: "scene/nothing-here",
      messages: [{ role: "user", content: "hello" }],
    });

    const keys = await json<{ requests: { model: string; status: number }[]; uses: number }[]>(
      t,
      "GET",
      "/api/api-keys",
    );
    expect(keys[0]?.requests[0]).toMatchObject({ model: "scene/nothing-here", status: 404 });
    expect(keys[0]?.uses).toBeGreaterThan(0);
  });
});
