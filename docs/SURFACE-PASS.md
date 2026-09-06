# The surface pass

Why the app reads as "AI slop" when the design system underneath it is good,
and the four passes that repair it. Written after phase 65; the diagnosis is
recorded so the work does not have to be re-derived.

## The diagnosis

Three specific drifts between `docs/design/DESIGN.md` and what shipped:

1. **The default theme contradicts the identity.** The design's third rule is
   "everything is a page being marked up — sharp corners, 1px hairlines, no
   shadows". Phase 45 made the default `Bottle`: radius 9px and drop shadows,
   on a greenish ground. Rounded corners + shadows + a neutral tint is the
   generic-SaaS recipe. The fix for the criticism that prompted phase 45 — "the
   app read flat" — was the wrong one; the real cause (surfaces two lightness
   points apart) was fixed in phase 49 by raising the steps, and the flat
   identity never needed to go.
2. **Density was automated backwards.** The design's amended §Density says
   "terse and dense are not opposites — say very little, show a great deal",
   "numbers are always visible", "controls live in the row". The guard tests
   enforce the *quiet* half (`voice.test.ts` caps explanations) and never
   guarded the *dense* half. The app got quieter without getting denser, which
   is the texture that reads as shallow.
3. **The prompt — the product — is buried.** The inspector the design calls
   "the screen that wins over a dissatisfied SillyTavern user" is post-hoc
   only, has no preview of the next turn, and is two gestures deep on a phone
   while the status-bar handle opens the guides sheet instead.

The sidebar is the same disease in miniature: no wordmark, five bare text
rows, and a recent list with no excerpt, cast or writing state — 232px of
dead grey where the design promised free scene-switching.

## The passes

Each one is small enough to ship and verify in a browser in one sitting, and
each lands its own guard so the drift cannot recur.

1. **Restore the identity.** Default theme → `Ledger` (flat, warm, hairline,
   with phase 49's raised surfaces). Guard: the default theme's depth tokens
   resolve to radius 0 and no shadow.

2. **The sidebar.** A Spectral wordmark; nav rows with glyphs, counts and an
   unmistakable active state; the recent list upgraded to real rows — title,
   one-line excerpt, cast initials, message count, and a red writing indicator
   on the scene currently generating; a solid-red new-roleplay footer; rows
   tightened per the pointer density rule. Guard: the sidebar's active state
   and row height measured by `surfaces` / `density`.

3. **The prompt on the surface.** A live "what this turn will send" preview
   from the composer; tap-through from a turn's `#4 · ~126t` gutter to that
   turn's prompt; cost as a share of the context window on cards, fields and
   blocks — the built-in prompt blocks included. Guard: the preview endpoint in
   `reachable`, and a "costs render" rule.

4. **Navigation density.** Controls in the row, not sheet-on-sheet; the
   Workbench promise of settings as a table edited in the pane; the phone
   status-bar "Context" button opens the inspector. Guard: a sheet never opens
   another sheet.
