import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SEND_KEYS, READER_DEFAULTS, type SendKey } from "../shared/types.ts";
import { strings } from "../client/strings.ts";

/**
 * The composer tells the truth about what sends (§20 phase 227).
 *
 * Found by trying to send a turn. The line under the composer read
 * `⌘↵ SEND · ⌘K CAST` — a constant, rendered at every desktop width,
 * consulting nothing — and on the install under test neither key sent
 * anything:
 *
 * | pressed | what happened |
 * |---|---|
 * | `Return` | a newline in the draft; nothing sent |
 * | `Ctrl+Return` | a newline in the draft; nothing sent |
 * | the send button | the turn went |
 *
 * That install has `send: "button"`, chosen by its owner. But the hint was
 * wrong at the *shipped default* too: with `send: "enter"` the handler reads
 * `!event.shiftKey && !modified`, so a modified Return is explicitly excluded.
 * `⌘↵` sends under exactly one of three settings and the hint showed under all
 * three.
 *
 * And `⌘` is a Mac key. This was the one place in the app that assumed the
 * reader was on one — the settings screen has had the platform-neutral
 * phrasing since the setting shipped, which is the kind of inconsistency that
 * only surfaces when somebody reads both.
 */

const COMPOSER = readFileSync("client/components/Composer.tsx", "utf8");

describe("the hint is derived from the setting", () => {
  test("it is a function of the send key, not a constant", () => {
    expect(typeof strings.chat.keyboardHints).toBe("function");
    expect(COMPOSER).toContain("strings.chat.keyboardHints(sendKey)");
  });

  test("each setting gets a hint that matches what the handler does", () => {
    /*
     * Read off `Composer.tsx`'s own branch:
     *   enter    → `!shiftKey && !modified`  — a bare Return, and only that
     *   modEnter → `modified`                — ⌘ or Ctrl, and only that
     *   button   → `false`                   — no key at all
     */
    const hints: Record<SendKey, string> = {
      enter: strings.chat.keyboardHints("enter"),
      modEnter: strings.chat.keyboardHints("modEnter"),
      button: strings.chat.keyboardHints("button"),
    };

    // A bare Return sends, so the hint must not claim a modifier is needed.
    expect(hints.enter).toContain("↵ SEND");
    expect(hints.enter).not.toMatch(/⌘\/CTRL ↵/);

    // A modified Return sends, and the hint says so with both names.
    expect(hints.modEnter).toContain("⌘/CTRL ↵ SEND");

    // No key sends, so no key is named. Inventing one here is how this began.
    expect(hints.button).not.toContain("SEND");
  });

  test("every value of the setting has a hint — a new one cannot be forgotten", () => {
    // A sweep over the union rather than three assertions, because the way a
    // fourth setting goes wrong is by nobody remembering this file exists.
    const missing = SEND_KEYS.filter((key) => strings.chat.keyboardHints(key).trim() === "");
    expect(missing).toEqual([]);
  });

  test("the default setting's hint is the one that would have been wrong", () => {
    // `enter` ships, and `⌘↵ SEND` was exactly what it must never say again.
    expect(strings.chat.keyboardHints(READER_DEFAULTS.send)).not.toContain("⌘/CTRL ↵");
  });
});

describe("no key is named for one platform", () => {
  test("nothing in the app writes ⌘ without also writing Ctrl", () => {
    /*
     * The app is self-hosted and most of its readers are not on a Mac. The
     * settings screen already phrased this correctly — `readerSendMod` reads
     * "⌘ or Ctrl + Return sends" — so the fix was to make the rest agree
     * rather than to invent a convention.
     */
    const source = readFileSync("client/strings.ts", "utf8");
    const lonely: string[] = [];
    for (const line of source.split("\n")) {
      const trimmed = line.trim();
      // Comments quote the wrong string on purpose — that is the record of
      // what it used to say, and a sweep that cannot tell prose from a string
      // is a sweep nobody can keep passing.
      if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;
      if (!line.includes("⌘")) continue;
      if (/ctrl/i.test(line)) continue;
      lonely.push(trimmed.slice(0, 70));
    }
    expect(lonely).toEqual([]);
  });

  test("the dead second copy of the hint is gone", () => {
    // `keyHints: "⌘↵ send"` had no reader anywhere in `client/` and was a
    // staler duplicate of the line above it.
    expect(strings.chat).not.toHaveProperty("keyHints");
  });
});
