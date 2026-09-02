import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import type { ExpressionDto, ExpressionPackDto } from "../../../shared/types.ts";

/**
 * Expression packs and sprites (SPEC §12, §20 phase 29).
 *
 * The pack is the binding: a character's named set of labelled sprites. The
 * queries here only store the *binding* — label → image path. Where the image
 * came from (an upload, a CharX bundle, a generated sprite in phase 41) is a
 * fact about the file, not the binding, which is what lets generation be
 * additive rather than a rework.
 */

export interface ExpressionRow {
  id: number;
  ulid: string;
  pack_id: number;
  label: string;
  image_path: string;
  variant_index: number;
  created_at: number;
}

export interface ExpressionPackRow {
  id: number;
  ulid: string;
  name: string;
  character_id: number;
  created_at: number;
  updated_at: number;
}

export function findPackByCharacter(db: Database, characterId: number): ExpressionPackRow | null {
  return (db
    .query("SELECT * FROM expression_packs WHERE character_id = $character")
    .get({ character: characterId }) ?? null) as ExpressionPackRow | null;
}

export function ensurePack(db: Database, characterId: number, name: string): ExpressionPackRow {
  const existing = findPackByCharacter(db, characterId);
  if (existing !== null) return existing;
  const now = Date.now();
  return db
    .query(
      `INSERT INTO expression_packs (ulid, name, character_id, created_at, updated_at)
       VALUES ($ulid, $name, $character, $now, $now) RETURNING *`,
    )
    .get({ ulid: ulid(), name, character: characterId, now }) as ExpressionPackRow;
}

export function addExpression(
  db: Database,
  packId: number,
  label: string,
  imagePath: string,
  variantIndex: number,
): ExpressionRow {
  return db
    .query(
      `INSERT INTO expressions (ulid, pack_id, label, image_path, variant_index, created_at)
       VALUES ($ulid, $pack, $label, $image, $variant, $now) RETURNING *`,
    )
    .get({ ulid: ulid(), pack: packId, label, image: imagePath, variant: variantIndex, now: Date.now() }) as ExpressionRow;
}

export function findExpression(db: Database, value: string): ExpressionRow | null {
  return (db.query("SELECT * FROM expressions WHERE ulid = $ulid").get({ ulid: value }) ??
    null) as ExpressionRow | null;
}

export function deleteExpression(db: Database, id: number): void {
  db.query("DELETE FROM expressions WHERE id = $id").run({ id });
}

export function expressionDtos(db: Database, packId: number): ExpressionDto[] {
  const rows = db
    .query("SELECT * FROM expressions WHERE pack_id = $pack ORDER BY label, variant_index")
    .all({ pack: packId }) as ExpressionRow[];
  return rows.map((row) => ({
    id: row.ulid,
    label: row.label,
    variantIndex: row.variant_index,
    hasImage: row.image_path !== "",
  }));
}

export function toPackDto(db: Database, pack: ExpressionPackRow, characterUlid: string): ExpressionPackDto {
  return {
    id: pack.ulid,
    characterId: characterUlid,
    expressions: expressionDtos(db, pack.id),
  };
}
