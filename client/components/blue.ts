/**
 * The blue pencil's button treatments (design system, SPEC §8, §11).
 *
 * Shared so that everything inside a blue panel agrees: the guides, the
 * memory, and whatever the author's own machinery grows next. Red is never one
 * of these — a destructive action in a blue panel wears red, and is the only
 * thing in it that does.
 */
export const blueOutline = {
  borderColor: "var(--onsen-color-blue-border-strong)",
  color: "var(--onsen-color-blue-text)",
};

export const blueSolid = {
  background: "var(--onsen-color-blue)",
  borderColor: "var(--onsen-color-blue)",
  color: "#f2f5f8",
};

export const red = {
  borderColor: "var(--onsen-color-red)",
  color: "var(--onsen-color-red)",
};

export const blueRule = { borderBottom: "1px solid var(--onsen-color-blue-border)" };
export const blueText = { color: "var(--onsen-color-blue-text)" };
export const blueMuted = { color: "var(--onsen-color-blue-text-muted)" };
export const blueProse = { color: "var(--onsen-color-blue-prose)" };
