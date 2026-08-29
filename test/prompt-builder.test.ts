import { describe, expect, test } from "bun:test";
import { buildPrompt } from "../server/prompt/index.ts";
import { HISTORY_PLACEHOLDER } from "../server/prompt/blocks.ts";
import {
  ANTHROPIC,
  AUTHOR,
  BELL,
  MIRA,
  OPENAI,
  PERSONA,
  PRESET,
  TEXT_COMPLETION,
  character,
  characterSays,
  context,
  flatten,
  singleCharacterContext,
  userSays,
} from "./prompt-fixtures.ts";

/**
 * Both rendering modes, the assembly order, and capability branching (SPEC §3,
 * §4, §23).
 */

describe("author mode", () => {
  test("puts the author in the system prompt, not a character", () => {
    const built = buildPrompt(context());
    expect(built.debug.mode).toBe("author");
    expect(built.system).toContain(`You are ${AUTHOR.name}, the author of this story`);
    expect(built.system).toContain(AUTHOR.writingStyle!);
    expect(built.system).toContain(AUTHOR.directingStyle!);
  });

  test("asserts the user-lock twice: in the system prompt and near the turn", () => {
    const built = buildPrompt(context({ history: [userSays("I push the door open.")] }));

    // SPEC §0.5 makes this a hard rule stated in the system prompt and restated
    // at depth 0, because models drift toward it constantly.
    expect(built.system).toContain(`${PERSONA.name} belongs to the reader`);
    const last = built.messages.at(-1)!;
    expect(last.content).toContain(`Write the next turn as ${BELL.name}`);
    expect(last.content).toContain(`Do not write ${PERSONA.name}'s dialogue`);
  });

  test("gives the spotlighted character a full definition and the rest compact ones", () => {
    const built = buildPrompt(context());
    const system = built.system!;

    expect(system).toContain(BELL.description!);
    expect(system).toContain(BELL.personality!);
    // Voice notes go only to the spotlighted character (SPEC §3).
    expect(system).toContain(BELL.voiceNotes!);

    expect(system).toContain(MIRA.name);
    expect(system).toContain(MIRA.description!);
  });

  test("does not leak a benched character's voice notes into the prompt", () => {
    const mira = character("mira", "Mira", { voiceNotes: "Talks in circles when nervous." });
    const built = buildPrompt(context({ cast: [BELL, mira] }));
    expect(built.system).not.toContain("Talks in circles when nervous.");
  });

  test("labels every turn with its speaker so one point of view can read it", () => {
    const built = buildPrompt(
      context({
        history: [
          userSays("Anyone there?"),
          characterSays("bell", "Bell looks up from the panel."),
          characterSays("mira", "Mira says nothing."),
        ],
      }),
    );

    const contents = built.messages.map((m) => m.content);
    expect(contents).toContain(`${PERSONA.name}: Anyone there?`);
    expect(contents).toContain("Bell: Bell looks up from the panel.");
    expect(contents).toContain("Mira: Mira says nothing.");

    // Non-user turns are assistant turns; there is no per-speaker re-render and
    // so no alternation gymnastics (SPEC §3).
    const roles = built.messages.slice(0, 3).map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "assistant"]);
  });

  test("keeps the prefix identical when the spotlight is the only thing that changes", () => {
    const history = [userSays("Who speaks?")];
    const first = buildPrompt(context({ history }));
    const second = buildPrompt(context({ history, spotlight: BELL }));

    // SPEC §0.6: the prefix must not change between turns, or prompt caching is
    // destroyed for no benefit under the author model.
    expect(second.system).toBe(first.system!);
  });

  test("names a speaker whose character has left the cast rather than losing the line", () => {
    const built = buildPrompt(
      context({ cast: [BELL], history: [characterSays("deleted-id", "A voice from the corridor.")] }),
    );
    expect(flatten(built)).toContain("Someone: A voice from the corridor.");
  });

  test("renders narration and out-of-character turns distinctly", () => {
    const built = buildPrompt(
      context({
        history: [
          { ...userSays("x"), kind: "narrator", authorType: "narrator", content: "The lights dim." },
          { ...userSays("y"), kind: "ooc", authorType: "ooc", content: "Want me to skip ahead?" },
        ],
      }),
    );
    const flat = flatten(built);
    expect(flat).toContain("Narration: The lights dim.");
    expect(flat).toContain(`${AUTHOR.name} (out of character): Want me to skip ahead?`);
  });
});

describe("single-character mode", () => {
  test("drops the author block and labels nothing", () => {
    const built = buildPrompt(
      singleCharacterContext({
        history: [userSays("Anyone there?"), characterSays("bell", "Bell looks up.")],
      }),
    );

    expect(built.debug.mode).toBe("single_character");
    expect(built.system).not.toContain("the author of this story");
    // Standard card rendering: the character simply is the assistant.
    expect(built.messages.map((m) => m.content)).toContain("Bell looks up.");
    expect(flatten(built)).not.toContain("Bell: Bell looks up.");
  });

  test("still locks the user's character", () => {
    const built = buildPrompt(singleCharacterContext());
    expect(built.messages.at(-1)!.content).toContain(`never ${PERSONA.name}'s`);
  });

  test("honours a per-character system prompt override", () => {
    const built = buildPrompt(
      singleCharacterContext({
        spotlight: character("bell", "Bell", { systemPrompt: "Answer only in questions." }),
        cast: [character("bell", "Bell", { systemPrompt: "Answer only in questions." })],
      }),
    );
    expect(built.system).toContain("Answer only in questions.");
  });
});

describe("assembly order", () => {
  test("follows SPEC §3 by default", () => {
    const built = buildPrompt(
      context({
        preset: { ...PRESET, systemPrompt: "House rules.", jailbreak: "Stay in prose." },
        history: [userSays("go")],
        guides: [{ name: "State", content: "Everyone is standing." }],
        summaries: [{ id: "s1", content: "They met at the ridge.", coversFromMessageId: null, coversToMessageId: null }],
      }),
    );

    const ids = built.debug.blocks.map((block) => block.id);
    expect(ids.indexOf("system_prompt")).toBeLessThan(ids.indexOf("author_identity"));
    expect(ids.indexOf("author_identity")).toBeLessThan(ids.indexOf("spotlight_character"));
    expect(ids.indexOf("spotlight_character")).toBeLessThan(ids.indexOf("cast"));
    expect(ids.indexOf("summaries")).toBeLessThan(ids.indexOf("history"));
    expect(ids.indexOf("history")).toBeLessThan(ids.indexOf("guides"));
    // The spotlight instruction is placed last, before only the jailbreak.
    expect(ids.indexOf("guides")).toBeLessThan(ids.indexOf("spotlight_instruction"));
    expect(ids.indexOf("spotlight_instruction")).toBeLessThan(ids.indexOf("jailbreak"));
  });

  test("omits blocks with nothing in them rather than emitting empty ones", () => {
    const built = buildPrompt(context());
    const ids = built.debug.blocks.map((block) => block.id);
    expect(ids).not.toContain("guides");
    expect(ids).not.toContain("trackers");
    expect(ids).not.toContain("summaries");
    expect(ids).not.toContain("documents");
  });

  test("a preset may reorder blocks", () => {
    const built = buildPrompt(
      context({
        preset: {
          ...PRESET,
          systemPrompt: "House rules.",
          blockOrder: ["author_identity", "system_prompt", "history", "spotlight_instruction"],
        },
      }),
    );
    const ids = built.debug.blocks.map((block) => block.id);
    expect(ids.indexOf("author_identity")).toBeLessThan(ids.indexOf("system_prompt"));
    // Blocks the preset omitted are genuinely dropped.
    expect(ids).not.toContain("cast");
  });

  test("a preset cannot accidentally drop the history or the user-lock", () => {
    const built = buildPrompt(
      context({
        history: [userSays("still here")],
        preset: { ...PRESET, blockOrder: ["system_prompt", "cast"] },
      }),
    );
    const ids = built.debug.blocks.map((block) => block.id);
    expect(ids).toContain("history");
    expect(ids).toContain("spotlight_instruction");
    expect(flatten(built)).toContain("still here");
  });

  test("a scene scenario overrides the character's", () => {
    const withCharacterScenario = context({
      spotlight: character("bell", "Bell", { scenario: "A quiet night shift." }),
    });
    expect(buildPrompt(withCharacterScenario).system).toContain("A quiet night shift.");

    const overridden = buildPrompt({
      ...withCharacterScenario,
      scene: { title: "Ridge station", scenarioOverride: "The power has failed." },
    });
    expect(overridden.system).toContain("The power has failed.");
    expect(overridden.system).not.toContain("A quiet night shift.");
  });
});

describe("depth placement", () => {
  test("depth 0 lands after the last turn and depth 2 two turns earlier", () => {
    const built = buildPrompt(
      context({
        history: [userSays("one"), characterSays("bell", "two"), userSays("three")],
        lore: [
          {
            id: "l1",
            content: "LORE AT DEPTH TWO",
            isConstant: false,
            position: "at_depth",
            insertionOrder: 0,
            insertionDepth: 2,
            insertionRole: "system",
            outletName: null,
          },
        ],
        nudge: "NUDGE AT DEPTH ZERO",
      }),
    );

    const contents = built.messages.map((m) => m.content);
    const lore = contents.findIndex((c) => c.includes("LORE AT DEPTH TWO"));
    const two = contents.findIndex((c) => c.endsWith("two"));
    const three = contents.findIndex((c) => c.endsWith("three"));
    const nudge = contents.findIndex((c) => c.includes("NUDGE AT DEPTH ZERO"));

    // Depth 2 means "two turns from the end", so it precedes the last two.
    expect(lore).toBeLessThan(two);
    expect(two).toBeLessThan(three);
    expect(three).toBeLessThan(nudge);
  });

  test("a depth deeper than the history lands at its start rather than falling out", () => {
    const built = buildPrompt(
      context({
        history: [userSays("only turn")],
        cast: [
          character("bell", "Bell", { depthPrompt: "REMEMBER THE COLD", depthPromptDepth: 50 }),
        ],
        spotlight: character("bell", "Bell", { depthPrompt: "REMEMBER THE COLD", depthPromptDepth: 50 }),
      }),
    );
    const contents = built.messages.map((m) => m.content);
    expect(contents.findIndex((c) => c.includes("REMEMBER THE COLD"))).toBeLessThan(
      contents.findIndex((c) => c.includes("only turn")),
    );
  });

  test("groups several characters' depth prompts that share a depth", () => {
    const bell = character("bell", "Bell", { depthPrompt: "Bell is cold.", depthPromptDepth: 4 });
    const mira = character("mira", "Mira", { depthPrompt: "Mira is lying.", depthPromptDepth: 4 });
    const built = buildPrompt(context({ cast: [bell, mira], spotlight: bell }));

    const depthBlocks = built.debug.blocks.filter((block) => block.id === "depth_prompts");
    expect(depthBlocks).toHaveLength(1);
    expect(depthBlocks[0]!.content).toContain("Bell is cold.");
    expect(depthBlocks[0]!.content).toContain("Mira is lying.");
  });
});

describe("capability branching", () => {
  test("OpenAI-compatible: separate system role, no prefill", () => {
    const built = buildPrompt(
      context({
        capabilities: OPENAI,
        preset: { ...PRESET, prefill: "Bell:" },
        history: [userSays("go")],
      }),
    );
    expect(built.system).toBeDefined();
    // The prefix goes in the system parameter; near-turn injections stay in the
    // conversation as system turns, which is how a depth injection carries its
    // configured role (SPEC §10).
    expect(built.system).toContain("the author of this story");
    expect(built.messages.some((m) => m.role === "system")).toBe(true);
    // Prefill is dropped where the provider cannot accept one (SPEC §4).
    expect(built.prefill).toBeUndefined();
  });

  test("Anthropic: system param, prefill, and strict alternation", () => {
    const built = buildPrompt(
      context({
        capabilities: ANTHROPIC,
        preset: { ...PRESET, prefill: "Bell:" },
        history: [userSays("one"), characterSays("bell", "two"), userSays("three")],
      }),
    );

    expect(built.system).toBeDefined();
    expect(built.prefill).toBe("Bell:");
    expect(built.messages.some((m) => m.role === "system")).toBe(false);

    // Alternation is strict and unbroken.
    for (let i = 1; i < built.messages.length; i++) {
      expect(built.messages[i]!.role).not.toBe(built.messages[i - 1]!.role);
    }
    expect(built.messages[0]!.role).toBe("user");
  });

  test("Anthropic: a scene opening on a greeting gets a visible filler turn", () => {
    const built = buildPrompt(
      context({
        capabilities: ANTHROPIC,
        history: [characterSays("bell", "Bell is already talking when you arrive.")],
      }),
    );

    expect(built.messages[0]!.role).toBe("user");
    // Invented text must always be visible in the inspector.
    const filler = built.debug.blocks.find((block) => block.id === "alternation_filler");
    expect(filler).toBeDefined();
    expect(built.messages[0]!.content).toBe(filler!.content);
  });

  test("no system role: the definitional text leads the conversation instead", () => {
    const built = buildPrompt(
      context({ capabilities: TEXT_COMPLETION, history: [userSays("go")] }),
    );
    expect(built.system).toBeUndefined();
    expect(built.messages[0]!.content).toContain("the author of this story");
  });

  test("text mode also emits a raw transcript", () => {
    const built = buildPrompt(
      context({
        capabilities: TEXT_COMPLETION,
        preset: { ...PRESET, prefill: "Bell:" },
        history: [userSays("go")],
      }),
    );
    expect(built.rawText).toBeDefined();
    expect(built.rawText).toContain("the author of this story");
    expect(built.rawText!.endsWith("Bell:")).toBe(true);
  });

  test("chat mode emits no raw transcript", () => {
    expect(buildPrompt(context()).rawText).toBeUndefined();
  });
});

describe("the history marker", () => {
  test("never leaks into the prompt", () => {
    // The history block holds a placeholder so it survives as a position in the
    // assembly order. That marker is not text and must not reach the model.
    const built = buildPrompt(context({ history: [userSays("a real turn")] }));
    expect(flatten(built)).not.toContain(HISTORY_PLACEHOLDER);
    expect(built.system).not.toContain(HISTORY_PLACEHOLDER);
    expect(flatten(built)).toContain("a real turn");
  });

  test("is absent from an empty scene's prompt too", () => {
    const built = buildPrompt(context());
    expect(flatten(built)).not.toContain(HISTORY_PLACEHOLDER);
  });
});

describe("hidden messages", () => {
  test("are excluded from the prompt and reported as evicted", () => {
    const secret = userSays("This never reaches the model.", { isHidden: true });
    const built = buildPrompt(context({ history: [userSays("visible"), secret] }));

    expect(flatten(built)).not.toContain("This never reaches the model.");
    expect(flatten(built)).toContain("visible");

    const eviction = built.debug.evicted.find((item) => item.itemId === secret.id);
    expect(eviction?.reason).toBe("hidden");
  });
});
