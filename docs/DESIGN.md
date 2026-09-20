# Onsen — design contract

The visual system's source of truth is `client/styles/tokens.css` (the tokens)
and `scripts/rendered-guard.ts` (the enforced budgets). This file is the human
reading of those two: the named rules a change must respect, and the numbers
the guard will fail you on.

The theme is dark-first with a warm/amber signal and an interactive blue, a
0px radius held across every surface, and a serif prose face over a mono chrome.
The identity is *quiet writing surface*, not decoration.

## Colour rules

- **Amber is "live", blue is "chosen".** Amber marks a turn being written, a
  cued speaker, a running state. Blue marks a selection, a pressed mode, a
  navigation choice. Do not blur the two (design review fix 1).
- **Signal is scarce.** A signal colour appears for action, selection, focus or
  meaningful state. If removing it does not reduce comprehension, remove it.
- **Read tokens, never hardcode a colour.** Components consume `--onsen-*`
  tokens; a hardcoded hex that bypasses user themes is a bug.
- **Contrast is measured composited.** The guard samples real pixels over the
  real background (a translucent panel over a photograph), because a token pair
  can pass at 2.63:1 while the screen does not. Body text targets 4.5:1.

## Type rules

- **Prose is serif, chrome is mono.** The app never sets its own chrome in the
  serif, and never sets story prose in the mono.
- **One owner per size.** The chrome sizes are `--onsen-text-ui` (12.5px) and
  `--onsen-text-ui-loose` (13.5px), read through `text-ui` / `text-ui-loose`
  utilities. No component spells a size out as a literal (phase 194; the guard
  enforces it).
- **Half-pixel sizes are deliberate, not soft.** `12.5px`/`13.5px` are the two
  chrome sizes on purpose; do not "round them up" — phase 194 proved that
  optimising the distinct-size count would damage consistency.

## Layout and targets

- **0px radius, everywhere.** The one axis that is perfectly consistent; hold it.
- **24px pointer minimum** (WCAG 2.5.8). The guard counts sub-24px targets; the
  number ratchets down, never up.
- **Focus is visible.** Every control keeps the global `:focus-visible` ring.
- **Reduced motion** is honoured via `prefers-reduced-motion` and the
  `data-motion` attribute.

## The enforced budgets (read from `rendered-guard.ts`)

These record the app as measured, so they can only come down:

- distinct font sizes ≤ 14 (12 at phase 193's baseline, less later)
- distinct control heights ≤ 27
- distinct flex/grid gaps ≤ 14
- interactive elements under 24px ≤ 208
- elements clipping content with no scroll container ≤ 38
- no contrast sample below 4.5:1 (`KNOWN_CONTRAST` must stay empty)

A budget is not an aspiration. If a change exceeds one, either the change is
wrong or the budget was already wrong — and raising the budget is the wrong
resolution, because the guard fails if a known-failing entry starts passing.

## When you add UI

1. Reach for the tokens and utilities, not new literals.
2. Respect the amber/blue signal split and the 0px radius.
3. Keep targets ≥24px, focus visible, motion reducible, labels semantic.
4. Run `guard:rendered` before and after and confirm byte-identical or
   *better* numbers.
