import type { Database } from "bun:sqlite";

/**
 * Display-only translations (SPEC §20 phase 78).
 *
 * A translation is a viewing layer: it lives beside the message rather than in
 * it, so the stored text and the prompt keep the language the author writes in.
 * These are the reads and writes that layer needs.
 */

/** Write one, replacing any earlier translation for the same language. */
export function upsertTranslation(
  db: Database,
  messageId: number,
  language: string,
  text: string,
): void {
  db.query(
    `INSERT INTO message_translations (message_id, language, text, created_at)
     VALUES ($message, $language, $text, $now)
     ON CONFLICT (message_id, language)
     DO UPDATE SET text = $text, created_at = $now`,
  ).run({ message: messageId, language, text, now: Date.now() });
}

/** The translation for each of a set of messages, for one language. */
export function translationsFor(
  db: Database,
  messageIds: number[],
  language: string,
): Map<number, string> {
  if (messageIds.length === 0) return new Map();
  const placeholders = messageIds.map(() => "?").join(", ");
  const rows = db
    .query(
      `SELECT message_id, text FROM message_translations
        WHERE language = ? AND message_id IN (${placeholders})`,
    )
    .all(language, ...messageIds) as { message_id: number; text: string }[];
  return new Map(rows.map((row) => [row.message_id, row.text]));
}
