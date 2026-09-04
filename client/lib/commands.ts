import { strings } from "../strings.ts";

/**
 * Everything the app can do, in one list (SPEC §20 phase 43).
 *
 * The palette is not a second menu that has to be kept in step with the first
 * ones — it is the list, and the message sheet and the ops row render from it
 * too. A palette covering forty of two hundred things is worse than the menu it
 * replaced, because the first miss teaches the reader to stop trying it.
 *
 * Pure data and a pure matcher. Running a command needs hooks and scene state,
 * so the screen supplies the handlers and this module never does — the same
 * split the server's op registry makes, and what keeps this testable.
 */

export type CommandScope =
  /** Needs a selected turn. */
  | "turn"
  /** Needs an open roleplay. */
  | "scene"
  /** Always available. */
  | "global";

export type CommandGroup = "turn" | "scene" | "goto";

export interface Command {
  id: string;
  title: string;
  scope: CommandScope;
  group: CommandGroup;
  /**
   * Words that should find it beyond its title. "reroll" is what the button
   * says; "regenerate" and "swipe" are what people arrive typing.
   */
  keywords?: string[];
  /** The right-hand column: what kind of thing this is. */
  hint?: string;
  /** Single key, when a turn is selected and nothing has focus. */
  key?: string;
  /** Shown but not runnable, with the reason. §7's "continue" is the case. */
  unavailable?: string;
}

const c = strings.chat;
const m = strings.media;

export const COMMANDS: readonly Command[] = [
  /* ---------------- on the selected turn ---------------- */
  { id: "reroll", title: c.reroll, scope: "turn", group: "turn", key: "r", keywords: ["regenerate", "swipe", "again"] },
  { id: "edit", title: c.edit, scope: "turn", group: "turn", key: "e" },
  { id: "branch", title: c.branch, scope: "turn", group: "turn", key: "b", keywords: ["fork", "diverge"] },
  { id: "mark", title: c.checkpoint, scope: "turn", group: "turn", key: "m", keywords: ["checkpoint", "bookmark", "save place"] },
  { id: "hide", title: c.hideFromPrompt, scope: "turn", group: "turn", key: "h", keywords: ["exclude", "prompt"] },
  { id: "inspect", title: c.inspect, scope: "turn", group: "turn", key: "i", keywords: ["prompt", "tokens", "why", "debug"] },
  { id: "check", title: c.checkTurn, scope: "turn", group: "turn", keywords: ["passes", "read", "slop"] },
  { id: "illustrate", title: m.illustrate, scope: "turn", group: "turn", hint: "picture", keywords: ["image", "draw", "sd", "picture"] },
  { id: "speak", title: m.speak, scope: "turn", group: "turn", hint: "voice", keywords: ["tts", "audio", "aloud", "narrate"] },
  { id: "expand", title: c.opExpand, scope: "turn", group: "turn", keywords: ["longer", "more"] },
  { id: "correct", title: c.opCorrect, scope: "turn", group: "turn", keywords: ["rewrite", "fix"] },
  { id: "recast", title: c.recast, scope: "turn", group: "turn", keywords: ["beat", "part", "character"] },
  { id: "split", title: c.splitBeat, scope: "turn", group: "turn", keywords: ["beat", "separate"] },
  { id: "copy", title: c.copy, scope: "turn", group: "turn", keywords: ["clipboard"] },
  { id: "delete", title: c.delete, scope: "turn", group: "turn", keywords: ["remove"] },
  {
    id: "continue",
    title: c.opContinue,
    scope: "turn",
    group: "turn",
    // §7: no shipping adapter accepts a partial assistant turn. Offered and
    // explained rather than hidden, which is the rule the ops grid already had.
    unavailable: c.opContinueUnavailable,
  },

  /* ---------------- on the roleplay ---------------- */
  { id: "nudge", title: c.opNudge, scope: "scene", group: "scene", hint: "this turn only", keywords: ["direct", "hint"] },
  { id: "steer", title: c.opSteer, scope: "scene", group: "scene", hint: "every turn", keywords: ["director", "note", "ongoing"] },
  { id: "impersonate", title: c.opImpersonate, scope: "scene", group: "scene", hint: "writes your turn", keywords: ["as me", "draft", "write for me"] },
  { id: "guided-swipe", title: c.opGuidedSwipe, scope: "scene", group: "scene", keywords: ["reroll with", "guidance"] },
  { id: "ooc", title: c.opOoc, scope: "scene", group: "scene", keywords: ["out of character", "aside", "ask"] },
  { id: "no-reply", title: c.opNoReply, scope: "scene", group: "scene", keywords: ["post", "silent", "without"] },
  { id: "guides", title: c.opGuides, scope: "scene", group: "scene", keywords: ["context", "state", "tracker"] },
  { id: "attach", title: m.attach, scope: "scene", group: "scene", hint: "picture", keywords: ["image", "upload", "show"] },
  { id: "marks", title: c.checkpoints, scope: "scene", group: "scene", keywords: ["checkpoints", "bookmarks", "places"] },
  { id: "setup", title: c.setup, scope: "scene", group: "scene", keywords: ["scene", "settings", "cast", "options"] },

  /* ---------------- go to ---------------- */
  { id: "go-scenes", title: strings.nav.roleplays, scope: "global", group: "goto", keywords: ["roleplays", "home"] },
  { id: "go-characters", title: strings.nav.characters, scope: "global", group: "goto", keywords: ["cast", "cards"] },
  { id: "go-authors", title: strings.nav.authors, scope: "global", group: "goto", keywords: ["writing partner"] },
  { id: "go-lorebooks", title: strings.nav.lore, scope: "global", group: "goto", keywords: ["world info", "books"] },
  { id: "go-settings", title: strings.nav.settings, scope: "global", group: "goto", keywords: ["preferences", "models", "providers"] },
  { id: "sign-out", title: strings.settings.signOut, scope: "global", group: "goto", keywords: ["lock", "log out"] },
];

export interface MatchContext {
  /** False outside a roleplay, or with nothing selected. */
  hasScene: boolean;
  hasTurn: boolean;
}

/**
 * Score a command against what has been typed.
 *
 * Subsequence rather than substring, so "dr" finds both "Draw this" and
 * "Director note" — the behaviour every palette is judged by. A prefix on a
 * word beats a match in the middle of one, so typing "de" puts "Delete" above
 * "Hide from the author".
 */
export function score(command: Command, query: string): number {
  const needle = query.trim().toLowerCase();
  if (needle === "") return 1;

  /** How well one string answers the query, before it is weighted. */
  const rate = (text: string): number => {
    const hay = text.toLowerCase();
    if (hay.startsWith(needle)) return 100;
    if (hay.includes(` ${needle}`)) return 80;
    if (hay.includes(needle)) return 60;
    // Subsequence only once there is enough query to mean something. On two
    // letters it matches almost every command — "dr" found Settings, through
    // "providers" — and a palette that answers everything answers nothing.
    return needle.length >= 3 && isSubsequence(needle, hay) ? 30 : 0;
  };

  const title = rate(command.title);
  // Halved, so a keyword match is a real match that never outranks a title's
  // own words: typing "de" must put Delete above Inspect, whose keyword list
  // happens to contain "debug".
  const keyword = Math.max(0, ...(command.keywords ?? []).map((word) => rate(word) / 2));
  return Math.max(title, keyword);
}

function isSubsequence(needle: string, hay: string): boolean {
  let at = 0;
  for (const character of hay) {
    if (character === needle[at]) at += 1;
    if (at === needle.length) return true;
  }
  return needle.length === 0;
}

/** What the palette shows, in order, for a query and a place in the app. */
export function matchCommands(query: string, context: MatchContext): Command[] {
  return COMMANDS.filter((command) => {
    if (command.scope === "turn" && !context.hasTurn) return false;
    if (command.scope === "scene" && !context.hasScene) return false;
    return score(command, query) > 0;
  }).sort((a, b) => {
    const difference = score(b, query) - score(a, query);
    if (difference !== 0) return difference;
    // Stable within a score: registry order, which is grouped by scope.
    return COMMANDS.indexOf(a) - COMMANDS.indexOf(b);
  });
}

export const GROUP_ORDER: readonly CommandGroup[] = ["turn", "scene", "goto"];
