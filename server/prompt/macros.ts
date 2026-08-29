import { createRng, hashString } from "./random.ts";
import type { PromptContext } from "./types.ts";

/**
 * The macro engine (SPEC §3). Macros are resolved late — after assembly, before
 * dispatch — so that a macro written inside a lore entry, a guide, or an outlet
 * resolves the same way as one written in the preset.
 *
 * Unknown macros are left in the text verbatim and reported. SPEC §18 calls
 * this degrading visibly: a suite that carries state in variables this engine
 * does not implement will leak literal `{{setvar}}` into the prompt, and the
 * inspector must be able to say so. Silently deleting them would hide the
 * problem instead.
 */

export interface MacroResolution {
  text: string;
  /** Macro names encountered that this engine does not implement. */
  unknown: string[];
}

export interface MacroEnvironment {
  ctx: PromptContext;
  /** Filled outlet contents, keyed by name (§3). */
  outlets: Record<string, string>;
  /** Outlets referenced by a `{{outlet::Name}}` that nothing filled. */
  unresolvedOutlets: Set<string>;
  /**
   * Outlets a placeholder actually consumed. An outlet whose content nothing
   * referenced never reaches the prompt, so it must not be charged for either.
   */
  usedOutlets: Set<string>;
}

const MACRO_PATTERN = /\{\{\s*([a-zA-Z_][\w]*)\s*(?:(::?)\s*([^}]*?)\s*)?\}\}/g;

function formatTime(now: number): string {
  return new Date(now).toISOString().slice(11, 16);
}

function formatDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function splitOptions(argument: string): string[] {
  return argument
    .split(",")
    .map((option) => option.trim())
    .filter((option) => option.length > 0);
}

/** "d20", "2d6", "d%" — anything else yields no roll. */
function rollDice(spec: string, next: () => number): string | null {
  const match = /^(\d*)d(\d+)$/i.exec(spec.trim());
  if (match === null) return null;
  const count = match[1] === "" || match[1] === undefined ? 1 : Number(match[1]);
  const sides = Number(match[2]);
  if (count < 1 || count > 100 || sides < 1 || sides > 1_000_000) return null;
  let total = 0;
  for (let i = 0; i < count; i++) total += 1 + Math.floor(next() * sides);
  return String(total);
}

function humaniseDuration(ms: number): string {
  if (ms < 60_000) return "less than a minute";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * The anchor that makes {{pick}} stable. SPEC §3 says pick is "stable per
 * message": unlike {{random}}, which varies per generation, the same turn must
 * pick the same option every time it is rebuilt — otherwise a swipe silently
 * rewrites the prompt's fixed choices and prompt caching is lost with it.
 */
function pickAnchor(ctx: PromptContext): string {
  return ctx.history.at(-1)?.id ?? ctx.scene.title;
}

export function resolveMacros(text: string, env: MacroEnvironment): MacroResolution {
  if (!text.includes("{{")) return { text, unknown: [] };

  const { ctx } = env;
  const unknown: string[] = [];
  // Occurrence-indexed so that two {{random}} in one prompt do not agree, while
  // the whole build stays reproducible from the seed.
  const rng = createRng(ctx.seed);
  const pickAnchorKey = pickAnchor(ctx);

  const resolved = text.replace(MACRO_PATTERN, (whole, rawName: string, separator: string | undefined, rawArgument: string | undefined) => {
    const name = rawName.toLowerCase();
    const argument = rawArgument ?? "";

    switch (name) {
      case "char":
        return ctx.spotlight.name;
      case "user":
      case "persona":
        return ctx.persona.name;
      case "author":
        return ctx.author?.name ?? ctx.spotlight.name;
      case "scenario":
        return ctx.scene.scenarioOverride ?? ctx.spotlight.scenario ?? "";
      case "cast":
        return ctx.cast.map((member) => member.name).join(", ");
      case "time":
        return formatTime(ctx.now);
      case "date":
        return formatDate(ctx.now);
      case "lastmessage":
        return ctx.history.at(-1)?.content ?? "";
      case "idle_duration":
        return ctx.idleDuration === undefined ? "" : humaniseDuration(ctx.idleDuration);

      case "random": {
        const options = splitOptions(argument);
        if (options.length === 0) return whole;
        return options[Math.floor(rng() * options.length)] ?? "";
      }

      case "pick": {
        const options = splitOptions(argument);
        if (options.length === 0) return whole;
        // Anchored to the turn rather than the build seed, so it is stable.
        const stable = createRng(hashString(`${pickAnchorKey}::${argument}`));
        return options[Math.floor(stable() * options.length)] ?? "";
      }

      case "roll": {
        const rolled = rollDice(argument, rng);
        return rolled ?? whole;
      }

      case "tracker": {
        const tracker = ctx.trackers.find(
          (candidate) => candidate.name.toLowerCase() === argument.toLowerCase(),
        );
        return tracker?.content ?? "";
      }

      case "guide": {
        const guide = ctx.guides.find(
          (candidate) => candidate.name.toLowerCase() === argument.toLowerCase(),
        );
        return guide?.content ?? "";
      }

      case "outlet": {
        // Written {{outlet::Name}} — the double colon distinguishes it, and a
        // single colon is a typo worth reporting rather than silently accepting.
        if (separator !== "::") {
          unknown.push(whole);
          return whole;
        }
        const filled = env.outlets[argument];
        if (filled === undefined) {
          // An outlet nothing filled collapses to nothing: unlike an unknown
          // macro, an empty slot is a normal state, not a misconfiguration.
          env.unresolvedOutlets.add(argument);
          return "";
        }
        env.usedOutlets.add(argument);
        return filled;
      }

      default:
        unknown.push(whole);
        return whole;
    }
  });

  return { text: resolved, unknown };
}
