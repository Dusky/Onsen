/**
 * The themes that ship (SPEC §20 phase 45).
 *
 * Each one names only what it changes; everything else falls through to
 * `client/styles/tokens.css`, which is what keeps a theme small and keeps a
 * theme written today working after a token is added tomorrow.
 *
 * Seven of them. The first is the original design handoff's palette, kept so
 * that nothing is lost by moving the default off it; the other six are grounds
 * that are deliberately not it.
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
    "card-bg": "transparent",
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
    // The original handoff palette, flat, exactly as it was. Nothing about
    // moving the default should make this unreachable.
    name: "Ledger",
    base: "dark",
    tokens: { ...DEPTH.flat },
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
      "color-text-muted": "#8d9287",
      "color-text-dim": "#697066",
      "color-text-prose-muted": "#9ba193",
      "color-text-placeholder": "#697066",
      "color-red": "#c8a049",
      "color-red-bg": "#1a1a10",
      "color-red-border": "#463b1e",
      "color-red-text": "#e0c489",
      "color-blue": "#5f93a6",
      "color-blue-bg": "#101d21",
      "color-blue-border": "#1e343b",
      "color-blue-text": "#b3ccd4",
      "color-green": "#7fa65b",
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
      "color-text-muted": "#8b93ad",
      "color-text-dim": "#5f6780",
      "color-text-prose-muted": "#9aa2ba",
      "color-text-placeholder": "#5f6780",
      "color-red": "#e5484d",
      "color-red-bg": "#20131a",
      "color-red-border": "#4d2732",
      "color-red-text": "#f2a6a3",
      "color-blue": "#5b7fa6",
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
      "color-text-muted": "#8b9099",
      "color-text-dim": "#666c75",
      "color-text-prose-muted": "#9aa0a8",
      "color-text-placeholder": "#666c75",
      "color-red": "#a8e02a",
      "color-red-bg": "#1a1e12",
      "color-red-border": "#3a4520",
      "color-red-text": "#c9ee78",
      "color-blue": "#5b8fa6",
      "color-blue-bg": "#161c20",
      "color-blue-border": "#26343b",
      "color-blue-text": "#b3c9d4",
      "color-green": "#7fa65b",
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
      "color-text-muted": "#9c8a8c",
      "color-text-dim": "#756668",
      "color-text-prose-muted": "#ab999b",
      "color-text-placeholder": "#756668",
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
      "color-text-muted": "#6b6b6b",
      "color-text-dim": "#949494",
      "color-text-placeholder": "#a3a3a3",
      "color-red": "#1f3fe0",
      "color-red-bg": "#e8ecfd",
      "color-red-border": "#b9c5f5",
      "color-blue": "#0f766e",
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
      "color-text-muted": "#5c646d",
      "color-text-dim": "#878f98",
      "color-text-placeholder": "#9aa2aa",
      "color-red": "#0f766e",
      "color-red-bg": "#e0efed",
      "color-red-border": "#b2d5d0",
      "color-blue": "#3f6486",
      "color-blue-bg": "#e6ecf2",
      "color-blue-border": "#c6d4e0",
      "color-blue-text": "#2d4b66",
      "card-bg": "#fbfcfd",
    }),
  },
];

/** What a fresh install opens on. */
export const DEFAULT_THEME_NAME = "Bottle";
