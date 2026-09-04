import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { V1_CARD, V2_CARD, V3_CARD, charxCard, jsonBytes, pngCard } from "./card-fixtures.ts";
import type { BulkImportCharactersResponse, CharacterDto } from "../shared/types.ts";

/**
 * Bulk import (SPEC §9, §20 phase 43): a multi-select, or a whole folder.
 *
 * The point of the report is the folder that is not clean — a readme, a stray
 * avatar, a card already in the library. One bad file must not lose the rest.
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

function upload(files: Array<[Uint8Array, string]>): FormData {
  const form = new FormData();
  for (const [bytes, name] of files) {
    form.append("files", new File([bytes as unknown as BlobPart], name));
  }
  return form;
}

async function bulk(t: TestHarness, form: FormData) {
  const response = await t.fetch("/api/characters/import/bulk", { method: "POST", body: form });
  return { status: response.status, body: (await response.json()) as BulkImportCharactersResponse };
}

const named = (name: string) => ({ ...V2_CARD, data: { ...V2_CARD.data, name } });

describe("importing several cards at once", () => {
  test("requires a session", async () => {
    const t = createHarness();
    const response = await t.fetch("/api/characters/import/bulk", {
      method: "POST",
      body: upload([[jsonBytes(V1_CARD), "aldan.json"]]),
    });
    expect(response.status).toBe(401);
  });

  test("three files, three characters, in every format", async () => {
    const t = await signedIn();
    const { status, body } = await bulk(
      t,
      upload([
        [pngCard({ chara: named("Sister Bell") }), "bell.png"],
        [jsonBytes(V1_CARD), "aldan.json"],
        [charxCard(named("Mira Vance")), "mira.charx"],
      ]),
    );

    expect(status).toBe(201);
    expect(body.added).toBe(3);
    expect(body.skipped).toBe(0);
    expect(body.items.every((item) => item.action === "add")).toBe(true);

    const library = (await (await t.fetch("/api/characters")).json()) as CharacterDto[];
    expect(library.map((row) => row.name).sort()).toEqual([
      "Aldan Roe",
      "Mira Vance",
      "Sister Bell",
    ]);
  });

  test("a card already in the library is skipped, and says so", async () => {
    const t = await signedIn();
    const bytes = pngCard({ chara: V2_CARD });
    await bulk(t, upload([[bytes, "bell.png"]]));

    const { body } = await bulk(t, upload([[bytes, "bell-copy.png"]]));
    expect(body.added).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.items[0]).toMatchObject({
      name: "Sister Bell",
      filename: "bell-copy.png",
      action: "skip",
      detail: "Already in the library.",
    });
    // The duplicate still points at what is there, so the report can link it.
    expect(body.items[0]!.characterId).not.toBeNull();
  });

  test("a file that is not a card is skipped and the good ones still land", async () => {
    // A folder holds whatever a folder holds. Losing 199 cards to one readme is
    // the failure this endpoint exists to avoid.
    const t = await signedIn();
    const { body } = await bulk(
      t,
      upload([
        [pngCard({ chara: named("Sister Bell") }), "bell.png"],
        [new TextEncoder().encode("# How to use these cards\n"), "README.md"],
        [charxCard(V3_CARD), "bell-v3.charx"],
      ]),
    );

    expect(body.added).toBe(2);
    expect(body.skipped).toBe(1);
    const readme = body.items.find((item) => item.filename === "README.md")!;
    expect(readme.action).toBe("skip");
    expect(readme.detail).not.toBe("");
    expect(readme.characterId).toBeNull();
  });

  test("every file gets a row, in the order it was sent", async () => {
    const t = await signedIn();
    const { body } = await bulk(
      t,
      upload([
        [jsonBytes(V1_CARD), "aldan.json"],
        [new TextEncoder().encode("nope"), "stray.txt"],
        [charxCard(named("Mira Vance")), "mira.charx"],
      ]),
    );
    expect(body.items.map((item) => item.filename)).toEqual([
      "aldan.json",
      "stray.txt",
      "mira.charx",
    ]);
  });

  test("an empty upload is a bad request", async () => {
    const t = await signedIn();
    const { status } = await bulk(t, upload([]));
    expect(status).toBe(400);
  });
});
