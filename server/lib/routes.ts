/**
 * The four things every route file was writing for itself.
 *
 * Found by a code-quality audit, and the interesting part is not the
 * duplication — `badRequest` was byte-identical in twenty files, which costs
 * nothing but lines. It is that two of them had *drifted into two different
 * behaviours under one name*:
 *
 *   - `connections.ts` and `media.ts` had `text()` trim its input and reject
 *     the empty string.
 *   - `dossiers.ts`, `quick-replies.ts`, `scripts.ts`, `triggers.ts` and
 *     `webhooks.ts` had `text()` slice only, and accept `""`.
 *
 * So a webhook named `"   "` was valid where a connection profile of the same
 * name was not, and nothing at either call site said which `text` was in
 * scope. Both behaviours are wanted — a *name* must not be blank, and a regex
 * script's `replacement` is legitimately emptied to delete what it matched —
 * which is exactly why they cannot share a name. They are `requiredText` and
 * `optionalText` here, and a reader can tell them apart without scrolling to
 * the top of the file.
 *
 * Two readers stay behind, deliberately. `connections.ts`'s `readJson` returns
 * `null` on a body that is not an object and `scenes.ts`'s returns a sentinel
 * symbol, and each route then answers differently — which of those a route
 * wants is a decision about its API, not boilerplate.
 */

/** The app's 400 body. Pair it with `c.json(badRequest(...), 400)`. */
export function badRequest(message: string) {
  return { error: { code: "bad_request", message } } as const;
}

/** The app's 404 body. `what` is a bare noun: "scene", "webhook", "theme". */
export function notFound(what: string) {
  return { error: { code: "not_found", message: `No such ${what}.` } } as const;
}

/**
 * A JSON body as an object, and an empty one for anything else.
 *
 * The contract every route that treats a malformed body as "no fields given"
 * wants: unparseable JSON, a bare array, a string, or no body at all all come
 * back as `{}`, and the route's own per-field validation then decides. A route
 * that needs to *refuse* a malformed body should say so itself rather than
 * inferring it from an empty object.
 */
export async function body(c: {
  req: { json(): Promise<unknown> };
}): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await c.req.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * A field that must carry something: trimmed, capped, and `null` when it is
 * absent, the wrong type, or blank once trimmed.
 *
 * For names, URLs and identifiers — anything where `""` is not a value the
 * reader could have meant.
 */
export function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
}

/**
 * A field that may be anything the reader typed, including nothing: capped,
 * untrimmed, and `undefined` only when the field was absent or not a string.
 *
 * `undefined` therefore means "the request did not mention this", which is
 * what a PATCH handler needs in order to leave a stored value alone — and it
 * keeps `""` distinguishable from that, because a regex script's `replacement`
 * is emptied on purpose.
 */
export function optionalText(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}
