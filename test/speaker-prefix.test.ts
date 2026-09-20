import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { stripSpeakerPrefix, stripStreamingPrefix } from "../shared/speaker-prefix.ts";

/**
 * The `Name:` prefix is gone before the reader ever sees it (§20 phase 223).
 *
 * Phase 216 taught `land()` to strip a leading `Name:` off a spotlight turn,
 * because the log has already attributed the turn and the prompt's history
 * would otherwise feed it back doubled. It stripped what was *stored*. What was
 * *streamed* still had the prefix, so a turn arrived reading "Aldan Roe: He set
 * the lamp down." and lost its first two words the instant it settled.
 *
 * `MessageLog`'s own comment beside that tail names the principle: prose that
 * "reflows the instant the turn completes… reads as the app changing its mind".
 * One regex, two ends, in `shared/`.
 */

describe("the stored strip", () => {
  test("takes the speaker's own name off the front, plain or bold", () => {
    expect(stripSpeakerPrefix("Aldan Roe: He set the lamp down.", "Aldan Roe")).toBe(
      "He set the lamp down.",
    );
    expect(stripSpeakerPrefix("**Aldan Roe:** He set it down.", "Aldan Roe")).toBe(
      "He set it down.",
    );
    // A model that imitates the format rarely matches its spacing.
    expect(stripSpeakerPrefix("  aldan roe :   He set it down.", "Aldan Roe")).toBe(
      "He set it down.",
    );
  });

  test("leaves a name that is prose alone", () => {
    // Only at the very start, and only the speaker's own. A name later in the
    // line is dialogue, not a header.
    expect(stripSpeakerPrefix("Later, Aldan Roe: the name in prose.", "Aldan Roe")).toBe(
      "Later, Aldan Roe: the name in prose.",
    );
    expect(stripSpeakerPrefix("Elira: she said nothing.", "Aldan Roe")).toBe(
      "Elira: she said nothing.",
    );
    expect(stripSpeakerPrefix("He set it down.", "Aldan Roe")).toBe("He set it down.");
  });

  test("a name with regex characters in it is a name, not a pattern", () => {
    expect(stripSpeakerPrefix("K. (the Warden): he waited.", "K. (the Warden)")).toBe(
      "he waited.",
    );
  });

  test("no speaker means nothing to strip", () => {
    expect(stripSpeakerPrefix("Aldan Roe: He set it down.", null)).toBe(
      "Aldan Roe: He set it down.",
    );
    expect(stripSpeakerPrefix("Aldan Roe: He set it down.", "   ")).toBe(
      "Aldan Roe: He set it down.",
    );
  });
});

describe("the streaming strip", () => {
  test("the prefix never appears, not even for one frame", () => {
    /*
     * The half a server-side strip cannot do. A stream delivers "A", "Ald",
     * "Aldan Roe", "Aldan Roe:" before there is a colon to match, so a strip
     * that only fires on the finished prefix would let the name flash on screen
     * and then remove it — the jump, arriving in instalments.
     */
    const full = "Aldan Roe: He set the lamp down.";
    for (let at = 1; at <= full.length; at++) {
      const shown = stripStreamingPrefix(full.slice(0, at), "Aldan Roe");
      expect({ at, leaks: shown.includes("Aldan") }).toEqual({ at, leaks: false });
    }
  });

  test("and what it eventually shows is the turn without its prefix", () => {
    const full = "Aldan Roe: He set the lamp down.";
    expect(stripStreamingPrefix(full, "Aldan Roe")).toBe("He set the lamp down.");
    expect(stripStreamingPrefix("**Aldan Roe:** He set it down.", "Aldan Roe")).toBe(
      "He set it down.",
    );
  });

  test("prose that merely starts with the same letters is shown at once", () => {
    // The hold has to end the moment the text stops being a possible prefix,
    // or an ordinary turn starting with "A" would stutter.
    expect(stripStreamingPrefix("He set", "Aldan Roe")).toBe("He set");
    expect(stripStreamingPrefix("Alone, he", "Aldan Roe")).toBe("Alone, he");
    expect(stripStreamingPrefix("A l", "Aldan Roe")).toBe("A l");
  });

  test("with no speaker decided yet, everything is shown", () => {
    // The classifier has not answered for the first frames of a turn, and the
    // honest answer then is that nobody knows who is speaking.
    expect(stripStreamingPrefix("He set it", null)).toBe("He set it");
  });
});

describe("both ends read the same regex", () => {
  test("the service calls the shared strip rather than carrying its own", () => {
    // The defect was two ends disagreeing. A second copy of the pattern is how
    // they would disagree again.
    const service = readFileSync("server/generation/service.ts", "utf8");
    expect(service).toContain('from "../../shared/speaker-prefix.ts"');
    expect(service).not.toMatch(/new RegExp\(\s*`\^\\\\s\*\(\?:/);
  });

  test("the streaming tail strips a spotlight and never a beat", () => {
    // A beat's `**Name:**` labels are per-part attribution — the one place the
    // prefix is the app's own doing and has to stay.
    const log = readFileSync("client/screens/chat/MessageLog.tsx", "utf8");
    expect(log).toContain("stripStreamingPrefix");
    expect(log).toContain('active.director?.scope === "beat"');
  });
});
