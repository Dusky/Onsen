import { unzipSync, zipSync } from "fflate";
import { PackError, readManifest, writeManifest, type PackKind, type PackManifest } from "./manifest.ts";

/**
 * A pack archive, read into memory (SPEC §15 tier 2).
 *
 * The layout the spec draws: `pack.json` at the root, then one directory per
 * entity kind holding JSON documents, then `/assets/` holding the images those
 * documents point at.
 *
 * Reading is separated from installing on purpose. Install is transactional and
 * previewable, which means it has to be able to say what a pack contains before
 * it writes anything — and a reader that could only report by writing would
 * make the preview a lie.
 */

export interface PackDocument {
  /** The path inside the archive, kept so a problem can name the file. */
  path: string;
  value: Record<string, unknown>;
}

export interface PackContents {
  manifest: PackManifest;
  /** One list per kind, in archive order. Kinds the pack omits are empty. */
  documents: Record<PackKind, PackDocument[]>;
  /** Everything under `assets/`, by path relative to the archive root. */
  assets: Map<string, Uint8Array>;
}

const MANIFEST_NAMES = ["pack.json", "Pack.json"];

/** The directory each kind lives in — the spec's tree, with two additions. */
const DIRECTORIES: Record<PackKind, string> = {
  characters: "characters",
  lorebooks: "lorebooks",
  presets: "presets",
  authors: "authors",
  options: "options",
  regex: "regex",
  // §15's tree predates event triggers, which arrived with them in phase 33.
  // A regex script fired by a trigger and shipped without it is half a feature.
  triggers: "triggers",
  banlists: "banlists",
};

function emptyDocuments(): Record<PackKind, PackDocument[]> {
  return {
    characters: [],
    lorebooks: [],
    presets: [],
    authors: [],
    options: [],
    regex: [],
    triggers: [],
    banlists: [],
  };
}

/** Which kind a path belongs to, or null for anything outside the tree. */
function kindOf(path: string): PackKind | null {
  const head = path.split("/")[0];
  if (head === undefined) return null;
  for (const [kind, directory] of Object.entries(DIRECTORIES) as [PackKind, string][]) {
    if (head === directory) return kind;
  }
  return null;
}

export function readPack(bytes: Uint8Array): PackContents {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (caught) {
    throw new PackError(
      `That pack could not be opened: ${caught instanceof Error ? caught.message : "unreadable"}.`,
    );
  }

  const manifestPath = MANIFEST_NAMES.find((name) => entries[name] !== undefined);
  if (manifestPath === undefined) {
    throw new PackError("That archive has no pack.json, so it is not a pack.");
  }
  const manifest = readManifest(new TextDecoder().decode(entries[manifestPath]!));

  const documents = emptyDocuments();
  const assets = new Map<string, Uint8Array>();

  for (const [path, data] of Object.entries(entries)) {
    if (path === manifestPath || path.endsWith("/")) continue;
    if (path.startsWith("assets/")) {
      assets.set(path, data);
      continue;
    }
    const kind = kindOf(path);
    // A file in no known directory is left alone rather than refused. A pack
    // written for a later version of this app will carry directories this one
    // has never heard of, and refusing the whole archive over one of them would
    // make every pack a compatibility cliff.
    if (kind === null) continue;
    // A character card can be a PNG or a CharX, both of which are carried whole
    // rather than as JSON; those reach the installer through `assets`.
    if (!path.endsWith(".json")) {
      assets.set(path, data);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(data));
    } catch {
      throw new PackError(`${path} is not valid JSON.`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new PackError(`${path} is not an object.`);
    }
    documents[kind].push({ path, value: parsed as Record<string, unknown> });
  }

  for (const list of Object.values(documents)) {
    list.sort((a, b) => a.path.localeCompare(b.path));
  }
  return { manifest, documents, assets };
}

export interface PackDraft {
  manifest: PackManifest;
  documents: Record<PackKind, { name: string; value: unknown }[]>;
  assets: Map<string, Uint8Array>;
}

/**
 * Write a pack archive.
 *
 * File names are the caller's, already made safe and unique — the writer does
 * not invent them, because the name is how a document points at its asset and
 * a writer that renamed one would break that link silently.
 */
export function writePack(draft: PackDraft): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    "pack.json": new TextEncoder().encode(writeManifest(draft.manifest)),
  };
  for (const [kind, documents] of Object.entries(draft.documents) as [
    PackKind,
    { name: string; value: unknown }[],
  ][]) {
    for (const document of documents) {
      entries[`${DIRECTORIES[kind]}/${document.name}.json`] = new TextEncoder().encode(
        JSON.stringify(document.value, null, 2),
      );
    }
  }
  for (const [path, data] of draft.assets) entries[path] = data;
  return zipSync(entries, { level: 6 });
}

/** A file name that cannot escape its directory or collide with the manifest. */
export function safeName(raw: string, fallback: string): string {
  const cleaned = raw
    .normalize("NFKD")
    .replace(/[^\w \-.]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 80)
    .trim();
  return cleaned === "" ? fallback : cleaned;
}
