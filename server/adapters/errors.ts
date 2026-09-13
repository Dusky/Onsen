/**
 * What a provider said went wrong, in words (§16, §20 phase 182).
 *
 * Every provider answers a failure with a JSON envelope and the useful part
 * buried one or two keys down. Showing the envelope raw is showing the reader
 * plumbing: `{"error":{"message":"The supported API models are …` is a
 * sentence wearing a costume, and the costume is what gets cut off first when
 * the space is tight.
 *
 * This existed three times — once per adapter, near-identically — and a fourth
 * time in `connections.ts`'s Test button, written later and worse: that one
 * showed the raw body and clipped it at 200 characters, so a reader testing a
 * DeepSeek key saw `HTTP 400: {"error":{"message":"The supported API model n`
 * and no way to learn the rest. One copy, used by all four.
 */

/** The shapes providers actually send. Nothing here assumes one vendor. */
interface ErrorEnvelope {
  /** OpenAI-compatible and Anthropic both nest it; some servers send a string. */
  error?: { message?: unknown; type?: unknown } | string;
  /** llama.cpp and friends sometimes put it at the top level. */
  message?: unknown;
  detail?: unknown;
}

/**
 * How much of an unparseable body is worth keeping.
 *
 * Generous on purpose: the cases that reach here are the ones nobody
 * anticipated, and a truncated mystery is harder to act on than a long one.
 * The reader sees it in a panel that wraps, not a single clipped line.
 */
const RAW_LIMIT = 2000;

/** Pull the human sentence out of a provider's error body. */
export function providerErrorMessage(text: string): string | null {
  if (text === "") return null;
  try {
    const parsed = JSON.parse(text) as ErrorEnvelope;
    if (typeof parsed.error === "string" && parsed.error !== "") return parsed.error;
    if (typeof parsed.error === "object" && parsed.error !== null) {
      const { message } = parsed.error;
      if (typeof message === "string" && message !== "") return message;
    }
    // Top-level, for the servers that do not nest.
    for (const key of ["message", "detail"] as const) {
      const value = parsed[key];
      if (typeof value === "string" && value !== "") return value;
    }
  } catch {
    /* Not JSON; the raw body is still the most useful thing to show. */
  }
  return text.slice(0, RAW_LIMIT);
}

/** The same, from a `Response` whose body has not been read yet. */
export async function readErrorBody(response: Response): Promise<string | null> {
  try {
    return providerErrorMessage(await response.text());
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Where each kind's calls actually go                                 */
/* ------------------------------------------------------------------ */

/**
 * The chat path an adapter appends to a provider's address (§20 phase 182).
 *
 * Here rather than as three literals because the Test button had its own copy
 * and the copies disagreed: it used `/messages` for Anthropic while the
 * adapter uses `v1/messages`, so an Anthropic address ending in `/v1` passed
 * the test and 404'd on every turn at `…/v1/v1/messages`. A test that checks
 * a different URL than the turn is a test that can pass while the app is
 * broken — the same family as a status readout disagreeing with the turn.
 *
 * The corollary, which the presets have to honour: an OpenAI-compatible or
 * text-completion address includes its own `/v1`, and an Anthropic one does
 * not, because the adapter supplies it.
 */
export function chatPathFor(kind: string): string {
  switch (kind) {
    case "anthropic":
      return "v1/messages";
    case "text_completion":
      return "completions";
    default:
      return "chat/completions";
  }
}

/** Join an address and a path without doubling or dropping the separator. */
export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
