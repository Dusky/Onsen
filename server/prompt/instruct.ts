/**
 * Instruct templates (SPEC §4).
 *
 * "Ship named templates as data, not code." They are data because the set is
 * open: every month brings another finetune with its own turn markers, and a
 * user who has to wait for a release to add one has a broken app. Everything
 * here is a plain object, and a user-authored template is the same shape.
 *
 * A template is what turns the app's message list back into the single string a
 * text-completion endpoint wants. Getting it wrong does not error — it produces
 * prose that drifts, repeats the user, or never stops, because the model was
 * trained to see markers that are not there. That failure looks exactly like a
 * bad model, which is why this is worth being fussy about.
 *
 * Rendering lives in the prompt builder rather than in the adapter, so the
 * wrappers are counted against the context budget like everything else. On a
 * long scene the markers are hundreds of tokens; an adapter that wrapped after
 * the fact would quietly overflow the window it was told it fitted.
 */

export interface InstructTemplate {
  id: string;
  name: string;
  /**
   * Emitted once, before anything else. Several tokenizers add this themselves,
   * so a server that does is told not to by `addBosToken: false` on its side —
   * two beginning-of-sequence tokens is a measurable quality loss, not a
   * cosmetic one.
   */
  bos: string;
  systemPrefix: string;
  systemSuffix: string;
  userPrefix: string;
  userSuffix: string;
  assistantPrefix: string;
  assistantSuffix: string;
  /**
   * True where the format has no system turn of its own and the system text
   * has to lead the first user turn instead (Mistral, Alpaca).
   */
  systemInUser: boolean;
  /**
   * What ends a turn. Sent to the provider as stop strings: without them a
   * text-completion model happily writes the user's next line as well, which is
   * the single most common complaint about text-completion mode.
   */
  stopSequences: string[];
}

/**
 * The six SPEC §4 names, plus a plain fallback.
 *
 * Each is written out longhand rather than derived from a shared shape. They
 * look similar and are not: the differences are exactly the newlines and
 * spaces, and a helper that generated them would hide the one thing that
 * matters.
 */
export const INSTRUCT_TEMPLATES: readonly InstructTemplate[] = [
  {
    id: "chatml",
    name: "ChatML",
    bos: "",
    systemPrefix: "<|im_start|>system\n",
    systemSuffix: "<|im_end|>\n",
    userPrefix: "<|im_start|>user\n",
    userSuffix: "<|im_end|>\n",
    assistantPrefix: "<|im_start|>assistant\n",
    assistantSuffix: "<|im_end|>\n",
    systemInUser: false,
    stopSequences: ["<|im_end|>", "<|im_start|>"],
  },
  {
    id: "llama3",
    name: "Llama 3",
    bos: "<|begin_of_text|>",
    systemPrefix: "<|start_header_id|>system<|end_header_id|>\n\n",
    systemSuffix: "<|eot_id|>",
    userPrefix: "<|start_header_id|>user<|end_header_id|>\n\n",
    userSuffix: "<|eot_id|>",
    assistantPrefix: "<|start_header_id|>assistant<|end_header_id|>\n\n",
    assistantSuffix: "<|eot_id|>",
    systemInUser: false,
    stopSequences: ["<|eot_id|>", "<|start_header_id|>"],
  },
  {
    id: "mistral",
    name: "Mistral",
    bos: "<s>",
    // No system turn: the instruct format never had one, and the system text
    // leads the first [INST] instead.
    systemPrefix: "",
    systemSuffix: "\n\n",
    userPrefix: "[INST] ",
    userSuffix: " [/INST]",
    assistantPrefix: "",
    assistantSuffix: "</s>",
    systemInUser: true,
    stopSequences: ["</s>", "[INST]"],
  },
  {
    id: "alpaca",
    name: "Alpaca",
    bos: "",
    systemPrefix: "",
    systemSuffix: "\n\n",
    userPrefix: "### Instruction:\n",
    userSuffix: "\n\n",
    assistantPrefix: "### Response:\n",
    assistantSuffix: "\n\n",
    systemInUser: true,
    stopSequences: ["### Instruction:", "### Response:"],
  },
  {
    id: "vicuna",
    name: "Vicuna",
    bos: "",
    systemPrefix: "",
    systemSuffix: "\n\n",
    userPrefix: "USER: ",
    userSuffix: "\n",
    assistantPrefix: "ASSISTANT: ",
    assistantSuffix: "</s>\n",
    systemInUser: false,
    stopSequences: ["USER:", "</s>"],
  },
  {
    id: "metharme",
    name: "Metharme",
    bos: "",
    systemPrefix: "<|system|>",
    systemSuffix: "",
    userPrefix: "<|user|>",
    userSuffix: "",
    assistantPrefix: "<|model|>",
    assistantSuffix: "",
    systemInUser: false,
    stopSequences: ["<|user|>", "<|system|>"],
  },
  {
    /**
     * No markers at all: a labelled transcript. The right answer for a base
     * model, which was never instruct-tuned and has no turn markers to match.
     */
    id: "plain",
    name: "Plain transcript",
    bos: "",
    systemPrefix: "",
    systemSuffix: "\n\n",
    userPrefix: "",
    userSuffix: "\n\n",
    assistantPrefix: "",
    assistantSuffix: "\n\n",
    systemInUser: true,
    stopSequences: [],
  },
];

export const DEFAULT_INSTRUCT_TEMPLATE_ID = "chatml";

export function findInstructTemplate(id: string | null): InstructTemplate | null {
  if (id === null) return null;
  return INSTRUCT_TEMPLATES.find((template) => template.id === id) ?? null;
}

/**
 * Validate and normalise a user-authored template (SPEC §4: "users must be able
 * to add custom ones").
 *
 * Every field but the id and name is optional and defaults to empty, because a
 * format defined by two markers should not require filling in eight boxes.
 */
export function parseInstructTemplate(value: unknown, id: string): InstructTemplate | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const text = (key: string): string => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  const name = typeof raw["name"] === "string" && raw["name"].trim() !== "" ? raw["name"].trim() : id;
  return {
    id,
    name,
    bos: text("bos"),
    systemPrefix: text("systemPrefix"),
    systemSuffix: text("systemSuffix"),
    userPrefix: text("userPrefix"),
    userSuffix: text("userSuffix"),
    assistantPrefix: text("assistantPrefix"),
    assistantSuffix: text("assistantSuffix"),
    systemInUser: raw["systemInUser"] === true,
    stopSequences: Array.isArray(raw["stopSequences"])
      ? raw["stopSequences"].filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

/** The role wrappers, so rendering does not repeat the same three-way branch. */
function wrappersFor(
  template: InstructTemplate,
  role: "system" | "user" | "assistant",
): { prefix: string; suffix: string } {
  switch (role) {
    case "system":
      return { prefix: template.systemPrefix, suffix: template.systemSuffix };
    case "user":
      return { prefix: template.userPrefix, suffix: template.userSuffix };
    case "assistant":
      return { prefix: template.assistantPrefix, suffix: template.assistantSuffix };
  }
}

/**
 * Render a conversation into one string.
 *
 * The last thing emitted is always an *open* assistant turn — the prefix with
 * no suffix — because that is the whole point: the model continues from there.
 * A prefill goes inside that open turn, which is how prefill works in text
 * mode and why it needs no capability of its own.
 */
export function renderInstruct(
  template: InstructTemplate,
  system: string | undefined,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  prefill: string | undefined,
): string {
  const parts: string[] = [];
  if (template.bos !== "") parts.push(template.bos);

  const systemText = system ?? "";
  let pendingSystem = "";
  if (systemText !== "") {
    if (template.systemInUser) {
      // Held back and glued to the first user turn's content, *inside* its
      // markers — a format with no system turn has nowhere else to put it.
      pendingSystem = systemText + template.systemSuffix;
    } else {
      parts.push(template.systemPrefix + systemText + template.systemSuffix);
    }
  }

  for (const message of messages) {
    const { prefix, suffix } = wrappersFor(template, message.role);
    if (pendingSystem !== "" && message.role === "user") {
      parts.push(prefix + pendingSystem + message.content + suffix);
      pendingSystem = "";
      continue;
    }
    parts.push(prefix + message.content + suffix);
  }

  // A conversation with no user turn at all still has to carry its system text.
  if (pendingSystem !== "") parts.push(template.userPrefix + pendingSystem + template.userSuffix);

  parts.push(template.assistantPrefix);
  if (prefill !== undefined && prefill !== "") parts.push(prefill);
  return parts.join("");
}
