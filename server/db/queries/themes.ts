/**
 * Theme rows (SPEC §20 phase 45).
 */
import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import { getSetting, setSetting } from "./settings.ts";
import { BUILTIN_THEMES, DEFAULT_THEME_NAME } from "../../themes/builtin.ts";
import { safeTokens } from "../../themes/index.ts";
import type { ThemeDto } from "../../../shared/types.ts";

export interface ThemeRow {
  id: number;
  ulid: string;
  name: string;
  base: "dark" | "light";
  tokens: string;
  custom_css: string;
  custom_css_pending: string;
  is_builtin: number;
  created_at: number;
  updated_at: number;
}

const ACTIVE_KEY = "active_theme";

function parseTokens(json: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function toThemeDto(row: ThemeRow): ThemeDto {
  return {
    id: row.ulid,
    name: row.name,
    base: row.base,
    tokens: parseTokens(row.tokens),
    customCss: row.custom_css,
    pendingCss: row.custom_css_pending,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listThemes(db: Database): ThemeRow[] {
  return db
    .query("SELECT * FROM themes ORDER BY is_builtin DESC, name COLLATE NOCASE")
    .all() as ThemeRow[];
}

export function findTheme(db: Database, value: string): ThemeRow | null {
  return (db.query("SELECT * FROM themes WHERE ulid = $v").get({ v: value }) ?? null) as
    | ThemeRow
    | null;
}

export interface NewTheme {
  name: string;
  base?: "dark" | "light";
  tokens?: Record<string, string>;
  customCss?: string;
  pendingCss?: string;
  isBuiltin?: boolean;
}

export function insertTheme(db: Database, input: NewTheme): ThemeRow {
  const now = Date.now();
  return db
    .query(
      `INSERT INTO themes
         (ulid, name, base, tokens, custom_css, custom_css_pending, is_builtin,
          created_at, updated_at)
       VALUES ($ulid, $name, $base, $tokens, $css, $pending, $builtin, $now, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      name: input.name,
      base: input.base ?? "dark",
      tokens: JSON.stringify(safeTokens(input.tokens ?? {})),
      css: input.customCss ?? "",
      pending: input.pendingCss ?? "",
      builtin: input.isBuiltin === true ? 1 : 0,
      now,
    }) as ThemeRow;
}

export interface ThemePatch {
  name?: string;
  tokens?: Record<string, string>;
  customCss?: string;
  pendingCss?: string;
}

export function updateTheme(db: Database, id: number, patch: ThemePatch): ThemeRow {
  const sets: string[] = [];
  const params: Record<string, string | number> = { id, now: Date.now() };
  if (patch.name !== undefined) {
    sets.push("name = $name");
    params["name"] = patch.name;
  }
  if (patch.tokens !== undefined) {
    sets.push("tokens = $tokens");
    params["tokens"] = JSON.stringify(safeTokens(patch.tokens));
  }
  if (patch.customCss !== undefined) {
    sets.push("custom_css = $css");
    params["css"] = patch.customCss;
  }
  if (patch.pendingCss !== undefined) {
    sets.push("custom_css_pending = $pending");
    params["pending"] = patch.pendingCss;
  }
  if (sets.length === 0) {
    return db.query("SELECT * FROM themes WHERE id = $id").get({ id }) as ThemeRow;
  }
  return db
    .query(`UPDATE themes SET ${sets.join(", ")}, updated_at = $now WHERE id = $id RETURNING *`)
    .get(params) as ThemeRow;
}

export function deleteTheme(db: Database, id: number): void {
  db.query("DELETE FROM themes WHERE id = $id AND is_builtin = 0").run({ id });
}

/* ------------------------------------------------------------------ */
/* Which one is on                                                     */
/* ------------------------------------------------------------------ */

export function setActiveTheme(db: Database, themeUlid: string): void {
  setSetting(db, ACTIVE_KEY, themeUlid);
}

/**
 * The theme in force.
 *
 * Falls back rather than failing: a deleted or never-chosen theme lands on the
 * shipped default, and an install whose themes have not been seeded yet gets
 * null, which the client reads as "the stylesheet's own values" — the original
 * flat palette. There is no state in which the app has no colours.
 */
export function activeTheme(db: Database): ThemeRow | null {
  const chosen = getSetting(db, ACTIVE_KEY);
  if (chosen !== null) {
    const row = findTheme(db, chosen);
    if (row !== null) return row;
  }
  return (db
    .query("SELECT * FROM themes WHERE name = $name")
    .get({ name: DEFAULT_THEME_NAME }) ?? null) as ThemeRow | null;
}

/**
 * Put the shipped themes in, and keep them shipped (§20 phase 195).
 *
 * Matched by name so a later release can add one without disturbing anything
 * the reader has made, and so re-running this never duplicates.
 *
 * **A builtin theme's tokens are reconciled on every boot**, and that is a
 * change: this used to insert-and-skip, full stop. A phase raised the ink
 * ramps to clear WCAG AA, `test/surfaces.test.ts` measured the corrected
 * values in `builtin.ts` and passed — and not one existing install ever saw
 * them. Midnight shipped `#808891` against `#14161a`, a clean 5.04:1, while
 * every database seeded before that fix kept rendering `#6f7883` at 4.05:1,
 * below the floor, indefinitely. The guard read the source; the app read the
 * row.
 *
 * The same argument `seedBuiltins` makes for option groups in
 * `server/db/queries/options.ts`: words somebody may have rewritten are kept,
 * but structure is not a preference and stale structure is a correctness bug.
 * A builtin theme's palette is the shipped artefact, not the reader's —
 * editing one in the app forks it to a custom theme, which `is_builtin = 0`
 * protects here. Custom themes are never touched.
 *
 * `custom_css` is left alone even on a builtin: that is text a reader wrote,
 * and it is the one field on these rows that can be theirs.
 */
export function seedBuiltinThemes(db: Database): number {
  let added = 0;
  for (const theme of BUILTIN_THEMES) {
    const existing = db
      .query("SELECT id, tokens FROM themes WHERE name = $name COLLATE NOCASE AND is_builtin = 1")
      .get({ name: theme.name }) as { id: number; tokens: string } | null;
    if (existing !== null) {
      const shipped = JSON.stringify(theme.tokens);
      if (existing.tokens !== shipped) {
        db.query("UPDATE themes SET tokens = $tokens, base = $base, updated_at = $now WHERE id = $id")
          .run({ tokens: shipped, base: theme.base, id: existing.id, now: Date.now() });
      }
      continue;
    }
    // A custom theme may have taken the name; leave it be.
    const taken = db
      .query("SELECT 1 AS hit FROM themes WHERE name = $name COLLATE NOCASE")
      .get({ name: theme.name });
    if (taken !== null) continue;
    insertTheme(db, { ...theme, isBuiltin: true });
    added += 1;
  }
  if (getSetting(db, ACTIVE_KEY) === null) {
    const fallback = db
      .query("SELECT ulid FROM themes WHERE name = $name")
      .get({ name: DEFAULT_THEME_NAME }) as { ulid: string } | null;
    if (fallback !== null) setActiveTheme(db, fallback.ulid);
  }
  return added;
}
