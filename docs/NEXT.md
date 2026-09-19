# What is left

A short, honest list. `GAPS.md` is the evidence; this is the order.

**State:** phase 226. 2041 tests across 151 files, typecheck clean. Feature
complete against `SPEC.md` §20 apart from the deferred phase 42.

This file went stale three times, and the third was the worst: it said phase
195 and 1929 tests while the repository stood at **218** and 1951, `SPEC.md`
§20's list ended at item 195, the README badge said 195, and phase 211 had no
`PHASES.md` entry at all — it shipped global search and four documents, and the
file jumped 210 → 212. A twenty-three-phase drift against the seventeen-phase
one this paragraph used to describe. Caught the same way both previous times
were: somebody asked what was next and the answer had to be re-derived from
`PHASES.md` by hand.

Worth naming why, because the rule was already written. Step 5 below says
§20, `PHASES.md`, `GAPS.md` and the README move *in the same commit*, and
the phases that drifted updated `PHASES.md` and the README only — the two
documents a phase is writing about itself, not the two that tell the next
person where they are. A queue is only as good as the last reconciliation,
and a reconciliation nobody is forced to do is one that happens seventeen
phases late.

**It is no longer a rule nobody is forced to keep.** `test/tracker-drift.test.ts`
(phase 219) asserts that the highest phase in `PHASES.md`, the highest item in
§20, the README badge and the state line above all agree, and that `PHASES.md`
has no numbering gaps. All three drifts would have failed on the commit that
caused them. `GAPS.md` is deliberately not in it — that file is evidence, not a
count, and asserting anything about its contents would be asserting a number
meant to move on its own.

## The queue

Ordered by what is ready to build without a decision, then by the decisions
that gate the rest. Each line is a todo; check one off by closing its phase in
`SPEC.md` §20 and `PHASES.md` in the same commit.

### From the phase-218 review (in order)

A review of phases 196–218 ran the app rather than reading it and found seven
things; `219` is shipped and the rest are planned, each its own phase.

0. ~~**Every change the assistant makes is in Undo.**~~ — **phase 219.**

1. ~~**A speaker's colour is legible on both themes.**~~ — **phase 220**, and
   the plan's own prescription turned out to be impossible: no palette clears
   the floor on both bases, because the luminance windows do not overlap. The
   stored colour is identity and `readableOn` resolves it against the ground.
   2.07/1.99/2.34:1 composited before, 4.98/4.88/5.76:1 after.

2. ~~**Markup inside speech renders again.**~~ — **phase 221.** The
   flattening rule stands for asterisks and does not carry to quotes, because a
   quote is punctuation rather than a mark somebody chose to write.

3. **The rendered guard measures the whole app.** `bun run guard:rendered`
   prints "all within budget" having taken **zero** contrast samples and never
   opened a scene — both are gated on `ONSEN_SCENE`, which `package.json` does
   not set. The four `SAMPLES` rectangles are absolute coordinates, which is
   why item 1 was never measured.

4. **The leaks in the new screens.** "Runs on: Default / Default" (a hardcoded
   button beside a profile with the same name); `SearchOverlay` mounted
   unconditionally so its focus never restores (measured: Search button →
   Escape → `<body>`, where the palette restores correctly); 8.5px text on
   three cast-rail buttons; and the `Name:` prefix that streams in and vanishes
   when the turn lands, because `stripSpeakerPrefix` has no client mirror.

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
