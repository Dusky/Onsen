import { describe, expect, test } from "bun:test";
import {
  applyScripts,
  flagsProblem,
  patternProblem,
  scriptsFor,
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
