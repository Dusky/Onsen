/**
 * The turn director (SPEC §6): who speaks next in a group scene.
 *
 * Pure, like the prompt builder, and for the same reason — the decision has to
 * be inspectable and reproducible. SPEC §6 requires the decision to be exposed
 * in the UI so it never feels random, which means the *reason* is part of the
 * return value rather than a comment in the code. The design prints it verbatim
 * under the cast strip: "DIRECTOR CUED HIM — MIRA ADDRESSED HIM, SILENT 3
 * TURNS". A reason nobody can read is the arbitrary dice roll this is meant to
 * replace.
 */

export type TurnStrategy = "manual" | "round_robin" | "mention" | "classifier";

export interface DirectorCandidate {
  /** External identifier. */
  id: string;
  name: string;
  /** A benched character is not chosen and is not offered. */
  isActive: boolean;
  displayOrder: number;
}

export interface DirectorHistoryEntry {
  /** The cast member who voiced this turn, or null for the user and narration. */
  characterId: string | null;
  content: string;
}

export interface DirectorInput {
  strategy: TurnStrategy;
  cast: DirectorCandidate[];
  /** The active path, oldest first. */
  history: DirectorHistoryEntry[];
  /** A character the user explicitly cued. Always wins (SPEC §6). */
  requested?: string | null;
}

export interface DirectorDecision {
  characterId: string;
  name: string;
  /** Whether the user chose, or the director did. Drives the cast strip caption. */
  source: "user" | "director";
  /** Shown verbatim in the UI. Written to be read by a person, not parsed. */
  reason: string;
}

/** How far back "silent for N turns" looks. Beyond this it is just "silent". */
const SILENCE_WINDOW = 12;

function activeOf(cast: DirectorCandidate[]): DirectorCandidate[] {
  return cast
    .filter((member) => member.isActive)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/** The last cast member to speak, which is who must not speak again. */
function lastSpeaker(history: DirectorHistoryEntry[]): string | null {
  for (let index = history.length - 1; index >= 0; index--) {
    const characterId = history[index]!.characterId;
    if (characterId !== null) return characterId;
  }
  return null;
}

/** Turns since this character last spoke, or null if they never have. */
function turnsSilent(history: DirectorHistoryEntry[], characterId: string): number | null {
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index]!.characterId === characterId) return history.length - 1 - index;
  }
  return null;
}

function describeSilence(history: DirectorHistoryEntry[], characterId: string): string | null {
  const silent = turnsSilent(history, characterId);
  if (silent === null) return history.length === 0 ? null : "has not spoken yet";
  if (silent === 0) return null;
  if (silent > SILENCE_WINDOW) return "silent a long while";
  return `silent ${silent} turn${silent === 1 ? "" : "s"}`;
}

/**
 * Choose who speaks next. Returns null only when there is nobody to choose —
 * an empty or entirely benched cast — which the caller treats as "the author
 * narrates" rather than as an error.
 */
export function chooseSpeaker(input: DirectorInput): DirectorDecision | null {
  const active = activeOf(input.cast);
  if (active.length === 0) return null;

  // An explicit pick always wins over the strategy (SPEC §6), including over
  // the never-twice-consecutively rule: "unless requested" is what that means.
  if (input.requested != null) {
    const requested = input.cast.find((member) => member.id === input.requested);
    if (requested !== undefined) {
      return {
        characterId: requested.id,
        name: requested.name,
        source: "user",
        reason: "Your pick overrides the director this turn",
      };
    }
  }

  const previous = lastSpeaker(input.history);

  switch (input.strategy) {
    case "manual": {
      // Nothing was cued, so the director offers a sensible default rather than
      // refusing: whoever has been quiet longest, which is the choice a person
      // would most often make anyway.
      const chosen = quietestOf(active, input.history, previous);
      return {
        characterId: chosen.id,
        name: chosen.name,
        source: "director",
        reason: manualReason(chosen, input.history),
      };
    }

    case "round_robin": {
      const chosen = nextInOrder(active, previous);
      const after = previous === null ? null : input.cast.find((m) => m.id === previous);
      return {
        characterId: chosen.id,
        name: chosen.name,
        source: "director",
        reason:
          after === undefined || after === null
            ? "Round robin — first in order"
            : `Round robin — after ${after.name}`,
      };
    }

    // `mention` is not implemented yet. Falling back to round robin is what
    // SPEC §6 specifies for it; saying so is what stops the choice looking
    // arbitrary.
    case "mention": {
      const chosen = nextInOrder(active, previous);
      return {
        characterId: chosen.id,
        name: chosen.name,
        source: "director",
        reason: "No name mentioned — round robin",
      };
    }

    /**
     * The classifier is a model call, so it cannot happen here — this function
     * is pure, and it is called on every read of a scene. The decision is taken
     * when the turn is generated and announced on the stream; what is returned
     * here is the fallback that stands if the call fails, labelled as the
     * provisional thing it is rather than as a choice already made.
     */
    case "classifier": {
      const chosen = nextInOrder(active, previous);
      return {
        characterId: chosen.id,
        name: chosen.name,
        source: "director",
        reason: "The classifier decides when you send",
      };
    }
  }
}

/** The next active member after `previous` in display order, wrapping around. */
function nextInOrder(active: DirectorCandidate[], previous: string | null): DirectorCandidate {
  if (previous === null) return active[0]!;
  const index = active.findIndex((member) => member.id === previous);
  // Someone who spoke and has since been benched leaves no position to advance
  // from, so the cycle restarts.
  if (index === -1) return active[0]!;
  return active[(index + 1) % active.length]!;
}

/**
 * Whoever has been quiet longest, never the character who just spoke unless
 * they are the only one active.
 */
function quietestOf(
  active: DirectorCandidate[],
  history: DirectorHistoryEntry[],
  previous: string | null,
): DirectorCandidate {
  const eligible =
    active.length > 1 ? active.filter((member) => member.id !== previous) : active;

  let best = eligible[0]!;
  let bestSilence = -1;
  for (const member of eligible) {
    // Never having spoken is the longest silence there is.
    const silence = turnsSilent(history, member.id) ?? Number.MAX_SAFE_INTEGER;
    if (silence > bestSilence) {
      best = member;
      bestSilence = silence;
    }
  }
  return best;
}

function manualReason(chosen: DirectorCandidate, history: DirectorHistoryEntry[]): string {
  const silence = describeSilence(history, chosen.id);
  return silence === null ? "Suggested — tap anyone to change" : `Suggested — ${silence}`;
}
