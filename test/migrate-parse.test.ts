import { describe, expect, test } from "bun:test";
import { ChatParseError, parseChat, titleFor } from "../server/sillytavern/chat.ts";
import {
  CONTEXT_TEMPLATE_REFUSAL,
  isContextTemplate,
  parseInstruct,
  parsePersonas,
  parseRegex,
} from "../server/sillytavern/settings.ts";
import { classify } from "../server/sillytavern/index.ts";
import {
  chatJsonl,
  charLine,
  contextJson,
  instructJson,
  regexJson,
  settingsJson,
  userLine,
} from "./sillytavern-fixtures.ts";

/**
 * Reading a SillyTavern install (SPEC §20 phase 44).
 *
 * These are the pure halves — no database — because the tree mapping is the
 * part of the migration that has to be right, and it should be provable without
 * standing a scene up first.
 */

describe("a chat is a tree with the alternates already in it", () => {
  test("a message with no swipes is one version", () => {
    const chat = parseChat(chatJsonl([userLine("Bell, are you there?")]));
    expect(chat.turns).toHaveLength(1);
    expect(chat.turns[0]!.versions).toHaveLength(1);
    expect(chat.turns[0]!.versions[0]!.content).toBe("Bell, are you there?");
    expect(chat.turns[0]!.versions[0]!.isUser).toBe(true);
  });

  test("swipes become versions and swipe_id says which is live", () => {
    const chat = parseChat(
      chatJsonl([
        charLine("Sister Bell", "Second.", {
          swipes: ["First.", "Second.", "Third."],
          swipe_id: 1,
        }),
      ]),
    );
    expect(chat.turns[0]!.versions.map((v) => v.content)).toEqual(["First.", "Second.", "Third."]);
    expect(chat.turns[0]!.liveIndex).toBe(1);
  });

  test("`mes` beats a stale swipes entry", () => {
    // Editing a message after swiping updates `mes` and leaves the array
    // behind, so the array is the half that is out of date.
    const chat = parseChat(
      chatJsonl([
        charLine("Sister Bell", "Edited after the fact.", {
          swipes: ["First.", "Original second.", "Third."],
          swipe_id: 1,
        }),
      ]),
    );
    expect(chat.turns[0]!.versions[1]!.content).toBe("Edited after the fact.");
    // The alternates the reader did not land on are untouched.
    expect(chat.turns[0]!.versions[0]!.content).toBe("First.");
  });

  test("a swipe_id pointing outside the array falls back to the first", () => {
    const chat = parseChat(
      chatJsonl([charLine("Sister Bell", "A.", { swipes: ["A.", "B."], swipe_id: 9 })]),
    );
    expect(chat.turns[0]!.liveIndex).toBe(0);
  });

  test("is_system is a hidden message, not a dropped one", () => {
    // In SillyTavern that flag means "kept out of the prompt, still in the
    // log", which is exactly what Onsen's is_hidden already does.
    const chat = parseChat(
      chatJsonl([charLine("Sister Bell", "A note to the reader.", { is_system: true })]),
    );
    expect(chat.turns[0]!.versions[0]!.isHidden).toBe(true);
  });

  test("reasoning is lifted out of extra", () => {
    const chat = parseChat(
      chatJsonl([charLine("Sister Bell", "Mm.", { extra: { reasoning: "She is stalling." } })]),
    );
    expect(chat.turns[0]!.versions[0]!.reasoning).toBe("She is stalling.");
  });

  test("the header is not a message, and its names are never read", () => {
    // SillyTavern writes the literal string "unused" into both.
    const chat = parseChat(chatJsonl([userLine("Hello.")]));
    expect(chat.turns).toHaveLength(1);
    expect(JSON.stringify(chat)).not.toContain("unused");
  });

  test("every speaker the log mentions is collected, by avatar and name", () => {
    const chat = parseChat(
      chatJsonl([
        userLine("Who is here?"),
        charLine("Sister Bell", "Me."),
        charLine("Mira Vance", "And me."),
        charLine("Sister Bell", "Still me."),
      ]),
    );
    expect(chat.speakers.map((s) => s.name)).toEqual(["Sister Bell", "Mira Vance"]);
    expect(chat.speakers[0]!.avatar).toBe("Sister Bell.png");
  });

  test("a truncated last line costs that turn and not the file", () => {
    // These files are append-only; a crash mid-write leaves exactly this.
    const good = chatJsonl([userLine("One."), charLine("Sister Bell", "Two.")]);
    const chat = parseChat(good + '{"name":"Sister Bell","mes":"Thr');
    expect(chat.turns).toHaveLength(2);
    expect(chat.warnings.join(" ")).toContain("not valid JSON");
  });

  test("a file with nothing readable in it is an error, not an empty scene", () => {
    expect(() => parseChat("")).toThrow(ChatParseError);
    expect(() => parseChat(chatJsonl([]))).toThrow(ChatParseError);
  });

  test("the title pairs the character with the chat's own timestamp", () => {
    expect(titleFor("Sister Bell", "chats/Sister Bell/2024-04-12 @18h 03m 21s.jsonl")).toBe(
      "Sister Bell — 2024-04-12 @18h 03m 21s",
    );
  });

  test("a group chat is not named twice over", () => {
    // A group's log is named for the group, and so is the group — pairing them
    // gives "The ridge — The ridge", which the browser drive found first.
    expect(titleFor("The ridge", "group chats/The ridge.jsonl")).toBe("The ridge");
  });
});

describe("what a file is, decided by where it sits", () => {
  test("each of SillyTavern's folders is recognised", () => {
    expect(classify("default-user/chats/Sister Bell/a.jsonl")).toBe("solo_chat");
    expect(classify("group chats/The ridge.jsonl")).toBe("group_chat");
    expect(classify("groups/The ridge.json")).toBe("group");
    expect(classify("data/default-user/characters/Bell.png")).toBe("character");
    expect(classify("settings.json")).toBe("settings");
    expect(classify("worlds/Ridge lore.json")).toBe("world");
    expect(classify("instruct/ChatML.json")).toBe("instruct");
    expect(classify("context/ChatML.json")).toBe("context");
    expect(classify("regex/Strip.json")).toBe("regex");
  });

  test("instruct and context are told apart by folder, not content", () => {
    // Both are bare JSON objects under neighbouring folders; nothing inside
    // them reliably says which is which.
    expect(classify("instruct/Ridge.json")).not.toBe(classify("context/Ridge.json"));
  });

  test("everything else is ignored rather than guessed at", () => {
    expect(classify("thumbnails/bg/x.png")).toBe("ignored");
    expect(classify("backups/chat_Bell_20240101.jsonl")).toBe("ignored");
    expect(classify("User Avatars/reader.png")).toBe("ignored");
  });
});

describe("personas", () => {
  test("come out of the two maps settings.json keeps them in", () => {
    const personas = parsePersonas(JSON.parse(settingsJson()));
    expect(personas).toHaveLength(2);
    expect(personas[0]).toMatchObject({
      name: "The Reader",
      description: "Keeps their coat on indoors.",
      isDefault: true,
    });
    // One with a name but no description is still a persona.
    expect(personas[1]).toMatchObject({ name: "Second Face", description: null, isDefault: false });
  });

  test("a settings file with no personas yields none rather than throwing", () => {
    expect(parsePersonas({})).toEqual([]);
    expect(parsePersonas("not an object")).toEqual([]);
  });
});

describe("instruct templates", () => {
  const parsed = parseInstruct(JSON.parse(instructJson()))!;

  test("the sequences map straight across", () => {
    expect(parsed.template).toMatchObject({
      name: "Ridge ChatML",
      userPrefix: "<|im_start|>user\n",
      userSuffix: "<|im_end|>\n",
      assistantPrefix: "<|im_start|>assistant\n",
      systemPrefix: "<|im_start|>system\n",
      systemInUser: false,
      stopSequences: ["<|im_end|>"],
    });
  });

  test("what did not survive is named, per template", () => {
    // SPEC §18: don't pretend round-tripping is clean when it isn't. `wrap`
    // changes the rendered prompt, so silence about it would be a real bug.
    expect(parsed.dropped).toContain("wrap");
    expect(parsed.dropped).toContain("first_output_sequence");
    expect(parsed.dropped).toContain("names_behavior");
    // An empty string is not a setting, so it is not reported as lost.
    expect(parsed.dropped).not.toContain("activation_regex");
  });

  test("something that is not an instruct template is refused", () => {
    expect(parseInstruct(JSON.parse(contextJson()))).toBeNull();
    expect(parseInstruct({ temperature: 0.8 })).toBeNull();
  });
});

describe("context templates", () => {
  test("are recognised, and refused with the native equivalent named", () => {
    expect(isContextTemplate(JSON.parse(contextJson()))).toBe(true);
    expect(CONTEXT_TEMPLATE_REFUSAL).toContain("prompt options");
  });
});

describe("regex scripts", () => {
  test("a /pattern/flags literal is split, and the model's output is the stage", () => {
    const parsed = parseRegex(JSON.parse(regexJson()))!;
    expect(parsed).toMatchObject({
      name: "Strip stage directions",
      pattern: "\\[[^\\]]*\\]",
      flags: "g",
      applyTo: "ai_output",
      enabled: true,
    });
  });

  test("markdownOnly and promptOnly decide the stage over placement", () => {
    expect(parseRegex(JSON.parse(regexJson({ markdownOnly: true })))!.applyTo).toBe("display_only");
    expect(parseRegex(JSON.parse(regexJson({ promptOnly: true })))!.applyTo).toBe("prompt");
    expect(parseRegex(JSON.parse(regexJson({ placement: [1] })))!.applyTo).toBe("user_input");
  });

  test("disabled travels", () => {
    expect(parseRegex(JSON.parse(regexJson({ disabled: true })))!.enabled).toBe(false);
  });

  test("a placement with no stage here is reported, not filed somewhere odd", () => {
    // 3 is slash-command output and 5 is world info; neither is a stage Onsen
    // has, and a script quietly filed under ai_output would surprise someone.
    const parsed = parseRegex(JSON.parse(regexJson({ placement: [3, 5] })))!;
    expect(parsed.dropped.join(" ")).toContain("placement");
  });

  test("trimStrings and the depth window are named as lost", () => {
    const parsed = parseRegex(
      JSON.parse(regexJson({ trimStrings: ["\n"], minDepth: 1, maxDepth: 4 })),
    )!;
    expect(parsed.dropped).toContain("trimStrings");
    expect(parsed.dropped).toContain("minDepth");
  });

  test("a bare pattern with no delimiters still works", () => {
    const parsed = parseRegex(JSON.parse(regexJson({ findRegex: "hello" })))!;
    expect(parsed.pattern).toBe("hello");
    expect(parsed.flags).toBe("g");
  });
});
