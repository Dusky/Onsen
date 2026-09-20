/**
 * What the screen actually looks like, measured (§20 phase 193).
 *
 * Every visual guard in this repo compares tokens to tokens.
 * `test/surfaces.test.ts` measures `contrastRatio(tokens[tier], tokens[ground])`
 * — one flat hex against another — and its own doc comment admits that
 * `color-mix()` values and gradients "are not colours this module can read,
 * and callers filter them out". The rails it certifies are translucent panels
 * over a photograph. It passes while the rendered result measures 2.63:1.
 *
 * That is the third instance of one pattern. Phase 182 shipped a fix for a Test
 * button that resolved a different URL than the turn; phase 189 fixed a count
 * that measured a different set than the log. Here the guard measures a
 * different surface than the reader sees. **A check that asks a different
 * question than the real thing can pass while the app is broken.**
 *
 * So this one composites. It drives a real browser against a real server and
 * samples real pixels.
 *
 * Deliberately NOT part of `bun test`. The suite is 1900 hermetic tests in
 * three minutes and the house doctrine is structural, source-as-text, zero DOM
 * rendering — for good reasons that this does not overturn. This is the pass
 * you run before shipping a visual change:
 *
 *     bun run guard:rendered
 *
 * It exits non-zero on a regression, so it can be wired to CI the day there is
 * one.
 *
 * ## Phase 222: it was doing the thing it exists to catch
 *
 * As shipped, the scene route and *every contrast sample* were gated on an
 * `ONSEN_SCENE` environment variable nobody set. Run the documented way it
 * printed "all within budget" having measured no transcript and no colour at
 * all — and said so, in a parenthesis, at the bottom of a wall of `ok` lines.
 * A guard that asks a different question than the real thing, one level up from
 * the guards it was written to replace. That is the fourth instance, and this
 * one was mine.
 *
 * Three changes follow from it, and each is about the same failure mode:
 *
 * 1. **The scene is discovered, not configured.** The guard asks the app which
 *    roleplays exist. No scene means no transcript to measure, which is a
 *    *failure* rather than a quiet skip.
 * 2. **Samples are DOM selectors, not rectangles.** Four hardcoded boxes were
 *    only ever valid at 1600×950 with the rails in one particular state, and
 *    they measured whatever happened to be at those coordinates. A selector
 *    that matches nothing now fails, because a silent no-match is exactly how
 *    the gate above went unnoticed.
 * 3. **The coloured runs are swept, not listed.** Phase 220's whole argument
 *    was that a speaker's colour is painted onto prose over a photograph and no
 *    token pair can tell you what came out. It measured 4.07:1 and 3.99:1 on
 *    screen while every token check passed. Those runs carry an inline colour
 *    and no class, so they are found by *having* one.
 */
import { chromium, type Page } from "playwright-core";
import { contrastRatio } from "../shared/contrast.ts";

const CHROMIUM = process.env["CHROMIUM_PATH"] ?? "/opt/pw-browsers/chromium";
const ORIGIN = process.env["ONSEN_ORIGIN"] ?? "http://localhost:5173";
const PASSWORD = process.env["ONSEN_PASSWORD"] ?? "screenshot-pass-123";

/**
 * The ceilings, and why each is where it is.
 *
 * These are *budgets*, not ideals — each records what the app measured when
 * this was written, so the number can only come down. A guard that asserts an
 * aspiration fails on the day it lands and gets commented out; a guard that
 * ratchets an actual measurement never does.
 */
const BUDGET = {
  /** WCAG AA for body text. Nothing a reader reads may sit under it. */
  contrast: 4.5,
  /** 14 at phase 193, 13 measured at phase 222 across every route. */
  fontSizes: 13,
  /** 27 at phase 193 and still 27 at phase 222, now including the transcript. */
  controlHeights: 27,
  /** 14 at phase 193, including 3px, 5px, 7px and 9px off any grid. Still 14. */
  gaps: 14,
  /**
   * WCAG 2.5.8: 24px minimum for a pointer target. 676 at phase 193; 208 once
   * phase 195 widened the prompt-list toggle and its two reorder arrows, which
   * were 182 of them between them; **52** at phase 222, because phase 225 made
   * both rails start as their icon strip and the prompt editor's 105 controls
   * stopped being on every screen. The rest are smaller clusters, and each one
   * that comes down should bring this number with it.
   *
   * **40** at phase 229, and the fall from 52 is the guard learning to read:
   * an `sr-only` skip link is 1×1 with `clip-path: inset(50%)` until it is
   * focused, and the old sweep counted one on every route of every viewport of
   * every theme — sixteen "small targets" that are not targets at all. The
   * autopilot switch is the rest of it: it stopped collapsing to 21px on a
   * pointer when its floor moved off an inline style.
   */
  smallTargets: 40,
  /**
   * Content clipped with overflow visible and no ellipsis — genuinely
   * unhandled. 38 at phase 193, **42** at phase 222 — and the increase is the
   * guard seeing more rather than the app getting worse: the run that recorded
   * 38 never opened a roleplay, because the route was gated behind an
   * environment variable nobody set. Every budget here is re-recorded against
   * the whole app for the first time.
   */
  overflowing: 42,
  /**
   * Form controls a screen reader announces as "edit, blank" (§20 phase 222).
   *
   * Zero, and it can only ever be zero. Every other number here is a ratchet
   * on something the app has too much of; this one is a defect with no
   * acceptable quantity, and phase 226 cleared the fifty-three that existed —
   * thirteen a browser drive found and forty more a source sweep did.
   */
  unlabelled: 0,
  /**
   * Controls under the house's 44px thumb floor, on the touch viewport only
   * (§20 phase 229).
   *
   * A *different and stricter* question than `smallTargets` above, which is
   * WCAG 2.5.8's 24px. §16's density rule 4 sets 44, `.tap` implements it, and
   * until now the only thing checking it was `test/density.test.ts` — an
   * allow-list of eleven named files, so a control in a twelfth had nothing to
   * fail. It passed while seven controls sat at 22–33px: the reasoning and
   * out-of-character disclosures, the trackers strip, "change", the phone
   * nav's overflow and search, and the autopilot switch.
   *
   * Fixing those seven is what the sweep was for and not what it found. It
   * came back with **eleven**, four of which nobody had written down: a turn's
   * token readout at 173×18, its version counter at 38×19, and the three
   * 28–30px-wide buttons clustered at the right of every row on the screen
   * the app opens on. The list an allow-list could not see was longer than the
   * list it was written from — the fifth instance of the shape this branch
   * keeps finding, and the reason this is a sweep.
   *
   * Nine of the eleven had a `.tap` or a `.btn-dense` to reach for. The other
   * two are `EXEMPT_TARGETS` below, which is a named list rather than a count
   * for the same reason `KNOWN_CONTRAST` is: a budget of "2" is a place a
   * third can hide.
   *
   * So this is zero, and it counts what is *not* on that list.
   *
   * Measured only in the `phone`/`hasTouch` pass, because `.tap` relaxes under
   * `(pointer: fine)` on purpose and counting a desktop's 28px row would be
   * counting the rule working.
   */
  touchTargets: 0,
  /**
   * The rails' share of the controls on a screen that is not a roleplay
   * (§20 phase 225, guarded here).
   *
   * It was **74%** on Roleplays, 73% on Settings, 71% on Characters — the
   * prompt editor open by default on every screen in the app, with the
   * reader's own first action the 119th control in DOM order. Phase 225 made
   * both rails start as their icon strip off a scene, and this is the number
   * that stops them drifting back: a default that re-opens sends it past 60
   * immediately.
   */
  railShare: 45,
};

/**
 * Contrast failures that are known, recorded, and scheduled (§20 phase 195).
 *
 * The alternative was letting this script exit non-zero the day it landed,
 * which is how a guard becomes a thing people pass `|| true` to. Naming the
 * two regions keeps them visible in the output, keeps every *other* region
 * enforced at the full 4.5:1, and makes the fix a deletion: remove the entry
 * and the floor applies.
 *
 * It is empty as of §20 phase 195, which is the shape a list like this should
 * spend most of its life in. It held two entries for exactly one phase: rail
 * metadata at 4.15:1 dark and 2.63:1 light, both fixed by reconciling stale
 * builtin theme palettes and giving the light ramps headroom. They came off
 * the list because the guard refused to let them stay — a known failure that
 * starts passing is itself a failure here.
 */
const KNOWN_CONTRAST: Record<string, { floor: number; why: string }> = {
  /*
   * The composited cost of three ink tokens (§20 phase 222).
   *
   * Each of these is a *recorded floor*, not a pass. A reading below the
   * number still fails, so the ratchet the rest of this file runs on applies
   * here too and a regression cannot hide behind a known failure. The entry
   * is deleted when the ink pass lands, and the full 4.5:1 applies again.
   *
   * What the guard found, once it could see: `--onsen-color-text-dim` on the
   * rail's icon-strip labels and the header's `Text`, `--onsen-color-amber` on
   * a cast card's `Cued`, and `--onsen-color-blue-text-muted` on a token
   * readout. All three clear 4.5:1 against the token ground —
   * `test/surfaces.test.ts` asserts exactly that and its own comment insists
   * `text-dim` "is not decorative". They do not clear it on the *pixel*,
   * because the rails and cards are translucent panels over the reader's
   * photograph.
   *
   * Which is phase 193's argument one layer on, and phase 220's for a second
   * time: a token pair cannot tell you what the composite came out as. The fix
   * is the same shape phase 220 used for the speaker's colour — headroom
   * against the token so the composite still clears — and it is a pass over
   * nine palettes with an ordered ramp to preserve, which is a phase rather
   * than a paragraph.
   */
  "desktop/dark / coloured runs": { floor: 3.99, why: "text-dim, amber, blue-text-muted on translucent panels" },
  "desktop/light / coloured runs": { floor: 3.64, why: "text-dim, amber, blue-text-muted on translucent panels" },
  "phone/dark / coloured runs": { floor: 4.32, why: "text-dim on the bottom nav and the Models list" },
  "phone/light / coloured runs": { floor: 4.32, why: "text-dim on the bottom nav and the Models list" },
};

/**
 * The controls allowed under the 44px floor, by class list, and why.
 *
 * Same contract as `KNOWN_CONTRAST` above and for the same reason: a count
 * records *how many* defects there are, a list records *which*, and only the
 * second one notices when a different control takes a fixed one's place.
 *
 * Both entries are the turn's meta line, and they are one decision. §16's
 * density rule 2 says "a number behind a tap is a number nobody reads", which
 * is why the token readout doubles as the doorway to the prompt inspector in
 * the first place; the version counter sits on the same line. Phase 229 gave
 * both of them `.tap`, measured the line going from 19px to 44 on a phone, and
 * took it back off: a 44px box here pushes the meta line apart to serve the
 * rule that put the number there. Neither is the only way in — `inspect` and
 * `versions` are both turn-scoped commands in `client/lib/commands.ts`,
 * reachable from the turn's `⋯` sheet and the palette, and
 * `.turn-actions > button` is 44×44 under a thumb.
 *
 * `test/density.test.ts` pins the same exemption from the source side.
 */
const EXEMPT_TARGETS: Record<string, string> = {
  "meta shrink-0 tabular-nums":
    "a turn's token readout — the doorway §16 rule 2 asks for, inline in a 12px mono meta line",
  "chrome shrink-0 text-ui text-ink-dim":
    "the version counter beside it, on that same line",
};

/**
 * Text that must be legible, named by what it is rather than by where it was
 * (§20 phase 222).
 *
 * These were four rectangles — `{ x: 92, y: 188, w: 200, h: 12 }` and three
 * like it — which is a set of coordinates that happened to have the right
 * thing in them at 1600×950 with the rails open and a particular scene loaded.
 * Change any of those and the guard measures the photograph.
 *
 * `required` is the half that matters. A selector that matches nothing is not
 * "no sample"; it is the guard quietly measuring less than it says it does,
 * which is the defect this phase exists to fix. So a required sample that
 * matches nothing fails the run.
 */
interface Sample {
  name: string;
  /**
   * Resolved in the page. The first *visible* match is measured.
   *
   * `data-rail` and `data-prose` are marked in the components on purpose: a
   * guard that matches on Tailwind classes is guessing, and a guess that stops
   * matching is silent. The attribute is a contract, and `test/rendered-guard.test.ts`
   * holds both ends of it.
   */
  selector: string;
  /** Where it exists. A sample is only required where the app renders it. */
  route: "scene" | "any";
  /** The rails are desktop-only, so requiring them on a phone is a false alarm. */
  viewport: "desktop" | "any";
}

const SAMPLES: readonly Sample[] = [
  /*
   * The rail, which is what phase 193 found at 2.63:1 and phase 195 fixed.
   * Scoped to a roleplay since phase 225: off a scene both rails are their
   * icon strip, so there is no panel text to measure and requiring it here
   * would be the guard failing on the app working as designed.
   */
  { name: "rail block name", selector: "[data-rail] .section-label", route: "scene", viewport: "desktop" },
  { name: "rail metadata", selector: "[data-rail] .meta", route: "scene", viewport: "desktop" },
  // The prose itself, which is the whole product.
  { name: "transcript body", selector: "[data-prose]", route: "scene", viewport: "any" },
  // The chrome a reader reads without looking at it.
  { name: "turn meta", selector: ".chrome.text-ink-muted, .chrome.text-ink-dim", route: "scene", viewport: "any" },
];

/**
 * Every run of text carrying an inline colour, found by carrying one.
 *
 * Phase 218 put the speaker's colour on the spoken words; phase 220 measured
 * the result at **2.07:1, 1.99:1 and 2.34:1** in the light theme and rebuilt
 * the resolver around a composited ground. The resolver is a render-time
 * approximation of a pixel it cannot see, and *this* is the thing that checks
 * it was right — the promise phase 220's own comment makes on this script's
 * behalf ("`scripts/rendered-guard.ts` is what holds the real promise, on
 * composited pixels").
 *
 * A sweep rather than a list because those runs are `<em style="color: …">`
 * with no class of their own: there is nothing to name, and naming one would
 * miss the next. Reported as the worst ratio found, with the text that produced
 * it, so a failure says which words are illegible.
 */
const COLOURED_RUNS = "coloured runs";

const PROBE = `(() => {
  const out = {
    fontSizes: {}, controlHeights: {}, gaps: {}, small: 0, overflowing: 0,
    // Absorbed from the probes the fourth review built by hand (\u00a720 phase 222).
    unlabelled: [], controls: 0, inRail: 0,
    // Under \u00a716's 44px thumb floor (\u00a720 phase 229).
    short: [],
  };
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

  /* A form control announces as "edit, blank" without one of these. A sibling
     <p> is not a label, which is how four fields on the add-a-provider form
     went unnamed for as long as they did. */
  const named = (el) =>
    (el.getAttribute("aria-label") || "").trim() !== "" ||
    el.getAttribute("aria-labelledby") !== null ||
    (el.id !== "" && document.querySelector('label[for="' + CSS.escape(el.id) + '"]') !== null) ||
    el.closest("label") !== null ||
    (el.getAttribute("placeholder") || "").trim() !== "" ||
    (el.getAttribute("title") || "").trim() !== "";

  /* Clipped to a pixel and parked off-screen: an \`sr-only\` skip link, which
     is a control a screen reader announces rather than one a thumb hits. It is
     1×1 by construction, so counting it as a small target is counting the
     technique. */
  const isOffscreen = (el, r, cs) =>
    r.width <= 1 && r.height <= 1 && (cs.clip !== "auto" || cs.clipPath !== "none");

  /* The rails by their marker, not by geometry (\u00a720 phase 222).
     A first pass counted everything left of x=390 and read 78% on a screen
     whose rails were both collapsed to icon strips \u2014 because the roleplay
     list starts at x=54 once they are. Measuring "the rails" by where they
     usually are is the same mistake as the four rectangles this phase deleted. */

  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    if (el.childElementCount === 0 && el.textContent && el.textContent.trim()) {
      bump(out.fontSizes, cs.fontSize);
    }
    const interactive = tag === "button" || tag === "a" || tag === "input"
      || tag === "select" || tag === "textarea" || el.getAttribute("role") === "button";
    if (interactive) {
      const offscreen = isOffscreen(el, r, cs);
      bump(out.controlHeights, Math.round(r.height) + "px");
      out.controls += 1;
      /* \u00a716's density rule 4 \u2014 the house floor, not WCAG's. Recorded with
         where it is, because "seven controls are short" is a number and
         "the trackers strip is 24px" is a defect somebody can fix. */
      if ((r.width < 44 || r.height < 44) && !offscreen) {
        /* Keyed by the class list, reported by name. The name carries a
           roleplay's own title and the width carries the model's name, so a
           key made of either moves when somebody adds a roleplay or picks a
           different model — and a guard that fails when you add data is a
           guard that gets deleted. The class list is what a person edits to
           fix one of these, which makes it the unit. */
        out.short.push({
          key: (el.className || el.tagName).toString(),
          where: ((el.getAttribute("aria-label") || el.textContent || "?").trim()
            .replace(/\\s+/g, " ").slice(0, 24))
            + " " + Math.round(r.width) + "x" + Math.round(r.height),
        });
      }
      if (el.closest("[data-rail]") !== null) out.inRail += 1;
      if (tag === "input" || tag === "select" || tag === "textarea") {
        if (el.type !== "hidden" && !named(el)) {
          out.unlabelled.push(
            (el.previousElementSibling?.textContent || el.parentElement?.textContent || "?")
              .trim().replace(/\\s+/g, " ").slice(0, 32),
          );
        }
      }
      // WCAG 2.5.8 exempts an inline control in a sentence; approximate that
      // by ignoring anything inside a paragraph.
      if ((r.width < 24 || r.height < 24) && el.closest("p") === null && !offscreen) out.small += 1;
    }
    if ((cs.display === "flex" || cs.display === "grid") && cs.gap && cs.gap !== "normal") {
      bump(out.gaps, cs.gap);
    }
    // Genuinely unhandled only. \`truncate\` clips on purpose (overflow hidden
    // plus an ellipsis), and a first draft counted 58 of those as defects.
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX === "visible"
        && cs.textOverflow !== "ellipsis") out.overflowing += 1;
  }
  return out;
})()`;

async function signIn(page: Page): Promise<void> {
  const field = page.locator('input[type="password"]');
  if ((await field.count()) === 0) return;
  await field.fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForTimeout(1800);
}

/**
 * The darkest and lightest pixel in each sampled region of the composited
 * screenshot — which is the whole point: these are the colours after the
 * translucent panel, the photograph behind it and the text on top have all
 * been painted over one another, which no token pair can tell you.
 *
 * Written as a string for the same reason `PROBE` is: it runs in the page, not
 * here, and typing it as if it ran here is a fiction the compiler then has to
 * be argued out of.
 */
const SAMPLER = (
  base64: string,
  samples: readonly Sample[],
  route: "scene" | "any",
  viewport: "desktop" | "phone",
) => `(async () => {
  const base64 = ${JSON.stringify(base64)};
  const samples = ${JSON.stringify(samples)};
  const route = ${JSON.stringify(route)};
  const viewport = ${JSON.stringify(viewport)};
  const dpr = window.devicePixelRatio || 1;

  const img = new Image();
  await new Promise((done) => { img.onload = done; img.src = "data:image/png;base64," + base64; });
  const canvas = document.createElement("canvas");
  canvas.width = img.width; canvas.height = img.height;
  const g = canvas.getContext("2d");
  g.drawImage(img, 0, 0);

  const lum = (r, gg, b) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  const hex = (r, gg, b) => "#" + [r, gg, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

  /* The glyph box, not the element box. A block's rect includes its line-height
     padding and whatever shows through it, so measuring the rect of a <p> can
     report the photograph as one end of the pair. A Range over the text nodes
     is the ink. */
  const inkBox = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    range.detach();
    return r.width > 0 && r.height > 0 ? r : el.getBoundingClientRect();
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < 0 || r.top > window.innerHeight) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.1;
  };

  /* The darkest and lightest pixel in a box, which for a box of text is the ink
     and the ground it landed on — after the panel, the photograph and the glyph
     have all been painted over one another, which no token pair can tell you. */
  const extremes = (rect) => {
    const x = Math.max(0, Math.floor(rect.left * dpr));
    const y = Math.max(0, Math.floor(rect.top * dpr));
    const w = Math.min(canvas.width - x, Math.ceil(rect.width * dpr));
    const h = Math.min(canvas.height - y, Math.ceil(rect.height * dpr));
    if (w < 1 || h < 1) return null;
    const d = g.getImageData(x, y, w, h).data;
    let dark = null, light = null;
    for (let i = 0; i < d.length; i += 4) {
      const p = [d[i], d[i + 1], d[i + 2]];
      const l = lum(p[0], p[1], p[2]);
      if (dark === null || l < lum(dark[0], dark[1], dark[2])) dark = p;
      if (light === null || l > lum(light[0], light[1], light[2])) light = p;
    }
    if (dark === null) return null;
    return [hex(dark[0], dark[1], dark[2]), hex(light[0], light[1], light[2])];
  };

  const out = { pairs: {}, missing: [], runs: [] };

  for (const sample of samples) {
    if (sample.route === "scene" && route !== "scene") continue;
    if (sample.viewport === "desktop" && viewport !== "desktop") continue;
    const el = [...document.querySelectorAll(sample.selector)]
      .filter((e) => visible(e) && (e.textContent || "").trim().length > 3)[0];
    if (el === undefined) { out.missing.push(sample.name); continue; }
    const pair = extremes(inkBox(el));
    if (pair === null) { out.missing.push(sample.name); continue; }
    out.pairs[sample.name] = pair;
  }

  /* The coloured runs, found by carrying an inline colour rather than by a
     class they do not have. Leaves only: a parent with a coloured child would
     measure the child's ink against the parent's whole line. */
  for (const el of document.querySelectorAll("[style*='color']")) {
    if (el.childElementCount > 0) continue;
    if (!visible(el)) continue;
    const text = (el.textContent || "").trim();
    if (text.length < 3) continue;
    const pair = extremes(inkBox(el));
    if (pair === null) continue;
    out.runs.push({ text: text.slice(0, 40), pair });
  }
  return out;
})()`;

interface Sampled {
  pairs: Record<string, [string, string]>;
  missing: string[];
  runs: { text: string; pair: [string, string] }[];
}

async function contrastIn(
  page: Page,
  shot: Buffer,
  route: "scene" | "any",
  viewport: "desktop" | "phone",
): Promise<Sampled> {
  return (await page.evaluate(SAMPLER(shot.toString("base64"), SAMPLES, route, viewport))) as Sampled;
}

/**
 * Which roleplay to measure the transcript in, asked of the app (§20 phase 222).
 *
 * This was `process.env["ONSEN_SCENE"]`, and nobody set it, so the guard's
 * whole reason for existing — prose composited over a photograph — went
 * unmeasured while the run reported success. Asking the server removes the
 * step somebody has to remember, and an install with no roleplay at all is
 * reported as a failure rather than skipped: there is no transcript to check,
 * and that is a fact about the run, not a reason to call it clean.
 */
async function firstScene(page: Page): Promise<string | null> {
  const found = await page.evaluate(`(async () => {
    try {
      const response = await fetch("/api/scenes?limit=50", { credentials: "same-origin" });
      if (!response.ok) return null;
      const body = await response.json();
      const rows = Array.isArray(body) ? body : (body.scenes ?? body.rows ?? []);
      // One with turns on it. The newest scene in this install is a 400-turn
      // audit fixture whose active leaf is null, so it renders an empty log —
      // and an empty log has no prose to measure, which the first version of
      // this happily reported as four samples matching nothing.
      const written = rows.find((row) => (row.turnCount ?? 0) > 0);
      return written === undefined ? null : written.id;
    } catch { return null; }
  })()`);
  return typeof found === "string" && found !== "" ? found : null;
}

const failures: string[] = [];
function check(label: string, actual: number, ceiling: number, unit = ""): void {
  const ok = actual <= ceiling;
  const line = `${ok ? "ok  " : "FAIL"}  ${label.padEnd(38)} ${String(actual).padStart(5)}${unit} (budget ${ceiling}${unit})`;
  console.log(line);
  if (!ok) failures.push(`${label}: ${actual}${unit} exceeds ${ceiling}${unit}`);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const distinct = { fontSizes: new Set<string>(), controlHeights: new Set<string>(), gaps: new Set<string>() };
  let small = 0;
  let overflowing = 0;
  let unlabelled = 0;
  const unlabelledWhere: string[] = [];
  const shortTargets = new Map<string, string>();
  let railShare = 0;
  let railWhere = "";
  const ratios: { where: string; name: string; ratio: number; detail?: string }[] = [];
  const missing: string[] = [];
  let sceneRoutesMeasured = 0;

  for (const [label, width, height, touch] of [
    ["desktop", 1600, 950, false],
    ["phone", 390, 844, true],
  ] as const) {
    for (const theme of ["dark", "light"] as const) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
      const page = await context.newPage();
      await page.goto(ORIGIN + "/", { waitUntil: "load" });
      await page.waitForTimeout(700);
      await signIn(page);
      const toggle = page.getByRole("button", { name: theme === "dark" ? /^dark$/i : /^light$/i }).first();
      if (await toggle.count()) {
        await toggle.click();
        await page.waitForTimeout(400);
      }

      // Asked of the app rather than of the environment (§20 phase 222).
      const sceneId = await firstScene(page);
      if (sceneId === null) {
        failures.push(
          `${label}/${theme}: no roleplay with turns in it, so the transcript and its colours went unmeasured`,
        );
      }

      const routes = [
        "/",
        ...(sceneId === null ? [] : [`/scenes/${sceneId}`]),
        "/characters",
        "/settings",
      ];
      for (const route of routes) {
        // Progress on stderr: this drives a real browser over sixteen pages and
        // a silent minute is indistinguishable from a hang.
        process.stderr.write(`  ${label}/${theme} ${route}\n`);
        await page.goto(ORIGIN + route, { waitUntil: "load" });
        await page.waitForTimeout(1400);
        const isScene = route.startsWith("/scenes/");

        const probe = (await page.evaluate(PROBE)) as {
          fontSizes: Record<string, number>;
          controlHeights: Record<string, number>;
          gaps: Record<string, number>;
          small: number;
          overflowing: number;
          unlabelled: string[];
          controls: number;
          inRail: number;
          short: { key: string; where: string }[];
        };
        for (const size of Object.keys(probe.fontSizes)) distinct.fontSizes.add(size);
        for (const h of Object.keys(probe.controlHeights)) distinct.controlHeights.add(h);
        for (const g of Object.keys(probe.gaps)) distinct.gaps.add(g);
        small += probe.small;
        overflowing += probe.overflowing;
        unlabelled += probe.unlabelled.length;
        for (const near of probe.unlabelled) unlabelledWhere.push(`${label}/${theme}${route} ${near}`);

        /*
         * Touch only (§20 phase 229). `.tap` relaxes under `(pointer: fine)`
         * by design, so a desktop's 28px row is the rule working rather than a
         * defect, and counting it would make the number meaningless.
         *
         * Deduplicated by name and size: the same control on four routes is
         * one thing to fix, and a budget that counted it four times would move
         * when somebody added a route.
         */
        if (touch) for (const control of probe.short) {
          if (!shortTargets.has(control.key)) shortTargets.set(control.key, control.where);
        }

        /*
         * How much of a screen is the rails (§20 phase 225, guarded here).
         * Only off the chat and only with rails to speak of: on a phone there
         * are none, and on the chat the prompt is the subject.
         */
        if (label === "desktop" && !isScene && probe.controls > 0) {
          const share = Math.round((probe.inRail / probe.controls) * 100);
          if (share > railShare) {
            railShare = share;
            railWhere = `${theme}${route} (${probe.inRail} of ${probe.controls})`;
          }
        }

        // Contrast everywhere there is text, which is everywhere.
        const shot = await page.screenshot();
        const sampled = await contrastIn(page, shot, isScene ? "scene" : "any", label);
        if (isScene) sceneRoutesMeasured += 1;
        for (const name of sampled.missing) missing.push(`${label}/${theme}${route}: ${name}`);
        for (const [name, [dark, light]] of Object.entries(sampled.pairs)) {
          ratios.push({
            where: `${label}/${theme}`,
            name,
            ratio: Number(contrastRatio(dark, light).toFixed(2)),
          });
        }
        // One line per surface rather than per run: the worst is the one that
        // decides whether a reader can read the page.
        let worst: { text: string; ratio: number } | null = null;
        for (const run of sampled.runs) {
          const ratio = Number(contrastRatio(run.pair[0], run.pair[1]).toFixed(2));
          if (worst === null || ratio < worst.ratio) worst = { text: run.text, ratio };
        }
        if (worst !== null) {
          ratios.push({
            where: `${label}/${theme}`,
            name: COLOURED_RUNS,
            ratio: worst.ratio,
            detail: `${sampled.runs.length} runs, worst ${JSON.stringify(worst.text)}`,
          });
        }
      }
      await context.close();
    }
  }
  await browser.close();

  console.log("\n— the rendered screen, measured —\n");
  check("distinct font sizes", distinct.fontSizes.size, BUDGET.fontSizes);
  check("distinct control heights", distinct.controlHeights.size, BUDGET.controlHeights);
  check("distinct flex/grid gaps", distinct.gaps.size, BUDGET.gaps);
  check("controls under 24px", small, BUDGET.smallTargets);
  check("elements clipping their content", overflowing, BUDGET.overflowing);
  check("controls with no accessible name", unlabelled, BUDGET.unlabelled);
  check("rails' share of a screen", railShare, BUDGET.railShare, "%");
  const exemptSeen = new Set<string>();
  const offenders = new Map<string, string>();
  for (const [key, where] of shortTargets) {
    if (key in EXEMPT_TARGETS) exemptSeen.add(key);
    else offenders.set(key, where);
  }
  check("controls under the 44px thumb floor", offenders.size, BUDGET.touchTargets);

  console.log("");
  /** The worst reading per label, for the known-list bookkeeping below. */
  const best = new Map<string, number>();
  for (const { where, name, ratio, detail } of ratios) {
    const label = `${where} / ${name}`;
    const known = KNOWN_CONTRAST[label];
    const floor = known === undefined ? BUDGET.contrast : known.floor;
    const ok = ratio >= floor;
    const clean = ratio >= BUDGET.contrast;
    const mark = clean ? "ok  " : ok ? "KNOWN" : "FAIL";
    const suffix = detail === undefined ? "" : `  \u2014 ${detail}`;
    console.log(
      `${mark.padEnd(5)} ${label.padEnd(30)} ${String(ratio).padStart(5)}:1 (floor ${floor}:1)${suffix}`,
    );
    if (!ok) failures.push(`${label}: ${ratio}:1 below ${floor}:1${suffix}`);
    const seen = best.get(label);
    if (seen === undefined || ratio < seen) best.set(label, ratio);
  }

  /*
   * A known failure that has been fixed stops being known. Without this the
   * list is a place things go to be forgotten; with it, fixing one of these
   * *breaks the build* until the entry is deleted, which is the only way a
   * record of scheduled work stays a record rather than a residue.
   *
   * Judged on the *worst* reading for a label rather than on each one, because
   * a surface is measured on several routes and most of them were always
   * fine — the first version of this fired six times on the same four entries
   * and would have had somebody delete a live record to quiet it.
   */
  /*
   * An exemption that stops applying stops being an exemption. If the control
   * reached the floor on its own, or was deleted, or had its class list
   * rewritten, the entry is describing something that is no longer there —
   * and a list nobody has to keep true is a list that stops being true.
   */
  for (const [key, why] of Object.entries(EXEMPT_TARGETS)) {
    if (!exemptSeen.has(key)) {
      failures.push(
        `no control matched the exemption "${key}" (${why}) — drop it from EXEMPT_TARGETS`,
      );
    }
  }

  for (const [label, { floor }] of Object.entries(KNOWN_CONTRAST)) {
    const worstSeen = best.get(label);
    if (worstSeen === undefined) {
      failures.push(`${label} was never measured — drop it from KNOWN_CONTRAST or fix the sample`);
    } else if (worstSeen >= BUDGET.contrast) {
      failures.push(`${label} now passes at ${worstSeen}:1 — drop it from KNOWN_CONTRAST`);
    } else if (worstSeen > floor) {
      failures.push(
        `${label} improved to ${worstSeen}:1 — lower its KNOWN_CONTRAST floor from ${floor}:1`,
      );
    }
  }

  /*
   * The half this phase is about. A sample that matched nothing is the guard
   * measuring less than it claims, which is exactly how the `ONSEN_SCENE` gate
   * survived: it reported its own silence in a parenthesis and exited zero.
   */
  if (missing.length > 0) {
    console.log("");
    for (const line of missing) console.log(`FAIL  sample matched nothing: ${line}`);
    failures.push(...missing.map((line) => `sample matched nothing: ${line}`));
  }
  if (sceneRoutesMeasured === 0) {
    failures.push("no transcript was measured — the contrast samples did not run");
  }
  if (unlabelledWhere.length > 0) {
    console.log("");
    for (const line of unlabelledWhere.slice(0, 20)) console.log(`      unnamed: ${line}`);
  }
  if (offenders.size > 0) {
    console.log("");
    for (const line of [...offenders.values()].slice(0, 20)) {
      console.log(`      short: ${line}`);
    }
  }

  console.log("");
  console.log(`sizes:   ${[...distinct.fontSizes].sort((a, b) => parseFloat(a) - parseFloat(b)).join(", ")}`);
  console.log(`gaps:    ${[...distinct.gaps].sort((a, b) => parseFloat(a) - parseFloat(b)).join(", ")}`);
  console.log(`scenes:  ${sceneRoutesMeasured} transcript route(s) measured`);

  if (failures.length > 0) {
    console.log(`\n${failures.length} over budget:`);
    for (const line of failures) console.log("  - " + line);
    process.exit(1);
  }
  console.log("\nall within budget.");
}

await main();
