import foundation from "./0001_foundation.sql" with { type: "text" };
import history from "./0002_history.sql" with { type: "text" };
import generation from "./0003_generation.sql" with { type: "text" };
import characters from "./0004_characters.sql" with { type: "text" };
import authors from "./0005_authors.sql" with { type: "text" };
import groupScenes from "./0006_group_scenes.sql" with { type: "text" };

export interface Migration {
  /** Monotonic, gapless, never reordered once merged. */
  version: number;
  name: string;
  sql: string;
}

/**
 * Migrations are imported as text rather than read from disk so that
 * `bun build --compile` produces a working single-file executable (SPEC §1).
 * Adding a migration means adding a line here, which also makes the ordering
 * reviewable in a diff.
 */
export const migrations: readonly Migration[] = [
  { version: 1, name: "foundation", sql: foundation },
  { version: 2, name: "history", sql: history },
  { version: 3, name: "generation", sql: generation },
  { version: 4, name: "characters", sql: characters },
  { version: 5, name: "authors", sql: authors },
  { version: 6, name: "group_scenes", sql: groupScenes },
];
