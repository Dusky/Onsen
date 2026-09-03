import type { Database } from "bun:sqlite";
import { createEstimatingTokenizer, defaultTemplateOf, fillTemplate } from "../prompt/index.ts";
import type { BuiltPrompt } from "../prompt/index.ts";
import { activePath, speakerLookup, type SceneRow } from "../db/queries/history.ts";
import { taskConfig, templateOf } from "../db/queries/tasks.ts";
import { MEMORY_EXTRACT, taskKind } from "../tasks/registry.ts";
import type { TaskRunner } from "../tasks/runner.ts";
import {
  listEntities,
  listRelations,
  mergeExtraction,
  setEntityVector,
  turnsSince,
  type MemoryEntityRow,
} from "../db/queries/memory.ts";
import { parseExtraction } from "./extract.ts";
import { rank, type Scored } from "./salience.ts";
import { embedTexts } from "../documents/store.ts";
import type { Keyring } from "../lib/crypto.ts";

/**
 * Narrative memory (SPEC §11 layer 3, §20 phase 38).
 *
 * §11: "Runs entirely off the main generation thread." Extraction happens after
 * a turn has landed, in the same swallow-everything block as the passes and the
 * trackers; retrieval reads what is already stored and never calls a model.
 *
 * Off unless the scene says otherwise. An extraction on every scene would spend
 * a model call per turn building a structure most stories never need — which is
 * why §11 puts this third and says to build it last.
 */

const HISTORY_TURNS = 12;
const EXCERPT_LIMIT = 400;
/** How much of what is already known the extractor is shown. */
const KNOWN_LIMIT = 40;

function excerpt(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_LIMIT ? flat : `${flat.slice(0, EXCERPT_LIMIT - 1)}…`;
}

function transcriptOf(db: Database, scene: SceneRow): string {
  const speakers = speakerLookup(db);
  const lines = activePath(db, scene.id)
    .filter((row) => row.is_hidden === 0)
    .slice(-HISTORY_TURNS)
    .map((row) => {
      const who =
        row.character_id === null
          ? row.author_type === "user"
            ? "The reader"
            : "Narration"
          : (speakers.nameById.get(row.character_id) ?? "Someone");
      return `${who}: ${excerpt(row.content)}`;
    });
  return lines.length === 0 ? "(the scene has not started)" : lines.join("\n");
}

/**
 * What the extractor is told it already knows.
 *
 * Names and kinds only, not the bodies: the point is to stop it restating the
 * cast list every turn, and sending every description back would cost more
 * than the extraction it is meant to make cheaper.
 */
function knownOf(db: Database, sceneId: number): string {
  const entities = listEntities(db, sceneId).slice(0, KNOWN_LIMIT);
  if (entities.length === 0) return "(nothing yet)";
  return entities.map((entity) => `- ${entity.name} (${entity.kind})`).join("\n");
}

export function buildMemoryPrompt(question: string): BuiltPrompt {
  const tokenizer = createEstimatingTokenizer();
  const system =
    `You read a story and note what is worth remembering: people, places, objects, events and facts, ` +
    `and how they relate. You reply with JSON only — no preamble, no code fences, no explanation.`;
  const tokens = tokenizer.count(system) + tokenizer.count(question);
  return {
    system,
    messages: [{ role: "user", content: question }],
    outlets: {},
    debug: {
      mode: "author",
      tokensAreEstimated: tokenizer.isEstimate,
      tokenizerId: tokenizer.id,
      budget: tokens,
      reservedForResponse: 0,
      available: tokens,
      fixedTokens: tokenizer.count(system),
      historyTokens: tokenizer.count(question),
      totalTokens: tokens,
      headroom: 0,
      blocks: [
        {
          id: "system_prompt",
          label: "Extractor",
          source: "guided op",
          role: "system",
          content: system,
          placement: { kind: "prefix" },
          tokens: tokenizer.count(system),
        },
        {
          id: "memory",
          label: "Question",
          source: "guided op",
          role: "user",
          content: question,
          placement: { kind: "depth", depth: 0 },
          tokens: tokenizer.count(question),
        },
      ],
      evicted: [],
      historyIncluded: [],
      unresolvedOutlets: [],
      unknownMacros: [],
      loreTrace: [],
      retrievedChunks: [],
      memoryTrace: [],
    },
  };
}

export interface MemoryRunnerOptions {
  db: Database;
  keyring: Keyring;
  tasks: TaskRunner;
}

export class MemoryRunner {
  private readonly db: Database;
  private readonly keyring: Keyring;
  private readonly tasks: TaskRunner;
  private stopped = false;

  constructor(options: MemoryRunnerOptions) {
    this.db = options.db;
    this.keyring = options.keyring;
    this.tasks = options.tasks;
  }

  shutdown(): void {
    this.stopped = true;
  }

  /** Whether this scene has switched memory on and the op is enabled. */
  willRunFor(scene: SceneRow): boolean {
    if (scene.memory_enabled !== 1) return false;
    const op = taskKind(MEMORY_EXTRACT);
    if (op === null) return false;
    const row = taskConfig(this.db, op);
    return row.enabled === 1;
  }

  /**
   * Read the recent turns and fold what they establish into memory.
   *
   * Never throws. §18's rule applies with force here: an extraction that could
   * fail a turn would be worse than no memory at all, and this runs after the
   * reader has already been given their reply.
   */
  async extract(scene: SceneRow): Promise<void> {
    if (this.stopped || !this.willRunFor(scene)) return;
    const op = taskKind(MEMORY_EXTRACT);
    if (op === null) return;
    const row = taskConfig(this.db, op);

    const question = fillTemplate(templateOf(row, op) || defaultTemplateOf(MEMORY_EXTRACT), {
      transcript: transcriptOf(this.db, scene),
      known: knownOf(this.db, scene.id),
    }).trim();

    const outcome = await this.tasks.run({
      kind: op,
      sceneId: scene.id,
      fallbackProfileId: scene.connection_profile_id,
      prompt: buildMemoryPrompt(question),
    });
    if (this.stopped || !outcome.ok) return;

    const extraction = parseExtraction(outcome.text);
    if (extraction.entities.length === 0 && extraction.relations.length === 0) {
      // A turn that established nothing is the common case, not a failure.
      if (extraction.problems.length > 0) {
        this.tasks.noteUnusable(
          {
            kind: op,
            sceneId: scene.id,
            fallbackProfileId: scene.connection_profile_id,
            prompt: buildMemoryPrompt(question),
          },
          outcome.text,
          extraction.problems.join(" "),
        );
      }
      return;
    }

    mergeExtraction(this.db, scene.id, extraction, scene.active_leaf_id);
    await this.embedNew(scene.id);
  }

  /**
   * Give anything without one an embedding.
   *
   * Separate from the merge because it is I/O: the merge is a transaction over
   * rows and this is a request to a provider that may not exist. Where there is
   * no embeddings provider these stay null and retrieval takes the lexical path
   * the data bank already uses.
   */
  private async embedNew(sceneId: number): Promise<void> {
    const pending = listEntities(this.db, sceneId).filter((entity) => entity.vector === null);
    if (pending.length === 0) return;
    try {
      const vectors = await embedTexts(
        this.db,
        this.keyring,
        pending.map((entity) => `${entity.name}: ${entity.content}`),
      );
      if (vectors === null) return;
      pending.forEach((entity, index) => {
        const vector = vectors[index];
        if (vector !== undefined) setEntityVector(this.db, entity.id, vector);
      });
    } catch {
      /* No embeddings provider, or it refused. Lexical retrieval still works. */
    }
  }
}

/** One recalled memory, with everything the inspector needs to explain it. */
export interface RecalledMemory extends Scored {
  id: string;
  kind: string;
  name: string;
  content: string;
  /** The relations this entity is on either end of, as prose. */
  links: string[];
}

/**
 * What this moment recalls (SPEC §11).
 *
 * Reads what is stored and never calls a model, so it sits on the prompt path
 * without costing a round trip. The blend is in `salience.ts`; this is the
 * part that has to know about the database.
 */
export async function recall(
  db: Database,
  keyring: Keyring,
  scene: SceneRow,
  query: string,
  limit = 6,
): Promise<RecalledMemory[]> {
  if (scene.memory_enabled !== 1) return [];
  const entities = listEntities(db, scene.id);
  if (entities.length === 0) return [];

  const similarity = await similarityOf(db, keyring, entities, query);
  const relations = listRelations(db, scene.id);
  const nameById = new Map(entities.map((entity) => [entity.id, entity.name]));

  const scorable = entities.map((entity, index) => ({
    id: entity.ulid,
    kind: entity.kind,
    name: entity.name,
    content: entity.content,
    similarity: similarity[index] ?? 0,
    salience: entity.salience,
    turnsSince: turnsSince(db, scene.id, entity.last_seen_message_id),
    userEdited: entity.user_edited === 1,
    links: relations
      .filter((relation) => relation.from_entity_id === entity.id || relation.to_entity_id === entity.id)
      .map((relation) => {
        const from = nameById.get(relation.from_entity_id) ?? "something";
        const to = nameById.get(relation.to_entity_id) ?? "something";
        return `${from} ${relation.kind} ${to}${relation.content === "" ? "" : ` — ${relation.content}`}`;
      }),
  }));

  return rank(scorable, limit);
}

/**
 * Cosine similarity to the query, per entity.
 *
 * Falls back to a lexical overlap where there is no embeddings provider — the
 * same trade the data bank makes, and better than scoring everything zero,
 * which would turn the blend back into salience alone.
 */
async function similarityOf(
  db: Database,
  keyring: Keyring,
  entities: MemoryEntityRow[],
  query: string,
): Promise<number[]> {
  const stored = entities.map((entity) => {
    if (entity.vector === null) return null;
    try {
      return JSON.parse(entity.vector) as number[];
    } catch {
      return null;
    }
  });

  if (stored.some((vector) => vector !== null)) {
    try {
      const queryVectors = await embedTexts(db, keyring, [query]);
      const queryVector = queryVectors?.[0];
      if (queryVector !== undefined && queryVector.length > 0) {
        return stored.map((vector) => (vector === null ? 0 : cosine(queryVector, vector)));
      }
    } catch {
      /* Fall through to lexical. */
    }
  }

  const wanted = new Set(words(query));
  if (wanted.size === 0) return entities.map(() => 0);
  return entities.map((entity) => {
    const have = new Set(words(`${entity.name} ${entity.content}`));
    if (have.size === 0) return 0;
    let shared = 0;
    for (const word of wanted) if (have.has(word)) shared += 1;
    return shared / Math.sqrt(wanted.size * have.size);
  });
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length > 2);
}

function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < length; index++) {
    const x = a[index]!;
    const y = b[index]!;
    dot += x * y;
    left += x * x;
    right += y * y;
  }
  if (left === 0 || right === 0) return 0;
  return dot / (Math.sqrt(left) * Math.sqrt(right));
}
