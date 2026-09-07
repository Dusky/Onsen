# What is left

A short, honest list, written at the end of phase 65 so work can resume without
re-deriving it. `GAPS.md` is the evidence; this is the order.

**State:** phase 99, on `glm/sillytavern-replacement-dyp30w`. 1420 tests across
104 files, typecheck clean, working tree clean. Feature complete against
`SPEC.md` §20 apart from the deferred phase 42.

**The redesign is done** (`docs/REDESIGN.md`). Both rails are full tools (§20
phases 95–98), and the turn surface and composer got the same pass — named
actions, an amber streaming cursor, labelled reasoning and a live draft cost
(§20 phase 99).

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

## The queue

Ordered by how early a session hits them, which is how `GAPS.md`'s tail has
been ordered since phase 55.

1. **Auto background** (`GAPS.md` §7). Per-scene backgrounds exist
   (`SceneDto.hasBackground`) and nothing generates one. The media services
   from phase 41 already draw pictures; this is a background task that reads
   the scene and asks for one.
2. **Chat translation** (`GAPS.md` §7). No translation path anywhere. Needs a
   decision first: a display-only layer (like §14's `display_only` regex
   stage) or a stored second text. Display-only is almost certainly right —
   the prompt should keep the language the author is writing in.
3. **Smooth streaming** (`GAPS.md` §5). No render throttle in
   `client/lib/generation.ts`. Low priority and explicitly conditional:
   revisit *if* streaming judders, not on principle.
4. **Self-responses** (`GAPS.md` §4). A judgement call under the author model
   rather than a gap — §0.2 rejects independent agents, and "a character
   replies to itself" may simply be a beat. Worth a conversation before code.
5. **Web search** (`GAPS.md` §1). Backend-dependent, and the first thing here
   that needs a provider decision rather than an implementation.
6. **Usage stats** and **avatar shape/blur/shadow** (`GAPS.md` §3, §6). Both
   marked low priority by their own rows. Left where they are.

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
