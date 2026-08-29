/**
 * Reading a Server-Sent Events stream.
 *
 * Network chunks do not respect line boundaries: one `data:` line routinely
 * arrives split across two reads, and two events routinely arrive in one. A
 * parser that assumes otherwise drops tokens under exactly the conditions this
 * app is built for — a phone on a flaky connection.
 */

export interface SseEvent {
  /** The `event:` field, or null when the stream did not name one. */
  event: string | null;
  /** The `data:` payload, with multiple data lines joined by newlines. */
  data: string;
}

/**
 * Decode a byte stream into SSE events. Incomplete trailing data is held until
 * the next chunk completes it.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  // Abort has to release the reader, or an aborted generation leaves the
  // upstream response half-read and the connection open.
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });

      // Events are separated by a blank line. \r\n is legal and some proxies
      // rewrite line endings, so both are accepted.
      let separator = findSeparator(pending);
      while (separator !== null) {
        const raw = pending.slice(0, separator.index);
        pending = pending.slice(separator.index + separator.length);
        const event = parseEvent(raw);
        if (event !== null) yield event;
        separator = findSeparator(pending);
      }
    }

    // A stream that ends without a trailing blank line still carries an event.
    const trailing = parseEvent(pending);
    if (trailing !== null) yield trailing;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

function findSeparator(text: string): { index: number; length: number } | null {
  const lf = text.indexOf("\n\n");
  const crlf = text.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function parseEvent(raw: string): SseEvent | null {
  const dataLines: string[] = [];
  let event: string | null = null;

  for (const line of raw.split(/\r?\n/)) {
    // A line starting with a colon is a comment — that is what a heartbeat is.
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // "data: x" and "data:x" are both legal; exactly one leading space is
    // stripped.
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "data") dataLines.push(value);
    else if (field === "event") event = value;
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}
