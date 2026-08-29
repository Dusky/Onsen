import { inflateSync, deflateSync } from "node:zlib";

/**
 * PNG text chunks, implemented directly as SPEC §9 requires.
 *
 * A character card is an ordinary PNG whose metadata carries the card JSON,
 * base64-encoded, in a `tEXt` chunk. V2 uses the keyword `chara`; V3 writes the
 * payload into both `ccv3` and `chara`, so a reader has to accept either and an
 * exporter has to emit both for back-compatibility.
 *
 * There is no PNG library here on purpose: the format is length-prefixed
 * chunks with a CRC, the app has to both read and write them, and a
 * general-purpose image library would be a much larger dependency for a job
 * this small.
 */

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngChunk {
  type: string;
  data: Uint8Array;
}

export class PngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngError";
  }
}

/* ------------------------------------------------------------------ */
/* CRC-32, as PNG specifies it                                         */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < SIGNATURE.length) return false;
  return SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export function readChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new PngError("Not a PNG file.");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let offset = SIGNATURE.length;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    // A truncated file is worth naming rather than reading past the end of.
    if (dataEnd + 4 > bytes.length) throw new PngError(`Truncated PNG: chunk ${type} is cut off.`);

    chunks.push({ type, data: bytes.subarray(dataStart, dataEnd) });
    offset = dataEnd + 4;
    if (type === "IEND") break;
  }

  return chunks;
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/**
 * Every text entry in the file, keyed by its keyword. `zTXt` is decompressed:
 * some exporters use it for large cards, and a reader that only understands
 * `tEXt` reports those cards as having no character data at all.
 */
export function readTextChunks(bytes: Uint8Array): Map<string, string> {
  const found = new Map<string, string>();

  for (const chunk of readChunks(bytes)) {
    if (chunk.type !== "tEXt" && chunk.type !== "zTXt") continue;

    const separator = chunk.data.indexOf(0);
    if (separator === -1) continue;
    const keyword = latin1(chunk.data.subarray(0, separator));

    if (chunk.type === "tEXt") {
      found.set(keyword, latin1(chunk.data.subarray(separator + 1)));
      continue;
    }

    // zTXt: keyword \0 compressionMethod compressedText
    const method = chunk.data[separator + 1];
    if (method !== 0) continue;
    try {
      const inflated = inflateSync(Buffer.from(chunk.data.subarray(separator + 2)));
      found.set(keyword, latin1(new Uint8Array(inflated)));
    } catch {
      // A corrupt text chunk should not stop the rest of the card being read.
    }
  }

  return found;
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

function encodeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // The CRC covers the type and the data, but not the length.
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function textChunk(keyword: string, text: string): Uint8Array {
  const data = new Uint8Array(keyword.length + 1 + text.length);
  for (let i = 0; i < keyword.length; i++) data[i] = keyword.charCodeAt(i) & 0xff;
  data[keyword.length] = 0;
  for (let i = 0; i < text.length; i++) data[keyword.length + 1 + i] = text.charCodeAt(i) & 0xff;
  return data;
}

/**
 * Rewrite a PNG's text chunks, keeping the image itself untouched.
 *
 * Existing entries with the same keywords are dropped rather than duplicated —
 * a PNG may legally carry two `tEXt` chunks with one keyword, and a reader
 * would then have to guess which card is current.
 */
export function writeTextChunks(bytes: Uint8Array, entries: Record<string, string>): Uint8Array {
  const chunks = readChunks(bytes);
  const replaced = new Set(Object.keys(entries));

  const kept: Uint8Array[] = [SIGNATURE];
  const added: Uint8Array[] = Object.entries(entries).map(([keyword, text]) =>
    encodeChunk("tEXt", textChunk(keyword, text)),
  );
  let wroteText = false;

  for (const chunk of chunks) {
    const separator = chunk.data.indexOf(0);
    const keyword =
      (chunk.type === "tEXt" || chunk.type === "zTXt") && separator !== -1
        ? latin1(chunk.data.subarray(0, separator))
        : null;
    if (keyword !== null && replaced.has(keyword)) continue;

    // Text chunks must appear before IEND; putting them straight after IHDR
    // also means a reader finds the card without scanning the whole image.
    if (chunk.type === "IEND" && !wroteText) {
      kept.push(...added);
      wroteText = true;
    }
    kept.push(encodeChunk(chunk.type, chunk.data));
  }

  if (!wroteText) kept.push(...added);

  const total = kept.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of kept) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Only used when a card has no image of its own to carry. */
export function blankPng(): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1); // width
  view.setUint32(4, 1); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // A single transparent pixel: filter byte then RGBA.
  const raw = Uint8Array.from([0, 0, 0, 0, 0]);
  const idat = new Uint8Array(deflateSync(Buffer.from(raw)));

  const parts = [
    SIGNATURE,
    encodeChunk("IHDR", ihdr),
    encodeChunk("IDAT", idat),
    encodeChunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Base64 of UTF-8 JSON is how a card payload is carried in a text chunk. */
export function encodePayload(json: string): string {
  return Buffer.from(json, "utf8").toString("base64");
}

export function decodePayload(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}
