/**
 * The `Name:` a model writes to imitate the history format (§20 phase 216).
 *
 * The prompt renders past turns as `Name: content`, so a model often opens its
 * own spotlight turn the same way — and the log has already attributed that
 * turn, so the name reads twice and feeds back into the next prompt doubled
 * ("Daphne: Daphne: …").
 *
 * Shared because both ends of the same turn need the identical answer
 * (§20 phase 223). The server strips it in `land()`, which is what gets stored;
 * the client strips it in the streaming tail, which is what the reader watches
 * arrive. When only the server did it, a turn streamed *with* the prefix and
 * lost it the instant it settled — the reader saw the text jump. `MessageLog`'s
 * own comment beside that tail already names the principle it was breaking:
 * prose that "reflows the instant the turn completes… reads as the app changing
 * its mind".
 *
 * Only the speaker's *own* name, and only at the very start. A name later in
 * the prose is dialogue, not a header. A beat's `**Name:**` labels are per-part
 * attribution and are never stripped, which is the caller's business — the
 * server passes a spotlight's character, the client checks the scope.
 */

/** Escape a name for use inside a regular expression. */
function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `content` without a leading `Name:` or `**Name:**` matching `name`.
 *
 * Case-insensitive and whitespace-tolerant, because a model that imitates the
 * format rarely matches its spacing. Returns `content` unchanged when `name` is
 * empty or the prefix is not there, so it is safe to call on every frame of a
 * stream.
 */
export function stripSpeakerPrefix(content: string, name: string | null): string {
  const speaker = name?.trim();
  if (speaker === undefined || speaker === "") return content;
  const escaped = escape(speaker);
  return content.replace(
    new RegExp(`^\\s*(?:\\*\\*${escaped}\\s*:\\*\\*|${escaped}\\s*:)\\s*`, "i"),
    "",
  );
}

/**
 * The same strip, for text that is still arriving.
 *
 * A stream delivers the prefix a character at a time, so for a few frames the
 * buffer is `"Dap"` — a prefix of the name with no colon yet, which the strip
 * above leaves alone and which would therefore flash on screen before
 * disappearing. This holds those frames back: while the text so far is still a
 * possible beginning of `Name:`, there is nothing to show yet.
 *
 * It only ever hides a few characters for a few frames, and only when the model
 * has in fact started writing the speaker's name.
 */
export function stripStreamingPrefix(content: string, name: string | null): string {
  const speaker = name?.trim();
  if (speaker === undefined || speaker === "") return content;

  const stripped = stripSpeakerPrefix(content, speaker);
  if (stripped !== content) return stripped;

  // Still arriving: `Daph`, `**Daphne`, `Daphne`, `Daphne:` with no space yet.
  const lower = content.trimStart().toLowerCase();
  const bare = speaker.toLowerCase();
  const bold = `**${bare}`;
  const couldBecome =
    bare.startsWith(lower) ||
    bold.startsWith(lower) ||
    lower === `${bare}:` ||
    lower === `${bold}:` ||
    lower === `${bold}:*`;
  return couldBecome ? "" : content;
}
