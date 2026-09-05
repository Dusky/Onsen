import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPrompt } from "../server/prompt/index.ts";
import { context, userSays } from "./prompt-fixtures.ts";

/**
 * The prompt builder's purity, enforced structurally rather than by convention.
 *
 * HANDOFF makes this a non-negotiable: the module takes a PromptContext and
 * returns a BuiltPrompt, with no I/O, no database and no HTTP. "The /prompt
 * directory importing from /db or /routes is a structural error. Enforce it."
 */

const PROMPT_DIR = join(import.meta.dir, "..", "server", "prompt");

function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(PROMPT_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, text: readFileSync(join(PROMPT_DIR, name), "utf8") }));
}

describe("structure", () => {
  test("the module has files to check", () => {
    expect(sourceFiles().length).toBeGreaterThan(3);
  });

  test("nothing under /prompt imports from /db or /routes", () => {
    for (const file of sourceFiles()) {
      const offending = [...file.text.matchAll(/from\s+"([^"]+)"/g)]
        .map((match) => match[1]!)
        .filter((specifier) => /(^|\/)(db|routes|middleware)\//.test(specifier));
      expect({ file: file.name, offending }).toEqual({ file: file.name, offending: [] });
    }
  });

  test("nothing under /prompt reaches for I/O or a global clock", () => {
    // Everything variable is passed in: the tokenizer, `now`, and `seed`. A
    // Date.now() here would make the same context produce different prompts.
    const banned = [
      /\bDate\.now\s*\(/,
      /\bnew Date\s*\(\s*\)/,
      /\bMath\.random\s*\(/,
      /\bfetch\s*\(/,
      /\bprocess\.env\b/,
      /from\s+"node:(fs|http|net|child_process)"/,
      /\bbun:sqlite\b/,
    ];
    for (const file of sourceFiles()) {
      for (const pattern of banned) {
        expect({ file: file.name, pattern: String(pattern), found: pattern.test(file.text) }).toEqual(
          { file: file.name, pattern: String(pattern), found: false },
        );
      }
    }
  });
});

describe("determinism", () => {
  test("the same context builds the same prompt, byte for byte", () => {
    const ctx = context({
      history: [userSays("The door is stuck."), userSays("Try the other one.")],
      preset: {
        name: "Default",
        systemPrompt: "Roll {{roll:d20}}, pick {{pick:a,b,c}}, random {{random:x,y,z}}.",
        jailbreak: null,
        prefill: null,
        postHistoryInstructions: null,
        maxResponseTokens: 200,
        blockOrder: null,
        customBlocks: [],
      },
      nudge: "It is {{time}} on {{date}}.",
    });

    const first = buildPrompt(ctx);
    const second = buildPrompt(ctx);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("a different seed changes only what the seed governs", () => {
    const base = context({
      preset: {
        name: "Default",
        systemPrompt: "Random {{random:alpha,beta,gamma,delta,epsilon,zeta}}.",
        jailbreak: null,
        prefill: null,
        postHistoryInstructions: null,
        maxResponseTokens: 200,
        blockOrder: null,
        customBlocks: [],
      },
    });

    const outputs = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      outputs.add(buildPrompt({ ...base, seed }).system!);
    }
    expect(outputs.size).toBeGreaterThan(1);
  });

  test("building does not mutate the context it was given", () => {
    const ctx = context({ history: [userSays("Hello {{char}}.")] });
    const snapshot = JSON.stringify({
      history: ctx.history,
      cast: ctx.cast,
      preset: ctx.preset,
      lore: ctx.lore,
    });

    buildPrompt(ctx);
    buildPrompt(ctx);

    expect(
      JSON.stringify({
        history: ctx.history,
        cast: ctx.cast,
        preset: ctx.preset,
        lore: ctx.lore,
      }),
    ).toBe(snapshot);
  });
});
