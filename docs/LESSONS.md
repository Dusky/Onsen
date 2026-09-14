# Onsen — durable lessons

This file records durable engineering and product lessons. It is not a release
record and not a changelog; `docs/PHASES.md` is the dated narrative, and this is
the "why" that survives re-reading. Add a lesson only when it applies beyond
one incident; write the invariant and the reasoning, not the commit history.

## The one sentence

> **A check that asks a different question than the real thing can pass while
> the app is broken.**

This is the single most useful lesson in the codebase, and it has repeated in
the same shape across phases 182, 189, 193, 195 and 196:

- The Test button built a different URL and body than a turn → passed while
  every generation 404'd (182).
- The turn counter counted every row in the tree while the log rendered one
  path → "11 turns" over six (189).
- The contrast guard measured two flat hex tokens while the real surface is a
  translucent panel over a photograph → passed at 2.63:1 (193).
- The theme test read `builtin.ts` while the app read the `themes` table, with
  a seeder that never reconciled → every install rendered sub-AA forever (195).
- The response cap was reserved by the prompt builder but never sent to the
  wire, so auto-continue could never fire (196).

**The rule:** when you add or audit a check, a cache, a DTO, a migration, or a
seeder, ask: *does this read the same data, in the same shape, as the code path
a user actually hits?* The fix shape is always the same — make one resolved
answer and have everyone read it.

## Evidence beats inference

The first review (phase 188) made seven findings it later withdrew, and every
one of the withdrawals shared a cause: a defect was *inferred from a screenshot
or from `textContent`* rather than reproduced or measured.

- **Reproduce it or measure it.** A screenshot is a prompt to investigate, not
  a finding.
- **Before calling something an oversight, check whether it was a decision.**
  The codebase documents its reasoning in doc comments, `docs/SPEC.md` §20/§22,
  and `docs/PHASES.md`. `git log -S'<the thing>'` finds the phase that
  introduced it. Four of the seven withdrawals were deliberate design with a
  better rationale than the objection.
- **Separate "defect" from "taste"** — both are worth reporting; label which.
- **Say what you did not check.** An honest gap list is more useful than
  padding.

## Data-loss bugs are the highest-value class

The worst finding in phase 188 was not cosmetic: asking an off-script question
from anywhere but the tip could silently orphan a reader's story. Nothing was
deleted, and the story was unreachable by every control the reader knew.

Look hardest at the message tree, branching, deletion cascades, import/export,
and anything that moves `active_leaf_id`. "Your work is fine, it is merely
unreachable" is not a distinction a reader makes.

## The turn director is a source of truth problem

Who speaks next is decided in several places (manual/round-robin/mention/
classifier, the cue, the beat lead, the beat's last segment), and three
independent "wrong character" bugs came from those places disagreeing (phases
201–203). The invariant: **the director's announced decision, the prompt's
spotlight, the message's stored `character_id`, and the next turn's
"never-twice" roster must all read the same speaker.** After a beat, that
speaker is the last *segment*, not the lead.

## The model's home is the profile

Phases 180–181 and 210 settled a chain that kept confusing everyone: a model
id lived on the provider, the profile *and* the scene, each shadowing the one
above. The durable shape is: **a provider is an endpoint; a profile is the
model's home (provider + model + preset + window); a scene points at a profile
and may override only the model.** Read the scene's `runsOn` DTO everywhere you
need to show what a roleplay talks to — do not re-derive `resolveRoute` in a
second place.

## Streaming, scrolling and cancellation are stateful

- The server owns generation; a client that vanishes must be able to resume
  (SPEC §5). Persist as you go.
- **Never steal scroll position** from a reader who scrolled up to read.
- Cancel keeps partial output, by design; the reader must be *told* it was kept
  (phase 197), or a mid-sentence fragment lands unannounced in the story.
- A mid-stream failure should say *why*, not just "it failed" (phase 198) — the
  detail is computed server-side and must reach the screen.

## Seeded and shipped data reconciles, or it rots

A builtin seeded once and never reconciled diverges from the source and goes on
rendering stale values under a green test suite (the theme ramps in phase 195).
Structure is not a preference: reconcile builtin structure on boot. Words a
reader may have edited are the preference half and stay.

## Background work fails open

Passes, guides, trackers, summaries, retrieval, extensions and the classifier
must never break the turn they sit beside. Swallow their failures, but make
them readable somewhere (the task-run history), or a feature is "quietly
broken" rather than off.

## What a visual change must clear

- `bun test` (hermetic, source-as-text).
- `bun run typecheck`.
- `ONSEN_SCENE=<ulid> bun run guard:rendered` before and after — it measures the
  composited screen (contrast, font-size count, control-height count, sub-24px
  targets, unhandled overflow) against budgets, and the budgets ratchet down,
  never up.

## Working method

1. State the user-visible invariant and the failure being corrected.
2. Locate the owning subsystem and the persisted format.
3. Read the tests and the phase history around the risky code.
4. Make the smallest complete change.
5. Run the narrowest check, then the broader ones the risk justifies.
6. Verify live where the defect is user-visible (a browser drive, a real
   provider) — and make the test assert *the thing it is checking actually
   happened* before asserting the outcome (phases 197–198 both nearly shipped a
   false pass this way).
