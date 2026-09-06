import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import type { QuickReplyDto } from "../shared/types.ts";

/**
 * Quick replies (SPEC §7, §20 phase 65).
 *
 * A label and a prompt the reader writes once and fires from the composer with
 * one tap. The nudge path — a one-shot instruction for the next turn, never a
 * message — is the engine this feature rides on, and it is already guarded by
 * `guided-ops.test.ts`. What is new here is storage and order, so that is what
 * is measured: rows round-trip, a new reply lands at the end, moving one
 * swaps it with its neighbour and never wraps around, and empty fields are
 * refused rather than stored as dead buttons.
 */

let harness: TestHarness | null = null;

async function signedIn(): Promise<TestHarness> {
  if (harness === null) {
    harness = createHarness();
    await completeSetup(harness);
  }
  return harness;
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

async function send<T>(
  t: TestHarness,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const parsed = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  return { status: response.status, body: parsed };
}

async function add(t: TestHarness, label: string, prompt: string): Promise<QuickReplyDto> {
  return (await send<QuickReplyDto>(t, "POST", "/api/quick-replies", { label, prompt })).body;
}

describe("the surface", () => {
  test("a reply round-trips, and a new one lands at the end", async () => {
    const t = await signedIn();
    const first = await add(t, "Fade to black", "Cut to the morning after.");
    const second = await add(t, "Hold the room", "Let the silence sit.");
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder);

    const all = await send<QuickReplyDto[]>(t, "GET", "/api/quick-replies");
    expect(all.body.map((reply) => [reply.label, reply.prompt])).toEqual([
      ["Fade to black", "Cut to the morning after."],
      ["Hold the room", "Let the silence sit."],
    ]);
  });

  test("an edit keeps the order and the id", async () => {
    const t = await signedIn();
    const reply = await add(t, "Fade to black", "Cut to the morning after.");
    const edited = await send<QuickReplyDto>(t, "PATCH", `/api/quick-replies/${reply.id}`, {
      label: "Fade out",
      prompt: "Cut to the evening after.",
    });
    expect(edited.body.id).toBe(reply.id);
    expect(edited.body.label).toBe("Fade out");
    expect(edited.body.prompt).toBe("Cut to the evening after.");
    expect(edited.body.sortOrder).toBe(reply.sortOrder);
  });

  test("empty fields are refused rather than stored as dead buttons", async () => {
    const t = await signedIn();
    expect(await (await t.fetch("/api/quick-replies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "  ", prompt: "Something." }),
    })).status).toBe(400);
    expect(await (await t.fetch("/api/quick-replies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Something", prompt: "" }),
    })).status).toBe(400);
    expect((await send<QuickReplyDto[]>(t, "GET", "/api/quick-replies")).body).toEqual([]);
  });

  test("deleting removes only that one", async () => {
    const t = await signedIn();
    const first = await add(t, "One", "First.");
    const second = await add(t, "Two", "Second.");
    expect((await send(t, "DELETE", `/api/quick-replies/${first.id}`)).status).toBe(204);
    const all = await send<QuickReplyDto[]>(t, "GET", "/api/quick-replies");
    expect(all.body.map((reply) => reply.label)).toEqual(["Two"]);
    expect((await send(t, "DELETE", `/api/quick-replies/${second.id}`)).status).toBe(204);
    expect((await send<QuickReplyDto[]>(t, "GET", "/api/quick-replies")).body).toEqual([]);
  });
});

describe("the order is the reader's", () => {
  test("moving swaps with the neighbour and never wraps around", async () => {
    const t = await signedIn();
    await add(t, "One", "First.");
    const middle = await add(t, "Two", "Second.");
    await add(t, "Three", "Third.");

    const movedUp = await send<QuickReplyDto[]>(t, "POST", `/api/quick-replies/${middle.id}/move`, {
      direction: "up",
    });
    expect(movedUp.body.map((reply) => reply.label)).toEqual(["Two", "One", "Three"]);

    // Up at the top is a no-op, not a wrap to the bottom.
    const pinned = await send<QuickReplyDto[]>(t, "POST", `/api/quick-replies/${middle.id}/move`, {
      direction: "up",
    });
    expect(pinned.body.map((reply) => reply.label)).toEqual(["Two", "One", "Three"]);

    const movedDown = await send<QuickReplyDto[]>(t, "POST", `/api/quick-replies/${middle.id}/move`, {
      direction: "down",
    });
    expect(movedDown.body.map((reply) => reply.label)).toEqual(["One", "Two", "Three"]);
  });

  test("a direction that is not a direction is refused", async () => {
    const t = await signedIn();
    const reply = await add(t, "One", "First.");
    expect(
      (await send(t, "POST", `/api/quick-replies/${reply.id}/move`, { direction: "sideways" }))
        .status,
    ).toBe(400);
  });

  test("moving one that does not exist is a 404", async () => {
    const t = await signedIn();
    expect(
      (await send(t, "POST", "/api/quick-replies/01NOTREAL/move", { direction: "up" })).status,
    ).toBe(404);
  });
});
