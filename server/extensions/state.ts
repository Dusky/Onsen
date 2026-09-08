import type { Database } from "bun:sqlite";

/**
 * Per-scene extension state (SPEC §15, §20 phase 146).
 *
 * The half of an extension that is data rather than code: a rolling summary, a
 * counter, the message an interval last fired on. Written by a task's `apply`,
 * read by `{{state:<key>}}` in the task prompt and by an injection's `render`.
 * The row dies with its scene, so a deleted scene leaves nothing behind.
 */

export function readExtensionState(
  db: Database,
  extensionName: string,
  sceneId: number,
  key: string,
): string | null {
  const row = db
    .query(
      "SELECT value FROM extension_state WHERE extension_name = $name AND scene_id = $scene AND key = $key",
    )
    .get({ name: extensionName, scene: sceneId, key }) as { value: string } | null;
  return row?.value ?? null;
}

export function writeExtensionState(
  db: Database,
  extensionName: string,
  sceneId: number,
  key: string,
  value: string,
): void {
  db.query(
    `INSERT INTO extension_state (extension_name, scene_id, key, value, updated_at)
     VALUES ($name, $scene, $key, $value, $now)
     ON CONFLICT (extension_name, scene_id, key) DO UPDATE SET
       value = excluded.value, updated_at = excluded.updated_at`,
  ).run({ name: extensionName, scene: sceneId, key, value, now: Date.now() });
}
