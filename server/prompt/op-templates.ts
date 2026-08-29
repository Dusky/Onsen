/**
 * Keys, duplicated from the op registry rather than imported.
 *
 * This module is under `/prompt`, which imports from nothing outside itself:
 * these strings are the words a prompt is made of, and the registry is a list
 * of things that can be configured. Five short constants is a cheaper coupling
 * than the layering violation, and `test/op-config.test.ts` asserts the two
 * lists agree.
 */
const EXPAND = "expand";
const CORRECT = "correct";
const CONTINUE = "continue";
const NUDGE = "nudge";
const STEER = "steer";

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

const DEFAULTS: Record<string, string> = {
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
