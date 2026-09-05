/**
 * Themes (SPEC §20 phase 45).
 *
 * A theme is a set of `--onsen-*` overrides plus, optionally, some CSS of the
 * reader's own. Turning one into a stylesheet is pure and lives here; the rows
 * live next door in the query layer.
 */
import type { ThemeDto } from "../../shared/types.ts";

/**
 * A token name a theme may set.
 *
 * Anything else is refused rather than written through, because a theme is data
 * that gets interpolated into a stylesheet: without this, a "token name" of
 * `x: red } body { display: none` would be a way to write arbitrary CSS from a
 * field that is not supposed to be able to.
 */
const TOKEN_NAME = /^[a-z0-9-]{1,48}$/;

/**
 * A token value.
 *
 * Deliberately narrow: colours, lengths, shadows and keywords, and nothing
 * carrying `;`, `{`, `}`, `<`, `@`, or a `url(`. A theme cannot reach the
 * network, so a shared theme cannot phone home through a token — that is what
 * the separate, confirmed custom-CSS path is for.
 */
const TOKEN_VALUE = /^[#a-zA-Z0-9 ,.()%_/+-]{1,120}$/;

export function isSafeToken(name: string, value: string): boolean {
  if (!TOKEN_NAME.test(name) || !TOKEN_VALUE.test(value)) return false;
  return !/url\s*\(|expression|@import/i.test(value);
}

/** Only the pairs that are safe to write. Anything else is dropped, not thrown. */
export function safeTokens(tokens: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens)) {
    if (typeof value === "string" && isSafeToken(name, value)) kept[name] = value;
  }
  return kept;
}

/**
 * Tokens that follow another when a theme does not set them.
 *
 * A theme names a handful of colours; the stylesheet defines ninety-odd. The
 * ones it does not name fall through to the base — and the base's light values
 * are the original warm palette, so a cool theme that set only its primaries
 * came out with tan button borders and cream bars. The browser drive found it
 * on the first light theme; nothing static could have.
 *
 * So a theme is completed here rather than being asked to be exhaustive. That
 * matters most for a theme somebody makes: they change five colours and the
 * rest follows, instead of hunting the one they missed.
 */
const FOLLOWS: ReadonlyArray<readonly [string, string]> = [
  ["color-bg-inset", "color-bg-raised"],
  ["color-bg-card", "color-bg-raised"],
  ["color-bg-sunken", "color-bg"],
  ["color-border-quiet", "color-rule"],
  ["color-rule-quiet", "color-rule"],
  ["color-text-bright", "color-text"],
  ["color-text-prose-muted", "color-text-muted"],
  ["color-text-placeholder", "color-text-dim"],
  ["color-red-text", "color-red"],
  ["color-blue-bg-sheet", "color-blue-bg"],
  ["color-blue-border-strong", "color-blue-border"],
  ["color-blue-text-muted", "color-text-muted"],
  ["color-blue-prose", "color-blue-text"],
  ["color-ooc-reader-bg", "color-bg-inset"],
  ["color-ooc-reader-text", "color-text"],
];

/**
 * The theme's own values, plus every value that follows one of them.
 *
 * Applied in order, so a token that follows a token that itself followed
 * something resolves too — `ooc-reader-bg` follows `bg-inset`, which follows
 * `bg-raised`.
 */
export function completeTokens(tokens: Record<string, string>): Record<string, string> {
  const full = { ...tokens };
  for (const [target, source] of FOLLOWS) {
    if (full[target] === undefined && full[source] !== undefined) full[target] = full[source]!;
  }
  return full;
}

/**
 * The stylesheet for a theme.
 *
 * `:root:root:root` rather than `:root`, and the repetition is load-bearing.
 * `tokens.css` sets its light values behind `:root:not([data-theme="dark"])`,
 * which has the same specificity as any single-attribute `:root` selector — so
 * which one wins comes down to source order, and the bundler decides that. In
 * development Vite injects the app's stylesheet after the document's own
 * `<link>` elements, so a theme written the obvious way loses every time and
 * loses *silently*: the network serves it, the page ignores it. Three
 * `:root`s outrank anything the stylesheet can say without needing to know
 * where the bundler put it.
 *
 * The custom CSS is appended last and unqualified, so it can still override the
 * tokens — which is the point of having it, and why only CSS the reader has
 * approved is ever passed in here.
 */
export function themeCss(theme: ThemeDto): string {
  const declarations = Object.entries(completeTokens(theme.tokens))
    .filter(([name, value]) => isSafeToken(name, value))
    .map(([name, value]) => `  --onsen-${name}: ${value};`)
    .join("\n");

  const root = declarations === "" ? "" : `:root:root:root {\n${declarations}\n}\n`;
  return theme.customCss.trim() === "" ? root : `${root}\n${theme.customCss}\n`;
}

/**
 * What an imported theme's CSS could do, in one line per finding.
 *
 * Not a sanitiser — the reader is shown the CSS itself and decides. This is the
 * part they would otherwise have to spot by reading, and the part that is worth
 * spotting: a rule that fetches a URL tells whoever is hosting it that you
 * opened the app, and roughly when.
 */
export function cssConcerns(css: string): string[] {
  const found: string[] = [];
  if (/url\s*\(/i.test(css)) {
    found.push("Fetches a URL. Whoever hosts it learns your address and when you opened the app.");
  }
  if (/@import/i.test(css)) found.push("Pulls in another stylesheet, which can contain anything.");
  if (/position\s*:\s*fixed/i.test(css)) found.push("Positions something over the whole screen.");
  if (/content\s*:/i.test(css)) found.push("Inserts text of its own into the page.");
  return found;
}
