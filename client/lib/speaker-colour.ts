import { useMemo } from "react";
import type { SceneMemberDto } from "@shared/types.ts";
import { isHex6, readableOn, relativeLuminance } from "@shared/contrast.ts";

/**
 * A speaker's colour, resolved against the ground it is about to be painted on
 * (§20 phase 220).
 *
 * The stored colour is *identity* — the reader picked it, or `CAST_PALETTE`
 * handed them one when the character joined a scene — and it is never rewritten
 * by anything here. What changes is what gets painted, because one hex cannot
 * be legible in both theme bases: clearing 4.5:1 against `#e5eaee` needs
 * relative luminance at or below 0.143, and against `#0a0d18` at or above
 * 0.194, and those windows do not overlap. Any palette chosen to satisfy both
 * has already failed before it starts.
 *
 * Which is what shipped. Measured on composited pixels at 1600×950 in the light
 * theme, the coloured dialogue phase 218 introduced read **2.07:1, 1.99:1 and
 * 2.34:1**; the speaker's name and spine had been failing the same way since
 * phase 185 at 2.14–2.94:1, and all eight palette colours sit at 2.12–3.93:1 on
 * the two light themes. Dark measures 7.5:1 and is fine, which is why nobody
 * saw it: the app's own default is dark.
 *
 * One owner. `ChatScreen` builds the single `Map<characterId, colour>` that
 * feeds the speaker's name, the spine, each beat part's label, the quoted runs
 * inside the prose and the conversation-mode bubble, so resolving it here
 * reaches all of them and there is no second place to forget.
 */

/**
 * The grounds text can land on, as the active theme defines them.
 *
 * Read from the live computed style rather than from `builtin.ts`, because the
 * app reads its palette from the `themes` table and a reader's own theme is as
 * real as a shipped one — which is the whole lesson of phase 195, where a guard
 * certified `builtin.ts` while the app rendered something else.
 */
const GROUND_TOKENS = ["--onsen-color-bg-raised", "--onsen-color-bg"] as const;

/** The mid-luminance point where black and white are equally legible. */
const HARDEST = 0.179;

/**
 * The floor this resolves to, which is above AA on purpose (§20 phase 220).
 *
 * The ground a token names is not the ground text lands on. Prose sits on a
 * translucent panel over the reader's own photograph, so the composited pixel
 * is darker than a light theme's token and can be lighter than a dark theme's,
 * by however much the picture decides. Resolving to exactly 4.5:1 against the
 * token therefore lands *under* 4.5:1 on screen — measured, after the first
 * version of this shipped: two dialogue runs came out at **4.07:1 and 3.99:1**
 * composited while every token-pair check passed. The same shape as phase 193's
 * whole argument, one layer in.
 *
 * So the number comes from measurement rather than taste. The darkest ground
 * the transcript actually composited to was `#e3e6ea` against a `#f1f1f1`
 * token, which demands 5.01:1 against the token to clear AA on screen; 5.5
 * carries that with margin (4.98:1 measured) and still clears 4.04:1 against a
 * `#d0d0d0` ground far darker than anything observed. It is applied in both
 * bases, because the direction the photograph pushes depends on the picture and
 * not on the theme.
 *
 * `scripts/rendered-guard.ts` is what holds the real promise, on composited
 * pixels. This is the client's best cheap approximation of it, and phase 222 is
 * what makes the guard measure these runs so the approximation stays honest.
 */
export const PAINT_FLOOR = 5.5;

/**
 * The ground to resolve against: whichever candidate is closest to mid grey.
 *
 * That is the hardest of them, and clearing it clears the others on the same
 * side — text darkened enough for the darker of two light grounds has more
 * contrast on the lighter one, not less. So one measurement covers the panel,
 * the page and the bubble without resolving three times and picking a winner.
 *
 * What this is *not* is the composited pixel. Prose sits on a translucent panel
 * over the reader's own photograph, and no token can tell you what that came
 * out as — `scripts/rendered-guard.ts` measures that, and phase 222 is what
 * makes it measure these runs. The token is the best answer available cheaply
 * at render time; the guard is the one that checks it was right.
 */
export function proseGround(): string | null {
  if (typeof document === "undefined") return null;
  const style = getComputedStyle(document.documentElement);
  const grounds = GROUND_TOKENS.map((token) => style.getPropertyValue(token).trim()).filter(
    isHex6,
  );
  if (grounds.length === 0) return null;
  return grounds.reduce((hardest, candidate) =>
    Math.abs(relativeLuminance(candidate) - HARDEST) <
    Math.abs(relativeLuminance(hardest) - HARDEST)
      ? candidate
      : hardest,
  );
}

/**
 * Every cast member's colour, resolved, keyed by character id.
 *
 * A member with no colour is absent rather than present-and-null, because every
 * consumer already treats a missing entry as "no colour" and adding a second
 * way to say it would be a second thing to get wrong.
 */
export function resolveCastColours(
  cast: SceneMemberDto[],
  ground: string | null,
  floor = PAINT_FLOOR,
): Map<string, string> {
  return new Map(
    cast
      .filter((member) => member.colour !== null)
      .map((member) => {
        const stored = member.colour!;
        return [
          member.characterId,
          ground === null ? stored : readableOn(stored, ground, floor),
        ] as const;
      }),
  );
}

/**
 * The resolved colours, recomputed when the cast changes.
 *
 * Not when the *theme* changes, because it cannot without a reload: applying a
 * theme calls `window.location.reload()` (see `client/lib/queries.ts`), and the
 * header's Dark/Light switch activates a theme like any other. So the ground is
 * a fact for the life of the page, read once here, and there is no observer to
 * keep in step with it.
 */
export function useSpeakerColours(cast: SceneMemberDto[]): Map<string, string> {
  return useMemo(() => resolveCastColours(cast, proseGround()), [cast]);
}
