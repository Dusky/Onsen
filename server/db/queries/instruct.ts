import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import {
  INSTRUCT_TEMPLATES,
  findInstructTemplate,
  parseInstructTemplate,
  type InstructTemplate,
} from "../../prompt/instruct.ts";

/**
 * Instruct templates in storage (SPEC §4, migration 0019).
 *
 * The six shipped templates live in code as data and are never written to the
 * database: they are not the user's material, they do not vary per install, and
 * a seeded copy would go stale the first time one of them is corrected. Only
 * user-authored templates get rows, and they share the shipped id space so a
 * provider can name either without knowing which it got.
 */

export interface InstructTemplateRow {
  id: number;
  ulid: string;
  template_id: string;
  name: string;
  body: string;
  created_at: number;
  updated_at: number;
}

/** A url-safe id derived from a name, which is what a provider row stores. */
export function slugFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug === "" ? "template" : slug;
}

export function listCustomTemplates(db: Database): InstructTemplateRow[] {
  return db
    .query("SELECT * FROM instruct_templates ORDER BY name COLLATE NOCASE")
    .all() as InstructTemplateRow[];
}

export function findCustomTemplate(db: Database, value: string): InstructTemplateRow | null {
  return (db
    .query("SELECT * FROM instruct_templates WHERE ulid = $value OR template_id = $value")
    .get({ value }) as InstructTemplateRow | null) ?? null;
}

/** Parse a stored row back into the shape the builder and adapter use. */
export function toTemplate(row: InstructTemplateRow): InstructTemplate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.body);
  } catch {
    parsed = {};
  }
  const template = parseInstructTemplate(parsed, row.template_id);
  // A row whose body will not parse still has a name and an id, and falling
  // back to an empty template is better than failing a generation: an empty
  // template is the plain transcript, which is legible if not ideal.
  return template === null
    ? { ...findInstructTemplate("plain")!, id: row.template_id, name: row.name }
    : { ...template, name: row.name };
}

/**
 * The template a provider should use, shipped or custom.
 *
 * Null selects the default rather than nothing: a text-completion provider
 * always renders through *some* template, and the one case where "no template"
 * is right — a base model — is the `plain` template, chosen explicitly.
 */
export function templateFor(db: Database, id: string | null): InstructTemplate {
  const shipped = findInstructTemplate(id);
  if (shipped !== null) return shipped;
  if (id !== null) {
    const row = findCustomTemplate(db, id);
    if (row !== null) return toTemplate(row);
  }
  return findInstructTemplate("chatml")!;
}

/** Every template a user can choose between: the shipped set plus their own. */
export function allTemplates(db: Database): InstructTemplate[] {
  return [...INSTRUCT_TEMPLATES, ...listCustomTemplates(db).map(toTemplate)];
}

export function insertCustomTemplate(
  db: Database,
  input: { name: string; template: InstructTemplate },
): InstructTemplateRow {
  const now = Date.now();
  // A shipped id is refused rather than shadowed: a custom template that
  // silently replaced ChatML for every provider is not something anyone asked
  // for. The suffix is applied to a clash with another custom row too.
  let templateId = slugFor(input.name);
  for (let attempt = 2; ; attempt += 1) {
    const clashes =
      findInstructTemplate(templateId) !== null || findCustomTemplate(db, templateId) !== null;
    if (!clashes) break;
    templateId = `${slugFor(input.name)}-${attempt}`;
  }

  const row = db
    .query(
      `INSERT INTO instruct_templates (ulid, template_id, name, body, created_at, updated_at)
            VALUES ($ulid, $templateId, $name, $body, $now, $now)
         RETURNING *`,
    )
    .get({
      ulid: ulid(),
      templateId,
      name: input.name,
      body: JSON.stringify({ ...input.template, id: templateId, name: input.name }),
      now,
    }) as InstructTemplateRow;
  return row;
}

export function updateCustomTemplate(
  db: Database,
  id: number,
  patch: { name?: string; template?: InstructTemplate },
): InstructTemplateRow {
  const current = db
    .query("SELECT * FROM instruct_templates WHERE id = $id")
    .get({ id }) as InstructTemplateRow;
  const name = patch.name ?? current.name;
  const body =
    patch.template === undefined
      ? current.body
      : JSON.stringify({ ...patch.template, id: current.template_id, name });
  return db
    .query(
      `UPDATE instruct_templates SET name = $name, body = $body, updated_at = $now
        WHERE id = $id RETURNING *`,
    )
    .get({ id, name, body, now: Date.now() }) as InstructTemplateRow;
}

export function deleteCustomTemplate(db: Database, id: number): void {
  const row = db
    .query("SELECT template_id FROM instruct_templates WHERE id = $id")
    .get({ id }) as { template_id: string } | null;
  db.query("DELETE FROM instruct_templates WHERE id = $id").run({ id });
  // A provider pointing at a template that no longer exists would silently fall
  // back to ChatML on the next generation, which is a prompt change nobody
  // asked for. Clearing the reference makes the fallback explicit instead.
  if (row !== null) {
    db.query(
      "UPDATE providers SET instruct_template = NULL WHERE instruct_template = $templateId",
    ).run({ templateId: row.template_id });
  }
}
