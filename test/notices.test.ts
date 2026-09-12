import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NOTICE_MS, notify, useNoticeStore } from "../client/state/notices.ts";
import { NOTICE_POSITIONS, READER_DEFAULTS, readReader } from "../shared/types.ts";

/**
 * What the app has to say, said once (§20 phase 167).
 *
 * The gap this closes is measurable and is measured below: before this there
 * was **not one** `aria-live` region or `role="status"` anywhere in `client/`.
 * Every async outcome was inline text in whichever component owned the
 * request, which works for a rejected field and fails completely for a
 * background task that finished — several of which said nothing at all.
 */

beforeEach(() => {
  useNoticeStore.setState({ notices: [] });
});

describe("the queue", () => {
  test("a failure has no deadline and a success does", () => {
    // An error that removed itself before it was read is an error that never
    // happened, and "why did that not work" is the question a reader comes
    // back to after looking away.
    notify("done", "Saved pack.onsenpack.");
    notify("failed", "The provider refused that key.");
    const [done, failed] = useNoticeStore.getState().notices;
    expect(done!.until).not.toBeNull();
    expect(failed!.until).toBeNull();
  });

  test("the same thing said twice is said once", () => {
    // Two identical notices are a retry, a double-click, or two components
    // reporting one failure — never two facts. An unfiltered live region
    // reading the same sentence twice is its best-known failure mode.
    notify("failed", "No address is set.");
    notify("failed", "No address is set.");
    expect(useNoticeStore.getState().notices).toHaveLength(1);
  });

  test("but a repeat refreshes how long a success stays up", () => {
    notify("done", "Saved.");
    const first = useNoticeStore.getState().notices[0]!.until!;
    useNoticeStore.setState({
      notices: [{ ...useNoticeStore.getState().notices[0]!, until: first - 4_000 }],
    });
    notify("done", "Saved.");
    expect(useNoticeStore.getState().notices[0]!.until!).toBeGreaterThan(first - 4_000);
  });

  test("the same words in two tones are two notices", () => {
    // "Exported." as a success and as a failure are different facts.
    notify("done", "Exported.");
    notify("failed", "Exported.");
    expect(useNoticeStore.getState().notices).toHaveLength(2);
  });

  test("an empty notice is not a notice", () => {
    // `captionError` is nullable and the call sites are onSuccess handlers; a
    // blank strip appearing on every successful attach would be worse than
    // silence.
    notify("done", "   ");
    expect(useNoticeStore.getState().notices).toHaveLength(0);
  });

  test("the queue does not grow without bound", () => {
    for (let i = 0; i < 12; i += 1) notify("failed", `failure ${i}`);
    expect(useNoticeStore.getState().notices).toHaveLength(4);
    // The newest are kept: a stack of stale failures with the current one
    // pushed off the end is the wrong end to drop from.
    expect(useNoticeStore.getState().notices.at(-1)!.text).toBe("failure 11");
  });

  test("sweeping drops what expired and leaves what did not", () => {
    notify("done", "Saved.");
    notify("failed", "Refused.");
    useNoticeStore.getState().sweep(Date.now() + NOTICE_MS + 1);
    expect(useNoticeStore.getState().notices.map((n) => n.tone)).toEqual(["failed"]);
  });

  test("sweeping nothing changes nothing, by identity", () => {
    // The region arms a timer off this array; a sweep that returned a fresh
    // array every tick would re-arm the timer forever.
    notify("failed", "Refused.");
    const before = useNoticeStore.getState().notices;
    useNoticeStore.getState().sweep(Date.now());
    expect(useNoticeStore.getState().notices).toBe(before);
  });
});

const ROOT = join(import.meta.dir, "..");

/**
 * Comments removed, string literals kept — `invariants.test.ts`'s helper, for
 * the reason phase 57 recorded: a guard forbidding a name read the comment
 * *explaining* the rule as the defect, which makes the rule impossible to
 * write about. The store below says `aria-live` out loud and has none.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Every source file under `client/`, the way `density.test.ts` sweeps it. */
function clientFiles(dir = join(ROOT, "client")): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...clientFiles(path));
    else if (/\.tsx?$/.test(entry)) out.push({ name: path.slice(ROOT.length + 1), text: readFileSync(path, "utf8") });
  }
  return out;
}

describe("there is exactly one announced region", () => {
  test("and every live region in the app is in it", () => {
    // One primitive, no per-caller variants — the lesson `Scroller` and
    // `useModalFocus` both came out of. A second live region somewhere else
    // would announce over this one with no way to order the two.
    const offending = clientFiles()
      .filter((file) => /aria-live/.test(withoutComments(file.text)))
      .map((file) => file.name);
    expect(offending).toEqual(["client/components/NoticeRegion.tsx"]);
  });

  test("both politenesses are fixed per region rather than switched", () => {
    /*
     * A live region's politeness is read when the region is created, not when
     * its contents change, so one region that flipped `aria-live` between
     * polite and assertive would announce at whichever politeness it happened
     * to mount with.
     */
    const source = readFileSync(join(ROOT, "client", "components", "NoticeRegion.tsx"), "utf8");
    expect(source).toContain('role="status" aria-live="polite"');
    expect(source).toContain('role="alert" aria-live="assertive"');
    expect(source).not.toMatch(/aria-live=\{/);
  });

  test("the regions are mounted whether or not they have anything to say", () => {
    // A region that appears at the moment it has something to say is a region
    // assistive technology has not been watching, and the first notice is
    // silently lost.
    const source = readFileSync(join(ROOT, "client", "components", "NoticeRegion.tsx"), "utf8");
    const polite = source.slice(source.indexOf('role="status"'));
    expect(polite).not.toMatch(/done\.length === 0 \? null/);
    expect(source).toContain("className=\"contents\"");
  });

  test("it is mounted once, at the shell, on both layouts", () => {
    const app = readFileSync(join(ROOT, "client", "App.tsx"), "utf8");
    // Phone branch and desktop branch: a region on one layout only is a
    // region that vanishes when the window is resized.
    expect(app.match(/<NoticeRegion position=\{reader\.notices\} \/>/g)).toHaveLength(2);
    const elsewhere = clientFiles()
      .filter((file) => /<NoticeRegion/.test(file.text))
      .map((file) => file.name);
    expect(elsewhere).toEqual(["client/App.tsx"]);
  });

  test("an empty region is not an invisible sheet over the app", () => {
    // It is `fixed` and full-width by position; without this every click in
    // the top strip of the window would land on nothing.
    const source = readFileSync(join(ROOT, "client", "components", "NoticeRegion.tsx"), "utf8");
    expect(source).toContain("pointer-events-none fixed");
    expect(source).toContain("pointer-events-auto");
  });

  test("it takes no focus and traps none", () => {
    // A notice is the app reporting, not asking. `useModalFocus` is for things
    // that ask.
    const source = readFileSync(join(ROOT, "client", "components", "NoticeRegion.tsx"), "utf8");
    for (const forbidden of ["useModalFocus", "autoFocus", ".focus()", "tabIndex"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

describe("what used to say nothing", () => {
  test("a pack export reports that it wrote a file", () => {
    // A browser download leaves no mark on the page, so a pack that built and
    // a click that was swallowed looked identical — and there is no field for
    // it to sit under, which is why it survived every inline-error pass.
    const queries = readFileSync(join(ROOT, "client", "lib", "queries.ts"), "utf8");
    expect(queries).toMatch(/useExportPack[\s\S]{0,1400}notify\("done", strings\.notices\.exported/);
  });

  test("a preference that failed to save says so", () => {
    // One mutation behind forty controls, and the render reads the cached
    // value — so a failed PATCH left the button showing the old answer, which
    // is indistinguishable from a button that does not work.
    const queries = readFileSync(join(ROOT, "client", "lib", "queries.ts"), "utf8");
    expect(queries).toMatch(/useSetPreferences[\s\S]{0,1600}onError[\s\S]{0,200}settingNotSaved/);
  });

  test("the chat's two bespoke note props are gone", () => {
    // They were threaded from `ChatScreen`'s state down into `MessageLog` and
    // rendered at the bottom of the log, where nothing announced them and the
    // next turn scrolled them away.
    const files = clientFiles().filter((file) =>
      /autopilotNote|mediaNote|onDismissMediaNote/.test(withoutComments(file.text)),
    );
    expect(files.map((file) => file.name)).toEqual([]);
  });
});

describe("where a notice appears", () => {
  test("is the reader's, and defaults to out of the way", () => {
    expect(READER_DEFAULTS.notices).toBe("top");
    expect(readReader({ notices: "underneath" }).notices).toBe("top");
    expect(readReader({ notices: "bottomRight" }).notices).toBe("bottomRight");
  });

  test("never bottom-centre, which is where the composer is", () => {
    // The one place in this app that must never be covered.
    expect(NOTICE_POSITIONS).not.toContain("bottom");
    const source = readFileSync(join(ROOT, "client", "components", "NoticeRegion.tsx"), "utf8");
    for (const position of NOTICE_POSITIONS) expect(source).toContain(`${position}:`);
  });
});
