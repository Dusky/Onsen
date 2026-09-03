/**
 * Guided ops over the wire (SPEC §19).
 *
 * "External clients have no director bar. Expose the ops as inline commands
 * parsed out of the incoming user message." The double-paren convention is
 * §19's, and its reason is worth keeping: single-slash prefixes collide with
 * client-side slash commands in most frontends.
 *
 * Pure. The parse has to be testable without a scene, and the same function has
 * to strip the command from the text that enters history - a parser that found
 * commands and a stripper that removed them would be free to disagree.
 */

export interface InlineOps {
  /** The message with every command removed. What enters history. */
  text: string;
  /** One-shot direction for this turn (§7). Never becomes a message. */
  nudge: string | null;
  /** Set the scene's standing direction, or clear it. */
  steer: string | null;
  clearSteer: boolean;
  /** Force the spotlight to a named character. */
  as: string | null;
  /** Ask the author out of character (§7). */
  ooc: string | null;
  continue: boolean;
  swipe: boolean;
  /** Commands that parsed as commands but named nothing this app knows. */
  unknown: string[];
}

/**
 * `((name: argument))` or `((name))`.
 *
 * Non-greedy up to the first `))`, so two commands in one message are two
 * commands rather than one that swallowed the text between them.
 */
const COMMAND = /\(\(\s*([a-zA-Z][a-zA-Z ]*?)\s*(?::\s*([\s\S]*?)\s*)?\)\)/g;

/**
 * The commands that take no argument.
 *
 * They matter because of §7: an out-of-character aside uses the same
 * double-paren syntax, so `((she has no idea))` is prose. Without this set a
 * bare aside parses as a command with a very long name — left in the text, but
 * reported as an unknown command, which is a lie about what the reader wrote.
 * With a colon there is no ambiguity: nobody writes an aside as `((mood:
 * bleak))` by accident, and an unknown one there is worth naming.
 */
const BARE_COMMANDS = new Set(["continue", "swipe", "clear steer"]);

export function parseInlineOps(raw: string): InlineOps {
  const ops: InlineOps = {
    text: raw,
    nudge: null,
    steer: null,
    clearSteer: false,
    as: null,
    ooc: null,
    continue: false,
    swipe: false,
    unknown: [],
  };

  ops.text = raw
    .replace(COMMAND, (whole, rawName: string, argument: string | undefined) => {
      const name = rawName.trim().toLowerCase().replace(/\s+/g, " ");
      const value = argument?.trim() ?? "";
      // No colon and not one of the three bare commands: this is an aside.
      if (argument === undefined && !BARE_COMMANDS.has(name)) return whole;
      switch (name) {
        case "nudge":
          ops.nudge = value === "" ? null : value;
          return "";
        case "steer":
          ops.steer = value === "" ? null : value;
          return "";
        case "clear steer":
          ops.clearSteer = true;
          return "";
        case "as":
          ops.as = value === "" ? null : value;
          return "";
        case "ooc":
          ops.ooc = value === "" ? null : value;
          return "";
        case "continue":
          ops.continue = true;
          return "";
        case "swipe":
          ops.swipe = true;
          return "";
        default:
          // Left in the text rather than deleted. §3 does the same for an
          // unknown macro, and for the same reason: a client that meant
          // something by `((mood: bleak))` should see it arrive rather than
          // watch it vanish.
          ops.unknown.push(name);
          return whole;
      }
    })
    // A command lifted out of the middle leaves two spaces behind it; one taken
    // off the end leaves a trailing one.
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return ops;
}
