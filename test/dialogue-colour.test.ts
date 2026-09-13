import { describe, expect, test } from "bun:test";
import { buildPrompt } from "../server/prompt/index.ts";
import { character, context, flatten } from "./prompt-fixtures.ts";

/**
 * Coloured dialogue (§20 phase 185).
 *
 * A cast member who picked a colour gets it in the prompt, so the model wraps
 * their spoken lines in that colour's span — and the reader's view, which now
 * renders that span, shows the same colour the cast rail and turn spine do.
 */

describe("dialogue colour", () => {
  test("a cast member with a colour gets a name-to-hex mapping", () => {
    const bell = character("bell", "Bell", { colour: "#ff0000" });
    const mira = character("mira", "Mira", { colour: "#00aaff" });
    const text = flatten(buildPrompt(context({ cast: [bell, mira], spotlight: bell })));

    expect(text).toContain("Colour spoken dialogue");
    expect(text).toContain('Bell \u2014 <span style="color:#ff0000">spoken dialogue</span>');
    expect(text).toContain('Mira \u2014 <span style="color:#00aaff">spoken dialogue</span>');
  });

  test("a colourless cast adds nothing", () => {
    const plain = character("plain", "Plain");
    const text = flatten(buildPrompt(context({ cast: [plain], spotlight: plain })));
    expect(text).not.toContain("spoken dialogue</span>");
  });

  test("a colour on one member does not colour the rest", () => {
    const bell = character("bell", "Bell", { colour: "#ff0000" });
    const mira = character("mira", "Mira");
    const text = flatten(buildPrompt(context({ cast: [bell, mira], spotlight: bell })));
    expect(text).toContain('Bell \u2014 <span style="color:#ff0000">');
    expect(text).not.toContain("Mira \u2014");
  });
});
