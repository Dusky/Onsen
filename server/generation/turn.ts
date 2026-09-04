import type { Database } from "bun:sqlite";
import { activePath, lastSpeakerOf, type SceneRow } from "../db/queries/history.ts";
import { castRowsOf } from "../db/queries/authors.ts";
import { chooseSpeaker, type DirectorDecision, type TurnStrategy } from "./director.ts";

/** The stored JSON array, defensively — a bad row must not fail a whole scene. */
function mentionKeywordsFrom(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The bridge between stored state and the pure turn director.
 *
 * Kept separate so `director.ts` stays a function of plain data: the rules for
 * who speaks next are worth being able to test without a database, and the
 * decision has to be reproducible to be worth showing the user.
 */

export interface NextSpeaker extends DirectorDecision {
  /** So the client can show a portrait without another lookup. */
  hasAvatar: boolean;
}

/**
 * Who speaks next in this scene. Null when there is nobody to choose — an empty
 * or entirely benched cast — which callers treat as "the author narrates".
 */
export function resolveNextSpeaker(
  db: Database,
  scene: SceneRow,
  requested?: string | null,
): NextSpeaker | null {
  const castRows = castRowsOf(db, scene.id);
  if (castRows.length === 0) return null;

  const decision = chooseSpeaker({
    strategy: scene.turn_strategy,
    cast: castRows.map((row) => ({
      id: row.ulid,
      name: row.name,
      isActive: row.is_active === 1,
      displayOrder: row.display_order,
      mentionKeywords: mentionKeywordsFrom(row.mention_keywords),
    })),
    history: activePath(db, scene.id).map((row) => {
      // For a beat this is whoever spoke last *inside* it, not the member it is
      // filed under: after a beat that ends on Mira, "never twice in a row" is
      // about Mira (SPEC §6, §3.5).
      const spoke = lastSpeakerOf(db, row);
      return {
        characterId:
          spoke === null ? null : (castRows.find((member) => member.id === spoke)?.ulid ?? null),
        content: row.content,
      };
    }),
    ...(requested == null ? {} : { requested }),
  });

  if (decision === null) return null;
  const row = castRows.find((member) => member.ulid === decision.characterId);
  return { ...decision, hasAvatar: row?.avatar_path != null };
}

/** Internal id for a decision, which is what generation stores on the message. */
export function internalIdOf(db: Database, scene: SceneRow, characterUlid: string): number | null {
  const row = castRowsOf(db, scene.id).find((member) => member.ulid === characterUlid);
  return row?.id ?? null;
}

export type { TurnStrategy };
