import { describe, expect, test } from "bun:test";
import { buildPrompt } from "../server/prompt/index.ts";
import { resolveMacros } from "../server/prompt/macros.ts";
import {
  AUTHOR,
  BELL,
  PERSONA,
  PRESET,
  character,
  context,
  flatten,
  userSays,
} from "./prompt-fixtures.ts";
import type { PromptContext } from "../server/prompt/types.ts";

/**
 * Every macro in SPEC §3, plus outlet resolution and the visible-degradation
 * rule from §18.
 */

function resolve(text: string, ctx: PromptContext = context(), outlets: Record<string, string> = {}) {
  return resolveMacros(text, {
    ctx,
    outlets,
    unresolvedOutlets: new Set(),
    usedOutlets: new Set(),
  });
}

describe("identity macros", () => {
  test("resolve the speaker, the reader and the author", () => {
    expect(resolve("{{char}}").text).toBe(BELL.name);
    expect(resolve("{{user}}").text).toBe(PERSONA.name!);
    expect(resolve("{{persona}}").text).toBe(PERSONA.name!);
    expect(resolve("{{author}}").text).toBe(AUTHOR.name);
  });

  test("fall back to the character when there is no author", () => {
    expect(resolve("{{author}}", context({ author: null })).text).toBe(BELL.name);
  });

  test("list the cast and the scenario", () => {
    expect(resolve("{{cast}}").text).toBe("Bell, Mira");

    const scened = context({ spotlight: character("bell", "Bell", { scenario: "A night shift." }) });
    expect(resolve("{{scenario}}", scened).text).toBe("A night shift.");

    const overridden = { ...scened, scene: { title: "x", scenarioOverride: "The power failed." } };
    expect(resolve("{{scenario}}", overridden).text).toBe("The power failed.");
  });

  test("are case-insensitive and tolerate whitespace", () => {
    expect(resolve("{{CHAR}} {{ char }} {{Char}}").text).toBe("Bell Bell Bell");
  });
});

describe("time macros", () => {
  test("come from the injected clock, never the real one", () => {
    const ctx = context({ now: Date.UTC(2026, 2, 14, 9, 30, 0) });
    expect(resolve("{{date}}", ctx).text).toBe("2026-03-14");
    expect(resolve("{{time}}", ctx).text).toBe("09:30");
  });

  test("idle duration reads in prose, and is empty when unknown", () => {
    expect(resolve("{{idle_duration}}", context({ idleDuration: 30_000 })).text).toBe(
      "less than a minute",
    );
    expect(resolve("{{idle_duration}}", context({ idleDuration: 5 * 60_000 })).text).toBe(
      "5 minutes",
    );
    expect(resolve("{{idle_duration}}", context({ idleDuration: 3 * 3_600_000 })).text).toBe(
      "3 hours",
    );
    expect(resolve("{{idle_duration}}", context({ idleDuration: 50 * 3_600_000 })).text).toBe(
      "2 days",
    );
    expect(resolve("{{idle_duration}}").text).toBe("");
  });
});

describe("random macros", () => {
  test("are deterministic for a seed, so a prompt can be rebuilt exactly", () => {
    const a = resolve("{{random:north,south,east,west}}", context({ seed: 7 })).text;
    const b = resolve("{{random:north,south,east,west}}", context({ seed: 7 })).text;
    expect(a).toBe(b);
    expect(["north", "south", "east", "west"]).toContain(a);
  });

  test("random varies with the seed", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      seen.add(resolve("{{random:a,b,c,d}}", context({ seed })).text);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  test("two random macros in one text disagree", () => {
    const both = resolve("{{random:a,b,c,d,e,f,g,h}}|{{random:a,b,c,d,e,f,g,h}}", context({ seed: 3 }));
    const [left, right] = both.text.split("|");
    // Not guaranteed for any one seed, but this seed distinguishes them, which
    // is enough to show the two draws are independent rather than shared.
    expect(left).not.toBe(right);
  });

  test("pick is stable per turn even as the seed changes", () => {
    const history = [userSays("the turn in question")];
    const first = resolve("{{pick:a,b,c,d}}", context({ history, seed: 1 })).text;
    const second = resolve("{{pick:a,b,c,d}}", context({ history, seed: 999 })).text;

    // SPEC §3: pick is stable per message. If it moved with the seed, every
    // swipe would silently rewrite the prompt's fixed choices.
    expect(first).toBe(second);
    expect(["a", "b", "c", "d"]).toContain(first);
  });

  test("pick differs between turns", () => {
    const options = "{{pick:a,b,c,d,e,f,g,h}}";
    const results = new Set<string>();
    for (const text of ["turn one", "turn two", "turn three", "turn four", "turn five"]) {
      results.add(resolve(options, context({ history: [userSays(text)] })).text);
    }
    expect(results.size).toBeGreaterThan(1);
  });

  test("rolls dice within range and understands a count", () => {
    for (let seed = 0; seed < 30; seed++) {
      const single = Number(resolve("{{roll:d20}}", context({ seed })).text);
      expect(single).toBeGreaterThanOrEqual(1);
      expect(single).toBeLessThanOrEqual(20);

      const pair = Number(resolve("{{roll:2d6}}", context({ seed })).text);
      expect(pair).toBeGreaterThanOrEqual(2);
      expect(pair).toBeLessThanOrEqual(12);
    }
  });

  test("leaves an unparseable roll alone rather than inventing a number", () => {
    expect(resolve("{{roll:coin}}").text).toBe("{{roll:coin}}");
    expect(resolve("{{random:}}").text).toBe("{{random:}}");
  });
});

describe("an unnamed persona", () => {
  test("resolves to the reader rather than a placeholder name", () => {
    // A stand-in name turns the most important sentence in the system prompt
    // into "You belongs to the reader".
    const anonymous = context({ persona: { name: null, description: null } });
    expect(resolve("{{user}}", anonymous).text).toBe("the reader");
  });
});

describe("state macros", () => {
  test("read guides and trackers by name, case-insensitively", () => {
    const ctx = context({
      guides: [{ name: "Clothes", content: "Bell is in a work coat." }],
      trackers: [{ name: "Scene", content: "Location: the ridge." }],
    });
    expect(resolve("{{guide:clothes}}", ctx).text).toBe("Bell is in a work coat.");
    expect(resolve("{{tracker:SCENE}}", ctx).text).toBe("Location: the ridge.");
  });

  test("an unknown guide or tracker resolves to nothing", () => {
    expect(resolve("{{guide:missing}}").text).toBe("");
    expect(resolve("{{tracker:missing}}").text).toBe("");
  });

  test("lastMessage is the final turn", () => {
    const ctx = context({ history: [userSays("first"), userSays("last")] });
    expect(resolve("{{lastMessage}}", ctx).text).toBe("last");
    expect(resolve("{{lastMessage}}").text).toBe("");
  });
});

describe("outlets", () => {
  test("a named outlet lands wherever the preset places it", () => {
    const built = buildPrompt(
      context({
        preset: { ...PRESET, systemPrompt: "House rules.\n\n{{outlet::Weather}}\n\nEnd." },
        lore: [
          {
            id: "l1",
            content: "It has been raining for a week.",
            isConstant: true,
            position: "outlet",
            insertionOrder: 0,
            insertionDepth: 0,
            insertionRole: "system",
            outletName: "Weather",
          },
        ],
      }),
    );

    expect(built.system).toContain("House rules.\n\nIt has been raining for a week.\n\nEnd.");
    expect(built.outlets["Weather"]).toBe("It has been raining for a week.");
    expect(built.debug.unresolvedOutlets).toEqual([]);
  });

  test("an outlet nothing filled collapses to nothing and is reported", () => {
    const built = buildPrompt(
      context({ preset: { ...PRESET, systemPrompt: "Before{{outlet::Missing}}After" } }),
    );
    expect(built.system).toContain("BeforeAfter");
    expect(built.debug.unresolvedOutlets).toEqual(["Missing"]);
  });

  test("outlet content nothing references costs no tokens", () => {
    const withUnused = buildPrompt(
      context({
        lore: [
          {
            id: "l1",
            content: "A very long entry ".repeat(200),
            isConstant: true,
            position: "outlet",
            insertionOrder: 0,
            insertionDepth: 0,
            insertionRole: "system",
            outletName: "NeverUsed",
          },
        ],
      }),
    );
    const baseline = buildPrompt(context());
    expect(withUnused.debug.fixedTokens).toBe(baseline.debug.fixedTokens);
  });

  test("macros inside an outlet resolve before it is spliced in", () => {
    const built = buildPrompt(
      context({
        preset: { ...PRESET, systemPrompt: "Note: {{outlet::Aside}}" },
        lore: [
          {
            id: "l1",
            content: "{{char}} has met {{user}} before.",
            isConstant: true,
            position: "outlet",
            insertionOrder: 0,
            insertionDepth: 0,
            insertionRole: "system",
            outletName: "Aside",
          },
        ],
      }),
    );
    expect(built.system).toContain("Note: Bell has met Ridge before.");
    expect(built.system).not.toContain("{{char}}");
  });

  test("a single colon is a typo, not an outlet", () => {
    const result = resolve("{{outlet:Weather}}");
    expect(result.text).toBe("{{outlet:Weather}}");
    expect(result.unknown).toEqual(["{{outlet:Weather}}"]);
  });
});

describe("unknown macros", () => {
  test("are left in the text and reported, so the failure is visible", () => {
    // SPEC §18: suites carry state in variables this engine does not implement,
    // and an unresolved macro leaking literal text is how the user finds out.
    const result = resolve("Set {{setvar::mood::grim}} then {{getvar::mood}}.");
    expect(result.text).toContain("{{setvar::mood::grim}}");
    expect(result.unknown).toHaveLength(2);
  });

  test("are collected in the debug output", () => {
    const built = buildPrompt(
      context({ preset: { ...PRESET, systemPrompt: "{{getvar::mood}}" } }),
    );
    expect(built.debug.unknownMacros).toContain("{{getvar::mood}}");
  });
});

describe("resolution reach", () => {
  test("macros resolve inside history, where a card's first message puts them", () => {
    const built = buildPrompt(
      context({ history: [userSays("Hello {{char}}, it's {{user}}.")] }),
    );
    expect(flatten(built)).toContain("Hello Bell, it's Ridge.");
    expect(flatten(built)).not.toContain("{{char}}");
  });

  test("macros resolve inside lore, guides and outlet content alike", () => {
    const built = buildPrompt(
      context({
        guides: [{ name: "State", content: "{{char}} is standing." }],
        lore: [
          {
            id: "l1",
            content: "{{user}} has been here before.",
            isConstant: true,
            position: "before_history",
            insertionOrder: 0,
            insertionDepth: 0,
            insertionRole: "system",
            outletName: null,
          },
        ],
      }),
    );
    const flat = flatten(built);
    expect(flat).toContain("Bell is standing.");
    expect(flat).toContain("Ridge has been here before.");
  });

  test("text without macros is returned untouched", () => {
    const text = "Nothing to resolve here.";
    expect(resolve(text).text).toBe(text);
  });
});
