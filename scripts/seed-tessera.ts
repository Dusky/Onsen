/**
 * Seed a "Tessera Station" roleplay: one scene, the station's cast already
 * imported, bound to the existing Tessera Station lorebook (which is already
 * character-scoped to these five). Idempotent — running it twice does nothing.
 *
 *   bun run scripts/seed-tessera.ts
 */
import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { ulid } from "../server/lib/ulid.ts";
import { openDatabase } from "../server/db/index.ts";

const db = openDatabase(resolve(process.env.ONSEN_DATA_DIR ?? "./data", "onsen.db"));
const now = Date.now();

// The station's cast, in the order they should read on the deck.
const CAST = [
  "TESS",
  "Dr. Kael Marsden",
  "Sera Voss",
  "Ren Sable",
  "Yuki Luscin",
] as const;

const existing = db.query("SELECT id FROM scenes WHERE title = ?").get("Tessera Station") as
  | { id: number }
  | null;
if (existing !== null) {
  console.log(`onsen: "Tessera Station" already exists (scene id ${existing.id}) — nothing to do.`);
  process.exit(0);
}

// A scene outlives the profile it was started with, but a fresh one should
// generate somewhere: the default profile and preset.
const profile = db.query("SELECT id FROM connection_profiles ORDER BY id LIMIT 1").get() as
  | { id: number }
  | null;
const author = db.query("SELECT id FROM authors ORDER BY id LIMIT 1").get() as { id: number } | null;
const persona = db.query("SELECT id FROM personas ORDER BY id LIMIT 1").get() as { id: number } | null;

const sceneId = Number(
  db
    .query(
      `INSERT INTO scenes (ulid, title, connection_profile_id, author_id, persona_id, created_at, updated_at)
       VALUES ($ulid, $title, $profile, $author, $persona, $now, $now)`,
    )
    .run({
      ulid: ulid(),
      title: "Tessera Station",
      profile: profile?.id ?? null,
      author: author?.id ?? null,
      persona: persona?.id ?? null,
      now,
    }).lastInsertRowid,
);

for (const [index, name] of CAST.entries()) {
  const character = db.query("SELECT id FROM characters WHERE name = ?").get(name) as
    | { id: number }
    | null;
  if (character === null) {
    console.error(`onsen: missing character "${name}" — import it first.`);
    process.exit(1);
  }
  db.query(
    `INSERT INTO scene_members (scene_id, character_id, display_order, created_at)
     VALUES ($scene, $character, $order, $now)`,
  ).run({ scene: sceneId, character: character.id, order: index, now });
}

console.log(`onsen: created "Tessera Station" (scene id ${sceneId}) with ${CAST.length} characters:`);
for (const name of CAST) console.log(`  - ${name}`);
console.log("onsen: the Tessera Station lorebook is already character-scoped to these five, so it applies.");
