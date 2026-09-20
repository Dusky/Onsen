/**
 * The themes that ship (SPEC §20 phase 45).
 *
 * Each one names only what it changes; everything else falls through to
 * `client/styles/tokens.css`, which is what keeps a theme small and keeps a
 * theme written today working after a token is added tomorrow.
 *
 * Eight of them. The first is the redesign's ground (phase 88); the second is
 * the original design handoff's palette, kept so that nothing is lost by
 * moving the default off it; the other six are grounds that are deliberately
 * not either.
 *
 * Each one spells out its own ink ramp, and every tier of it clears WCAG AA
 * against that theme's own surfaces — `test/surfaces.test.ts` measures all
 * eight, with `FOLLOWS` applied, because a failure that arrives by
 * inheritance is still a failure. None of them names
 * `color-text-placeholder`: it follows `color-text-dim`, which is the floor,
 * and a placeholder set a step quieter than the floor is under it.
 */

export interface BuiltinTheme {
  name: string;
  base: "dark" | "light";
  /** `--onsen-*` custom property names, without the prefix. */
  tokens: Record<string, string>;
}

/**
 * Depth as four values (phase 45).
 *
 * `flat` is the original rule — sharp corners, hairlines, no shadow — and is
 * what a theme gets by saying nothing. `cards` gives every panel its own fill,
 * a real corner and a real lift, which is what makes a turn read as a thing
 * rather than as more of the page.
 */
const DEPTH = {
  flat: {
    radius: "0px",
    "border-width": "1px",
    "shadow-panel": "none",
    "shadow-card": "none",
    // No card-bg: the flat original now inherits `--onsen-card-bg` from
    // tokens.css, which is `var(--onsen-color-bg-raised)` — a grounded turn
    // rather than a transparent one, while staying sharp and shadowless.
  },
  cards: {
    radius: "9px",
    "border-width": "1px",
    "shadow-panel": "0 -4px 14px rgba(0, 0, 0, 0.5)",
    "shadow-card": "0 3px 10px rgba(0, 0, 0, 0.55)",
    "card-padding": "14px 16px 16px",
  },
  /** The same corners and lift, tuned for a light ground where black is loud. */
  cardsLight: {
    radius: "9px",
    "border-width": "1px",
    "shadow-panel": "0 -3px 12px rgba(30, 26, 21, 0.09)",
    "shadow-card": "0 2px 6px rgba(30, 26, 21, 0.08)",
    "card-padding": "14px 16px 16px",
  },
} as const;

function withDepth(
  depth: Record<string, string>,
  colors: Record<string, string>,
): Record<string, string> {
  return { ...depth, ...colors };
}

export const BUILTIN_THEMES: readonly BuiltinTheme[] = [
  {
    // The redesign's cool dark ground (§20 phase 88). Sharp, hairline, no
    // shadows, with the live/writing state in amber and the interactive in
    // blue — the mockup's palette.
    name: "Midnight",
    base: "dark",
    tokens: {
      ...DEPTH.flat,
      "color-bg": "#0e0f11",
      "color-bg-sunken": "#111317",
      "color-bg-raised": "#14161a",
      "color-bg-inset": "#1c2026",
      "color-bg-input": "#0e0f11",
      "color-rule": "#2a2f37",
      "color-rule-strong": "#3b424e",
      "color-border-quiet": "#23282f",
      "color-text": "#e7eaed",
      "color-text-bright": "#f2f4f6",
      "color-text-label": "#c9ccd0",
      "color-text-muted": "#a2aab3",
      "color-text-dim": "#9399a1",
      "color-text-prose-muted": "#919aa3",
      "color-red": "#d56653",
      "color-red-bg": "#1f1514",
      "color-red-border": "#3a231f",
      "color-red-text": "#e08070",
      "color-blue": "#528acb",
      "color-blue-bg": "#141a20",
      "color-blue-bg-sheet": "#141a20",
      "color-blue-border": "#2a3440",
      "color-blue-border-strong": "#2f3d4a",
      "color-blue-text": "#7fa8d8",
      "color-blue-text-muted": "#839bb6",
      "color-blue-prose": "#c2ccd6",
      "color-green": "#6ba05f",
      "color-green-text": "#9cc08f",
      "color-green-text-muted": "#8e9d86",
      "color-amber": "#d99a3f",
      "color-amber-text": "#e0b878",
      "color-amber-text-muted": "#a79777",
      "color-ooc-reader-bg": "#241d12",
      "color-ooc-reader-text": "#e0cba4",
    },
  },
  {
    // The original handoff palette, flat, exactly as it was.
    //
    // The colours are named explicitly rather than left to the stylesheet's
    // fall-through, because a theme that sets no colours follows the OS's
    // light preference — the `base` field is stored and round-tripped but
    // nothing wires it to `data-theme`, so it cannot stop that. A default
    // theme must be deterministic, so this carries the dark warm palette
    // itself. Sharp corners and no shadows come from DEPTH.flat.
    name: "Ledger",
    base: "dark",
    tokens: {
      ...DEPTH.flat,
      "color-bg": "#14120f",
      "color-bg-sunken": "#0f0d0a",
      "color-bg-raised": "#1d1a15",
      "color-bg-inset": "#262119",
      "color-bg-input": "#100e0b",
      "color-rule": "#2b2620",
      "color-rule-strong": "#3b352c",
      "color-border-quiet": "#332d25",
      "color-text": "#e8e2d6",
      "color-text-bright": "#f0e9dc",
      "color-text-label": "#c9c1b1",
      "color-text-muted": "#a8a499",
      "color-text-dim": "#9d9a93",
      "color-text-prose-muted": "#a19a8d",
      "color-red": "#cb6f5e",
      "color-red-bg": "#1e1712",
      "color-red-border": "#4a3129",
      "color-red-text": "#d78872",
      "color-blue": "#6b8caf",
      "color-blue-bg": "#191d22",
      "color-blue-bg-sheet": "#171b20",
      "color-blue-border": "#232a31",
      "color-blue-border-strong": "#2f3a45",
      "color-blue-text": "#b9c3ce",
      "color-blue-text-muted": "#909ca6",
      "color-blue-prose": "#cdd5de",
      "color-ooc-reader-bg": "#2b2118",
      "color-ooc-reader-text": "#e2cdb4",
      "color-green": "#7fa65b",
      "color-green-text": "#b6c6a4",
      "color-green-text-muted": "#929f86",
      "color-amber": "#a6864f",
      "color-amber-text": "#cbb894",
      "color-amber-text-muted": "#a59a7f",
    },
  },
  {
    name: "Bottle",
    base: "dark",
    tokens: withDepth(DEPTH.cards, {
      "color-bg": "#0d1712",
      "color-bg-sunken": "#0a120e",
      "color-bg-raised": "#12201a",
      "color-bg-inset": "#16281f",
      "color-bg-input": "#0a120e",
      "color-rule": "#1e3227",
      "color-rule-strong": "#2b4536",
      "color-border-quiet": "#243b2e",
      "color-text": "#e6e4d8",
      "color-text-bright": "#f2f0e4",
      "color-text-label": "#c4c3b4",
      "color-text-muted": "#a5a9a0",
      "color-text-dim": "#9a9f98",
      "color-text-prose-muted": "#9ba193",
      "color-red": "#c8a049",
      "color-red-bg": "#1a1a10",
      "color-red-border": "#463b1e",
      "color-red-text": "#e0c489",
      "color-blue": "#5f93a6",
      "color-blue-bg": "#101d21",
      "color-blue-border": "#1e343b",
      "color-blue-text": "#b3ccd4",
      "color-green": "#7fa65b",
      "color-amber": "#a68750",
      "color-amber-text": "#b49a6b",
      "color-green-text": "#83a85f",
      "card-bg": "#12201a",
    }),
  },
  {
    name: "Nocturne",
    base: "dark",
    tokens: withDepth(DEPTH.cards, {
      "color-bg": "#0e1220",
      "color-bg-sunken": "#0a0d18",
      "color-bg-raised": "#141930",
      "color-bg-inset": "#1a2039",
      "color-bg-input": "#0a0d18",
      "color-rule": "#242b45",
      "color-rule-strong": "#333c5c",
      "color-border-quiet": "#2b3350",
      "color-text": "#dfe3ef",
      "color-text-bright": "#eef1f8",
      "color-text-label": "#bcc3d6",
      "color-text-muted": "#9da4b9",
      "color-text-dim": "#949aaa",
      "color-text-prose-muted": "#9aa2ba",
      "color-red": "#e7585c",
      "color-red-bg": "#20131a",
      "color-red-border": "#4d2732",
      "color-red-text": "#f2a6a3",
      "color-blue": "#6b8baf",
      "color-blue-bg": "#141b28",
      "color-blue-border": "#243449",
      "color-blue-text": "#b9c8de",
      "color-green": "#5bbf8f",
      "card-bg": "#141930",
    }),
  },
  {
    name: "Graphite",
    base: "dark",
    tokens: withDepth(DEPTH.cards, {
      "color-bg": "#15171a",
      "color-bg-sunken": "#111316",
      "color-bg-raised": "#1c1f23",
      "color-bg-inset": "#22262b",
      "color-bg-input": "#111316",
      "color-rule": "#2b2f35",
      "color-rule-strong": "#3a3f47",
      "color-border-quiet": "#32373e",
      "color-text": "#e3e5e8",
      "color-text-bright": "#f2f4f6",
      "color-text-label": "#c0c4ca",
      "color-text-muted": "#a4a9ae",
      "color-text-dim": "#9a9fa4",
      "color-text-prose-muted": "#9aa0a8",
      "color-red": "#a8e02a",
      "color-red-bg": "#1a1e12",
      "color-red-border": "#3a4520",
      "color-red-text": "#c9ee78",
      "color-blue": "#6193a9",
      "color-blue-bg": "#161c20",
      "color-blue-border": "#26343b",
      "color-blue-text": "#b3c9d4",
      "color-green": "#7fa65b",
      "color-amber": "#a78851",
      "color-amber-text": "#b59b6c",
      "color-green-text": "#84aa61",
      "card-bg": "#1c1f23",
    }),
  },
  {
    name: "Oxblood",
    base: "dark",
    tokens: withDepth(DEPTH.cards, {
      "color-bg": "#17090c",
      "color-bg-sunken": "#120709",
      "color-bg-raised": "#200e13",
      "color-bg-inset": "#2a141a",
      "color-bg-input": "#120709",
      "color-rule": "#361920",
      "color-rule-strong": "#4a242d",
      "color-border-quiet": "#3f1e26",
      "color-text": "#ece2e2",
      "color-text-bright": "#f7efef",
      "color-text-label": "#c9b8ba",
      "color-text-muted": "#ab9a9c",
      "color-text-dim": "#9c9293",
      "color-text-prose-muted": "#ab999b",
      "color-red": "#7fb2d9",
      "color-red-bg": "#101a22",
      "color-red-border": "#24384a",
      "color-red-text": "#a9cde6",
      "color-blue": "#c98f6b",
      "color-blue-bg": "#1d130d",
      "color-blue-border": "#3a2718",
      "color-blue-text": "#e0bfa4",
      "color-green": "#7fa65b",
      "card-bg": "#200e13",
    }),
  },
  {
    name: "Bone",
    base: "light",
    tokens: withDepth(DEPTH.cardsLight, {
      "color-bg": "#fafafa",
      "color-bg-raised": "#f1f1f1",
      "color-bg-input": "#ffffff",
      "color-rule": "#e0e0e0",
      "color-rule-strong": "#cfcfcf",
      "color-text": "#121212",
      "color-text-label": "#3d3d3d",
      "color-text-muted": "#565656",
      "color-text-dim": "#5e5e5e",
      "color-red": "#1f3fe0",
      "color-red-bg": "#e8ecfd",
      "color-red-border": "#b9c5f5",
      "color-blue": "#0f766e",
      "color-amber": "#88682e",
      "color-amber-text": "#765a28",
      "color-green": "#57763b",
      "color-green-text": "#4c6633",
      "color-blue-bg": "#e6f2f0",
      "color-blue-border": "#bcdcd7",
      "color-blue-text": "#14504b",
      "card-bg": "#ffffff",
    }),
  },
  {
    name: "Slate",
    base: "light",
    tokens: withDepth(DEPTH.cardsLight, {
      "color-bg": "#eef1f4",
      "color-bg-raised": "#e5eaee",
      "color-bg-input": "#fbfcfd",
      "color-rule": "#d2d9df",
      "color-rule-strong": "#bcc6ce",
      "color-text": "#16191d",
      "color-text-label": "#3a4149",
      "color-text-muted": "#4c525b",
      "color-text-dim": "#565a61",
      "color-red": "#0f756e",
      "color-red-bg": "#e0efed",
      "color-red-border": "#b2d5d0",
      "color-red-text": "#0d655f",
      "color-blue": "#3f6486",
      "color-blue-bg": "#e6ecf2",
      "color-blue-border": "#c6d4e0",
      "color-blue-text": "#2d4b66",
      "color-amber": "#83642d",
      "color-amber-text": "#705526",
      "color-green": "#537138",
      "color-green-text": "#486130",
      "card-bg": "#fbfcfd",
    }),
  },
];

/**
 * What a fresh install opens on.
 *
 * `Midnight` is the redesign's cool dark ground (§20 phase 88): sharp, hairline,
 * no shadows, with the live state in amber and the interactive in blue. The
 * warm `Ledger` palette and the rounded themes stay, pickable by hand.
 */
export const DEFAULT_THEME_NAME = "Midnight";
