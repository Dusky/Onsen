import { blankPng, encodePayload, writeTextChunks } from "../server/cards/png.ts";
import { writeCharx } from "../server/cards/charx.ts";

/**
 * Card fixtures built here rather than committed as binaries, so a test can say
 * exactly what is in a card and a reviewer can see it. The PNG writer is the
 * one under test, which is fine: the round-trip tests assert against the
 * *payload*, and a writer that produced malformed PNGs would fail the chunk
 * tests first.
 */

/** A V2 card with the fields other importers most often drop (SPEC §9). */
export const V2_CARD = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Sister Bell",
    description: "Bell keeps the ridge station running.",
    personality: "Dry, watchful, slow to trust.",
    scenario: "A night shift at the end of a closed road.",
    first_mes: "Bell does not look up. \"Ridge.\"",
    mes_example: "<START>\n{{user}}: Anyone there?\n{{char}}: Mm.",
    // The five fields SPEC §9 names as commonly lost.
    alternate_greetings: ["The lamp is already lit when you arrive.", "She is asleep at the panel."],
    creator_notes: "Play her slow. She does not explain herself.",
    post_history_instructions: "Never break character.",
    character_book: {
      name: "Ridge lore",
      entries: [{ keys: ["road"], content: "The road closed in the spring." }],
    },
    extensions: {
      depth_prompt: { prompt: "Bell has not slept in two days.", depth: 2, role: "system" },
      // An extension nothing in this app understands. It must survive.
      talkativeness: "0.4",
      risuai: { customScriptV2: ["never", "touched"] },
    },
    tags: ["station", "slow-burn"],
    creator: "someone",
    character_version: "1.2",
  },
};

/**
 * Bell with nothing to open a scene with.
 *
 * Casting a character now seeds the scene's opening message (SPEC §2, phase
 * 43), which is right and is what most fixtures do not want: a test about
 * summarisation thresholds or autopilot caps wants to say "a scene with ten
 * turns in it" and mean ten.
 */
export const V2_CARD_SILENT = {
  ...V2_CARD,
  data: { ...V2_CARD.data, first_mes: "", alternate_greetings: [] },
};

/** A V3 card, which adds group-only greetings. */
export const V3_CARD = {
  spec: "chara_card_v3",
  spec_version: "3.0",
  data: {
    ...V2_CARD.data,
    group_only_greetings: ["Bell nods at the newcomer and says nothing."],
    // A top-level field from a spec revision this app has never heard of.
    future_top_level_field: { anything: "at all" },
    extensions: {
      ...V2_CARD.data.extensions,
      // A field from a spec revision this app has never heard of.
      hypothetical_future_field: { nested: [1, 2, 3] },
    },
  },
};

/** A bare V1 card: no envelope at all. Plenty are still in circulation. */
export const V1_CARD = {
  name: "Aldan Roe",
  description: "He reads labels he wrote himself.",
  personality: "Flatly confident.",
  scenario: "",
  first_mes: "He said a number.",
  mes_example: "",
};

export function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

/** A PNG card carrying its payload in the given chunks. */
export function pngCard(chunks: Record<string, unknown>): Uint8Array {
  const entries: Record<string, string> = {};
  for (const [keyword, value] of Object.entries(chunks)) {
    entries[keyword] = encodePayload(JSON.stringify(value, null, 2));
  }
  return writeTextChunks(blankPng(), entries);
}

export function charxCard(card: unknown, assets: Record<string, Uint8Array> = {}): Uint8Array {
  return writeCharx(JSON.stringify(card, null, 2), new Map(Object.entries(assets)));
}
