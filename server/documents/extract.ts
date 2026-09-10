import { extractText } from "unpdf";

/**
 * Text from an uploaded file, for the data bank (§20 phase 156).
 *
 * Plain text and markdown are just bytes; a PDF is parsed with unpdf (pure JS,
 * no native module, no WASM). Returns null for a file with no readable text —
 * an image-only PDF, or an extension the bank cannot read.
 */

const PLAIN_EXTENSIONS = new Set(["txt", "md", "markdown", "text"]);

export function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

export async function extractDocumentText(
  filename: string,
  bytes: Uint8Array,
): Promise<string | null> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";

  if (PLAIN_EXTENSIONS.has(ext)) {
    return new TextDecoder().decode(bytes);
  }

  if (ext === "pdf") {
    try {
      const result = await extractText(bytes, { mergePages: true });
      return result.text;
    } catch {
      return null;
    }
  }

  return null;
}
