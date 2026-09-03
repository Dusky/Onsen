/**
 * Double-assembly protection (SPEC §19).
 *
 * "Other roleplay frontends will build their own prompt before calling you —
 * character card, lorebook, jailbreak — producing a prompt with two conflicting
 * character definitions."
 *
 * The failure this prevents is not an error, it is worse: a scene that answers,
 * in the wrong voice, for reasons nobody can see. §19 asks for three things —
 * document it, warn on it, and log it in the inspector so the conflict is
 * visible rather than mysterious. This is the detection half.
 *
 * Deliberately a warning and never a refusal. A false positive that rejected
 * the request would break a client over a heuristic; a false positive that adds
 * a header costs nothing.
 */

export const WARNING_HEADER = "X-Roleplay-Warning";
export const CLIENT_ASSEMBLED = "client-assembled-prompt";

/** What a system prompt looked like, for the header and for the inspector. */
export interface AssemblyCheck {
  assembled: boolean;
  /** Which signals fired, so the log says why rather than only that. */
  signals: string[];
}

/**
 * Signals that a system message was built by another frontend.
 *
 * Each is something a hand-written instruction has little reason to contain and
 * an assembled card has every reason to. One alone is weak - "Personality:" is
 * a thing a person might write - so two are required.
 */
const SIGNALS: { name: string; test: RegExp; strong?: true }[] = [
  // Macro residue: the surest signal there is, and the only one that stands
  // alone. A person writing an instruction does not type `{{char}}`; a client
  // that left it there is handing over a template it expected somebody else to
  // fill, which is exactly the conflict this is looking for.
  {
    name: "macro-residue",
    test: /\{\{(char|user|persona|description|personality)\}\}/i,
    strong: true,
  },
  // Card field headers, as every frontend renders them.
  { name: "card-headers", test: /^\s*(personality|description|scenario|appearance)\s*:/im },
  // Example dialogue markers, which are card syntax and nothing else.
  { name: "example-markers", test: /<start>|^\s*<\|?(system|user|assistant)\|?>/im },
  // The speaker-label form a card's example block uses.
  { name: "speaker-labels", test: /^\s*\{\{char\}\}\s*:|^\s*[A-Z][\w '-]{1,30}:\s.+$[\s\S]*^\s*[A-Z][\w '-]{1,30}:\s/m },
  // A jailbreak, which is the third thing §19 names.
  { name: "jailbreak", test: /\b(you are now|ignore (all|any) (previous|prior)|never refuse|unfiltered|no restrictions)\b/i },
  // A lorebook spliced in.
  { name: "lore-block", test: /^\s*(\[|<)(world ?info|lorebook|memory)(\]|>)/im },
];

/**
 * Long enough that a genuinely minimal system prompt is never suspected.
 *
 * Applied to the weak signals only. A card assembled by a frontend that
 * happened to be short still leaves macro residue, and a length floor that
 * suppressed that would be a threshold deciding a question the evidence had
 * already answered.
 */
const MINIMUM_LENGTH = 200;

export function checkAssembly(systemPrompt: string): AssemblyCheck {
  const matched = SIGNALS.filter((signal) => signal.test.test(systemPrompt));
  const signals = matched.map((signal) => signal.name);
  if (matched.some((signal) => signal.strong === true)) {
    return { assembled: true, signals };
  }
  if (systemPrompt.trim().length < MINIMUM_LENGTH) return { assembled: false, signals };
  // Two, because one is a coincidence and two is a card.
  return { assembled: signals.length >= 2, signals };
}
