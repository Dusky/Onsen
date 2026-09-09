# What is left

A short, honest list. `GAPS.md` is the evidence; this is the order.

**State:** phase 154. 1498 tests across 112 files, typecheck clean. Feature
complete against `SPEC.md` §20 apart from the deferred phase 42.

## The queue

Ordered by what is ready to build without a decision, then by the decisions
that gate the rest. Each line is a todo; check one off by closing its phase in
`SPEC.md` §20 and `PHASES.md` in the same commit.

### Ready to build

1. **ChatScreen extraction.** `client/screens/ChatScreen.tsx` is a 69KB
   monolith with ~40 `useState` hooks — the highest-traffic file in the app,
   and the one every future "server has it / screen can't reach it" defect will
   be born in. Extract in small, behaviour-preserving steps (turn commands →
   a hook, the sheet collection → a component, the log → a component, the
   composer wiring → a hook), each committed separately, suite green after
   each. Do it in its own session, not the tail of another.

2. **Smooth streaming throttle.** Add a render throttle in
   `client/lib/generation.ts` — **only if** streaming judders on a phone.
   Reproduce the judder first; this is a conditional, not a default.

### Gated on a decision

3. **Web search.** Needs a provider/backend decision. Build as an **extension**
   (not core), per the earlier product note. **Deferred by the user: not wanted
   until we run out of better things.**

4. **Self-responses.** A product conversation under the author model — how the
   author may answer itself without a second inference path. Decide first;
   nothing to build until it is decided.

5. **Tabletop module** (§20 phase 40). SPEC's own note splits it: rolls and
   checks as recorded events first (server-side, deterministic — `{{roll}}`
   already does), stats only if the checks actually get used.

6. **Chub import / community browsing** (§20 phase 42, deferred). Gated on the
   app's stance toward third-party services.

### Not wanted (deferred until better things run out)

- **Translate extension** (port ST's). Deferred by the user — the app already
  surfaces enough, and this is a capability, not a missing piece.
- **Web search** (item 3 above) — same note.

### Carried forward from the phase-108 queue

7. **Megumin Suite — Story Config + Blocks.** Story Config dropdowns (genre,
   POV, friction, pace → scene prompt options) and the Blocks (tracker cards
   under a reply).

8. **Multihog** — the RPG engine. State Tracker first, then the RNG, then
   World Progression and Map Evolution.

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
