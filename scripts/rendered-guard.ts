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
  /** 14 at phase 193. Half-pixel sizes are the bulk of it; phase 194 cuts them. */
  fontSizes: 14,
  /** 27 at phase 193 — 19, 20, 21, 22, 24, 26, 28, 32, 34, 37, 38, 41, 44, 49… */
  controlHeights: 27,
  /** 14 at phase 193, including 3px, 5px, 7px and 9px off any grid. */
  gaps: 14,
  /**
   * WCAG 2.5.8: 24px minimum for a pointer target. 676 at phase 193; 208 once
   * phase 195 widened the prompt-list toggle and its two reorder arrows, which
   * were 182 of them between them. The rest are smaller clusters, and each one
   * that comes down should bring this number with it.
   */
  smallTargets: 208,
  /** Content clipped with overflow visible and no ellipsis — genuinely unhandled. */
  overflowing: 38,
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
const KNOWN_CONTRAST: readonly string[] = [];

/** Regions whose text must be legible, sampled from the composited image. */
const SAMPLES: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: "rail metadata", x: 92, y: 188, w: 200, h: 12 },
  { name: "rail block name", x: 84, y: 168, w: 120, h: 14 },
  { name: "transcript body", x: 455, y: 145, w: 550, h: 16 },
  { name: "status bar", x: 470, y: 938, w: 220, h: 12 },
];

const PROBE = `(() => {
  const out = { fontSizes: {}, controlHeights: {}, gaps: {}, small: 0, overflowing: 0 };
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
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
      bump(out.controlHeights, Math.round(r.height) + "px");
      // WCAG 2.5.8 exempts an inline control in a sentence; approximate that
      // by ignoring anything inside a paragraph.
      if ((r.width < 24 || r.height < 24) && el.closest("p") === null) out.small += 1;
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
const SAMPLER = (base64: string, regions: typeof SAMPLES) => `(async () => {
  const base64 = ${JSON.stringify(base64)}, regions = ${JSON.stringify(regions)};
  const img = new Image();
  await new Promise((done) => { img.onload = done; img.src = "data:image/png;base64," + base64; });
  const canvas = document.createElement("canvas");
  canvas.width = img.width; canvas.height = img.height;
  const g = canvas.getContext("2d");
  g.drawImage(img, 0, 0);
  const lum = (r, gg, b) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  const hex = (r, gg, b) => "#" + [r, gg, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  const out = {};
  for (const region of regions) {
    const d = g.getImageData(region.x, region.y, region.w, region.h).data;
    let dark = [255, 255, 255], light = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      const p = [d[i], d[i + 1], d[i + 2]];
      if (lum(p[0], p[1], p[2]) < lum(dark[0], dark[1], dark[2])) dark = p;
      if (lum(p[0], p[1], p[2]) > lum(light[0], light[1], light[2])) light = p;
    }
    out[region.name] = [hex(dark[0], dark[1], dark[2]), hex(light[0], light[1], light[2])];
  }
  return out;
})()`;

async function contrastIn(page: Page, shot: Buffer): Promise<Record<string, [string, string]>> {
  return (await page.evaluate(SAMPLER(shot.toString("base64"), SAMPLES))) as Record<
    string,
    [string, string]
  >;
}

const failures: string[] = [];
function check(label: string, actual: number, ceiling: number, unit = ""): void {
  const ok = actual <= ceiling;
  const line = `${ok ? "ok  " : "FAIL"}  ${label.padEnd(38)} ${String(actual).padStart(5)}${unit} (budget ${ceiling}${unit})`;
  console.log(line);
  if (!ok) failures.push(`${label}: ${actual}${unit} exceeds ${ceiling}${unit}`);
}

async function main(): Promise<void> {
  const sceneId = process.env["ONSEN_SCENE"] ?? null;
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const distinct = { fontSizes: new Set<string>(), controlHeights: new Set<string>(), gaps: new Set<string>() };
  let small = 0;
  let overflowing = 0;
  const ratios: { where: string; name: string; ratio: number }[] = [];

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

      const routes = sceneId === null ? ["/", "/characters", "/settings"] : ["/", `/scenes/${sceneId}`, "/characters", "/settings"];
      for (const route of routes) {
        await page.goto(ORIGIN + route, { waitUntil: "load" });
        await page.waitForTimeout(1400);
        const probe = (await page.evaluate(PROBE)) as {
          fontSizes: Record<string, number>;
          controlHeights: Record<string, number>;
          gaps: Record<string, number>;
          small: number;
          overflowing: number;
        };
        for (const size of Object.keys(probe.fontSizes)) distinct.fontSizes.add(size);
        for (const h of Object.keys(probe.controlHeights)) distinct.controlHeights.add(h);
        for (const g of Object.keys(probe.gaps)) distinct.gaps.add(g);
        small += probe.small;
        overflowing += probe.overflowing;

        // Contrast only where the sampled coordinates mean something.
        if (label === "desktop" && sceneId !== null && route.startsWith("/scenes/")) {
          const shot = await page.screenshot();
          const pairs = await contrastIn(page, shot);
          for (const [name, [dark, light]] of Object.entries(pairs)) {
            ratios.push({ where: theme, name, ratio: Number(contrastRatio(dark, light).toFixed(2)) });
          }
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

  if (ratios.length > 0) {
    console.log("");
    for (const { where, name, ratio } of ratios) {
      const label = `${where} / ${name}`;
      const ok = ratio >= BUDGET.contrast;
      const known = KNOWN_CONTRAST.includes(label);
      const mark = ok ? "ok  " : known ? "KNOWN" : "FAIL";
      console.log(
        `${mark.padEnd(5)} ${label.padEnd(38)} ${String(ratio).padStart(5)}:1 (floor ${BUDGET.contrast}:1)`,
      );
      if (!ok && !known) failures.push(`${label}: ${ratio}:1 below ${BUDGET.contrast}:1`);
      // A known failure that has been fixed should stop being listed as known.
      if (ok && known) failures.push(`${label} now passes at ${ratio}:1 — drop it from KNOWN_CONTRAST`);
    }
  } else {
    console.log("\n(no contrast samples — set ONSEN_SCENE to a scene ulid to include them)");
  }

  console.log("");
  console.log(`sizes:   ${[...distinct.fontSizes].sort((a, b) => parseFloat(a) - parseFloat(b)).join(", ")}`);
  console.log(`gaps:    ${[...distinct.gaps].sort((a, b) => parseFloat(a) - parseFloat(b)).join(", ")}`);

  if (failures.length > 0) {
    console.log(`\n${failures.length} over budget:`);
    for (const line of failures) console.log("  - " + line);
    process.exit(1);
  }
  console.log("\nall within budget.");
}

await main();
