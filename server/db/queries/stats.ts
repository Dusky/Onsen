import type { Database } from "bun:sqlite";

/**
 * Aggregate stats for a scene (§20 phase 128).
 *
 * The per-message readout already shows what one turn cost; this rolls the
 * whole scene up so a reader can see it at a glance: how many messages, how
 * many words, and who has been carrying the conversation. Word counts are a
 * plain whitespace split — an estimate, and labelled as such by being a count
 * rather than a token figure.
 */

export interface SceneStats {
  messages: number;
  userMessages: number;
  aiMessages: number;
  words: number;
  byCharacter: { name: string; messages: number; words: number }[];
}

export function sceneStats(db: Database, sceneId: number): SceneStats {
  const rows = db
    .query(
      `SELECT m.author_type, m.content, c.name AS speaker
         FROM messages m
         LEFT JOIN characters c ON c.id = m.character_id
        WHERE m.scene_id = $scene AND m.is_hidden = 0`,
    )
    .all({ scene: sceneId }) as {
    author_type: string;
    speaker: string | null;
    content: string;
  }[];

  const wordsOf = (text: string): number =>
    text.trim().split(/\s+/).filter((part) => part !== "").length;

  const totals = { messages: rows.length, userMessages: 0, aiMessages: 0, words: 0 };
  const by = new Map<string, { name: string; messages: number; words: number }>();

  for (const row of rows) {
    const words = wordsOf(row.content);
    totals.words += words;
    if (row.author_type === "user") totals.userMessages += 1;
    else if (row.author_type === "character" || row.author_type === "narrator") {
      totals.aiMessages += 1;
    }
    if (row.speaker !== null) {
      const entry = by.get(row.speaker) ?? {
        name: row.speaker,
        messages: 0,
        words: 0,
      };
      entry.messages += 1;
      entry.words += words;
      by.set(row.speaker, entry);
    }
  }

  return {
    ...totals,
    byCharacter: [...by.values()].sort((a, b) => b.messages - a.messages),
  };
}
