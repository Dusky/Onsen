# Onsen — product intent

Onsen is a self-hosted AI roleplay and collaborative-fiction app. The writing —
the story, the characters, the moment being written — is the product. Everything
else is chrome, and chrome's job is to recede until the reader reaches for it.

This document is the product-level contract. `docs/SPEC.md` says *how* the app
is built; this says *what it is for and what it is not allowed to become*. When
a change could go either way, this file is the tiebreaker. Read it as a set of
merge gates, not as prose.

## One principle

**The writing is the product. The machinery is not.**

A reader should be able to open a scene and write, with nothing competing for
their attention. Configuration and tooling stay out of the way until they are
deliberately opened, and then they get out of the way again.

This is the lesson of the first use review (phase 188), stated once so it is
never re-derived: the app's prose surface was excellent and its chrome was
louder than the writing — the composer sat 112 tab stops deep behind a prompt
rail of seventy-eight controls. The fix is not to remove the machinery (a
power user genuinely wants it); it is to keep the writing reachable in one or
two steps from anywhere, and to make the machinery a thing the reader *calls
for*, not a thing that is always in the room.

## What the app is

- **A writing surface first.** One reader, one author, a cast, a history. The
  prose column is the centre of gravity; every screen defers to it.
- **One AI author who voices the whole cast** — the game-master model, not a
  per-character bot. Characters are roles, not accounts.
- **Bring-your-own-backend.** Providers, profiles and presets are the reader's;
  the app routes work through them and never talks to an inference API itself
  (SPEC §0.7).
- **Self-hosted and single-user.** One install, one password, one library.
  There is no multiuser story and there will not be.

## Anti-patterns

These are violations of the principle. A change that introduces one should be
revised before merge, or the phase must say why the exception is worth it.

- **UI creep** — persistent panels, rails or toolbars that sit in the primary
  viewport during writing. Onsen *has* rails (a deliberate dock system, phase
  100/173); the rule they must respect is: they recede, they never own the tab
  order between the reader and the composer, and none of them is required to
  write. A new rail panel is a heavy decision, not a default.
- **Machinery louder than writing** — configuration that is more visible than
  the thing it configures. The prompt block list is configuration; the story is
  not.
- **Nested menu spiral** — sub-menus that spawn sub-menus. One level of
  disclosure is the norm; if a feature needs two, it needs its own surface.
- **Configuration sprawl** — a wall of options presented to a returning reader.
  Options appear because the reader seeks them out, not because they exist.
- **Mystery meat** — essential controls behind unlabelled glyphs. (Phase 190
  removed the `▎`/`▕` buttons for exactly this reason.) Configuration may be
  hidden; the controls a reader needs to *write* may not be.
- **Hover-only discovery** — anything that is unreachable on touch.
- **Tiny targets** — controls under the 24px pointer minimum (WCAG 2.5.8).
- **Silent data loss** — any path where the reader's writing becomes
  unreachable, orphaned, or overwritten without being told. The off-script
  hijack (phase 189) is the canonical case: nothing was deleted and the story
  was still gone.

## Anti-references

Aesthetic and behavioural traps to avoid.

- **SaaS polish** — interchangeable, characterless styling. The 0px radius and
  the amber/blue signal pair are Onsen's identity; do not smooth them away.
- **Clone blandness** — inheriting SillyTavern's look or behaviour wholesale.
- **Decorative motion** — motion that does not orient the reader through a
  state change. Everything moves for a reason, and honours `prefers-reduced-motion`.
- **Desktop-only assumptions** — layouts, inputs or interactions that presume a
  mouse and a large viewport. The phone layout is a first-class layout, not a
  fallback.
- **Hover-revealed delete/actions** — see anti-patterns.

## Accessibility baseline

Not a stretch goal. A contribution that fails one of these is revised before
merge.

- **Contrast** — body text targets WCAG AA (4.5:1) against what actually
  renders, composited over whatever is behind it (not token-vs-token).
- **Visible focus** — every control has a focus-visible ring.
- **Keyboard reach** — every control is keyboard-reachable, and the composer is
  one keystroke (`c`) or one skip-link press away.
- **Semantic labels** — controls carry accessible names; visual-only cues are
  never the sole carrier of meaning.
- **Comfortable targets** — 24px pointer minimum everywhere.
- **Reduced motion** — every transition has a reduced-motion path.
- **Long labels, zoom, narrow widths** — layouts tolerate them.

## Navigation model

Onsen's destinations are: Roleplays (base), a scene's Chat (base), and the
overlay screens — Characters, Authors, Personas, Lorebooks, Backdrops, Settings,
Assistant, and a scene's Setup. The rails are dockable, not destinations.

The rule from the principle: **Chat and Roleplays are the base; everything else
is a visit.** An overlay should not make the writing harder to get back to.
