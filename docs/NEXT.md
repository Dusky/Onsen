# What is left

A short, honest list. `GAPS.md` is the evidence; this is the order.

**State:** phase 181. 1843 tests across 131 files, typecheck clean. Feature
complete against `SPEC.md` §20 apart from the deferred phase 42.

This file has now gone stale twice, and the second time was worse. It said
phase 157 and 1515 tests while the repository stood at 174 and 1754 — a
seventeen-phase drift covering two whole batches (158–164's audit work,
165–169's settings parity, 170–174's structural UI), and `SPEC.md` §20 and
`GAPS.md` had drifted with it. Caught the same way as last time: somebody
asked what was next and the answer had to be re-derived from `PHASES.md`
by hand.

Worth naming why, because the rule was already written. Step 5 below says
§20, `PHASES.md`, `GAPS.md` and the README move *in the same commit*, and
the phases that drifted updated `PHASES.md` and the README only — the two
documents a phase is writing about itself, not the two that tell the next
person where they are. A queue is only as good as the last reconciliation,
and a reconciliation nobody is forced to do is one that happens seventeen
phases late.

## The queue

Ordered by what is ready to build without a decision, then by the decisions
that gate the rest. Each line is a todo; check one off by closing its phase in
`SPEC.md` §20 and `PHASES.md` in the same commit.

### Ready to build

1. **Smooth streaming throttle.** Add a render throttle in
   `client/lib/generation.ts` — **only if** streaming judders on a phone.
   Reproduce the judder first; this is a conditional, not a default.

2. **Tabletop** (§20 phase 40) — **as an extension, not core.** The decisions
   this was gated on are made: it is called Tabletop, after §20 phase 40's own
   name and the `mode` option already called that, and it ships through §15's
   extension host rather than into the app. The first slice is the one SPEC
   already prescribes: **rolls and checks as recorded events**, stats and
   inventory only if the checks actually get used.

   Nothing needs building to make the seam work — `server/extensions/api.ts`
   already hands an extension per-scene `state` and app-wide `globalState`
   (key/value, pre-bound to its name), `inject()` with a
   `render({ db, sceneId })` that returns prompt text at a chosen position,
   depth and role, `on(event)` handlers for `message.created` /
   `generation.complete` / `tracker.updated`, `action()` for a manual button,
   and `task()` for a background pass. One constraint to design around: a task
   is **post-generation only** (§154), so anything that must happen *before* a
   turn is an injection or an event handler, not a task.

   And §21's "don't roll dice in the model" is already satisfied —
   `rollDice()` in `server/prompt/macros.ts` rolls server-side off an
   injectable RNG, which is the half that clause was protecting. A roll should
   reach the model as settled fact it narrates, never as a number it invents.

   The prompt for this was ST's *Multihog D&D Framework*
   (`MultihogAurelius/SillyTavern-MultihogDnDFramework`), and it is a
   reference for **what capability is worth having, never a source of code or
   text**: it is GPL-3.0 and this repository ships no licence at all, so
   absorbing any of it would decide our licensing for us. The same rule item 5
   already followed — "generic capability, not a port". Worth taking as an
   *idea*: its split between a pre-rolled value injected cheaply, and a
   tool-call path where the model must commit to a difficulty before it sees
   the result. Onsen has tool calling on every provider since phase 48, so
   both are expressible; the pre-rolled one is the cheaper default.

### Gated on a decision

3. **Web search.** Needs a provider/backend decision. Build as an **extension**
   (not core), per the earlier product note. **Deferred by the user: not wanted
   until we run out of better things.**

4. **Chub import / community browsing** (§20 phase 42, deferred). Gated on the
   app's stance toward third-party services.

### Not wanted (deferred until better things run out)

- **Translate extension** (port ST's). Deferred by the user — the app already
  surfaces enough, and this is a capability, not a missing piece.
- **Web search** (item 2 above) — same note.

### Carried forward from the phase-108 queue

5. ~~**Story Config + tracker cards under a reply.**~~ — **done**, both
   halves. ~~The Blocks (tracker cards under a reply)~~ — **phase 163**, and
   natively: a tracker row is already anchored to the turn that produced it,
   so the card renders the app's own structured state rather than parsing
   markup out of a reply. ~~Story Config dropdowns (genre, POV, friction,
   pace → scene prompt options)~~ — **phase 175**, and mostly already built:
   point of view had shipped since §13.5's first pass and the option
   machinery generalises, so it came to three groups of words (genre, pace,
   friction) rather than a feature. Each ships with a silent default, so no
   scene that predates them reads differently.

   Worth restating what this entry was: it named a *preset* somebody uses, and
   the interesting thing about reading that preset was that its formatting and
   colour are not prompt-driven at all — they are regex post-processing into
   HTML that its client renders. Onsen already had the regex half (§14, with
   ordering); what it lacked was a renderer, which is what phases 161–163
   built. Generic capability, not a port: nothing preset-specific is in the
   codebase, and a preset that brings its own scripts simply works.

The RPG-engine entry that used to sit here is gone, folded into item 2. It
carried another project's name for a job this queue already had: §20 phase 40
has described a tabletop module since the spec was written, and the queue was
tracking the same work twice under two names because one of them arrived from
a link. One job, one name, one entry.

## How to pick up

1. Read `HANDOFF.md` — the ten non-negotiables and the guards behind them.
2. Pick the top ready item, or whatever the user asks for instead.
3. Re-run its `GAPS.md` evidence command **before** building. Three rows have
   now turned out to be wrong or stale when re-run (phases 61, 62), and one of
   those was written the phase before.
4. Build, test, drive it in a browser at 390×844 with `hasTouch: true` and
   1440×900, both themes through the app's own picker.
5. `SPEC.md` §20 + the section it touches, `PHASES.md`, `GAPS.md`, README
   status, all in the same commit.

## One piece of process debt

- **The `dead-columns` blind spot.** The guard matches a column *name*, so a
  busy table's read masks a quiet one's: 58 of 264 column names are on more
  than one table, 89 `(table, column)` pairs where this can hide. Three real
  defects have hidden there. Making it attribution-aware needs more than a
  text sweep, and every cheap version either cries wolf or needs a per-pair
  allowlist nobody maintains. Recorded in `HANDOFF.md`; a column whose name is
  on another table is one to check by hand until somebody builds the real one.

## One question the user has not answered

Phase 60 rewrote `HANDOFF.md` down to the invariants and put a guard behind
each. The user's original suggestion was to retire it entirely. It has earned
its keep for now; if it stops doing so, the ten rules and the guards table are
the part to keep and `test/invariants.test.ts` is what makes deleting the rest
safe.
