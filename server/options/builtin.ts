/**
 * The option groups and ban phrases the app ships with (SPEC §13.5, §13.6).
 *
 * Under `/options` rather than `/prompt` because these are rows, not prompt
 * assembly: they are seeded into the database once and are editable from that
 * point on. The words are here because a shipped option whose text lives in the
 * schema would be a migration every time a sentence improves.
 *
 * §22 is explicit that a preset arriving entirely switched off is an
 * anti-pattern — "major suites do this and a first run looks broken" — so a
 * default is named in every group, and the prose-discipline rules that are
 * simply good advice are on.
 */

export type Cardinality = "one_of" | "any_of";

export interface BuiltinOption {
  key: string;
  name: string;
  fragment: string;
  /** Selected on a scene that has never been configured. */
  isDefault?: boolean;
}

export interface BuiltinGroup {
  key: string;
  name: string;
  description: string;
  cardinality: Cardinality;
  options: BuiltinOption[];
}

export const BUILTIN_GROUPS: readonly BuiltinGroup[] = [
  {
    key: "pov",
    name: "Point of view",
    description: "Whose eyes the prose is written through.",
    cardinality: "one_of",
    options: [
      {
        key: "first",
        name: "First person",
        fragment: "Write in first person, from the point of view of whoever is speaking this turn.",
      },
      {
        key: "second",
        name: "Second person",
        fragment:
          "Write in second person, addressing the reader as \"you\". The reader's character is the one being addressed, never the one being narrated.",
      },
      {
        key: "third_limited",
        name: "Third limited",
        fragment:
          "Write in third person, limited to what the character speaking this turn can see, hear and know. Do not narrate anything they are not present for.",
        isDefault: true,
      },
      {
        key: "third_omniscient",
        name: "Third omniscient",
        fragment:
          "Write in third person with access to what every character is thinking and to events elsewhere.",
      },
    ],
  },
  {
    key: "prose_structure",
    name: "Prose structure",
    description: "The shape on the page.",
    cardinality: "one_of",
    options: [
      {
        key: "flowing",
        name: "Flowing prose",
        fragment:
          "Write continuous prose: paragraphs of narration with dialogue set inside them. No headings, no stage directions, no formatting scaffolding.",
        isDefault: true,
      },
      {
        key: "screenplay",
        name: "Screenplay",
        fragment:
          "Write in screenplay form: a speaker name on its own line, then their line, with action in brief present-tense lines between.",
      },
      {
        key: "web_novel",
        name: "Web-novel chapter",
        fragment:
          "Write in short paragraphs with frequent breaks, in the rhythm of a serialised web novel: one beat per paragraph, dialogue on its own line.",
      },
      {
        key: "minimal",
        name: "Minimal",
        fragment:
          "Write sparely. Dialogue and only the action needed to make it land. No description that the scene does not require.",
      },
    ],
  },
  {
    key: "length",
    name: "Length",
    description: "How much to write in one turn.",
    cardinality: "one_of",
    options: [
      {
        key: "short",
        name: "Short (80–150 words)",
        fragment: "Write between 80 and 150 words. Stop when the beat is finished.",
      },
      {
        key: "medium",
        name: "Medium (150–300 words)",
        fragment: "Write between 150 and 300 words. Stop when the beat is finished.",
      },
      {
        key: "adaptive",
        name: "Adaptive",
        fragment:
          "Match the length of your turn to the length of what you are replying to. A one-line question does not want three paragraphs.",
        isDefault: true,
      },
      {
        key: "scene_adaptive",
        name: "Scene-driven",
        fragment:
          "Let the scene decide the length. Give a quiet moment a few lines and a turning point as much room as it needs.",
      },
    ],
  },
  {
    key: "reasoning_depth",
    name: "Planning",
    description: "Whether to think before writing, and how much.",
    cardinality: "one_of",
    options: [
      { key: "none", name: "None", fragment: "", isDefault: true },
      {
        key: "brief",
        name: "Brief plan",
        fragment:
          "Before writing, think briefly inside <think></think> about what this turn needs to accomplish. Keep it to two or three lines. Everything outside those tags is the story.",
      },
      {
        key: "full",
        name: "Per-character planning",
        fragment:
          "Before writing, think inside <think></think> about what each character in this turn wants right now, what they know that the others do not, and what they will actually do about it. Then write. Everything outside those tags is the story.",
      },
    ],
  },
  {
    key: "mode",
    name: "Mode",
    description: "What kind of thing is being written.",
    cardinality: "one_of",
    options: [
      {
        key: "immersive",
        name: "Immersive prose",
        fragment: "",
        isDefault: true,
      },
      {
        key: "chat",
        name: "Chat / messaging",
        fragment:
          "This exchange is happening over messages, not in person. Write what the character types: no narration of their body or surroundings unless they describe it themselves.",
      },
      {
        key: "tabletop",
        name: "Tabletop",
        fragment:
          "Narrate as a game master would: describe the situation, then stop and leave the decision to the reader. Never decide what the reader's character does.",
      },
      {
        key: "visual_novel",
        name: "Visual novel",
        fragment:
          "Write in visual-novel rhythm: short narration, then a line of dialogue, then a beat of reaction. Keep each turn to a single exchange.",
      },
      {
        key: "cowriting",
        name: "Co-writing",
        fragment:
          "You and the reader are writing this together as authors rather than as characters. Prose can move between viewpoints and skip time when the story wants it to.",
      },
    ],
  },
  {
    key: "prose_discipline",
    name: "Prose discipline",
    description: "The habits models fall into, named so they can be avoided.",
    cardinality: "any_of",
    options: [
      {
        key: "no_echo",
        name: "No echoing",
        // §13.6 names this as a separate option, and it is the one that fights
        // the failure a long scene actually has: not a bad turn, but the same
        // turn again in different words.
        fragment:
          "Do not reuse phrasing, sentence shapes or imagery from the previous turn. If a line would land the same way as one already written, write a different line.",
        isDefault: true,
      },
      {
        key: "no_summary_close",
        name: "No summing up",
        fragment:
          "Do not end a turn by summarising it, restating what it meant, or reaching for a closing image. Stop at the last thing that happens.",
        isDefault: true,
      },
      {
        key: "no_pathetic_fallacy",
        name: "No weather-as-mood",
        fragment:
          "Do not have the weather, the light or the room reflect how a character feels. The setting is not a mood ring.",
        isDefault: true,
      },
      {
        key: "no_negation_pattern",
        name: "No \"not X, but Y\"",
        fragment:
          "Do not use the construction \"not X, but Y\", or its relatives — \"it wasn't A; it was B\". Say the thing you mean.",
        isDefault: true,
      },
      {
        key: "no_cutaway",
        name: "No cutaways",
        fragment:
          "Stay in this scene. Do not cut elsewhere, skip forward in time, or open with a transition like \"meanwhile\" or \"elsewhere\".",
      },
      {
        key: "dialogue_forward",
        name: "Dialogue forward",
        fragment:
          "Prefer letting characters say things over describing what they feel. What somebody chooses to say, and what they leave out, is the characterisation.",
      },
    ],
  },
  {
    key: "content",
    name: "Content",
    description: "How far the prose goes. Project-defined (§13.5).",
    cardinality: "one_of",
    options: [
      {
        key: "unrestricted",
        name: "As the story goes",
        fragment: "",
        isDefault: true,
      },
      {
        key: "fade",
        name: "Fade to black",
        fragment:
          "When a scene moves toward sex or graphic violence, close it there and pick up afterwards.",
      },
      {
        key: "no_graphic_violence",
        name: "No graphic violence",
        fragment: "Violence can happen, but do not dwell on injury in physical detail.",
      },
    ],
  },
];

/**
 * The starter ban list (§13.6: "ship a starter list covering the well-known
 * offenders").
 *
 * Phrases rather than regexes on purpose. A ban list is read by a model as
 * instruction and matched by a pass as text, and neither of those wants a
 * pattern language — but more to the point, the list is meant to be edited by
 * somebody who has just read a turn that annoyed them, and a regex is a worse
 * thing to be angry at.
 */
export const BUILTIN_BANS: readonly string[] = [
  "the air hung heavy",
  "a mixture of",
  "sent shivers down",
  "barely above a whisper",
  "a testament to",
  "little did they know",
  "in that moment",
  "couldn't help but",
  "a shiver ran through",
  "eyes sparkled with mischief",
  "voice barely audible",
  "meanwhile, elsewhere",
  "somewhere in the distance",
  "the tension was palpable",
  "a wave of relief washed over",
  "little more than a whisper",
];
