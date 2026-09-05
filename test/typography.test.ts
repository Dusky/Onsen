import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The type system, enforced structurally (SPEC §16, §20 phase 47).
 *
 * The reason this file exists: phases 21 through 46 each added a screen, each
 * reached for the smallest generic element the vocabulary offered, and the
 * result measured 395 elements at 10px or below against 12 at 17px or above.
 * Nothing was wrong with any single one of them, which is exactly why no
 * review caught it — the defect was the distribution, and only a count of the
 * whole tree can see a distribution.
 *
 * So the rules are checked here rather than trusted to the next phase's
 * judgement.
 */

const CLIENT = join(import.meta.dir, "..", "client");

function tsxFiles(dir = CLIENT): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsxFiles(path));
    else if (entry.endsWith(".tsx")) {
      out.push({ name: path.slice(CLIENT.length + 1), text: readFileSync(path, "utf8") });
    }
  }
  return out;
}

/** Every `className="..."` in the client, as its set of classes. */
function classLists(): { file: string; classes: string[] }[] {
  return tsxFiles().flatMap((file) =>
    [...file.text.matchAll(/className="([^"]*)"/g)].map((match) => ({
      file: file.name,
      classes: match[1]!.split(/\s+/).filter((c) => c !== ""),
    })),
  );
}

const css = readFileSync(join(CLIENT, "styles", "app.css"), "utf8");

describe("the type system exists", () => {
  test("there is client source to check", () => {
    expect(tsxFiles().length).toBeGreaterThan(20);
  });

  for (const role of ["group-heading", "section-label", "explain", "meta", "token-count"]) {
    test(`.${role} is defined once`, () => {
      expect(css.match(new RegExp(`^  \\.${role} \\{`, "gm"))?.length ?? 0).toBe(1);
    });
  }
});

describe("mono names, Spectral speaks", () => {
  /*
   * The two-voices rule, and the one place phase 47 bends it. `.explain` is
   * the app talking in sentences — the same argument the design already
   * accepted for the OOC voice. Setting it in mono as well would put it back
   * where it started.
   */
  test("nothing is both .explain and .chrome", () => {
    const offending = classLists()
      .filter((c) => c.classes.includes("explain") && c.classes.includes("chrome"))
      .map((c) => c.file);
    expect(offending).toEqual([]);
  });

  test(".explain is never uppercased or tracked", () => {
    const offending = classLists()
      .filter(
        (c) =>
          c.classes.includes("explain") &&
          c.classes.some((k) => k === "uppercase" || k.startsWith("tracking-")),
      )
      .map((c) => c.file);
    expect(offending).toEqual([]);
  });

  test(".explain sets its own size, so nothing overrides it", () => {
    const offending = classLists()
      .filter((c) => c.classes.includes("explain") && c.classes.some((k) => /^text-\[[\d.]+px\]$/.test(k)))
      .map((c) => c.file);
    expect(offending).toEqual([]);
  });
});

describe("the hierarchy stays a hierarchy", () => {
  /*
   * The shape that started it: mono, a size at or under 10px, a reading
   * line-height, and a muted colour — an explanatory sentence dressed as a
   * label. There were 148 of these. Any new one belongs in `.explain`.
   */
  test("no explanatory paragraph is set as chrome", () => {
    const offending = classLists()
      .filter(
        (c) =>
          c.classes.includes("chrome") &&
          c.classes.some((k) => /^leading-\[1\.[56]\]$/.test(k)) &&
          c.classes.some((k) => {
            const size = /^text-\[([\d.]+)px\]$/.exec(k);
            return size !== null && Number(size[1]) <= 10;
          }) &&
          c.classes.some((k) => k === "text-ink-dim" || k === "text-red-text") &&
          !c.classes.includes("uppercase") &&
          !c.classes.some((k) => k.startsWith("tracking-")),
      )
      .map((c) => c.file);
    expect(offending).toEqual([]);
  });

  /*
   * "Minimum sizes are load-bearing", and the floor moved in phase 49.
   *
   * The design table's figures were drawn for a phone at reading distance. On
   * a desktop browser they were small enough that the app was being used at
   * 130% browser zoom — which is a report that the default is wrong, not that
   * the reader is unusual. Everything at or below 11px went up a step, and the
   * floor went with it: 9px, and the ops-key caption is no longer an exception
   * because it no longer needs to be.
   */
  test("nothing is set below 9px", () => {
    const offending = classLists()
      .filter((c) =>
        c.classes.some((k) => {
          const size = /^text-\[([\d.]+)px\]$/.exec(k);
          return size !== null && Number(size[1]) < 9;
        }),
      )
      .map((c) => c.file);
    expect(offending).toEqual([]);
  });

  /*
   * Not a size limit — a spread. If the tiny end of the app grows without the
   * readable end growing with it, the screens go back to one texture. The
   * ratio when this was written was 200 to 60; the bound is deliberately loose
   * so ordinary work never trips it, and a phase that doubles the chrome
   * without adding anything to read will.
   */
  test("the app has more than one voice, by count", () => {
    const sizes = tsxFiles().flatMap((file) =>
      [...file.text.matchAll(/text-\[([\d.]+)px\]/g)].map((m) => Number(m[1])),
    );
    const small = sizes.filter((size) => size <= 10).length;
    const readable =
      sizes.filter((size) => size >= 13).length +
      classLists().filter((c) =>
        c.classes.some((k) => k === "explain" || k === "screen-title" || k === "field"),
      ).length;
    expect({ small, readable, ok: small < readable * 2 }).toMatchObject({ ok: true });
  });
});
