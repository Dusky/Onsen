import foundation from "./0001_foundation.sql" with { type: "text" };
import history from "./0002_history.sql" with { type: "text" };
import generation from "./0003_generation.sql" with { type: "text" };
import characters from "./0004_characters.sql" with { type: "text" };
import authors from "./0005_authors.sql" with { type: "text" };
import groupScenes from "./0006_group_scenes.sql" with { type: "text" };
import segments from "./0007_segments.sql" with { type: "text" };
import director from "./0008_director.sql" with { type: "text" };
import tasks from "./0009_tasks.sql" with { type: "text" };
import steer from "./0010_steer.sql" with { type: "text" };
import opConfig from "./0011_op_config.sql" with { type: "text" };
import passes from "./0012_passes.sql" with { type: "text" };
import guides from "./0013_guides.sql" with { type: "text" };
import summaries from "./0014_summaries.sql" with { type: "text" };
import reasoning from "./0015_reasoning.sql" with { type: "text" };
import options from "./0016_options.sql" with { type: "text" };
import scenarioOverride from "./0017_scenario_override.sql" with { type: "text" };

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
  { version: 7, name: "segments", sql: segments },
  { version: 8, name: "director", sql: director },
  { version: 9, name: "tasks", sql: tasks },
  { version: 10, name: "steer", sql: steer },
  { version: 11, name: "op_config", sql: opConfig },
  { version: 12, name: "passes", sql: passes },
  { version: 13, name: "guides", sql: guides },
  { version: 14, name: "summaries", sql: summaries },
  { version: 15, name: "reasoning", sql: reasoning },
  { version: 16, name: "options", sql: options },
  { version: 17, name: "scenario_override", sql: scenarioOverride },
];
