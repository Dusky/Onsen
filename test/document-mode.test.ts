import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LAYOUT_PRESETS, presetOf } from "@shared/types.ts";

/**
 * Document mode (§20 phase 165).
 *
 * The fourth named layout, and the only one that removes the turn as a visible
 * object. Everything about it follows from one value — `attribution: "runin"` —
 * so what is worth guarding is not the look but the consequences: that the
 * name moved into the prose, that the controls did not go with it, and that
 * the other three presets are untouched.
 *
 * Structural, like `density.test.ts` and `leftrail.test.ts`: this project
 * renders no DOM in tests by design, so the source is read as text and the
 * decisions are asserted where they are written.
 */

const ROOT = join(import.meta.dir, "..");
const BLOCK = readFileSync(join(ROOT, "client", "components", "MessageBlock.tsx"), "utf8");
const LOG = readFileSync(join(ROOT, "client", "screens", "chat", "MessageLog.tsx"), "utf8");
const APP_CSS = readFileSync(join(ROOT, "client", "styles", "app.css"), "utf8");
const SYSTEM = readFileSync(join(ROOT, "server", "routes", "system.ts"), "utf8");

describe("the document preset", () => {
  test("is Quiet's switches with the name moved into the paragraph", () => {
    // The claim the type's own comment makes, and the reason this is a preset
    // rather than a fourth chat screen: one field differs.
    const { attribution: quietName, ...quiet } = LAYOUT_PRESETS.quiet;
    const { attribution: docName, ...document } = LAYOUT_PRESETS.document;
    expect(document).toEqual(quiet);
    expect(quietName).toBe("stacked");
    expect(docName).toBe("runin");
  });

  test("is recognised as itself rather than reported as custom", () => {
    // `presetOf` compares field by field, so a preset added to the record and
    // not to the comparison would round-trip as "Yours" — the settings screen
    // would show the reader a name they never picked.
    expect(presetOf(LAYOUT_PRESETS.document)).toBe("document");
  });

  test("leaves the other three exactly where they were", () => {
    expect(presetOf(LAYOUT_PRESETS.instrument)).toBe("instrument");
    expect(presetOf(LAYOUT_PRESETS.quiet)).toBe("quiet");
    expect(presetOf(LAYOUT_PRESETS.broadsheet)).toBe("broadsheet");
    expect(LAYOUT_PRESETS.broadsheet.attribution).toBe("inline");
  });
});

describe("the server stores the third attribution", () => {
  /**
   * The bug this is written against was already latent: `layout_attribution`
   * was read with a two-way ternary, so any value but `inline` came back as
   * `stacked`. A third value would have been accepted by the PATCH, written to
   * the settings row, and then read back as something else — a preference that
   * silently does not stick.
   */
  test("read and write agree on one list of values", () => {
    expect(SYSTEM).toContain('const ATTRIBUTIONS: readonly AttributionStyle[] = ["stacked", "inline", "runin"]');
    // Neither side may spell the set out again.
    const ternary = /layout_attribution"\)\s*===\s*"inline"/;
    expect(ternary.test(SYSTEM)).toBe(false);
    expect(SYSTEM.match(/ATTRIBUTIONS\.includes/g)?.length).toBe(2);
  });
});

describe("a turn with no boundary still has its controls", () => {
  /**
   * Phase 57's finding, which this mode could easily have re-broken: fifteen
   * turn commands, three of them on screen, the rest behind a long-press
   * nobody is told about. Document mode removes the row those three sat in, so
   * the row has to go somewhere rather than go away.
   */
  test("the chrome leaves flow instead of being hidden", () => {
    expect(BLOCK).toContain('const flow = attribution !== "stacked"');
    expect(BLOCK).toContain('<div className="turn-chrome flex items-center gap-x-[10px]">');
    // Positioned, not display:none — so it stays in the accessibility tree and
    // a screen reader reads the turn's number and timing in document order.
    expect(APP_CSS).toContain('.turn[data-flow] .turn-chrome');
    expect(APP_CSS).toMatch(/\.turn\[data-flow\] \.turn-chrome \{[^}]*position: absolute/);
    expect(APP_CSS).not.toMatch(/\.turn\[data-flow\] \.turn-chrome \{[^}]*display: none/);
  });

  test("it is revealed by a pointer, by the keyboard and by selection", () => {
    // Selection is what a tap already does, so a phone reaches the controls
    // without a gesture of its own.
    for (const trigger of [
      '.turn[data-flow]:hover .turn-chrome',
      '.turn[data-flow]:focus-within .turn-chrome',
      '.turn[data-flow][data-selected="true"] .turn-chrome',
    ]) {
      expect(APP_CSS).toContain(trigger);
    }
  });

  test("a thumb gets room for them rather than prose underneath them", () => {
    // At 390px the cluster is the full column — six glyphs at the tap floor
    // plus the stats — so revealed over the prose it hid the last line and a
    // half of the turn just tapped. The turn makes room instead, and the
    // cluster stays positioned and stays in the tree.
    expect(APP_CSS).toMatch(
      /@media \(hover: none\) \{\s*\.turn\[data-flow\]\[data-selected="true"\] \{\s*padding-bottom:/,
    );
  });

  test("the reveal honours a reader who asked for less motion", () => {
    const guarded = APP_CSS.slice(APP_CSS.indexOf(".turn-chrome"));
    expect(guarded).toContain("prefers-reduced-motion: reduce");
  });

  test("Broadsheet gets the row back too", () => {
    // It has hidden its whole header since phase 52, actions and stats with
    // it. `flow` covers both non-stacked styles, so the fix is not document's
    // alone — and the header's own gate is now the same condition.
    expect(BLOCK).toContain("hidden={flow}");
    expect(BLOCK).not.toContain('hidden={attribution === "inline"}');
  });
});

describe("the run-in head", () => {
  test("keeps real paragraphs and real emphasis", () => {
    // The distinction from Broadsheet's `inline`, which sets the whole message
    // as one unformatted paragraph. Document goes through `Prose`, so it gets
    // the paragraph split and the tokenizer like every other turn.
    expect(BLOCK).toContain("function Prose({ text, lead }");
    expect(BLOCK).toContain("{index === 0 ? lead : null}");
    expect(BLOCK).toMatch(/attribution === "runin"[\s\S]{0,200}lead: \(\s*<RunIn/);
  });

  test("shows the name before the first character arrives", () => {
    // A streamed turn is empty for one frame. Without this the speaker appears
    // a character late, which on a slow first token is a visible stutter.
    expect(BLOCK).toContain("if (paragraphs.length === 0)");
    expect(BLOCK).toContain("return lead === undefined ? null : (");
  });

  test("streams and settles as the same shape", () => {
    // The tail renders the turn being written without going through
    // MessageBlock, so it has to make the same choice — otherwise the name
    // jumps from above the prose into it the instant the turn completes.
    expect(LOG).toContain('layout.attribution === "runin"');
    expect(LOG).toContain("<RunIn name={active.speaker}");
  });

  test("a beat's parts run in as well", () => {
    // A beat is already one continuous document; the only thing document mode
    // changes about it is where each part's name sits.
    expect(BLOCK).toContain('{...(attribution === "runin" ? { runin: true } : {})}');
    expect(BLOCK).toContain("segment.speakerName === null || runin === true ? null : (");
  });
});

describe("what document mode does not draw", () => {
  test("no spine, and Broadsheet keeps its", () => {
    expect(BLOCK).toContain('const railed = attribution !== "runin"');
    expect(BLOCK).toContain("data-rail={railed ? (isUser ? \"user\" : \"character\") : undefined}");
  });

  test("no card either, and Broadsheet keeps its", () => {
    // `.turn` takes the theme's `--onsen-card-bg` and `--onsen-shadow-card`, so
    // in a card theme Document was four white blocks down a mode that exists to
    // have none. The attribute carries which style it is for exactly this.
    expect(BLOCK).toContain("data-flow={flow ? attribution : undefined}");
    expect(APP_CSS).toMatch(/\.turn\[data-flow="runin"\] \{[^}]*background: none/);
    expect(APP_CSS).toMatch(/\.turn\[data-flow="runin"\] \{[^}]*box-shadow: none/);
  });

  test("a selected paragraph does not move sideways", () => {
    // The stacked selection draws a blue edge with a -20px margin. Applied to
    // a paragraph in continuous prose that shifts the text you are reading.
    expect(BLOCK).toMatch(/selected === true\s*\?\s*railed/);
    expect(BLOCK).toContain(': { background: "var(--onsen-color-bg-raised)" }');
  });
});
