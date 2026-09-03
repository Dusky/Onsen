/**
 * Regex scripts (SPEC §14). Find and replace, ordered, individually toggleable,
 * applied at one of four stages, scoped to everything or to one character or
 * one scene.
 *
 * This module is pure the way `/prompt` is pure — text and scripts in, text and
 * a trace out — because the test panel (§14: "with a test panel") and the live
 * path have to agree. A test that ran a different code path from the one that
 * edits the reader's messages would be worse than no test panel at all.
 *
 * It is deliberately not a scripting language. §14 is explicit that a language
 * is out of scope for v1, and the reason holds here: everything below is data
 * the user can read back off the screen.
 */

export const APPLY_STAGES = ["user_input", "ai_output", "display_only", "prompt"] as const;
export type ApplyStage = (typeof APPLY_STAGES)[number];

export const SCRIPT_SCOPES = ["global", "character", "scene"] as const;
export type ScriptScope = (typeof SCRIPT_SCOPES)[number];

/** A script as this engine needs it. Identifiers are ULIDs, as everywhere. */
export interface RegexScript {
  id: string;
  name: string;
  pattern: string;
  replacement: string;
  flags: string;
  enabled: boolean;
  applyTo: ApplyStage;
  scope: ScriptScope;
  /** Set when `scope` is `character`; the character this script belongs to. */
  characterId: string | null;
  /** Set when `scope` is `scene`. */
  sceneId: string | null;
  runOrder: number;
}

/**
 * What a replacement's macros can see.
 *
 * A deliberate subset of §3's macro set, not the whole engine. §3's macros
 * resolve against a built prompt, and three of this module's four stages run
 * where no prompt exists — a script rewriting the reader's message as they send
 * it has no spotlight character, no seed and no history. The names below are
 * the ones that mean something at every stage; anything else is left in the
 * text verbatim and reported, which is §3's own rule for an unknown macro.
 */
export interface ScriptEnvironment {
  /** The character whose turn this is, where there is one. */
  char: string | null;
  /** The reader's persona name. Null when they have not said who they are. */
  user: string | null;
  cast: string[];
  /** Injected rather than read, so this module stays pure. */
  now: number;
}

/** What one script did, for the test panel and for the inspector. */
export interface ScriptRun {
  scriptId: string;
  name: string;
  /** How many matches it replaced. Zero is the common and uninteresting case. */
  replacements: number;
  /**
   * Why it did nothing, where that was not simply an absence of matches. A
   * script whose pattern will not compile is a misconfiguration the user needs
   * told about, not a silent no-op (SPEC §18).
   */
  error: string | null;
  /** Macros in the replacement this engine does not implement. */
  unknownMacros: string[];
}

export interface ApplyResult {
  text: string;
  /** One entry per script considered, in run order. */
  runs: ScriptRun[];
}

/** The flags `new RegExp` accepts that mean anything here. */
const ALLOWED_FLAGS = "gimsuy";

export function flagsProblem(flags: string): string | null {
  const seen = new Set<string>();
  for (const flag of flags) {
    if (!ALLOWED_FLAGS.includes(flag)) return `${flag} is not a flag this app allows.`;
    if (seen.has(flag)) return `${flag} is given twice.`;
    seen.add(flag);
  }
  return null;
}

/**
 * Whether a pattern compiles, and what is wrong with it if not.
 *
 * Called at save time as well as at run time. Catching it at save time is what
 * keeps a typo from becoming a script that silently does nothing on every turn
 * for a week.
 */
export function patternProblem(pattern: string, flags: string): string | null {
  const flagProblem = flagsProblem(flags);
  if (flagProblem !== null) return flagProblem;
  if (pattern === "") return "A pattern is required.";
  try {
    new RegExp(pattern, flags);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "That is not a valid pattern.";
  }
}

const MACRO_PATTERN = /\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g;

/**
 * Resolve the replacement's macros before the replace runs, not after.
 *
 * After would mean a macro landing inside matched text got resolved too, which
 * turns a script that quotes the model's own words into one that rewrites them.
 * Resolving first also means `$1` and `$<name>` still reach `String.replace`
 * untouched — so a resolved value containing a dollar sign has to be escaped,
 * or a character named `$1` would splice a capture group into the output.
 */
function resolveReplacement(
  replacement: string,
  env: ScriptEnvironment,
): { text: string; unknown: string[] } {
  if (!replacement.includes("{{")) return { text: replacement, unknown: [] };
  const unknown: string[] = [];
  const text = replacement.replace(MACRO_PATTERN, (whole, rawName: string) => {
    const value = ((): string | null => {
      switch (rawName.toLowerCase()) {
        case "char":
          return env.char ?? "";
        case "user":
        case "persona":
          return env.user ?? "the reader";
        case "cast":
          return env.cast.join(", ");
        case "time":
          return new Date(env.now).toISOString().slice(11, 16);
        case "date":
          return new Date(env.now).toISOString().slice(0, 10);
        case "newline":
          return "\n";
        default:
          return null;
      }
    })();
    if (value === null) {
      unknown.push(rawName);
      return whole;
    }
    return value.replaceAll("$", "$$$$");
  });
  return { text, unknown };
}

/**
 * Which scripts run here.
 *
 * A character-scoped script runs when that character is the one speaking, which
 * is why the spotlight rather than the whole cast decides it: a script that
 * styles Kestrel's dialogue should not reformat Aldan's turn because Kestrel is
 * in the room.
 */
export function scriptsFor(
  scripts: readonly RegexScript[],
  where: { stage: ApplyStage; characterId?: string | null; sceneId?: string | null },
): RegexScript[] {
  return scripts
    .filter((script) => script.enabled && script.applyTo === where.stage)
    .filter((script) => {
      switch (script.scope) {
        case "global":
          return true;
        case "character":
          return script.characterId !== null && script.characterId === (where.characterId ?? null);
        case "scene":
          return script.sceneId !== null && script.sceneId === (where.sceneId ?? null);
      }
    })
    .sort((a, b) => a.runOrder - b.runOrder || a.id.localeCompare(b.id));
}

/**
 * Run the given scripts over the text, in order, each seeing the last one's
 * output.
 *
 * Order is the whole point of `run_order`: a script that strips markdown and a
 * script that adds it are both reasonable, and which one wins is the user's
 * decision rather than an accident of insertion order.
 */
export function applyScripts(
  text: string,
  scripts: readonly RegexScript[],
  env: ScriptEnvironment,
): ApplyResult {
  const runs: ScriptRun[] = [];
  let current = text;

  for (const script of scripts) {
    const problem = patternProblem(script.pattern, script.flags);
    if (problem !== null) {
      runs.push({
        scriptId: script.id,
        name: script.name,
        replacements: 0,
        error: problem,
        unknownMacros: [],
      });
      continue;
    }

    const { text: replacement, unknown } = resolveReplacement(script.replacement, env);
    let replacements = 0;
    const expression = new RegExp(script.pattern, script.flags);
    const next = current.replace(expression, (...args: unknown[]) => {
      replacements += 1;
      // `String.replace` with a function hands back raw matches, so the
      // replacement's own `$1` and `$<name>` would arrive as literal text. The
      // second replace puts them back, reading from this match's groups.
      return expandReferences(replacement, args);
    });

    current = next;
    runs.push({
      scriptId: script.id,
      name: script.name,
      replacements,
      error: null,
      unknownMacros: unknown,
    });
  }

  return { text: current, runs };
}

const REFERENCE_PATTERN = /\$(\$|&|<([A-Za-z_$][\w$]*)>|\d{1,2})/g;

/**
 * Expand `$$`, `$&`, `$1`…`$99` and `$<name>` against one match.
 *
 * `String.replace` does this itself when given a string, but not when given a
 * function - and a function is what counts the replacements. Doing it here is
 * the price of that count.
 */
function expandReferences(replacement: string, args: readonly unknown[]): string {
  if (!replacement.includes("$")) return replacement;

  const whole = typeof args[0] === "string" ? args[0] : "";
  // The trailing arguments are offset, the subject, and named groups where the
  // pattern has any. Everything between the match and the offset is a group.
  const offsetAt = args.findIndex((value) => typeof value === "number");
  const groups = (offsetAt === -1 ? args.slice(1) : args.slice(1, offsetAt)) as (
    | string
    | undefined
  )[];
  const last = args.at(-1);
  const named = (typeof last === "object" && last !== null ? last : {}) as Record<
    string,
    string | undefined
  >;

  return replacement.replace(REFERENCE_PATTERN, (reference, body: string, name?: string) => {
    if (body === "$") return "$";
    if (body === "&") return whole;
    if (name !== undefined) return named[name] ?? "";
    const index = Number(body);
    // An out-of-range reference stays literal, which is what the engine does
    // for a string replacement and is easier to spot than an empty string.
    if (index < 1 || index > groups.length) return reference;
    return groups[index - 1] ?? "";
  });
}
