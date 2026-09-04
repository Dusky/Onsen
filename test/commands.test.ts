import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMANDS, matchCommands, score } from "../client/lib/commands.ts";

/**
 * The palette is complete, and stays complete (SPEC §20 phase 43).
 *
 * A command palette covering forty of two hundred things is worse than the menu
 * it replaced: the first miss teaches the reader to stop trying it. So the
 * registry is the list, the message sheet and the ops row render from it, and
 * this fails when someone adds an action to a screen without adding it here.
 */

const ROOT = join(import.meta.dir, "..");
const chatScreen = readFileSync(join(ROOT, "client/screens/ChatScreen.tsx"), "utf8");

describe("the registry", () => {
  test("ids are unique", () => {
    const ids = COMMANDS.map((command) => command.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  test("single-key accelerators do not collide", () => {
    const keys = COMMANDS.map((command) => command.key).filter((key) => key !== undefined);
    expect(keys.length).toBe(new Set(keys).size);
  });

  test("every command has a handler on the screen that runs it", () => {
    // The handler map is keyed by id, so a command with no handler is a row in
    // the palette that does nothing when you press return — the exact failure
    // this whole registry exists to prevent.
    const missing = COMMANDS.filter(
      (command) => !new RegExp(`["']${command.id}["']\\s*:`).test(chatScreen),
    ).map((command) => command.id);
    expect(missing).toEqual([]);
  });

  test("an unavailable command says why", () => {
    for (const command of COMMANDS) {
      if (command.unavailable !== undefined) expect(command.unavailable.length).toBeGreaterThan(10);
    }
  });
});

describe("matching", () => {
  const everywhere = { hasScene: true, hasTurn: true };

  test("two letters find more than the one command that starts with them", () => {
    // The behaviour every palette is judged by. Note "dr" reaches As me
    // through its "draft" keyword, not Steer — "director" begins "di", which
    // a design caption written before this test claimed otherwise.
    const titles = matchCommands("dr", everywhere).map((command) => command.title);
    expect(titles).toContain("Draw this");
    expect(titles).toContain("As me");
    expect(matchCommands("di", everywhere).map((command) => command.title)).toContain("Steer");
  });

  test("two letters do not match half the app", () => {
    // Subsequence matching on a short query is the way a palette becomes
    // useless: "dr" once returned Settings, via the "providers" keyword.
    const titles = matchCommands("dr", everywhere).map((command) => command.title);
    expect(titles.length).toBeLessThan(6);
    expect(titles).not.toContain("Settings");
    // The first result is still the obvious one.
    expect(titles[0]).toBe("Draw this");
  });

  test("a longer query may match loosely, because by then it means something", () => {
    expect(matchCommands("splt", everywhere).map((c) => c.id)).toContain("split");
  });

  test("a word people arrive typing finds the button they did not know the name of", () => {
    expect(matchCommands("regenerate", everywhere).map((c) => c.id)).toContain("reroll");
    expect(matchCommands("checkpoint", everywhere).map((c) => c.id)).toContain("mark");
    expect(matchCommands("tts", everywhere).map((c) => c.id)).toContain("speak");
    expect(matchCommands("world info", everywhere).map((c) => c.id)).toContain("go-lorebooks");
  });

  test("a prefix outranks a match buried in the middle of a word", () => {
    const first = matchCommands("de", everywhere)[0]!;
    expect(first.id).toBe("delete");
  });

  test("scope hides what cannot be run rather than offering it", () => {
    const nothingOpen = matchCommands("", { hasScene: false, hasTurn: false });
    expect(nothingOpen.every((command) => command.scope === "global")).toBe(true);
    // In a roleplay with nothing selected, the turn commands are still hidden:
    // a palette that offers "Reroll" with no turn to reroll is lying.
    const noSelection = matchCommands("", { hasScene: true, hasTurn: false });
    expect(noSelection.some((command) => command.scope === "turn")).toBe(false);
    expect(noSelection.some((command) => command.id === "nudge")).toBe(true);
  });

  test("an empty query lists everything in registry order", () => {
    expect(matchCommands("", everywhere).length).toBe(COMMANDS.length);
  });

  test("nonsense matches nothing", () => {
    expect(matchCommands("zzqq", everywhere)).toEqual([]);
    expect(score(COMMANDS[0]!, "zzqq")).toBe(0);
  });
});

describe("the screens render from the registry", () => {
  test("the message sheet is the palette, not a second hand-written list", () => {
    // Sixteen hand-written <SheetAction> rows lived in a sheet titled
    // `strings.chat.actions`. Any list of message commands that comes back is a
    // second one to keep in step with the registry, which is how they drift.
    expect(chatScreen).not.toContain("strings.chat.actions");
    expect(chatScreen).toContain("<CommandPalette");
  });

  test("the palette is reachable without a turn", () => {
    // ⌘K opens it on nothing; long-pressing a turn opens it scoped. Both go
    // through the same component, so there is one list and two ways in.
    expect(chatScreen).toContain("setPaletteOpen");
    expect(chatScreen).toMatch(/metaKey \|\| event\.ctrlKey/);
  });
});
