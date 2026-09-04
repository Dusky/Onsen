/**
 * Keys, duplicated from the op registry rather than imported.
 *
 * This module is under `/prompt`, which imports from nothing outside itself:
 * these strings are the words a prompt is made of, and the registry is a list
 * of things that can be configured. A handful of short constants is a cheaper
 * coupling than the layering violation, and `test/op-config.test.ts` asserts
 * the two lists agree.
 */
const EXPAND = "expand";
const CORRECT = "correct";
const CONTINUE = "continue";
const NUDGE = "nudge";
const STEER = "steer";
const ANALYSE_SLOP = "analyse_slop";
const SUMMARISE = "summarise";
const RESUMMARISE = "resummarise";

/**
 * The words each op uses, as templates (SPEC §7: "fully user-overridable,
 * `{{input}}` plus the macro set").
 *
 * Two substitution passes reach these, and the difference matters. The op's own
 * variables — `{{input}}`, `{{original}}` — are filled here, because only the
 * op knows what they mean. Everything else is the ordinary macro set, filled at
 * assembly along with the rest of the prompt, so `{{char}}` inside an override
 * resolves exactly as it does inside a preset.
 *
 * **The user-lock is not part of any template.** SPEC §0.5 makes it a hard
 * constraint restated near the turn, and a template a user can edit is not
 * where a non-negotiable belongs; the builder appends it after the template,
 * where an override cannot drop it by accident.
 */

const EXPAND_TEMPLATE = `You wrote this turn as {{char}}:

{{original}}

Write it again, longer and with more in it. Not more words for the same content — more that happens: what they do with their hands, what they notice, what they do not say. Keep everything that is already there and keep the same ending.`;

const CORRECT_TEMPLATE = `You wrote this turn as {{char}}:

{{original}}

{{input}}
Keep everything that was already working — the same moment, the same voice, the same beats — and change only what has to change. This is a correction, not a fresh attempt.`;

const CONTINUE_TEMPLATE = `You were writing this turn as {{char}} and stopped partway:

{{original}}

Carry straight on from where it stops. Do not repeat any of it, do not start again, and do not summarise what came before — write only what comes next, beginning mid-flow.`;

/**
 * Nudge and steer are the user's own words, so their templates are the bare
 * variable. Overriding one is how you wrap it — "Note to the author:
 * {{input}}" — for a model that reads direction better with a frame.
 */
const PASSTHROUGH_TEMPLATE = `{{input}}`;

/* ------------------------------------------------------------------ */
/* Persistent guides (SPEC §8)                                         */
/* ------------------------------------------------------------------ */

/**
 * A guide is written once by a side call and injected every turn until it is
 * flushed, so its question has a shape all six share: here is the scene, here
 * is what you wrote last time, write it again from what has happened since.
 *
 * `{{previous}}` is why a refresh updates rather than restarting. A guide that
 * forgot everything each time it ran would lose exactly the state it exists to
 * carry — a coat somebody took off three turns ago stays off.
 */
function guideTemplate(subject: string, instruction: string): string {
  return `${subject}

What has happened, oldest first:
{{transcript}}

{{previous}}

${instruction}

Write it as plain prose a person could edit — a few short lines, no headings, no bullet list, no preamble. Write only what the story has actually established: if something has not come up, leave it out rather than inventing it.`;
}

const SITUATIONAL_TEMPLATE = guideTemplate(
  "You are keeping a note of where this scene currently stands, so the author can pick it up without rereading.",
  "Write the situation as it stands now: where everyone is, what is going on, and what is unresolved.",
);

const THINKING_TEMPLATE = guideTemplate(
  "You are keeping a note of what each character is privately thinking — the things they have not said.",
  "Write what each character currently wants, suspects or is holding back. One short line each. This is never spoken aloud; it is what the author knows and the characters do not say.",
);

const CLOTHES_TEMPLATE = guideTemplate(
  "You are keeping a note of what each character is currently wearing.",
  "Write what each character has on now, including anything they have removed, put on, or ruined since. One short line each.",
);

const STATE_TEMPLATE = guideTemplate(
  "You are keeping a note of where everyone physically is and what condition they are in.",
  "Write where each character is standing or sitting, what they are holding or touching, and any injury or physical state that would still be true a minute from now. One short line each.",
);

const RULES_TEMPLATE = guideTemplate(
  "You are keeping a note of the rules this world runs on, so the story does not contradict itself.",
  "Write the in-world rules the story has established — how things work here, what is possible, what is forbidden, and by whom. Only rules the story has actually stated or demonstrated.",
);

/** The custom guide's question is the user's own; there is no built-in. */
const CUSTOM_TEMPLATE = `{{input}}

What has happened, oldest first:
{{transcript}}

{{previous}}`;

/**
 * Rolling summarisation (SPEC §11 layer 1).
 *
 * Written to be *joined* rather than to stand alone: this paragraph will sit in
 * a list of other paragraphs covering earlier stretches, so it opens in the
 * middle of a story and is told not to conclude anything. The previous summary
 * is shown for continuity — who people are, what a name refers to — and
 * explicitly not to be repeated, because a summariser handed its own last
 * output will otherwise restate it and grow without bound.
 */
const SUMMARISE_TEMPLATE = `You keep the record of a story someone else is writing. Below is a stretch of it. Condense it into a short piece of prose that a reader could use in place of the original.

{{previous}}

The stretch to condense, oldest first:
{{transcript}}

Write what happened, in order, in past tense: what was decided, what changed, what was learned, and anything a later scene would need to know. Keep names, places and specifics — a summary that says "they discussed the shortage" where the story said "Mira accused Aldan of skimming oil" has thrown away the only part worth keeping.

Do not repeat what earlier summaries already cover, do not quote dialogue at length, do not editorialise about the writing, and do not round the stretch off with a conclusion — the story is still going. A few short paragraphs at most, no headings, no bullet list, no preamble.`;

/**
 * Condensing summaries into one (§11: "older summaries can be re-summarised
 * when they themselves grow past a budget"). Deliberately blunter than the
 * first pass: at this level detail is already being traded for room, and
 * pretending otherwise produces something as long as what went in.
 */
const RESUMMARISE_TEMPLATE = `Below are several summaries of consecutive stretches of one story, oldest first. Fold them into a single shorter summary covering the whole span.

{{transcript}}

Keep the through-line: who these people are, what they decided, what changed, and anything a later scene would still need. Drop the detail that only mattered at the time. Names and specifics survive; beat-by-beat sequence does not.

Write it as plain past-tense prose, shorter than what went in, with no headings, no bullet list and no preamble.`;

/**
 * Judging what recurrence means (SPEC §13.6).
 *
 * The counting has already happened in code, exactly, before this is asked —
 * §13.6 says recurrence is measurable, so it is measured. What is left is the
 * only part that needs a reader: whether a phrase that keeps appearing is a tic
 * or is simply the story. A character's name recurs. A place recurs. A thing
 * somebody says on purpose recurs. None of those are slop, and no amount of
 * counting can tell them apart from the ones that are.
 */
const ANALYSE_SLOP_TEMPLATE = `Below are phrasings that have appeared across several turns of one story, with the number of turns each appeared in.

{{candidates}}

Some of these recur because the story is about them — a character's name, a place, an object that matters, something a character says deliberately. Those are not problems.

The rest recur because they are filler: stock descriptive phrases, worn imagery, the same sentence shape reached for again and again.

Reply with only the filler ones, one per line, copied exactly as written above. No numbering, no explanation, nothing else. If none of them are filler, reply with nothing at all.`;

const TRACKER_SCENE_TEMPLATE = `You keep one structured note about a story in progress: where the scene is, the time of day, and who is present. You rewrite it as the story moves.

{{transcript}}

{{previous}}

Reply with JSON only, no commentary, in exactly this shape:
{"location": "where they are", "time_of_day": "morning, afternoon, evening or night", "present": ["names of everyone there"]}`;

const TRACKER_CHARACTERS_TEMPLATE = `You keep one structured note about a story in progress: what each character is currently doing and feeling, including what they know privately. You rewrite it as the story moves.

{{transcript}}

{{previous}}

Reply with JSON only, no commentary, in exactly this shape:
{"characters": [{"name": "...", "mood": "...", "position": "...", "notable_state": "...", "private_knowledge": "..."}]}`;

/**
 * §11 layer 3's extractor.
 *
 * Asked for the three signals separately rather than one number, because a
 * model handed "rate the importance 0-1" answers 0.7 to everything — and
 * because the three are what §11 names, so a reader looking at a salience can
 * be told what it was made of.
 *
 * "What is already known" is passed in so the model can say a *changed* thing
 * rather than restate the cast list every turn.
 */
const MEMORY_EXTRACT_TEMPLATE = `Read the recent turns of a story and note what is worth remembering.

Already known:
{{known}}

Recent turns:
{{transcript}}

Note only what the recent turns establish or change. Do not restate what is already known unless it changed. If nothing is worth noting, reply with empty lists.

For each thing, give three scores from 0 to 1:
- emotional: how much feeling is attached to it
- narrative: how much of the story turns on it
- density: how much it says that is not already obvious

Reply with JSON only, no commentary, in exactly this shape:
{"entities": [{"kind": "person|place|object|event|fact", "name": "...", "content": "one or two sentences", "salience": {"emotional": 0.0, "narrative": 0.0, "density": 0.0}}], "relations": [{"from": "name", "to": "name", "kind": "owes money to", "content": "...", "salience": {"emotional": 0.0, "narrative": 0.0, "density": 0.0}}]}`;

/**
 * §11's author memory.
 *
 * Asked in the second person and about the author's *own* experience, because
 * that is what this memory is for: not what happened in the story, which the
 * summaries already hold, but what the partner would want to know next time.
 * §11's examples are all of that kind — unresolved threads, what the reader
 * tends to enjoy, recurring characters.
 */
const AUTHOR_REMEMBER_TEMPLATE = `You are {{author}}, a writing partner. Write one note to your future self, to carry into other roleplays with this reader.

You already remember:
{{known}}

What just happened:
{{transcript}}

Note something that will still matter after this roleplay ends: a thread left hanging, a name that keeps coming back, something about how this reader likes to be written for. Not a summary of the plot — you have that elsewhere.

Give it a short title and the words that should bring it back to mind.

Reply with JSON only, no commentary, in exactly this shape:
{"title": "...", "keys": ["word", "another"], "content": "one or two sentences, in your own voice"}`;

const CAPTION_IMAGE_TEMPLATE = `Describe what is in this image, for someone who cannot see it.

Write two or three sentences of plain description: who or what is in it, where, and what is happening. Say what is actually there. Do not guess at names, do not invent a story around it, and do not say what it might mean.

Reply with the description alone.`;

const DEFAULTS: Record<string, string> = {
  caption_image: CAPTION_IMAGE_TEMPLATE,
  author_remember: AUTHOR_REMEMBER_TEMPLATE,
  memory_extract: MEMORY_EXTRACT_TEMPLATE,
  [ANALYSE_SLOP]: ANALYSE_SLOP_TEMPLATE,
  [SUMMARISE]: SUMMARISE_TEMPLATE,
  [RESUMMARISE]: RESUMMARISE_TEMPLATE,
  guide_situational: SITUATIONAL_TEMPLATE,
  guide_thinking: THINKING_TEMPLATE,
  guide_clothes: CLOTHES_TEMPLATE,
  guide_state: STATE_TEMPLATE,
  guide_rules: RULES_TEMPLATE,
  guide_custom: CUSTOM_TEMPLATE,
  tracker_scene: TRACKER_SCENE_TEMPLATE,
  tracker_characters: TRACKER_CHARACTERS_TEMPLATE,
  [EXPAND]: EXPAND_TEMPLATE,
  [CORRECT]: CORRECT_TEMPLATE,
  [CONTINUE]: CONTINUE_TEMPLATE,
  [NUDGE]: PASSTHROUGH_TEMPLATE,
  [STEER]: PASSTHROUGH_TEMPLATE,
};

/**
 * The built-in words for an op. Side calls build their own prompts in code and
 * have no template to show, which is honest rather than a gap: their question
 * is a shape — a roster, a transcript, a reply format — not a paragraph.
 */
export function defaultTemplateOf(key: string): string {
  return DEFAULTS[key] ?? "";
}

/** Every op that has a template, for the test that keeps this list honest. */
export const TEMPLATED_OPS: readonly string[] = Object.keys(DEFAULTS);

/**
 * Fill an op's own variables. Unknown names are left alone, because the
 * ordinary macro pass runs after this one and a macro deleted here would never
 * reach it.
 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? (values[name] ?? "") : whole,
  );
}
