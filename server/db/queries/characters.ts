import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import { createEstimatingTokenizer } from "../../prompt/index.ts";
import { unmodelledFieldsOfDocument, type NormalisedCard } from "../../cards/index.ts";
import type {
  CardFormat,
  CardTokenCosts,
  CharacterDto,
  PromptRoleName,
} from "../../../shared/types.ts";

/**
 * Character storage (SPEC §2, §9).
 *
 * The typed columns are a *view* of the card. `raw_card` holds the original
 * document verbatim, and export re-emits from it with these fields overlaid —
 * which is what makes a round trip lossless for fields this app never modelled.
 */

export interface CharacterRow {
  id: number;
  ulid: string;
  name: string;
  avatar_path: string | null;
  description: string | null;
  personality: string | null;
  scenario: string | null;
  first_message: string | null;
  alternate_greetings: string;
  group_greetings: string;
  example_dialogue: string | null;
  voice_notes: string | null;
  depth_prompt: string | null;
  depth_prompt_depth: number;
  depth_prompt_role: PromptRoleName;
  system_prompt: string | null;
  post_history_instructions: string | null;
  creator_notes: string | null;
  tags: string;
  creator: string | null;
  character_version: string | null;
  raw_card: string;
  raw_card_format: CardFormat;
  extensions: string;
  source_filename: string | null;
  source_hash: string | null;
  folder: string | null;
  parent_character_id: number | null;
  created_at: number;
  updated_at: number;
}

function parseArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function parseObject(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Per-field costs for the editor. Computed here rather than in the client so
 * there is one tokenizer in the system and the numbers cannot disagree.
 */
export function tokenCostsFor(row: CharacterRow): CardTokenCosts {
  const tokenizer = createEstimatingTokenizer();
  const count = (value: string | null) => (value === null ? 0 : tokenizer.count(value));

  const costs = {
    description: count(row.description),
    personality: count(row.personality),
    scenario: count(row.scenario),
    firstMessage: count(row.first_message),
    exampleDialogue: count(row.example_dialogue),
    voiceNotes: count(row.voice_notes),
    depthPrompt: count(row.depth_prompt),
  };

  return {
    ...costs,
    // The first message is history rather than definition, so it is not part of
    // what the card costs the prompt every turn.
    total:
      costs.description +
      costs.personality +
      costs.scenario +
      costs.voiceNotes +
      costs.depthPrompt,
    estimated: tokenizer.isEstimate,
  };
}

/**
 * Fields the original card carries that the editor does not show. Read from
 * `raw_card` rather than recomputed from the columns, so it reports what is
 * genuinely preserved rather than what happened to be normalised.
 */
function unmodelledOf(row: CharacterRow): string[] {
  return unmodelledFieldsOfDocument(row.raw_card);
}

export function toCharacterDto(db: Database, row: CharacterRow): CharacterDto {
  return {
    id: row.ulid,
    name: row.name,
    hasAvatar: row.avatar_path !== null,
    description: row.description,
    personality: row.personality,
    scenario: row.scenario,
    firstMessage: row.first_message,
    alternateGreetings: parseArray(row.alternate_greetings),
    groupGreetings: parseArray(row.group_greetings),
    exampleDialogue: row.example_dialogue,
    voiceNotes: row.voice_notes,
    depthPrompt: row.depth_prompt,
    depthPromptDepth: row.depth_prompt_depth,
    depthPromptRole: row.depth_prompt_role,
    systemPrompt: row.system_prompt,
    postHistoryInstructions: row.post_history_instructions,
    creatorNotes: row.creator_notes,
    tags: parseArray(row.tags),
    creator: row.creator,
    characterVersion: row.character_version,
    format: row.raw_card_format,
    folder: row.folder,
    parentId: parentUlidOf(db, row.parent_character_id),
    unmodelledFields: unmodelledOf(row),
    tokens: tokenCostsFor(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Rebuild the normalised card a row came from, for export. */
export function toNormalisedCard(row: CharacterRow): NormalisedCard {
  return {
    name: row.name,
    description: row.description,
    personality: row.personality,
    scenario: row.scenario,
    firstMessage: row.first_message,
    alternateGreetings: parseArray(row.alternate_greetings),
    groupGreetings: parseArray(row.group_greetings),
    exampleDialogue: row.example_dialogue,
    systemPrompt: row.system_prompt,
    postHistoryInstructions: row.post_history_instructions,
    creatorNotes: row.creator_notes,
    tags: parseArray(row.tags),
    creator: row.creator,
    characterVersion: row.character_version,
    depthPrompt: row.depth_prompt,
    depthPromptDepth: row.depth_prompt_depth,
    depthPromptRole: row.depth_prompt_role,
    extensions: parseObject(row.extensions),
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export interface NewCharacter {
  card: NormalisedCard;
  rawCard: string;
  format: CardFormat;
  avatarPath: string | null;
  sourceFilename: string | null;
  sourceHash: string | null;
  /** Voice notes are ours, not a card field, so they start empty on import. */
  voiceNotes?: string | null;
}

export function insertCharacter(db: Database, input: NewCharacter): CharacterRow {
  const now = Date.now();
  const row = db
    .query(
      `INSERT INTO characters (
         ulid, name, avatar_path, description, personality, scenario, first_message,
         alternate_greetings, group_greetings, example_dialogue, voice_notes,
         depth_prompt, depth_prompt_depth, depth_prompt_role,
         system_prompt, post_history_instructions, creator_notes, tags, creator,
         character_version, raw_card, raw_card_format, extensions,
         source_filename, source_hash, created_at, updated_at
       ) VALUES (
         $ulid, $name, $avatar_path, $description, $personality, $scenario, $first_message,
         $alternate_greetings, $group_greetings, $example_dialogue, $voice_notes,
         $depth_prompt, $depth_prompt_depth, $depth_prompt_role,
         $system_prompt, $post_history_instructions, $creator_notes, $tags, $creator,
         $character_version, $raw_card, $raw_card_format, $extensions,
         $source_filename, $source_hash, $now, $now
       ) RETURNING *`,
    )
    .get({
      ulid: ulid(),
      name: input.card.name,
      avatar_path: input.avatarPath,
      description: input.card.description,
      personality: input.card.personality,
      scenario: input.card.scenario,
      first_message: input.card.firstMessage,
      alternate_greetings: JSON.stringify(input.card.alternateGreetings),
      group_greetings: JSON.stringify(input.card.groupGreetings),
      example_dialogue: input.card.exampleDialogue,
      voice_notes: input.voiceNotes ?? null,
      depth_prompt: input.card.depthPrompt,
      depth_prompt_depth: input.card.depthPromptDepth,
      depth_prompt_role: input.card.depthPromptRole,
      system_prompt: input.card.systemPrompt,
      post_history_instructions: input.card.postHistoryInstructions,
      creator_notes: input.card.creatorNotes,
      tags: JSON.stringify(input.card.tags),
      creator: input.card.creator,
      character_version: input.card.characterVersion,
      raw_card: input.rawCard,
      raw_card_format: input.format,
      extensions: JSON.stringify(input.card.extensions),
      source_filename: input.sourceFilename,
      source_hash: input.sourceHash,
      now,
    }) as CharacterRow;

  // The baseline snapshot — the card as it arrived — so restore can always
  // take the character back to unedited (SPEC §9).
  snapshotCharacter(db, row);
  return row;
}

export function listCharacters(db: Database): CharacterRow[] {
  return db
    .query("SELECT * FROM characters ORDER BY name COLLATE NOCASE")
    .all() as CharacterRow[];
}

export function findCharacter(db: Database, value: string): CharacterRow | null {
  return (db.query("SELECT * FROM characters WHERE ulid = $ulid").get({ ulid: value }) ??
    null) as CharacterRow | null;
}

/** The parsed-card cache: an identical file is recognised, not re-imported. */
export function findByHash(db: Database, hash: string): CharacterRow | null {
  return (db.query("SELECT * FROM characters WHERE source_hash = $hash").get({ hash }) ??
    null) as CharacterRow | null;
}

/** Column names that may be patched, mapped from their request field names. */
const PATCHABLE = {
  name: "name",
  description: "description",
  personality: "personality",
  scenario: "scenario",
  firstMessage: "first_message",
  exampleDialogue: "example_dialogue",
  voiceNotes: "voice_notes",
  depthPrompt: "depth_prompt",
  depthPromptDepth: "depth_prompt_depth",
  depthPromptRole: "depth_prompt_role",
  systemPrompt: "system_prompt",
  postHistoryInstructions: "post_history_instructions",
  creatorNotes: "creator_notes",
  creator: "creator",
  characterVersion: "character_version",
  folder: "folder",
} as const;

const PATCHABLE_ARRAYS = {
  alternateGreetings: "alternate_greetings",
  groupGreetings: "group_greetings",
  tags: "tags",
} as const;

export function updateCharacter(
  db: Database,
  id: number,
  patch: Record<string, unknown>,
): CharacterRow {
  const assignments: string[] = [];
  // bun:sqlite's binding type is a union of scalars; a dynamically built
  // parameter object has to be widened to satisfy it.
  const params: Record<string, string | number | null> = { id, now: Date.now() };

  for (const [field, column] of Object.entries(PATCHABLE)) {
    if (!(field in patch)) continue;
    assignments.push(`${column} = $${column}`);
    const value = patch[field];
    params[column] =
      typeof value === "string" || typeof value === "number" ? value : null;
  }
  for (const [field, column] of Object.entries(PATCHABLE_ARRAYS)) {
    if (!(field in patch)) continue;
    assignments.push(`${column} = $${column}`);
    params[column] = JSON.stringify(patch[field] ?? []);
  }

  if (assignments.length === 0) {
    return db.query("SELECT * FROM characters WHERE id = $id").get({ id }) as CharacterRow;
  }

  // A save is a version: snapshot what is about to change, then change it.
  // Bulk tag/folder moves bypass this path, which is why organisational churn
  // does not fill the history with noise (SPEC §9).
  const before = db.query("SELECT * FROM characters WHERE id = $id").get({ id }) as CharacterRow;
  if (before !== null) snapshotCharacter(db, before);

  return db
    .query(
      `UPDATE characters SET ${assignments.join(", ")}, updated_at = $now
        WHERE id = $id RETURNING *`,
    )
    .get(params) as CharacterRow;
}

export function deleteCharacter(db: Database, id: number): void {
  db.query("DELETE FROM characters WHERE id = $id").run({ id });
}

/** The ulid of a character's parent variant, or null (SPEC §9). */
function parentUlidOf(db: Database, parentId: number | null): string | null {
  if (parentId === null) return null;
  const row = db.query("SELECT ulid FROM characters WHERE id = $id").get({ id: parentId }) as
    | { ulid: string }
    | null;
  return row?.ulid ?? null;
}

/* ------------------------------------------------------------------ */
/* Version snapshots (SPEC §9)                                        */
/* ------------------------------------------------------------------ */

/** The fields a snapshot remembers — the editor's own shape, minus folder. */
function snapshotOfCharacter(row: CharacterRow): Record<string, unknown> {
  return {
    name: row.name,
    description: row.description,
    personality: row.personality,
    scenario: row.scenario,
    firstMessage: row.first_message,
    alternateGreetings: parseArray(row.alternate_greetings),
    groupGreetings: parseArray(row.group_greetings),
    exampleDialogue: row.example_dialogue,
    voiceNotes: row.voice_notes,
    depthPrompt: row.depth_prompt,
    depthPromptDepth: row.depth_prompt_depth,
    depthPromptRole: row.depth_prompt_role,
    systemPrompt: row.system_prompt,
    postHistoryInstructions: row.post_history_instructions,
    creatorNotes: row.creator_notes,
    tags: parseArray(row.tags),
    creator: row.creator,
    characterVersion: row.character_version,
  };
}

/** Record a snapshot of the row's current state — the state *before* an edit. */
export function snapshotCharacter(db: Database, row: CharacterRow): void {
  db.query(
    `INSERT INTO character_versions (ulid, character_id, snapshot, created_at)
     VALUES ($ulid, $character, $snapshot, $now)`,
  ).run({
    ulid: ulid(),
    character: row.id,
    snapshot: JSON.stringify(snapshotOfCharacter(row)),
    now: Date.now(),
  });
}
