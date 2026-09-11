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
import { bind, insertEntry, insertLorebook, updateEntry, updateLorebook } from "../db/queries/lore.ts";
import { embeddedCharacterBook } from "../lore/import.ts";
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

  /*
   * One transaction for the character, its sprites and its embedded lorebook
   * (the server-hardening pass).
   *
   * These were three unguarded groups of writes. A malformed
   * `character_book` throwing partway through — and it is the least trusted
   * part of a downloaded card — committed a character with half a lorebook
   * bound to it, which is worse than no import at all: nothing says the rest
   * is missing, and the same card imported again makes a second character.
   * This is the shared path for one-off import, folder import and the whole
   * SillyTavern migration, so it happened in bulk or not at all.
   *
   * The blocker was one `await` in the middle, writing a sprite between
   * `ensurePack` and `addExpression`: a `bun:sqlite` transaction is
   * synchronous and cannot contain one. `server/packs/install.ts` had already
   * solved exactly this — queue the files, run one synchronous transaction
   * over the rows, write the files after. Same shape here.
   */
  const files: { path: string; data: Uint8Array }[] = [];

  const persisted = ctx.db.transaction(() => {
    const row = insertCharacter(ctx.db, {
      card: imported.card,
      rawCard: imported.rawCard,
      format: imported.format,
      avatarPath,
      sourceFilename: filename,
      sourceHash: imported.sourceHash,
    });

    // CharX bundles carry expression sprites under an `expressions/` tree;
    // import them into the pack so the VN stage has something to draw (§12).
    // The label is the filename stem; anything that is not named like a sprite
    // is left for re-export, not guessed at.
    let expressionCount = 0;
    for (const [path, data] of imported.assets) {
      const match = /(?:^|\/)expressions?\/([a-zA-Z0-9_-]+)\.(?:png|jpe?g|webp|gif)$/i.exec(path);
      if (match === null) continue;
      const label = match[1]!.toLowerCase();
      const pack = ensurePack(ctx.db, row.id, `${row.name} sprites`);
      const filePath = `${row.id}-${label}-${ulid()}.${path.split(".").at(-1) ?? "png"}`;
      files.push({ path: filePath, data });
      addExpression(ctx.db, pack.id, label, filePath, 0);
      expressionCount += 1;
    }

    // A card's embedded `character_book` becomes a real, bindable lorebook, so
    // the world info a SillyTavern card carries is actually usable (§20 phase
    // 139) rather than sitting in `raw_card` unread.
    let loreCount = 0;
    const embedded = embeddedCharacterBook(imported.rawCard);
    if (embedded !== null) {
      const book = insertLorebook(ctx.db, { name: embedded.name, rawImport: embedded.raw });
      updateLorebook(ctx.db, book.id, {
        ...(embedded.scanDepth === null ? {} : { scan_depth: embedded.scanDepth }),
        ...(embedded.tokenBudget === null ? {} : { token_budget: embedded.tokenBudget }),
        ...(embedded.recursionDepth === null ? {} : { recursion_depth: embedded.recursionDepth }),
      });
      for (const entry of embedded.entries) {
        const entryRow = insertEntry(ctx.db, book.id, String(entry.columns.content ?? ""));
        updateEntry(ctx.db, entryRow.id, entry.columns);
      }
      bind(ctx.db, book.id, "character", row.id);
      loreCount = embedded.entries.length;
    }

    return { row, expressionCount, loreCount };
  })();

  const { row, expressionCount, loreCount } = persisted;

  // Sprites last, and a failed write is a warning rather than a rollback —
  // `install.ts` settled the same trade: throwing away an imported card over a
  // missing picture is the wrong way round, and the stage falls back to the
  // placeholder.
  const missing: string[] = [];
  for (const file of files) {
    try {
      await Bun.write(join(ctx.config.spritesDir, file.path), file.data);
    } catch {
      missing.push(file.path);
    }
  }

  const warnings = [...imported.warnings];
  if (missing.length > 0) {
    warnings.push(
      `${missing.length} expression sprite${missing.length === 1 ? "" : "s"} could not be written.`,
    );
  }
  if (loreCount > 0) {
    warnings.push(
      `Imported its embedded lorebook \u2014 ${loreCount} ${loreCount === 1 ? "entry" : "entries"}.`,
    );
  }
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
