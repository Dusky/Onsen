import { createHash } from "node:crypto";
import {
  blankPng,
  decodePayload,
  encodePayload,
  isPng,
  readTextChunks,
  writeTextChunks,
} from "./png.ts";
import { findAvatar, isZip, readCharx, writeCharx } from "./charx.ts";
import {
  buildCardDocument,
  buildV2Document,
  CardError,
  parseCardJson,
  type NormalisedCard,
  type ParsedCard,
} from "./card.ts";

export * from "./card.ts";
export * from "./decorators.ts";
export { isPng, readTextChunks, writeTextChunks, blankPng } from "./png.ts";
export { isZip, readCharx, writeCharx } from "./charx.ts";

/**
 * Importing and exporting character cards, whatever shape they arrive in
 * (SPEC §9).
 *
 * Four formats: PNG with the payload in a text chunk (V2 and V3), raw JSON, and
 * CharX. All four normalise into the same record, and all four keep the
 * original document verbatim.
 */

export interface ImportedCard extends ParsedCard {
  /** The image the card carried, if any: the PNG itself, or a CharX asset. */
  avatar: { data: Uint8Array; extension: string } | null;
  /** CharX assets, kept so a re-export preserves the sprite pack. */
  assets: Map<string, Uint8Array>;
  /** Content hash of the source file, for the parsed-card cache (§9). */
  sourceHash: string;
}

/** V3 writes the payload into both chunks; a reader must accept either. */
const V3_KEYWORD = "ccv3";
const V2_KEYWORD = "chara";

export function hashOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  return match === null ? "png" : match[1]!.toLowerCase();
}

/**
 * Read a card from bytes. The format is detected from the content rather than
 * the filename, because cards are routinely renamed and a `.png` that is really
 * a CharX archive should still import.
 */
export function importCard(bytes: Uint8Array, filename = "card.png"): ImportedCard {
  const sourceHash = hashOf(bytes);

  if (isPng(bytes)) {
    const chunks = readTextChunks(bytes);
    // Prefer ccv3: when a file carries both, the V3 payload is the newer of the
    // two and the V2 chunk exists only for older readers.
    const v3 = chunks.get(V3_KEYWORD);
    const v2 = chunks.get(V2_KEYWORD);
    const payload = v3 ?? v2;
    if (payload === undefined) {
      throw new CardError(
        "That PNG has no character data in it. It may be a plain image rather than a card.",
      );
    }

    let json: string;
    try {
      json = decodePayload(payload);
    } catch {
      throw new CardError("That card's embedded data could not be decoded.");
    }

    const parsed = parseCardJson(json, v3 !== undefined ? "png_v3" : "png_v2");
    return {
      ...parsed,
      // The PNG is the avatar: that is the whole convention behind the format.
      avatar: { data: bytes, extension: "png" },
      assets: new Map(),
      sourceHash,
    };
  }

  if (isZip(bytes)) {
    const { cardJson, assets } = readCharx(bytes);
    const parsed = parseCardJson(cardJson, "charx");
    const avatar = findAvatar(assets);
    return {
      ...parsed,
      avatar: avatar === null ? null : { data: avatar.data, extension: extensionOf(avatar.path) },
      assets,
      sourceHash,
    };
  }

  // Anything else is treated as raw JSON, which is also how a card exported
  // from a text editor arrives.
  const text = new TextDecoder().decode(bytes).trim();
  if (!text.startsWith("{")) {
    throw new CardError(
      `${filename} is not a character card. Expected a PNG, a CharX archive, or card JSON.`,
    );
  }
  return { ...parseCardJson(text, "json"), avatar: null, assets: new Map(), sourceHash };
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export type ExportFormat = "png" | "charx" | "json";

export interface ExportInput {
  card: NormalisedCard;
  /** The original document, so unmodelled fields survive the round trip. */
  rawCard: string | null;
  /** The character's image, where it has one. */
  avatar: Uint8Array | null;
  assets: Map<string, Uint8Array>;
}

export interface ExportedCard {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[^\w \-.]/g, "").trim();
  return cleaned === "" ? "character" : cleaned;
}

export function exportCard(input: ExportInput, format: ExportFormat): ExportedCard {
  const json = buildCardDocument(input.card, input.rawCard);
  const base = safeFilename(input.card.name);

  switch (format) {
    case "json":
      return {
        bytes: new TextEncoder().encode(json),
        filename: `${base}.json`,
        contentType: "application/json",
      };

    case "png": {
      // SPEC §9: emit both chunks. A V3 reader takes ccv3; everything older
      // still finds a card in chara.
      const image = input.avatar !== null && isPng(input.avatar) ? input.avatar : blankPng();
      const bytes = writeTextChunks(image, {
        [V3_KEYWORD]: encodePayload(json),
        [V2_KEYWORD]: encodePayload(buildV2Document(input.card, input.rawCard)),
      });
      return { bytes, filename: `${base}.png`, contentType: "image/png" };
    }

    case "charx": {
      const assets = new Map(input.assets);
      if (input.avatar !== null && !assets.has("assets/avatar.png")) {
        assets.set("assets/avatar.png", input.avatar);
      }
      return {
        bytes: writeCharx(json, assets),
        filename: `${base}.charx`,
        contentType: "application/zip",
      };
    }
  }
}
