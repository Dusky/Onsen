import { afterEach, describe, expect, test } from "bun:test";
import { ScriptedAdapter, completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { OPENAI_COMPATIBLE_CAPABILITIES } from "../server/adapters/index.ts";
import { V2_CARD, pngCard } from "./card-fixtures.ts";
import { TOOLS, toolSpecs } from "../server/agent/tools.ts";
import { snapshots } from "../server/agent/snapshot.ts";
import type { AgentThreadDto, CharacterDto, ThemeDto } from "../shared/types.ts";

/**
 * The agent (SPEC §20 phase 46): a second model with tools that reach the
 * install. Not a cast member — §22's rule is about who writes the story, and
 * this one does not.
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

/**
 * Ask, and collect the stream.
 *
 * The whole script goes in before the request, because a turn is a *loop*: the
 * model answers, its tools run, and it is asked again with the results. The
 * scripted adapter's queue survives across those calls and `end` returns from
 * one without draining the rest, so one queue scripts every round.
 */
async function ask(
  t: TestHarness,
  threadId: string,
  content: string,
  script: () => void,
): Promise<string> {
  script();
  const response = await t.fetch(`/api/agent/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return drain(response);
}

/**
 * Read an SSE body to the end.
 *
 * `.text()` comes back empty on a Hono streaming response here, which is what
 * `test/generation.test.ts` already worked around — the reader is the pattern
 * that works, so this uses the same one.
 */
async function drain(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

/** A round that asks for tools, then a round that answers from the results. */
function callThenAnswer(
  calls: { id: string; name: string; arguments: string }[],
  answer = "Done.",
): () => void {
  return () => {
    adapter.pushToolCalls(calls);
    adapter.end();
    adapter.push(answer);
    adapter.end();
  };
}

async function importBell(t: TestHarness): Promise<CharacterDto> {
  const form = new FormData();
  form.append("file", new File([pngCard({ chara: V2_CARD }) as unknown as BlobPart], "bell.png"));
  const body = (await (
    await t.fetch("/api/characters/import", { method: "POST", body: form })
  ).json()) as { character: CharacterDto };
  return body.character;
}

const newThread = (t: TestHarness) => json<AgentThreadDto>(t, "POST", "/api/agent/threads", {});

describe("the tools it is given", () => {
  test("every one has a name, a description and an object schema", () => {
    // The description is what the model chooses on. A tool with a thin one is a
    // tool that gets called for the wrong reason.
    for (const spec of toolSpecs()) {
      expect(spec.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(spec.description.length).toBeGreaterThan(30);
      expect(spec.parameters["type"]).toBe("object");
    }
  });

  test("the registry key and the advertised name are the same", () => {
    // They are looked up by the name the model sends, so a mismatch is a tool
    // that can be offered and never runs.
    for (const [key, tool] of Object.entries(TOOLS)) expect(tool.spec.name).toBe(key);
  });

  test("they are listed over HTTP, so the UI can say what it can do", async () => {
    const t = await signedIn();
    const tools = await json<{ name: string }[]>(t, "GET", "/api/agent/tools");
    expect(tools.length).toBe(Object.keys(TOOLS).length);
  });
});

describe("threads", () => {
  test("require a session", async () => {
    const t = createHarness();
    expect((await t.fetch("/api/agent/threads")).status).toBe(401);
  });

  test("a first question titles the thread", async () => {
    const t = await signedIn();
    const thread = await newThread(t);
    expect(thread.title).toBe("New thread");

    await ask(t, thread.id, "Tidy up my cast please", () => {
      adapter.push("Sure.");
      adapter.end();
    });

    const after = await json<{ thread: AgentThreadDto }>(t, "GET", `/api/agent/threads/${thread.id}`);
    expect(after.thread.title).toBe("Tidy up my cast please");
  });

  test("an empty question is refused", async () => {
    const t = await signedIn();
    const thread = await newThread(t);
    const response = await t.fetch(`/api/agent/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "   " }),
    });
    expect(response.status).toBe(400);
  });
});

describe("a turn", () => {
  test("plain prose comes back and is kept", async () => {
    const t = await signedIn();
    const thread = await newThread(t);
    const stream = await ask(t, thread.id, "Hello", () => {
      adapter.push("Hello. What would you like to do?");
      adapter.end();
    });

    expect(stream).toContain("What would you like to do?");
    expect(stream).toContain("event: done");

    const after = await json<{ messages: { role: string; content: string }[] }>(
      t,
      "GET",
      `/api/agent/threads/${thread.id}`,
    );
    expect(after.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  test("a tool call runs, and what it returned goes back to the model", async () => {
    const t = await signedIn();
    await importBell(t);
    const thread = await newThread(t);

    const stream = await ask(
      t,
      thread.id,
      "What characters do I have?",
      callThenAnswer([{ id: "c1", name: "list_characters", arguments: "{}" }], "You have one."),
    );

    expect(stream).toContain("event: tool");
    expect(stream).toContain("list_characters");
    expect(stream).toContain("Sister Bell");

    const after = await json<{ messages: { role: string; content: string }[] }>(
      t,
      "GET",
      `/api/agent/threads/${thread.id}`,
    );
    // user, assistant-with-calls, tool result, and the assistant turn after it.
    expect(after.messages.map((m) => m.role).slice(0, 3)).toEqual(["user", "assistant", "tool"]);
    expect(after.messages[2]!.content).toContain("Sister Bell");
  });

  test("a tool that throws is a result the model can read, not a crash", async () => {
    const t = await signedIn();
    const thread = await newThread(t);
    const stream = await ask(
      t,
      thread.id,
      "Get a character",
      callThenAnswer([
        { id: "c1", name: "get_character", arguments: JSON.stringify({ id: "nope" }) },
      ]),
    );

    expect(stream).toContain("No character has that id");
    // The turn keeps going rather than ending the stream on an exception.
    expect(stream).not.toContain("event: error");
  });

  test("malformed arguments are reported back rather than throwing", async () => {
    // Models emit bad JSON often enough that this has to be a message.
    const t = await signedIn();
    const thread = await newThread(t);
    const stream = await ask(
      t,
      thread.id,
      "Do something",
      callThenAnswer([{ id: "c1", name: "get_character", arguments: "{not json" }]),
    );
    expect(stream).toContain("not valid JSON");
  });

  test("a tool it was never given is reported by name", async () => {
    const t = await signedIn();
    const thread = await newThread(t);
    const stream = await ask(
      t,
      thread.id,
      "Do something",
      callThenAnswer([{ id: "c1", name: "launch_missiles", arguments: "{}" }]),
    );
    expect(stream).toContain("There is no tool called launch_missiles");
  });
});

describe("what the tools actually do", () => {
  test("it can rename a character, for real", async () => {
    const t = await signedIn();
    const bell = await importBell(t);
    const thread = await newThread(t);

    await ask(
      t,
      thread.id,
      "Rename Bell",
      callThenAnswer([
        {
          id: "c1",
          name: "update_character",
          arguments: JSON.stringify({ id: bell.id, name: "Sister Belladonna" }),
        },
      ]),
    );

    const after = await json<CharacterDto>(t, "GET", `/api/characters/${bell.id}`);
    expect(after.name).toBe("Sister Belladonna");
  });

  test("deleting snapshots first, so it can be undone", async () => {
    const t = await signedIn();
    const bell = await importBell(t);
    const thread = await newThread(t);

    await ask(
      t,
      thread.id,
      "Delete Bell",
      callThenAnswer([
        { id: "c1", name: "delete_character", arguments: JSON.stringify({ id: bell.id }) },
      ]),
    );

    expect((await t.fetch(`/api/characters/${bell.id}`)).status).toBe(404);

    const kept = snapshots(t.ctx);
    expect(kept[0]).toMatchObject({ kind: "character", subjectId: bell.id });
    expect(JSON.parse(kept[0]!.before).name).toBe("Sister Bell");

    const listed = await json<{ kind: string }[]>(t, "GET", "/api/agent/undo");
    expect(listed[0]!.kind).toBe("character");
  });

  test("it can make a theme and switch to it", async () => {
    const t = await signedIn();
    const thread = await newThread(t);

    await ask(
      t,
      thread.id,
      "Make me a purple theme",
      callThenAnswer([
        {
          id: "c1",
          name: "create_theme",
          arguments: JSON.stringify({
            name: "Aubergine",
            base: "dark",
            tokens: { "color-bg": "#1a0f22", "color-red": "#c07fd9" },
          }),
        },
      ]),
    );

    const { themes } = await json<{ themes: ThemeDto[] }>(t, "GET", "/api/themes");
    const made = themes.find((theme) => theme.name === "Aubergine")!;
    expect(made.tokens["color-bg"]).toBe("#1a0f22");
  });

  test("a token that is really a CSS injection is refused and reported", async () => {
    // The agent goes through the same door as an import: a token is data.
    const t = await signedIn();
    const thread = await newThread(t);

    const stream = await ask(
      t,
      thread.id,
      "Theme me",
      callThenAnswer([
        {
          id: "c1",
          name: "create_theme",
          arguments: JSON.stringify({
            name: "Hostile",
            tokens: { "color-bg": "#111", evil: "red } body { display: none" },
          }),
        },
      ]),
    );
    expect(stream).toContain("refusedTokens");
    expect(stream).toContain("evil");
  });

  test("a shipped theme cannot be edited, and it is told why", async () => {
    const t = await signedIn();
    const { themes } = await json<{ themes: ThemeDto[] }>(t, "GET", "/api/themes");
    const shipped = themes.find((theme) => theme.isBuiltin)!;
    const thread = await newThread(t);

    const stream = await ask(
      t,
      thread.id,
      "Change Bottle",
      callThenAnswer([
        {
          id: "c1",
          name: "update_theme",
          arguments: JSON.stringify({ id: shipped.id, tokens: { "color-bg": "#000" } }),
        },
      ]),
    );
    expect(stream).toContain("ships with Onsen");
  });
});

describe("a model that cannot use tools", () => {
  test("says so instead of pretending", async () => {
    // Text completion has no structured place to put a call. Sending tools that
    // will be ignored and then wondering why nothing ran is the failure mode.
    //
    // Its own harness, with its own capabilities object: the shared one is a
    // module-level constant, and mutating it here would quietly change what
    // every other test in the suite is running against.
    const toolless = createHarness({
      adapter: new ScriptedAdapter({ ...OPENAI_COMPATIBLE_CAPABILITIES, supportsTools: false }),
    });
    await completeSetup(toolless);
    const thread = await json<AgentThreadDto>(toolless, "POST", "/api/agent/threads", {});

    const response = await toolless.fetch(`/api/agent/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });
    const stream = await drain(response);
    toolless.cleanup();

    expect(stream).toContain("event: error");
    expect(stream).toContain("cannot use tools");
  });
});
