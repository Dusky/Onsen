import { describe, expect, test } from "bun:test";
import {
  buildCardDocument,
  CardError,
  exportCard,
  importCard,
  parseDecorators,
  numericDecorator,
} from "../server/cards/index.ts";
import { blankPng, isPng, readTextChunks, writeTextChunks, decodePayload } from "../server/cards/png.ts";
import { readCharx } from "../server/cards/charx.ts";
import { V1_CARD, V2_CARD, V3_CARD, charxCard, jsonBytes, pngCard } from "./card-fixtures.ts";

/**
 * Card import and export (SPEC §9, §23).
 *
 * The governing requirement is that import must not be lossy: lossy card
 * parsing is the most common migration failure in this ecosystem, and the top
 * complaint about every other frontend. The round-trip tests are therefore the
 * point of this file, not a nicety.
 */

describe("PNG chunks", () => {
  test("round-trips a text chunk through a real PNG", () => {
    const png = writeTextChunks(blankPng(), { chara: "aGVsbG8=" });
    expect(isPng(png)).toBe(true);
    expect(readTextChunks(png).get("chara")).toBe("aGVsbG8=");
  });

  test("replaces an existing chunk rather than writing a second one", () => {
    // A PNG may legally carry two tEXt chunks with one keyword, and a reader
    // would then have to guess which card is current.
    const once = writeTextChunks(blankPng(), { chara: "Zmlyc3Q=" });
    const twice = writeTextChunks(once, { chara: "c2Vjb25k" });
    expect(readTextChunks(twice).get("chara")).toBe("c2Vjb25k");
    expect(twice.length).toBeLessThan(once.length + 40);
  });

  test("keeps the image data intact while rewriting metadata", () => {
    const original = blankPng();
    const written = writeTextChunks(original, { ccv3: "eA==" });
    // Every non-text chunk survives, so the avatar is not damaged by an edit.
    const before = readChunkTypes(original).filter((type) => type !== "tEXt");
    const after = readChunkTypes(written).filter((type) => type !== "tEXt");
    expect(after).toEqual(before);
  });

  test("rejects a file that is not a PNG", () => {
    expect(() => readTextChunks(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/Not a PNG/);
  });

  test("rejects a truncated PNG rather than reading past the end", () => {
    const png = writeTextChunks(blankPng(), { chara: "eA==" });
    expect(() => readTextChunks(png.subarray(0, png.length - 20))).toThrow(/Truncated/);
  });
});

function readChunkTypes(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types: string[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    types.push(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)));
    offset += 12 + length;
  }
  return types;
}

describe("importing", () => {
  test("reads a V2 PNG and keeps the fields other importers drop", () => {
    const imported = importCard(pngCard({ chara: V2_CARD }), "bell.png");
    expect(imported.format).toBe("png_v2");
    expect(imported.card.name).toBe("Sister Bell");

    // The five SPEC §9 names as commonly lost.
    expect(imported.card.alternateGreetings).toHaveLength(2);
    expect(imported.card.creatorNotes).toContain("Play her slow");
    expect(imported.card.postHistoryInstructions).toBe("Never break character.");
    expect(imported.card.depthPrompt).toBe("Bell has not slept in two days.");
    expect(imported.card.depthPromptDepth).toBe(2);
    // character_book is not modelled until phase 19, so it lives in raw_card.
    expect(JSON.parse(imported.rawCard).data.character_book.name).toBe("Ridge lore");
    expect(imported.warnings.join(" ")).toContain("lorebook");
  });

  test("prefers ccv3 when a card carries both chunks", () => {
    // V3 writes both; the V2 chunk exists only for older readers.
    const both = pngCard({ ccv3: V3_CARD, chara: V2_CARD });
    const imported = importCard(both);
    expect(imported.format).toBe("png_v3");
    expect(imported.card.groupGreetings).toHaveLength(1);
  });

  test("reads a V3-only PNG", () => {
    const imported = importCard(pngCard({ ccv3: V3_CARD }));
    expect(imported.format).toBe("png_v3");
    expect(imported.card.groupGreetings[0]).toContain("nods at the newcomer");
  });

  test("reads a bare V1 card with no envelope", () => {
    const imported = importCard(jsonBytes(V1_CARD), "aldan.json");
    expect(imported.format).toBe("json");
    expect(imported.card.name).toBe("Aldan Roe");
    expect(imported.card.description).toContain("labels he wrote himself");
  });

  test("reads a CharX archive and its assets", () => {
    const sprite = new Uint8Array([1, 2, 3, 4]);
    const bytes = charxCard(V3_CARD, { "assets/avatar.png": blankPng(), "assets/joy.png": sprite });
    const imported = importCard(bytes, "bell.charx");

    expect(imported.format).toBe("charx");
    expect(imported.card.name).toBe("Sister Bell");
    expect(imported.assets.get("assets/joy.png")).toEqual(sprite);
    expect(imported.avatar?.extension).toBe("png");
  });

  test("detects the format from content, not the filename", () => {
    // Cards are routinely renamed; a CharX called .png must still import.
    const imported = importCard(charxCard(V2_CARD), "actually-a-zip.png");
    expect(imported.format).toBe("charx");
  });

  test("names the fields it preserved but does not model", () => {
    const imported = importCard(pngCard({ ccv3: V3_CARD }));
    // Silent partial imports are the worst outcome (SPEC §18): what is
    // preserved-but-hidden has to be nameable.
    expect(imported.unmodelledFields).toContain("future_top_level_field");
    expect(imported.unmodelledFields).toContain("extensions.risuai");
    // A field the editor does show is not reported as unmodelled.
    expect(imported.unmodelledFields).not.toContain("group_only_greetings");
    expect(imported.unmodelledFields).not.toContain("extensions.depth_prompt");
  });

  test("a card with nothing exotic reports nothing unmodelled", () => {
    expect(importCard(jsonBytes(V1_CARD)).unmodelledFields).toEqual([]);
  });

  test("refuses a plain image, an unnamed card, and rubbish", () => {
    expect(() => importCard(blankPng())).toThrow(/no character data/);
    expect(() => importCard(jsonBytes({ description: "no name" }))).toThrow(/no name/);
    expect(() => importCard(new TextEncoder().encode("not a card"))).toThrow(CardError);
  });

  test("hashes the source so a re-import is recognised", () => {
    const bytes = pngCard({ chara: V2_CARD });
    expect(importCard(bytes).sourceHash).toBe(importCard(bytes).sourceHash);
    expect(importCard(bytes).sourceHash).not.toBe(importCard(pngCard({ chara: V3_CARD })).sourceHash);
  });
});

describe("round trips", () => {
  /** Import, export, re-import, and compare what came back. */
  function roundTrip(bytes: Uint8Array, format: "png" | "charx" | "json") {
    const first = importCard(bytes);
    const exported = exportCard(
      {
        card: first.card,
        rawCard: first.rawCard,
        avatar: first.avatar?.data ?? null,
        assets: first.assets,
      },
      format,
    );
    return { first, second: importCard(exported.bytes), exported };
  }

  test.each(["png", "charx", "json"] as const)(
    "a V2 card survives export as %s with nothing lost",
    (format) => {
      const { first, second } = roundTrip(pngCard({ chara: V2_CARD }), format);

      expect(second.card.name).toBe(first.card.name);
      expect(second.card.description).toBe(first.card.description);
      expect(second.card.personality).toBe(first.card.personality);
      expect(second.card.scenario).toBe(first.card.scenario);
      expect(second.card.firstMessage).toBe(first.card.firstMessage);
      expect(second.card.exampleDialogue).toBe(first.card.exampleDialogue);
      expect(second.card.alternateGreetings).toEqual(first.card.alternateGreetings);
      expect(second.card.creatorNotes).toBe(first.card.creatorNotes);
      expect(second.card.postHistoryInstructions).toBe(first.card.postHistoryInstructions);
      expect(second.card.depthPrompt).toBe(first.card.depthPrompt);
      expect(second.card.depthPromptDepth).toBe(first.card.depthPromptDepth);
      expect(second.card.tags).toEqual(first.card.tags);
      expect(second.card.creator).toBe(first.card.creator);
    },
  );

  test("an embedded lorebook this app does not model yet survives export", () => {
    const { second } = roundTrip(pngCard({ chara: V2_CARD }), "png");
    const book = JSON.parse(second.rawCard).data.character_book;
    expect(book.name).toBe("Ridge lore");
    expect(book.entries[0].content).toBe("The road closed in the spring.");
  });

  test("an unknown extension survives export byte for byte", () => {
    // This is the test SPEC §23 asks for: a card with unknown extension fields.
    const { second } = roundTrip(pngCard({ ccv3: V3_CARD }), "png");
    const extensions = JSON.parse(second.rawCard).data.extensions;
    expect(extensions.risuai).toEqual({ customScriptV2: ["never", "touched"] });
    expect(extensions.hypothetical_future_field).toEqual({ nested: [1, 2, 3] });
    // And a top-level unknown, not only one under extensions.
    expect(JSON.parse(second.rawCard).data.future_top_level_field).toEqual({ anything: "at all" });
  });

  test("a PNG export carries both chunks, so old readers still find a card", () => {
    const first = importCard(pngCard({ ccv3: V3_CARD }));
    const exported = exportCard(
      { card: first.card, rawCard: first.rawCard, avatar: null, assets: new Map() },
      "png",
    );

    const chunks = readTextChunks(exported.bytes);
    expect(chunks.has("ccv3")).toBe(true);
    expect(chunks.has("chara")).toBe(true);
    expect(JSON.parse(decodePayload(chunks.get("ccv3")!)).spec).toBe("chara_card_v3");
    expect(JSON.parse(decodePayload(chunks.get("chara")!)).spec).toBe("chara_card_v2");
  });

  test("a CharX export keeps the sprite pack", () => {
    const sprite = new Uint8Array([9, 8, 7]);
    const bytes = charxCard(V3_CARD, { "assets/joy.png": sprite });
    const { exported } = roundTrip(bytes, "charx");
    expect(readCharx(exported.bytes).assets.get("assets/joy.png")).toEqual(sprite);
  });

  test("an edit wins over the original while everything else is preserved", () => {
    const first = importCard(pngCard({ ccv3: V3_CARD }));
    const edited = { ...first.card, description: "Rewritten by the user." };

    const document = JSON.parse(buildCardDocument(edited, first.rawCard));
    expect(document.data.description).toBe("Rewritten by the user.");
    // The unmodelled extension is untouched by the edit.
    expect(document.data.extensions.risuai).toEqual({ customScriptV2: ["never", "touched"] });
    expect(document.data.character_book.name).toBe("Ridge lore");
  });

  test("clearing a depth prompt removes it rather than writing an empty one", () => {
    const first = importCard(pngCard({ ccv3: V3_CARD }));
    const document = JSON.parse(
      buildCardDocument({ ...first.card, depthPrompt: null }, first.rawCard),
    );
    expect("depth_prompt" in document.data.extensions).toBe(false);
  });

  test("a card exported with no image still imports", () => {
    const first = importCard(jsonBytes(V1_CARD));
    const exported = exportCard(
      { card: first.card, rawCard: first.rawCard, avatar: null, assets: new Map() },
      "png",
    );
    expect(isPng(exported.bytes)).toBe(true);
    expect(importCard(exported.bytes).card.name).toBe("Aldan Roe");
  });
});

describe("CCv3 decorators", () => {
  test("strips decorator lines from the content", () => {
    // Leaving them in would put "@@depth 4" in front of the model.
    const result = parseDecorators("@@depth 4\n@@role assistant\nThe actual entry text.");
    expect(result.content).toBe("The actual entry text.");
    expect(numericDecorator(result.applied, "depth")).toBe(4);
  });

  test("only treats decorators at the top of an entry as decorators", () => {
    const result = parseDecorators("Prose that mentions @@depth in passing.");
    expect(result.content).toBe("Prose that mentions @@depth in passing.");
    expect(result.decorators).toEqual([]);
  });

  test("falls through a chain to the first supported decorator", () => {
    // SPEC §9: an unsupported decorator falls through rather than erroring.
    const result = parseDecorators("@@invented_by_a_future_spec 9\n@@@depth 3\nContent.");
    expect(numericDecorator(result.applied, "depth")).toBe(3);
    expect(result.unsupported).toEqual(["invented_by_a_future_spec"]);
    expect(result.content).toBe("Content.");
  });

  test("a chain where nothing is supported still yields the content", () => {
    const result = parseDecorators("@@unknown_one\n@@@unknown_two\nStill here.");
    expect(result.applied).toEqual([]);
    expect(result.content).toBe("Still here.");
    expect(result.unsupported).toEqual(["unknown_one", "unknown_two"]);
  });

  test("recognises the decorators SPEC §9 names", () => {
    for (const line of [
      "@@depth 4",
      "@@instruct_depth 2",
      "@@activate_after_emotion joy",
      "@@ignore_on_max_context",
    ]) {
      const result = parseDecorators(`${line}\nContent.`);
      expect(result.unsupported).toEqual([]);
      expect(result.applied).toHaveLength(1);
      expect(result.content).toBe("Content.");
    }
  });

  test("ignores a decorator whose value is not the number it needs", () => {
    const result = parseDecorators("@@depth deep\nContent.");
    expect(numericDecorator(result.applied, "depth")).toBeNull();
  });

  test("an entry with no decorators is returned unchanged", () => {
    const result = parseDecorators("Just content.\n\nWith a second paragraph.");
    expect(result.content).toBe("Just content.\n\nWith a second paragraph.");
    expect(result.applied).toEqual([]);
  });
});
