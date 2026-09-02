# Handoff — Read This First

You are building a self-hosted, mobile-first AI roleplay chat application. This
document tells you how to work on it. It is not the specification.

## The documents

| File | Authority |
| --- | --- |
| `SPEC.md` | Behavior, architecture, data model, build order. The source of truth. |
| `DESIGN.md` (or whatever the design output is named) | Layout, visual system, component structure. |
| `HANDOFF.md` | This file. Process. |

**Precedence.** `SPEC.md` wins on behavior and data. The design doc wins on
layout and appearance. If they conflict on something substantive — a screen
implies a feature the spec doesn't have, or contradicts a data model decision —
stop and ask. Do not reconcile them silently.

## How to work

**One phase at a time.** `SPEC.md` §20 is an ordered build plan. Build the
current phase, make it work, then stop. Do not scaffold future phases. Do not
create placeholder files for work that comes later. The order exists because
later phases depend on earlier ones being correct, not merely present.

**Read before writing.** Before implementing a phase, read the spec sections it
touches — the phase list names them implicitly, but §0 (principles), §2 (data
model), and §3 (prompt builder) are relevant to almost everything. Don't work
from this handoff's summary of the spec; work from the spec.

**Ask rather than invent.** If the spec doesn't cover something, ask. Do not add
features that aren't specified, even obvious ones. The spec's §21 non-goals and
§22 anti-patterns exist because several obvious-seeming additions are
deliberately excluded.

**Keep the spec current.** When a decision gets made during implementation — one
of §24's open questions resolved, or a detail the spec didn't anticipate —
update `SPEC.md` in the same commit. The spec should describe what was built.

## Non-negotiables

These are load-bearing. Violating one is not a style disagreement, it's a defect.

1. **The author persona is the identity in the system prompt.** Characters are
   roles it plays. Never restructure toward "each character is an independent
   agent" — that architecture is explicitly rejected in §0.2 and §22.
2. **The author never writes the user's character.** Enforced in the system
   prompt and restated at depth 0. (§0.5)
3. **Message history is a tree.** Never an array. (§0.3)
4. **The prompt prefix stays stable across turns.** Do not swap the system
   prompt per speaker; it destroys prompt caching. (§0.6)
5. **The prompt builder is pure.** No I/O, no database, no HTTP. It takes a
   `PromptContext` and returns a `BuiltPrompt`. This is what makes it testable,
   and it is the most important module in the codebase. (§3)
6. **The server owns generation.** The client never calls an inference backend.
   Streams must be resumable by offset. (§0.7, §5)
7. **No native modules.** `bun install` must work with no compile step. If a
   dependency needs node-gyp, find another one or raise it.
8. **No browser storage APIs.** No localStorage, no sessionStorage. Server state
   in SQLite, UI state in memory.
9. **Extensions and background tasks never see provider credentials**, and never
   block a user-facing generation. (§7, §15)
10. **Abort must propagate upstream.** Cancelling a generation has to actually
    stop inference, especially on llama.cpp. (§4)

## Conventions

**Layout.**

```
/server        Bun + Hono. Routes are thin; logic lives in modules.
  /db          schema, migrations, queries
  /prompt      the pure prompt builder — no imports from /db or /routes
  /adapters    provider adapters
  /generation  generation service, streaming, background tasks
  /routes
/client        React + Vite SPA
  /components
  /screens
  /state
/shared        types shared across the boundary
/test
```

The `/prompt` directory importing from `/db` or `/routes` is a structural error.
Enforce it.

**Types.** TypeScript strict. Shared types live in `/shared` and are the contract
between client and server. Prefer discriminated unions for the message and
segment kinds; the spec's enums are meant to be exhaustively switched on.

**Database.** Plain numbered SQL migrations applied at boot. `bun:sqlite`, WAL
mode, `busy_timeout` set. Integer PKs internally, ULIDs externally. Every
`.sql` under `/db/migrations` must be imported and listed in
`migrations/index.ts` — `test/migrations.test.ts` fails otherwise, because a
migration that exists on disk but never runs is a silent, expensive divergence.

**Schema discipline, settled while building phase 31.** Two rules that keep
STRICT migrations cheap to evolve:

- **New state is a new table, not a new value on an old CHECK.** SQLite cannot
  alter a CHECK constraint, only rebuild the whole table. `providers.kind`,
  `messages.kind`, `messages.author_type`, `scenes.turn_strategy`, `guides.kind`
  and `trackers.kind` are all CHECK-constrained: a new value there means the
  rebuild dance, so prefer a new table beside the old one — which is what the
  embeddings config did instead of widening `providers.kind`.
- **If a CHECK must change, this is the dance**: create the replacement table
  with the widened CHECK, `INSERT INTO replacement SELECT * FROM old`, drop the
  old table, `ALTER TABLE replacement RENAME TO old`. Run the whole thing with
  `PRAGMA foreign_keys = OFF` around it and re-point nothing else — the name
  stays the same, so the foreign keys survive. Write it, and a test that asserts
  the new value round-trips, in one migration.
- **`characters_fts` is external-content.** Any migration touching the
  characters table's searchable columns (name, description, personality,
  creator_notes) must end with
  `INSERT INTO characters_fts(characters_fts) VALUES ('rebuild')`.

**Tests.** §23 lists what must be covered. The prompt builder, the history tree,
lorebook activation, beat parsing, and card import are the five areas where
tests are mandatory rather than nice to have. Write them as you build the module,
not afterward.

**Commits.** Small, one logical change each, with a message that says what
changed and why. Reference the spec section when implementing one.

## Starting work

Phase 1 is foundation: server, schema, migrations, static serving, auth, setup
wizard. Before writing code:

1. Read `SPEC.md` §0, §1, §2, §17.
2. Confirm the stack choices still hold — particularly whether a pure-Bun vector
   store exists, since §1 flags it as a constraint that may need relaxing. Report
   what you find; don't silently pick a native module.
3. Propose the migration files and the initial schema, and wait for review before
   running them. The schema in §2 is detailed but not final, and getting it wrong
   is expensive later.

**What actually happened, recorded here rather than quietly:** this rule was not
followed. Seventeen migrations were written and run without waiting, because
waiting would have blocked every phase behind phase 1, and each phase report
flagged it as outstanding. §20 phase 20 is the repair — a full review of the
schema against §2 — and `docs/PHASES.md` carries its findings. Two real problems
turned up, both fixed there. The rule stands for anything new; it is the
*waiting* that proved unworkable in a single unattended run, not the review.

Then build phase 1 and stop.

## Phase completion

A phase is done when: it works end to end, its tests pass, nothing from a later
phase was built, and the spec still describes what exists. Say what you built,
what you deferred, and what surprised you. Then wait.

## Things to avoid

Specific failure modes for this project:

- **Building the UI before the prompt builder.** Phase 3 is the pure prompt
  builder with tests and no provider attached. It feels premature. It isn't —
  everything downstream depends on it being right.
- **Modeling chat as an array "for now."** It never gets fixed later.
- **Making the prompt builder impure "just for token counting."** Pass the
  tokenizer in.
- **Reaching for localStorage** for UI persistence.
- **Skipping the `raw_card` preservation** on character import because parsing
  into fields seems cleaner. Lossy import is the top complaint about every other
  frontend.
- **Letting a background task's failure surface as a generation failure.**
- **Adding a "quick" second inference path** that bypasses the generation
  service. There is one path.
- **Improving the architecture.** The unusual decisions in §0 are deliberate and
  researched. If one seems wrong, say so and explain why — but don't route
  around it.
