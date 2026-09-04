import { createHash } from "node:crypto";
import { join } from "node:path";

/**
 * Where generated and uploaded media lives (SPEC §20 phase 41).
 *
 * Content-addressed, like avatars: the filename is the hash of the bytes. Three
 * things fall out of that and all three are wanted.
 *
 * Regenerating a picture that happens to come out identical costs a row and no
 * bytes. A reader who illustrates the same line in two branches gets one file.
 * And deleting a row can never orphan a file another row is using, which is why
 * `media_assets` has an index on `path` — the delete checks before unlinking.
 */

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/wav": "wav",
  "audio/L16": "pcm",
};

export function extensionFor(mime: string): string {
  return EXTENSIONS[mime] ?? "bin";
}

/** The mime a stored file should be served with, read back from its name. */
export function mimeForPath(path: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  if (match === null) return null;
  const extension = match[1]!.toLowerCase();
  for (const [mime, candidate] of Object.entries(EXTENSIONS)) {
    if (candidate === extension) return mime;
  }
  return null;
}

/** Whether this is something a browser will render rather than download. */
export function isSupportedMedia(mime: string): boolean {
  return mime in EXTENSIONS;
}

export function pathFor(bytes: Uint8Array, mime: string): string {
  const hash = createHash("sha256").update(bytes).digest("hex");
  return `${hash.slice(0, 40)}.${extensionFor(mime)}`;
}

/**
 * Write bytes into the media directory and return the relative path.
 *
 * Idempotent by construction: the same bytes produce the same name, so a second
 * write of identical content overwrites a file with itself.
 */
export async function store(
  mediaDir: string,
  bytes: Uint8Array,
  mime: string,
): Promise<{ path: string; bytes: number }> {
  const path = pathFor(bytes, mime);
  await Bun.write(join(mediaDir, path), bytes);
  return { path, bytes: bytes.byteLength };
}
