import type { Database } from "bun:sqlite";
import { createEstimatingTokenizer, defaultTemplateOf, fillTemplate } from "../prompt/index.ts";
import type { BuiltPrompt } from "../prompt/index.ts";
import { activePath, speakerLookup, type SceneRow } from "../db/queries/history.ts";
import { taskConfig, templateOf } from "../db/queries/tasks.ts";
import { AUTHOR_REMEMBER, taskKind } from "../tasks/registry.ts";
import type { TaskRunner } from "../tasks/runner.ts";
import {
  insertEntry,
  insertLorebook,
  listEntries,
  memoryBookOf,
  updateEntry,
  type LorebookRow,
} from "../db/queries/lore.ts";
import { findAuthorById, type AuthorRow } from "../db/queries/authors.ts";

/**
 * Author memory (SPEC §11, §20 phase 39).
 *
 * "Implemented as a lorebook with `owner_author_id` set, so it reuses keyword
 * activation, budgeting, and the editor." Nothing here is a second retrieval
 * mechanism or a second editor — an entry the author writes is an ordinary lore
 * entry that happens to say who wrote it, and §10 does the rest.
 *
 * §11 is emphatic about the posture: "Keep it strictly opt-in. An author that
 * silently accumulates notes about the user is a different product with
 * different expectations." So this never runs unasked. It runs when the reader
 * presses a button, and only for an author that has memory switched on.
 */

const HISTORY_TURNS = 16;
const EXCERPT_LIMIT = 400;
/** How many existing notes the author is reminded of, so it does not repeat. */
const KNOWN_LIMIT = 30;

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
 * The author's own book, made on first use rather than at author creation.
 *
 * A book that existed for every author from the start would appear in the
 * lorebooks list as an empty thing the reader did not make and cannot explain.
 */
export function ensureMemoryBook(db: Database, author: AuthorRow): LorebookRow {
  const existing = memoryBookOf(db, author.id);
  if (existing !== null) return existing;
  const book = insertLorebook(db, {
    name: `${author.name}'s memory`,
    description: "What this writing partner remembers across roleplays (SPEC §11).",
  });
  db.query("UPDATE lorebooks SET owner_author_id = $author WHERE id = $id").run({
    id: book.id,
    author: author.id,
  });
  return { ...book, owner_author_id: author.id };
}

export function buildRememberPrompt(question: string, authorName: string): BuiltPrompt {
  const tokenizer = createEstimatingTokenizer();
  const system =
    `You are ${authorName}, a writing partner keeping notes for yourself across roleplays. ` +
    `You reply with JSON only — no preamble, no code fences, no explanation.`;
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
          label: "Author memory",
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

/** What the author wrote, once it is readable. */
export interface RememberedNote {
  title: string;
  keys: string[];
  content: string;
}

/**
 * Read the author's answer.
 *
 * Pure, and forgiving in the same two ways the entity extractor is: prose
 * around the JSON is a habit rather than a failure, and a note with no keys is
 * still a note — the title stands in, because an entry with no keys would never
 * activate and would be a note nobody ever sees again.
 */
export function parseNote(reply: string): RememberedNote | null {
  const trimmed = reply.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const row = parsed as Record<string, unknown>;

  const content = typeof row["content"] === "string" ? row["content"].trim().slice(0, 2_000) : "";
  if (content === "") return null;
  const title = typeof row["title"] === "string" ? row["title"].trim().slice(0, 200) : "";

  const keys = Array.isArray(row["keys"])
    ? row["keys"]
        .filter((key): key is string => typeof key === "string")
        .map((key) => key.trim())
        .filter((key) => key !== "")
        .slice(0, 20)
    : [];

  return {
    title: title === "" ? content.slice(0, 60) : title,
    // Without a key an entry never activates, which makes it a note nobody
    // sees again. The title is a worse key than a considered one and a far
    // better one than none.
    keys: keys.length > 0 ? keys : [title === "" ? content.slice(0, 40) : title],
    content,
  };
}

export interface AuthorMemoryOptions {
  db: Database;
  tasks: TaskRunner;
}

export class AuthorMemory {
  private readonly db: Database;
  private readonly tasks: TaskRunner;
  private stopped = false;

  constructor(options: AuthorMemoryOptions) {
    this.db = options.db;
    this.tasks = options.tasks;
  }

  shutdown(): void {
    this.stopped = true;
  }

  /**
   * Write one note about this scene into the author's book.
   *
   * Awaited by its route, unlike the extractor: the reader pressed a button and
   * is waiting to see what the author wrote. Returns null when there was
   * nothing to write, which is a normal answer rather than a failure.
   */
  async remember(scene: SceneRow): Promise<RememberedNote | null> {
    if (this.stopped || scene.author_id === null) return null;
    const author = findAuthorById(this.db, scene.author_id);
    if (author === null || author.memory_enabled !== 1) return null;

    const op = taskKind(AUTHOR_REMEMBER);
    if (op === null) return null;
    const row = taskConfig(this.db, op);
    if (row.enabled !== 1) return null;

    const book = ensureMemoryBook(this.db, author);
    const known = listEntries(this.db, book.id)
      .slice(-KNOWN_LIMIT)
      .map((entry) => `- ${entry.title}`)
      .join("\n");

    const question = fillTemplate(templateOf(row, op) || defaultTemplateOf(AUTHOR_REMEMBER), {
      transcript: transcriptOf(this.db, scene),
      author: author.name,
      known: known === "" ? "(nothing yet)" : known,
    }).trim();

    const outcome = await this.tasks.run({
      kind: op,
      sceneId: scene.id,
      fallbackProfileId: scene.connection_profile_id,
      prompt: buildRememberPrompt(question, author.name),
    });
    if (this.stopped || !outcome.ok) return null;

    const note = parseNote(outcome.text);
    if (note === null) return null;

    const entry = insertEntry(this.db, book.id, note.content);
    updateEntry(this.db, entry.id, {
      title: note.title,
      keys: JSON.stringify(note.keys),
      // Provenance, so §11's "showing the author wrote it" is a column rather
      // than a convention nobody can check.
      written_by: "author",
      written_in_scene_id: scene.id,
    });
    return note;
  }
}
