import { rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Database } from "bun:sqlite";
import { unregisterExtensionModule } from "./registry.ts";
import {
  deleteExtension,
  deleteExtensionTasks,
  findExtensionByNameVersion,
} from "../db/queries/extensions.ts";

/**
 * The uninstall half of the extension code API (SPEC §15, §20 phase 113).
 *
 * `installExtensionCode` copies a directory, persists an `extensions` row and
 * its `tasks`, and registers the `apply` callbacks in memory. Until this file
 * existed, none of those four were undone: uninstalling a pack removed its data
 * rows and left the code on disk, the rows in the database, and the callbacks
 * firing in the running process until the next restart.
 *
 * Removing is therefore four steps, in this order so a failure never leaves a
 * half-live extension:
 *
 * 1. Unregister the callbacks — the part that can run *now* goes first.
 * 2. Delete the rows — one transaction, so a crash cannot leave tasks without
 *    an extension or an extension without its tasks.
 * 3. Remove the directory — best-effort: a leftover directory is harmless,
 *    because startup only reloads extensions the `extensions` table still lists.
 */

/** The name and version a pack was installed under — the join to its extension. */
export interface ExtensionRef {
  name: string;
  version: string;
}

/**
 * Remove the extension a pack installed, if it installed one.
 *
 * Returns whether an extension was found and removed. The caller has already
 * deleted the pack's data rows; this is the code half of the same uninstall.
 */
export function removePackExtension(
  db: Database,
  extensionsDir: string,
  ref: ExtensionRef,
): boolean {
  const extension = findExtensionByNameVersion(db, ref.name, ref.version);
  if (extension === null) return false;

  unregisterExtensionModule(extension.name);
  db.transaction(() => {
    deleteExtensionTasks(db, extension.name);
    deleteExtension(db, extension.id);
  })();

  // The directory is only removed when it still sits under the extensions
  // root. `dir` was written by the installer, but it is persisted state, and a
  // delete of a path that has drifted outside the root is worse than an orphan
  // directory.
  const root = resolve(extensionsDir);
  if (resolve(extension.dir) === root || resolve(extension.dir).startsWith(root + "/")) {
    rmSync(extension.dir, { recursive: true, force: true });
  }
  return true;
}
