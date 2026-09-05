/**
 * Stand-ins for the files a SillyTavern install holds (SPEC §20 phase 44).
 *
 * Written to match what SillyTavern actually writes rather than what its docs
 * describe — including the header whose `user_name` and `character_name` are
 * the literal string "unused", which is real and is why nothing reads them.
 */

export interface StMessage {
  name: string;
  is_user: boolean;
  is_system?: boolean;
  send_date?: string | number;
  mes: string;
  swipes?: string[];
  swipe_id?: number;
  original_avatar?: string;
  extra?: Record<string, unknown>;
}

/** A chat file: the header line, then one line per message. */
export function chatJsonl(messages: StMessage[]): string {
  const header = { chat_metadata: {}, user_name: "unused", character_name: "unused" };
  return [header, ...messages].map((line) => JSON.stringify(line)).join("\n") + "\n";
}

export function userLine(mes: string, extra: Partial<StMessage> = {}): StMessage {
  return { name: "You", is_user: true, send_date: "2024-04-12T18:03:21.000Z", mes, ...extra };
}

export function charLine(
  name: string,
  mes: string,
  extra: Partial<StMessage> = {},
): StMessage {
  return {
    name,
    is_user: false,
    send_date: "2024-04-12T18:03:40.000Z",
    mes,
    original_avatar: `${name}.png`,
    ...extra,
  };
}

/** A group definition, as SillyTavern writes one under `groups/`. */
export function groupJson(name: string, members: string[], disabled: string[] = []): string {
  return JSON.stringify({
    id: "1",
    name,
    members,
    disabled_members: disabled,
    chat_id: "chat",
    chats: ["chat"],
    activation_strategy: 0,
    generation_mode: 0,
  });
}

/** `settings.json`, cut down to the two maps personas live in. */
export function settingsJson(): string {
  return JSON.stringify({
    user_avatar: "reader.png",
    personas: { "reader.png": "The Reader", "other.png": "Second Face" },
    persona_descriptions: {
      "reader.png": { description: "Keeps their coat on indoors.", position: 0, depth: 2 },
    },
  });
}

/** An instruct template, with fields Onsen has nowhere to put. */
export function instructJson(): string {
  return JSON.stringify({
    name: "Ridge ChatML",
    input_sequence: "<|im_start|>user\n",
    input_suffix: "<|im_end|>\n",
    output_sequence: "<|im_start|>assistant\n",
    output_suffix: "<|im_end|>\n",
    system_sequence: "<|im_start|>system\n",
    system_suffix: "<|im_end|>\n",
    stop_sequence: "<|im_end|>",
    system_same_as_user: false,
    // The ones with no home here. `wrap` changes the rendered prompt.
    wrap: true,
    macro: true,
    first_output_sequence: "<|im_start|>assistant\n",
    names_behavior: "always",
    activation_regex: "",
  });
}

export function contextJson(): string {
  return JSON.stringify({
    name: "Ridge context",
    story_string: "{{#if system}}{{system}}\n{{/if}}{{#if description}}{{description}}{{/if}}",
    chat_start: "***",
    example_separator: "***",
  });
}

export function regexJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "a-uuid",
    scriptName: "Strip stage directions",
    findRegex: "/\\[[^\\]]*\\]/g",
    replaceString: "",
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    ...overrides,
  });
}
