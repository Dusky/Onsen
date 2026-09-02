import type { Database } from "bun:sqlite";
import type { Keyring } from "../lib/crypto.ts";
import { buildCardDocument } from "../cards/index.ts";
import { insertCharacter, findCharacter, type CharacterRow } from "../db/queries/characters.ts";
import { insertAuthor, insertPersona, updateAuthor } from "../db/queries/authors.ts";
import { insertScene, updateScene, appendMessage, listScenes } from "../db/queries/history.ts";
import { addSceneMember } from "../db/queries/authors.ts";
import { ingestDocument, listDocuments } from "../documents/store.ts";

/**
 * Demo content (first run), and the author's own user guide.
 *
 * Two things seeded together because they serve the same first run: a cast to
 * talk to, and a scene where the author already knows how the app works —
 * because the app's own user guide is the data bank's first global document.
 * That is the data bank dogfooding itself: ask the author "how do I make a
 * beat", and it retrieves the guide the same way it retrieves any other
 * reference material.
 */

/** A concise, user-facing guide, written for retrieval — not the dev spec. */
const USER_GUIDE = `# Onsen — what it is and how to use it

Onsen is a roleplay frontend with one AI author who plays every character, the way a game master runs a table. You mostly direct rather than write.

## The people
- The **author** is the AI's own identity — one writing partner who voices the whole cast. It has its own personality and directing style.
- **Characters** are the roles the author plays. **You** are the reader, and your **persona** is who you are in the story.
- A **scene** is one roleplay: a cast of characters, a persona, and a history.

## Directing
- The **composer** is where you write or give directions. Tap a character in the cast strip to cue them to speak next.
- A **beat** is one turn where several characters interact, written in one go — ask for it by choosing "the room" instead of one voice.
- **Swipe left on a message to reroll** it, swipe right to flip through alternate versions. Long-press for edit, branch, continue, and more.
- **Steer** is a note applied to every turn until you clear it. **Nudge** is a one-shot instruction for the next turn only.

## The author's own notes
- **Lorebooks** are world facts triggered by keywords — the author retrieves them when the scene mentions them.
- **Guides** are short prose notes the author keeps about the scene (who is thinking what, what everyone is wearing, where everyone is). They refresh after each turn.
- **Trackers** are the strict, structured version: JSON fields, shown in a panel above the composer.
- The **data bank** is long reference material, recalled by meaning rather than keyword.

## Letting it run
- **Autopilot** keeps the scene writing itself after a reply, up to a bound, and stops the moment someone turns to face you. Take over any time.
- **Off-script (OOC)** is how the author steps out of the scene to ask you something, and how you ask it questions about the story — or about using Onsen.

## Expressions
- The author can declare emotions inline, and the **visual novel stage** shows sprites above the log. Add sprites on a character's Sprites tab.

## Asking for help
The author is reading this guide. Ask it "how do I make a beat", "what is a lorebook", or "how do I turn on autopilot" and it will answer from what is written here.`;

interface DemoCard {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  exampleDialogue: string;
}

const DEMO_CHARACTERS: DemoCard[] = [
  {
    name: "Elira Voss",
    description:
      "The innkeeper of the Last Inn, a warm woman in her forties who has seen every kind of traveller come down off the ridge.",
    personality:
      "Warm but sharp-eyed, hospitable without being naive. She reads people quickly and keeps her counsel.",
    scenario: "A cold night at the Last Inn, the only stop for a day in any direction.",
    firstMessage: `Elira sets a clay cup down in front of you and wipes her hands on her apron. "You came off the ridge late. I was starting to think the road had kept you."`,
    exampleDialogue:
      "Elira: \"The warden says the pass will be snowed in by morning.\"\nYou: \"Then I'll stay a while.\"\nElira: \"Good. The fire's already paid for, and so's the company.\"",
  },
  {
    name: "Dusky",
    description:
      "A lean, quiet tracker who haunts the treeline above the inn. Nobody knows their full name, and nobody asks twice.",
    personality:
      "Taciturn and watchful, speaks in short sentences, notices tracks and weather before anything else.",
    scenario: "Keeping watch over the road, because something has been moving on it at night.",
    firstMessage: `Dusky drops into the seat by the fire without a sound and rests their boots on the hearth. "Three sets of tracks on the north road. One of them's fresh."`,
    exampleDialogue:
      "You: \"What was moving out there?\"\nDusky: \"Big. And it wasn't scared of the light.\"",
  },
  {
    name: "The Warden",
    description:
      "An aging lawkeeper who has held the ridge alone for thirty years. Duty is the only thing that still keeps him warm.",
    personality:
      "Formal, weary, unbending about rules but quietly kind. Speaks like he is always a little tired of explaining.",
    scenario: "Arriving at the inn to warn everyone the pass is closing.",
    firstMessage: `The Warden stamps snow from his coat at the door. "The pass closes at dawn. Whatever any of you mean to do, do it before then."`,
    exampleDialogue:
      "The Warden: \"I won't have another body on that road.\"\nElira: \"Then help me keep them off it.\"",
  },
];

const DEMO_AUTHOR = {
  name: "Mara",
  personality:
    "A patient, literary writing partner who likes slow-burn tension and small, telling details.",
  writingStyle:
    "Third person, close and sensory. Paragraphs that breathe; dialogue that does half the work.",
  directingStyle:
    "Moves the scene one beat at a time, escalates gently, and lets silences land.",
  oocVoice:
    "Friendly and direct, like a director leaning over the table between scenes.",
};

export interface DemoSeedResult {
  sceneId: string;
  charactersCreated: number;
  guideAdded: boolean;
}

/** Seed the demo cast and the user guide. Idempotent by name. */
export async function seedDemo(db: Database, keyring: Keyring): Promise<DemoSeedResult> {
  let charactersCreated = 0;
  const cast: CharacterRow[] = [];

  for (const card of DEMO_CHARACTERS) {
    const existing = findCharacterByName(db, card.name);
    if (existing !== null) {
      cast.push(existing);
      continue;
    }
    const normalised = {
      name: card.name,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      firstMessage: card.firstMessage,
      alternateGreetings: [],
      groupGreetings: [],
      exampleDialogue: card.exampleDialogue,
      systemPrompt: null,
      postHistoryInstructions: null,
      creatorNotes: "Demo character, shipped with Onsen.",
      tags: ["demo"],
      creator: null,
      characterVersion: null,
      depthPrompt: null,
      depthPromptDepth: 4,
      depthPromptRole: "system" as const,
      extensions: {},
    };
    const row = insertCharacter(db, {
      card: normalised,
      rawCard: buildCardDocument(normalised, null),
      format: "native",
      avatarPath: null,
      sourceFilename: null,
      sourceHash: null,
    });
    cast.push(row);
    charactersCreated += 1;
  }

  // The author, with its own voice. Reused across the demo, and available to
  // every other scene the reader starts after.
  const author =
    (db.query("SELECT * FROM authors ORDER BY id LIMIT 1").get() as { id: number } | null) ??
    (() => {
      const created = insertAuthor(db, DEMO_AUTHOR.name);
      updateAuthor(db, created.id, {
        personality: DEMO_AUTHOR.personality,
        writingStyle: DEMO_AUTHOR.writingStyle,
        directingStyle: DEMO_AUTHOR.directingStyle,
        oocVoice: DEMO_AUTHOR.oocVoice,
      });
      return created;
    })();

  // The reader's persona, so the demo scene has somebody to address.
  const persona =
    (db.query("SELECT * FROM personas ORDER BY id LIMIT 1").get() as { id: number } | null) ??
    insertPersona(db, "You");

  // One demo scene, or the one that already exists. It carries the default
  // profile and preset, because a demo that cannot generate is a broken demo.
  const defaultProfile = db
    .query("SELECT id FROM connection_profiles ORDER BY is_default DESC, id LIMIT 1")
    .get() as { id: number } | null;
  const defaultPreset = db.query("SELECT id FROM presets WHERE is_default = 1 LIMIT 1").get() as
    | { id: number }
    | null;
  const scene =
    (db.query("SELECT * FROM scenes WHERE title = 'The Last Inn' LIMIT 1").get() as
      | { id: number; ulid: string; connection_profile_id: number | null }
      | null) ??
    insertScene(db, {
      title: "The Last Inn",
      connectionProfileId: defaultProfile?.id ?? null,
      presetId: defaultPreset?.id ?? null,
    });

  updateScene(db, scene.id, {
    authorId: author.id,
    personaId: persona.id,
    ...(scene.connection_profile_id === null && defaultProfile !== null
      ? { connectionProfileId: defaultProfile.id }
      : {}),
    ...(defaultPreset !== null ? { presetId: defaultPreset.id } : {}),
  });
  for (const member of cast) {
    const already = db
      .query("SELECT 1 FROM scene_members WHERE scene_id = $scene AND character_id = $char")
      .get({ scene: scene.id, char: member.id });
    if (already === null) addSceneMember(db, scene.id, member.id);
  }

  // The opening line, once, so the scene is not an empty room.
  const hasMessages = (db
    .query("SELECT count(*) AS n FROM messages WHERE scene_id = $scene")
    .get({ scene: scene.id }) as { n: number }).n > 0;
  if (!hasMessages && cast[0] !== undefined) {
    appendMessage(db, {
      sceneId: scene.id,
      parentId: null,
      kind: "spotlight",
      authorType: "character",
      content: cast[0].first_message ?? "The Last Inn is quiet tonight.",
      characterId: cast[0].id,
    });
  }

  // The user guide becomes the data bank's first global document — so the
  // author can be asked how to use the app, and retrieval answers it.
  const hasGlobalDocs = (db
    .query("SELECT count(*) AS n FROM documents WHERE scene_id IS NULL")
    .get() as { n: number }).n > 0;
  let guideAdded = false;
  if (!hasGlobalDocs) {
    await ingestDocument(db, keyring, { title: "Onsen guide", text: USER_GUIDE, sceneId: null });
    guideAdded = true;
  }

  return { sceneId: scene.ulid, charactersCreated, guideAdded };
}

function findCharacterByName(db: Database, name: string): CharacterRow | null {
  return (db.query("SELECT * FROM characters WHERE name = $name LIMIT 1").get({ name }) ??
    null) as CharacterRow | null;
}
