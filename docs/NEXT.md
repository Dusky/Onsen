# What is left

A short, honest list, written at the end of phase 65 so work can resume without
re-deriving it. `GAPS.md` is the evidence; this is the order.

**State:** phase 105, on `glm/sillytavern-replacement-dyp30w`. 1427 tests across
105 files, typecheck clean, working tree clean. Feature complete against
`SPEC.md` §20 apart from the deferred phase 42.

## The queue

Ordered by what the user asked for most recently, which is the thread to
follow.

1. **Prompt preset management** — *the current ask, mostly shipped (§20 phase
   105).* The Preset tab is a manager and a preset can name its model. Remaining:
   the import/export parity for the SillyTavern utility prompts (impersonation,
   continue nudge, new-chat) and the unmapped samplers, so a Celia-style preset
   round-trips whole.

2. **Megumin Suite — Story Config + Blocks.** The preset's prompt blocks are
   already imported. What remains: the Story Config dropdowns (genre, POV,
   friction, pace → scene prompt options) and the Blocks (tracker cards under a
   reply).

3. **Multihog** — the RPG engine and the long pole. State Tracker first, then
   the RNG, then World Progression and Map Evolution.

4. **Web search** — explicitly *not* core; the user said it could be an
   extension. Left off the core list.

5. **Self-responses** (`GAPS.md` §4). Still a product conversation, not a gap.

## How to pick up

1. Read `HANDOFF.md` — the ten non-negotiables and the guards behind them.
2. Pick the top item below, or whatever the user asks for instead.
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
