import { describe, expect, test } from "bun:test";
import {
  applyScripts,
  flagsProblem,
  patternProblem,
  scriptsFor,
  MAX_SCRIPT_INPUT,
  type RegexScript,
  type ScriptEnvironment,
} from "../server/scripts/apply.ts";

const env: ScriptEnvironment = {
  char: "Kestrel",
  user: "Wren",
  cast: ["Kestrel", "Aldan"],
  now: Date.parse("2026-03-04T09:41:00Z"),
};

function script(over: Partial<RegexScript> = {}): RegexScript {
  return {
    id: "01AAA",
    name: "test",
    pattern: "a",
    replacement: "b",
    flags: "g",
    enabled: true,
    applyTo: "ai_output",
    scope: "global",
    characterId: null,
    sceneId: null,
    runOrder: 0,
    ...over,
  };
}

describe("validation", () => {
  test("an unparseable pattern is reported rather than thrown", () => {
    expect(patternProblem("(unclosed", "g")).not.toBeNull();
    expect(patternProblem("\\d+", "g")).toBeNull();
  });

  test("an empty pattern is refused", () => {
    expect(patternProblem("", "g")).toBe("A pattern is required.");
  });

  test("only the flags that mean something here are allowed", () => {
    expect(flagsProblem("gim")).toBeNull();
    expect(flagsProblem("gd")).toContain("d");
    expect(flagsProblem("gg")).toContain("twice");
  });
});

/**
 * A script cannot be allowed to end the process (the server-hardening pass).
 *
 * Scripts arrive in installed packs and §14 runs them synchronously on the
 * generation path. A `String.replace` cannot be interrupted once it has
 * started — not by a timer, not by an abort signal — so `(a+)+$` against forty
 * `a`s and a `b` is not a slow turn, it is a process that has to be killed.
 *
 * Three guards, and only the first one addresses that case; the other two
 * bound the ways a chain of merely slow scripts adds up.
 */
describe("a script cannot hang the app", () => {
  test("a group that repeats around a group that repeats is refused", () => {
    for (const pattern of ["(a+)+", "([a-z]+\\.)+", "(\\w*\\s*)*", "(\\d+)*", "(?:x+)+", "(a{1,}b)+"]) {
      expect({ pattern, refused: patternProblem(pattern, "g") !== null }).toMatchObject({
        refused: true,
      });
    }
  });

  test("and the patterns people actually write are not", () => {
    // The heuristic's whole cost is here. It has to survive escaped
    // parentheses, parentheses inside a character class, lookarounds,
    // backreferences and alternation without crying wolf on any of them —
    // a false positive is somebody's working script breaking on upgrade.
    for (const pattern of [
      "\\d+",
      "(cat|dog)s?",
      "\\*\\*(.+?)\\*\\*",
      "^\\s+|\\s+$",
      "(foo)+",
      "\\[([^\\]]+)\\]",
      "(a|b)*",
      "\\((\\d)\\)+",
      "(?=\\w+)x",
      "[(+*)]+",
      "<(\\w+)>[^<]*</\\1>",
      "(\\r\\n|\\n)+",
      "^(#{1,6}) ",
    ]) {
      expect({ pattern, refused: patternProblem(pattern, "g") !== null }).toMatchObject({
        refused: false,
      });
    }
  });

  test("the refusal is reported per script, not thrown", () => {
    // The run path reports it the same way an unparseable pattern is reported,
    // so a pack carrying one loses that script and nothing else.
    const result = applyScripts(
      "aaaa",
      [script({ id: "bad", pattern: "(a+)+" }), script({ id: "good", pattern: "a", replacement: "b" })],
      env,
    );
    expect(result.runs[0]!.error).toContain("repeats a group that already repeats");
    expect(result.runs[1]!.error).toBeNull();
    expect(result.text).toBe("bbbb");
  });

  test("text past the cap is left alone, and says so", () => {
    const long = "a".repeat(MAX_SCRIPT_INPUT + 1);
    const result = applyScripts(long, [script({ pattern: "a", replacement: "b" })], env);
    expect(result.text).toBe(long);
    expect(result.runs[0]!.error).toContain("over the");
  });

  test("a chain that runs out of budget abandons the rest rather than the turn", () => {
    // The clock is injected so this proves the behaviour without spending the
    // budget in real time.
    // Reads: start at 0, the first script is still inside the budget, the
    // second finds a second has gone by.
    const readings = [0, 0, 1_000];
    let at = 0;
    const result = applyScripts(
      "aaa",
      [
        script({ id: "one", pattern: "a", replacement: "b" }),
        script({ id: "two", pattern: "b", replacement: "c" }),
      ],
      env,
      { budgetMs: 10, now: () => readings[at++] ?? 1_000 },
    );
    // The first ran; the second found the budget gone.
    expect(result.runs[0]!.error).toBeNull();
    expect(result.runs[1]!.error).toContain("budget");
    expect(result.text).toBe("bbb");
  });
});

describe("applying", () => {
  test("replaces, and counts what it replaced", () => {
    const result = applyScripts("a cat sat", [script({ pattern: "at", replacement: "og" })], env);
    expect(result.text).toBe("a cog sog");
    expect(result.runs[0]?.replacements).toBe(2);
  });

  test("numbered and named capture groups reach the replacement", () => {
    const result = applyScripts(
      "said Kestrel loudly",
      [
        script({ pattern: "said (\\w+)", replacement: "$1 said" }),
        script({ pattern: "(?<who>Kestrel) said", replacement: "$<who> murmured" }),
      ],
      env,
    );
    expect(result.text).toBe("Kestrel murmured loudly");
  });

  test("$& is the whole match and $$ is a literal dollar", () => {
    const result = applyScripts("cost 5", [script({ pattern: "5", replacement: "$$$&" })], env);
    expect(result.text).toBe("cost $5");
  });

  test("a reference past the group count stays literal", () => {
    const result = applyScripts("x", [script({ pattern: "x", replacement: "$3" })], env);
    expect(result.text).toBe("$3");
  });

  test("scripts run in order, each seeing the last one's output", () => {
    const result = applyScripts(
      "one",
      [
        script({ id: "b", pattern: "two", replacement: "three", runOrder: 2 }),
        script({ id: "a", pattern: "one", replacement: "two", runOrder: 1 }),
      ].sort((x, y) => x.runOrder - y.runOrder),
      env,
    );
    expect(result.text).toBe("three");
  });

  test("a broken pattern is reported and the rest still run", () => {
    const result = applyScripts(
      "a b",
      [script({ id: "bad", pattern: "(" }), script({ id: "ok", pattern: "b", replacement: "c" })],
      env,
    );
    expect(result.text).toBe("a c");
    expect(result.runs[0]?.error).not.toBeNull();
    expect(result.runs[1]?.error).toBeNull();
  });
});

describe("macros in the replacement", () => {
  test("the names that mean something at every stage resolve", () => {
    const result = applyScripts(
      "X X X",
      [
        script({ pattern: "^X", replacement: "{{char}}" }),
        script({ pattern: "X$", replacement: "{{user}}" }),
        script({ pattern: " X ", replacement: " {{date}} " }),
      ],
      env,
    );
    expect(result.text).toBe("Kestrel 2026-03-04 Wren");
  });

  test("an unknown macro is left in the text and named", () => {
    const result = applyScripts("X", [script({ pattern: "X", replacement: "{{setvar}}" })], env);
    expect(result.text).toBe("{{setvar}}");
    expect(result.runs[0]?.unknownMacros).toEqual(["setvar"]);
  });

  test("a dollar sign inside a resolved macro is not a capture group", () => {
    const result = applyScripts(
      "X",
      [script({ pattern: "(a)?X", replacement: "{{char}}" })],
      { ...env, char: "$1" },
    );
    expect(result.text).toBe("$1");
  });

  test("an unnamed reader is named, because a blank would read as a bug", () => {
    const result = applyScripts(
      "X",
      [script({ pattern: "X", replacement: "{{user}}" })],
      { ...env, user: null },
    );
    expect(result.text).toBe("the reader");
  });
});

describe("scope and stage", () => {
  const all = [
    script({ id: "g", applyTo: "ai_output", scope: "global" }),
    script({ id: "c", applyTo: "ai_output", scope: "character", characterId: "char-1" }),
    script({ id: "s", applyTo: "ai_output", scope: "scene", sceneId: "scene-1" }),
    script({ id: "u", applyTo: "user_input", scope: "global" }),
    script({ id: "off", applyTo: "ai_output", scope: "global", enabled: false }),
  ];

  test("a stage takes only its own scripts, and never a disabled one", () => {
    const picked = scriptsFor(all, { stage: "user_input" });
    expect(picked.map((s) => s.id)).toEqual(["u"]);
  });

  test("a character script runs for that character only", () => {
    // Same run order, so identity breaks the tie: "c" sorts before "g".
    expect(
      scriptsFor(all, { stage: "ai_output", characterId: "char-1" }).map((s) => s.id),
    ).toEqual(["c", "g"]);
    expect(
      scriptsFor(all, { stage: "ai_output", characterId: "char-2" }).map((s) => s.id),
    ).toEqual(["g"]);
  });

  test("a scene script runs in that scene only", () => {
    expect(scriptsFor(all, { stage: "ai_output", sceneId: "scene-1" }).map((s) => s.id)).toEqual([
      "g",
      "s",
    ]);
  });

  test("run order decides, and identity breaks a tie so the order is stable", () => {
    const ordered = scriptsFor(
      [
        script({ id: "z", runOrder: 1 }),
        script({ id: "a", runOrder: 1 }),
        script({ id: "m", runOrder: 0 }),
      ],
      { stage: "ai_output" },
    );
    expect(ordered.map((s) => s.id)).toEqual(["m", "a", "z"]);
  });
});
