import type { Database } from "bun:sqlite";
import { listScripts } from "../db/queries/scripts.ts";
import {
  applyScripts,
  scriptsFor,
  type ApplyResult,
  type ApplyStage,
  type RegexScript,
  type ScriptEnvironment,
} from "./apply.ts";

/**
 * Where the pure engine meets the database (SPEC §14).
 *
 * The four stages differ in what they touch, and the difference is the reason
 * there are four rather than one switch:
 *
 * - `user_input` and `ai_output` rewrite a message **before it is stored**.
 *   Permanent, and the model sees the result.
 * - `display_only` changes what the reader is shown and nothing else. The
 *   stored text and the prompt keep the original, which is what makes it the
 *   safe stage to experiment in.
 * - `prompt` changes the transcript on its way into a generation and writes
 *   nothing.
 *
 * A caller loads the scripts once and applies them many times. That split
 * exists because the display stage runs over a whole transcript: reading the
 * table per message would turn opening a scene into a query per turn.
 */

/** The scripts, loaded once, with the names their replacements can reach. */
export interface ScriptContext {
  scripts: RegexScript[];
  env: ScriptEnvironment;
  /** Null outside a scene — the stage that rewrites a message as it is typed. */
  sceneId: string | null;
}

interface Names {
  personaName: string | null;
  cast: string[];
}

function namesForScene(db: Database, sceneId: number | null): Names {
  if (sceneId === null) return { personaName: null, cast: [] };
  const persona = db
    .query(
      `SELECT p.name AS name FROM scenes s
         JOIN personas p ON p.id = s.persona_id
        WHERE s.id = $id`,
    )
    .get({ id: sceneId }) as { name: string } | null;
  const cast = db
    .query(
      `SELECT c.name AS name FROM scene_members m
         JOIN characters c ON c.id = m.character_id
        WHERE m.scene_id = $id AND m.is_active = 1
        ORDER BY m.display_order`,
    )
    .all({ id: sceneId }) as { name: string }[];
  return { personaName: persona?.name ?? null, cast: cast.map((row) => row.name) };
}

function sceneUlid(db: Database, sceneId: number | null): string | null {
  if (sceneId === null) return null;
  const row = db.query("SELECT ulid FROM scenes WHERE id = $id").get({ id: sceneId }) as
    | { ulid: string }
    | null;
  return row?.ulid ?? null;
}

/** A character's external id and name together - both stages need both. */
export function speakerOf(
  db: Database,
  characterId: number | null,
): { id: string | null; name: string | null } {
  if (characterId === null) return { id: null, name: null };
  const row = db
    .query("SELECT ulid, name FROM characters WHERE id = $id")
    .get({ id: characterId }) as { ulid: string; name: string } | null;
  return { id: row?.ulid ?? null, name: row?.name ?? null };
}

/**
 * Load everything the stages below need for one scene.
 *
 * `now` is read here rather than inside the engine, which is the same rule
 * `/prompt` follows: the impure edge takes one reading and hands it in, so the
 * test panel can pass its own and get an answer it can assert on.
 */
export function scriptContext(db: Database, sceneId: number | null): ScriptContext {
  const { personaName, cast } = namesForScene(db, sceneId);
  return {
    scripts: listScripts(db),
    sceneId: sceneUlid(db, sceneId),
    env: { char: null, user: personaName, cast, now: Date.now() },
  };
}

/**
 * Run one stage over one piece of text.
 *
 * `speaker` is who the text belongs to — the spotlight for a generated turn,
 * the message's own character when rewriting a transcript. It decides both
 * which character-scoped scripts apply and what `{{char}}` resolves to.
 */
export function runStage(
  context: ScriptContext,
  stage: ApplyStage,
  text: string,
  speaker?: { id: string | null; name: string | null },
): ApplyResult {
  const selected = scriptsFor(context.scripts, {
    stage,
    characterId: speaker?.id ?? null,
    sceneId: context.sceneId,
  });
  if (selected.length === 0) return { text, runs: [] };
  return applyScripts(text, selected, { ...context.env, char: speaker?.name ?? null });
}

/**
 * The convenience the write paths want: a stage applied for its text, with the
 * trace dropped.
 *
 * Dropping it is deliberate at these call sites. A script that rewrites a
 * stored message has already had its trace read in the test panel; carrying one
 * through the generation service would be a second reporting channel nothing
 * displays.
 */
export function scriptText(
  db: Database,
  stage: ApplyStage,
  text: string,
  where: { sceneId: number | null; characterId?: number | null },
): string {
  const context = scriptContext(db, where.sceneId);
  if (context.scripts.length === 0) return text;
  return runStage(context, stage, text, speakerOf(db, where.characterId ?? null)).text;
}
