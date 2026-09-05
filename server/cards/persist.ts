/**
 * Everything after a card's bytes have been parsed: the avatar on disk, the
 * row, the CharX sprites, and the warnings that say what was not understood.
 *
 * Lifted out of the characters route when the SillyTavern migration became its
 * third caller (§20 phase 44). One-off import, folder import and migration must
 * not drift into landing a card three slightly different ways.
 */
import { join } from "node:path";
import type { AppContext } from "../context.ts";
import { ulid } from "../lib/ulid.ts";
import { insertCharacter, type CharacterRow } from "../db/queries/characters.ts";
import { addExpression, ensurePack } from "../db/queries/expressions.ts";
import type { importCard } from "./index.ts";

export async function persistCard(
  ctx: AppContext,
  filename: string,
  imported: ReturnType<typeof importCard>,
): Promise<{ row: CharacterRow; warnings: string[] }> {
  // The avatar is written before the row so a failure leaves an orphaned file
  // rather than a character pointing at nothing.
  let avatarPath: string | null = null;
  if (imported.avatar !== null) {
    avatarPath = `${imported.sourceHash.slice(0, 32)}.${imported.avatar.extension}`;
    await Bun.write(join(ctx.config.avatarsDir, avatarPath), imported.avatar.data);
  }

  const row = insertCharacter(ctx.db, {
    card: imported.card,
    rawCard: imported.rawCard,
    format: imported.format,
    avatarPath,
    sourceFilename: filename,
    sourceHash: imported.sourceHash,
  });

  // CharX bundles carry expression sprites under an `expressions/` tree; import
  // them into the pack so the VN stage has something to draw (§12). The label
  // is the filename stem; anything that is not named like a sprite is left for
  // re-export, not guessed at.
  let expressionCount = 0;
  for (const [path, data] of imported.assets) {
    const match = /(?:^|\/)expressions?\/([a-zA-Z0-9_-]+)\.(?:png|jpe?g|webp|gif)$/i.exec(path);
    if (match === null) continue;
    const label = match[1]!.toLowerCase();
    const pack = ensurePack(ctx.db, row.id, `${row.name} sprites`);
    const filePath = `${row.id}-${label}-${ulid()}.${path.split(".").at(-1) ?? "png"}`;
    await Bun.write(join(ctx.config.spritesDir, filePath), data);
    addExpression(ctx.db, pack.id, label, filePath, 0);
    expressionCount += 1;
  }

  const warnings = [...imported.warnings];
  if (expressionCount > 0) {
    warnings.push(
      `Imported ${expressionCount} expression sprite${expressionCount === 1 ? "" : "s"}.`,
    );
  }
  if (imported.unmodelledFields.length > 0) {
    // Silent partial imports are the worst outcome (SPEC §18); naming what was
    // not understood is the difference between preserved and lost.
    warnings.push(
      `Preserved but not shown in the editor: ${imported.unmodelledFields.join(", ")}.`,
    );
  }
  return { row, warnings };
}
