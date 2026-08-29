import { unzipSync, zipSync } from "fflate";
import { CardError } from "./card.ts";

/**
 * CharX: a character card as a ZIP archive (SPEC §9).
 *
 * The archive holds `card.json` plus an `assets/` tree — avatar, expression
 * sprites, embedded lorebooks. It exists because a PNG can only carry one
 * image, and a card with a sprite pack needs many.
 *
 * `fflate` supplies DEFLATE. It is pure JavaScript with no build step, so it
 * satisfies the no-native-modules constraint; hand-rolling DEFLATE to avoid one
 * small dependency would be the wrong trade.
 */

/** Where the card document lives. Casing varies between exporters. */
const CARD_NAMES = ["card.json", "Card.json", "card.JSON"];

export interface CharxContents {
  cardJson: string;
  /** Everything else in the archive, by path. Preserved on re-export. */
  assets: Map<string, Uint8Array>;
}

export function isZip(bytes: Uint8Array): boolean {
  // "PK\x03\x04" — a local file header. An empty archive starts "PK\x05\x06".
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06)
  );
}

export function readCharx(bytes: Uint8Array): CharxContents {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (caught) {
    throw new CardError(
      `That CharX archive could not be opened: ${caught instanceof Error ? caught.message : "unreadable"}.`,
    );
  }

  const cardPath = CARD_NAMES.find((name) => entries[name] !== undefined);
  if (cardPath === undefined) {
    throw new CardError("That archive has no card.json, so it is not a CharX card.");
  }

  const assets = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(entries)) {
    // Directory entries have no content and nothing to preserve.
    if (path === cardPath || path.endsWith("/")) continue;
    assets.set(path, data);
  }

  return { cardJson: new TextDecoder().decode(entries[cardPath]!), assets };
}

/**
 * Write a CharX archive. Assets carried in from an imported card are written
 * back unchanged, so a round trip keeps a character's sprite pack intact.
 */
export function writeCharx(cardJson: string, assets: Map<string, Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    "card.json": new TextEncoder().encode(cardJson),
  };
  for (const [path, data] of assets) entries[path] = data;
  return zipSync(entries, { level: 6 });
}

/**
 * The avatar, if the archive names one. CharX has no single required path, so
 * the common conventions are tried in order before falling back to the first
 * image in the archive.
 */
export function findAvatar(assets: Map<string, Uint8Array>): { path: string; data: Uint8Array } | null {
  const preferred = [
    "assets/avatar.png",
    "assets/icon.png",
    "assets/main.png",
    "avatar.png",
    "icon.png",
  ];
  for (const path of preferred) {
    const data = assets.get(path);
    if (data !== undefined) return { path, data };
  }
  for (const [path, data] of assets) {
    if (/\.(png|jpe?g|webp)$/i.test(path)) return { path, data };
  }
  return null;
}
