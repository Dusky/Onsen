import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import { bind, bindingsOf, insertEntry, insertLorebook, updateEntry } from "./lore.ts";

/**
 * Character dossiers (SPEC §11, §20 phase 32).
 *
 * A dossier is two things at once, and the split is the whole design. This
 * table is the editable truth — the five fields §11 names, each meaning
 * something different. The lore entry it renders into is how it reaches a
 * prompt, which means §10's activation does the work: keyword matching, scan
 * depth, the token budget, sticky, the character filter, and §16's activation
 * test tool, none of it written twice.
 *
 * The rule that keeps the two halves honest is that the entry is **derived**.
 * Nothing edits it directly; every write goes through `renderDossier`, so the
 * entry cannot drift from the fields it came from. That is the same rule §8's
 * guides follow and for the same reason.
 */

export interface DossierRow {
  id: number;
  ulid: string;
  scene_id: number;
  name: string;
  role: string;
  voice: string;
  canon_lock: string;
  knowledge: string;
  standing: string;
  lore_entry_id: number | null;
  promoted_character_id: number | null;
  mentions: number;
  created_at: number;
  updated_at: number;
}

/** The three tiers §11 asks for, stored together because they are written together. */
export interface DossierKnowledge {
  public: string;
  private: string;
  buried: string;
}

export function parseKnowledge(json: string): DossierKnowledge {
  try {
    const parsed = JSON.parse(json) as Partial<DossierKnowledge>;
    return {
      public: typeof parsed.public === "string" ? parsed.public : "",
      private: typeof parsed.private === "string" ? parsed.private : "",
      buried: typeof parsed.buried === "string" ? parsed.buried : "",
    };
  } catch {
    return { public: "", private: "", buried: "" };
  }
}

/** The name of the per-scene book dossiers live in. */
const BOOK_NAME = "Dossiers";

/**
 * The scene's dossier book, made on first use and bound to that scene.
 *
 * Per scene rather than global, which is SillyTavern's chat-lorebook answer and
 * the right one: an NPC who emerged in one story has no business appearing in
 * another, and a global dossier book would leak every roleplay into every other.
 */
export function dossierBookFor(db: Database, sceneId: number): { id: number } {
  const existing = db
    .query(
      `SELECT b.id AS id FROM lorebooks b
         JOIN lorebook_bindings bd ON bd.lorebook_id = b.id
        WHERE bd.scope = 'scene' AND bd.scene_id = $scene AND b.name = $name`,
    )
    .get({ scene: sceneId, name: BOOK_NAME }) as { id: number } | null;
  if (existing !== null) return existing;

  const book = insertLorebook(db, {
    name: BOOK_NAME,
    description: "Characters who turned up during play. Written by the app, edited by you.",
  });
  bind(db, book.id, "scene", sceneId);
  return { id: book.id };
}

/**
 * Render a dossier into its lore entry.
 *
 * The body is assembled here rather than by the model, so an edited field
 * always reaches the prompt in the same shape. Empty fields are dropped: a
 * dossier with nothing but a name should cost a line, not a form.
 *
 * The **buried** tier is deliberately not rendered. §11 tiers knowledge into
 * public, private and buried, and buried means the author knows it and has not
 * revealed it — putting it in the prompt every time the name is mentioned is
 * exactly how a secret gets spoken aloud two turns later. It is kept, shown to
 * the reader, and used only where something asks for it.
 */
export function dossierBody(row: DossierRow): string {
  const knowledge = parseKnowledge(row.knowledge);
  const parts: string[] = [];
  const put = (label: string, value: string) => {
    if (value.trim() !== "") parts.push(`${label}: ${value.trim()}`);
  };
  put("Role", row.role);
  put("Voice", row.voice);
  put("Established, and not to be contradicted", row.canon_lock);
  put("Known publicly", knowledge.public);
  put("Known privately", knowledge.private);
  put("With the reader", row.standing);
  return parts.join("\n");
}

/**
 * Write the dossier's entry, creating it the first time.
 *
 * Keyed on the name, which is the whole activation rule: a dossier is for a
 * character who is mentioned, and being mentioned means their name appears.
 * A promoted dossier is disabled rather than deleted — the character card now
 * carries the same material, and two copies in one prompt is the failure this
 * avoids.
 */
export function renderDossier(db: Database, row: DossierRow): DossierRow {
  const book = dossierBookFor(db, row.scene_id);
  const content = dossierBody(row);
  const entryId =
    row.lore_entry_id ?? insertEntry(db, book.id, content).id;

  updateEntry(db, entryId, {
    title: row.name,
    content,
    keys: JSON.stringify([row.name]),
    enabled: row.promoted_character_id === null && content.trim() !== "" ? 1 : 0,
    // Before the character definitions: a dossier is who someone is, and it
    // reads as background to the scene rather than as an instruction in it.
    position: "before_character",
  });

  if (row.lore_entry_id === entryId) return row;
  return db
    .query("UPDATE dossiers SET lore_entry_id = $entry, updated_at = $now WHERE id = $id RETURNING *")
    .get({ id: row.id, entry: entryId, now: Date.now() }) as DossierRow;
}

export function listDossiers(db: Database, sceneId: number): DossierRow[] {
  return db
    .query("SELECT * FROM dossiers WHERE scene_id = $scene ORDER BY name COLLATE NOCASE")
    .all({ scene: sceneId }) as DossierRow[];
}

export function findDossier(db: Database, value: string): DossierRow | null {
  return (db.query("SELECT * FROM dossiers WHERE ulid = $v").get({ v: value }) ??
    null) as DossierRow | null;
}

export function findDossierByName(db: Database, sceneId: number, name: string): DossierRow | null {
  return (db
    .query("SELECT * FROM dossiers WHERE scene_id = $scene AND name = $name COLLATE NOCASE")
    .get({ scene: sceneId, name }) ?? null) as DossierRow | null;
}

export interface DossierInput {
  name: string;
  role?: string;
  voice?: string;
  canonLock?: string;
  knowledge?: Partial<DossierKnowledge>;
  standing?: string;
  mentions?: number;
}

export function insertDossier(db: Database, sceneId: number, input: DossierInput): DossierRow {
  const now = Date.now();
  const row = db
    .query(
      `INSERT INTO dossiers
         (ulid, scene_id, name, role, voice, canon_lock, knowledge, standing, mentions,
          created_at, updated_at)
       VALUES ($ulid, $scene, $name, $role, $voice, $lock, $knowledge, $standing, $mentions,
               $now, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      scene: sceneId,
      name: input.name,
      role: input.role ?? "",
      voice: input.voice ?? "",
      lock: input.canonLock ?? "",
      knowledge: JSON.stringify({
        public: input.knowledge?.public ?? "",
        private: input.knowledge?.private ?? "",
        buried: input.knowledge?.buried ?? "",
      }),
      standing: input.standing ?? "",
      mentions: input.mentions ?? 0,
      now,
    }) as DossierRow;
  return renderDossier(db, row);
}

export function updateDossier(
  db: Database,
  id: number,
  patch: Partial<DossierInput> & { promotedCharacterId?: number | null },
): DossierRow {
  const current = db.query("SELECT * FROM dossiers WHERE id = $id").get({ id }) as DossierRow;
  const knowledge = { ...parseKnowledge(current.knowledge), ...(patch.knowledge ?? {}) };
  const row = db
    .query(
      `UPDATE dossiers
          SET name = $name, role = $role, voice = $voice, canon_lock = $lock,
              knowledge = $knowledge, standing = $standing,
              promoted_character_id = $promoted, updated_at = $now
        WHERE id = $id RETURNING *`,
    )
    .get({
      id,
      name: patch.name ?? current.name,
      role: patch.role ?? current.role,
      voice: patch.voice ?? current.voice,
      lock: patch.canonLock ?? current.canon_lock,
      knowledge: JSON.stringify(knowledge),
      standing: patch.standing ?? current.standing,
      promoted:
        patch.promotedCharacterId === undefined
          ? current.promoted_character_id
          : patch.promotedCharacterId,
      now: Date.now(),
    }) as DossierRow;
  return renderDossier(db, row);
}

/**
 * Delete a dossier and the entry it rendered into.
 *
 * The entry goes explicitly rather than by cascade: the foreign key runs the
 * other way — the dossier points at the entry — so nothing would collect it,
 * and an orphaned entry keyed on a name still fires.
 */
export function deleteDossier(db: Database, id: number): void {
  const row = db
    .query("SELECT lore_entry_id FROM dossiers WHERE id = $id")
    .get({ id }) as { lore_entry_id: number | null } | null;
  db.query("DELETE FROM dossiers WHERE id = $id").run({ id });
  if (row?.lore_entry_id != null) {
    db.query("DELETE FROM lore_entries WHERE id = $id").run({ id: row.lore_entry_id });
  }
}

/** So a caller can tell whether the scene's dossier book is bound at all. */
export function dossierBookBindings(db: Database, sceneId: number) {
  return bindingsOf(db, dossierBookFor(db, sceneId).id);
}
