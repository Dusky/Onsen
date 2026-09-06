# Handoff — the rules that outlived the bootstrap

This document used to be instructions for starting an app that did not exist:
read these sections, propose these migrations, build phase 1 and stop. Sixty
phases later that half is spent, and it has been rewritten down to the part
that is still load-bearing — the invariants, the conventions, and the tests
that measure them. The history it used to carry lives in `PHASES.md`, which is
where a record belongs.

It is not the specification. `SPEC.md` is.

## The documents

| File | Authority |
| --- | --- |
| `SPEC.md` | Behaviour, architecture, data model, build order. The source of truth. |
| `design/DESIGN.md` | Layout and visual system. |
| `HANDOFF.md` | This file. Invariants, conventions, guards. |
| `PHASES.md` | The per-phase record: what was built, deferred, and what surprised. |
| `GAPS.md` | What the incumbent does that this does not, measured against a real install. Every row carries the command that proves it. Not authority — evidence. |

**Precedence.** `SPEC.md` wins on behaviour and data. `DESIGN.md` wins on layout
and appearance. If they conflict on something substantive — a screen implies a
feature the spec doesn't have, or contradicts a data model decision — stop and
ask. Do not reconcile them silently.

**And a document can be wrong.** Phase 55 found six phases built against one
sentence in `DESIGN.md` that came out of a design session, was never briefed,
and was wrong about the audience. The precedence table made it binding; nobody
had checked whether it was true. When the authority is the problem, the repair
is to rewrite the authority and record the reversal — not to override it screen
by screen, which leaves the next reader deriving the same mistake.

## How to work

**One phase at a time.** `SPEC.md` §20 is an ordered build plan. Build the
current phase, make it work, then stop. Do not scaffold future phases. The
order exists because later phases depend on earlier ones being correct, not
merely present.

**Read before writing.** Read the spec sections a phase touches. §0
(principles), §2 (data model) and §3 (prompt builder) are relevant to almost
everything. Work from the spec, not from this file's summary of it.

**Ask rather than invent.** If the spec doesn't cover something, ask. §21
non-goals and §22 anti-patterns exist because several obvious-seeming additions
are deliberately excluded.

**Keep the spec current.** When a decision gets made during implementation,
update `SPEC.md` in the same commit. The spec should describe what was built.

## Non-negotiables

These are load-bearing. Violating one is not a style disagreement, it's a
defect. Each one names the test that measures it, and
`test/invariants.test.ts` reads this list back: a rule added here without a
guard fails the suite.

1. **The author persona is the identity in the system prompt.** Characters are
   roles it plays. Never restructure toward "each character is an independent
   agent" — that architecture is explicitly rejected in §0.2 and §22.
   *Guarded by `test/prompt-builder.test.ts` — "puts the author in the system
   prompt, not a character".*
2. **The author never writes the user's character.** Enforced in the system
   prompt and restated at depth 0. (§0.5)
   *Guarded by `test/prompt-builder.test.ts` — the user-lock is asserted twice,
   and a preset that reorders the blocks cannot drop it.*
3. **Message history is a tree.** Never an array. (§0.3)
   *Guarded by `test/history-tree.test.ts`.*
4. **The prompt prefix stays stable across turns.** Do not swap the system
   prompt per speaker; it destroys prompt caching. (§0.6)
   *Guarded by `test/prompt-builder.test.ts` — "keeps the prefix identical when
   the spotlight is the only thing that changes".*
5. **The prompt builder is pure.** No I/O, no database, no HTTP. It takes a
   `PromptContext` and returns a `BuiltPrompt`. This is what makes it testable,
   and it is the most important module in the codebase. (§3)
   *Guarded by `test/prompt-purity.test.ts`, structurally — banned imports,
   banned globals, and the same context building the same prompt byte for byte.*
6. **The server owns generation.** The client never calls an inference backend.
   Streams must be resumable by offset. (§0.7, §5)
   *Guarded by `test/invariants.test.ts` — every `fetch` in client source
   targets this app's own `/api` — and `test/generation.test.ts` for the
   offset.*
7. **No native modules.** `bun install` must work with no compile step. If a
   dependency needs node-gyp, find another one or raise it.
   *Guarded by `test/invariants.test.ts` — no installed package has an install
   hook or a `binding.gyp`, and nothing in the runtime dependency closure is a
   native binary.*
8. **No browser storage APIs.** No localStorage, no sessionStorage. Server
   state in SQLite, UI state in memory.
   *Guarded by `test/invariants.test.ts`, on comment-stripped client source.*
9. **Extensions and background tasks never see provider credentials**, and
   never block a user-facing generation. (§7, §15)
   *Guarded by `test/invariants.test.ts` — the script runtime, the pack
   installer and the webhook sender reach no key store, and no pack kind is a
   provider — and `test/crypto.test.ts` for storage and masking.*
10. **Abort must propagate upstream.** Cancelling a generation has to actually
    stop inference, especially on llama.cpp. (§4)
    *Guarded by `test/generation.test.ts` — "aborts upstream and keeps what was
    already written".*

## The guards

A guard is a test that measures the whole tree rather than one case, because
the defect it looks for is a distribution: it holds on every file you inspect
and fails across the set. They are the reason this project can be handed over
at all, and they are cheap to extend — most of them are a directory walk and a
regular expression.

| Test | What it defends |
| --- | --- |
| `test/invariants.test.ts` | The ten rules above, and this document's claim to have guarded them. |
| `test/prompt-purity.test.ts` | The builder's purity and determinism. |
| `test/dead-columns.test.ts` | Every column of a migrated database is read by something. |
| `test/migrations.test.ts` | Every `.sql` on disk is listed in `migrations/index.ts`. |
| `test/reachable.test.ts` | Every route is reachable from the client. |
| `test/reachable-fields.test.ts` | Every field an editor writes is a field it also reads. |
| `test/density.test.ts` | §16 §Density: prose scales, rows tighten, controls live in the row. |
| `test/prompt-blocks.test.ts` | A preset's block order survives the whole path into a built prompt. |
| `test/surfaces.test.ts` | Elevation and contrast across every screen. |
| `test/typography.test.ts` | One type ramp, used everywhere. |
| `test/voice.test.ts` | The app does not explain itself in labels. |
| `test/empty-states.test.ts` | Every empty screen offers the thing it is empty of. |
| `test/adapter-tools-conformance.test.ts` | Every adapter answers tool calls the same shape. |
| `test/pwa.test.ts` | The service worker caches the shell and never `/api`. |

**Two rules for writing one.** It must not cry wolf: a guard that fails on a
live, correct usage gets switched off within a week, so prefer under-reporting
to a false alarm, and say in the file which cases it deliberately misses. And
it must run on comment-stripped source when it greps for a banned name —
otherwise the comment explaining the fix reads as the defect, and the rule
becomes impossible to write about. Both lessons cost a phase each.

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

**Types.** TypeScript strict. Shared types live in `/shared` and are the
contract between client and server. Prefer discriminated unions for the message
and segment kinds; the spec's enums are meant to be exhaustively switched on.

**Database.** Plain numbered SQL migrations applied at boot. `bun:sqlite`, WAL
mode, `busy_timeout` set, `strict: true`. Integer PKs internally, ULIDs
externally. Every `.sql` under `/db/migrations` must be imported and listed in
`migrations/index.ts` — a migration that exists on disk but never runs is a
silent, expensive divergence.

A test that exercises a real path opens the database the way the app does, via
`openDatabase`. A bare `new Database(":memory:")` misses `strict: true`, and
under bun:sqlite's loose mode a bound parameter can silently arrive as null:
phase 56 spent an hour on migrations failing a NOT NULL check with a valid
string in hand.

**Storage nothing reads is a defect, and it is measured (phase 58).**
`test/dead-columns.test.ts` sweeps every column of a migrated database and
fails on two shapes: a column mentioned nowhere outside its own migration, and
a column written but never read. Four phases running had each found one by
accident — `presets.is_default`, `messages.generation_meta`,
`presets.prompt_order`, `personas.avatar_path` — the oldest dating to migration
0001, and every one of them was a feature the app already paid for and could
not use. Adding a column means adding the read in the same phase, or an entry
in that test's `DELIBERATE` map saying why not.

The check matches on column *name* rather than `table.column`, because that is
what a text search can honestly do: `avatar_path` is on two tables and one
table's use hides the other's. It under-reports on shared names deliberately.

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
tests are mandatory rather than nice to have. Write them as you build the
module, not afterward.

**Browsers.** A phase is not verified until it has been driven in one, at
390×844 and 1440×900, in both themes, switched through the app's own picker. A
phone context needs `hasTouch: true` — `@media (pointer: fine)` matches a
narrow desktop window, so a phone-sized viewport alone proves nothing about the
touch path. And read state from the app's own instrumentation rather than from
a substring search of the transcript: three phases running drew a wrong
conclusion from text that appeared in two places.

**Commits.** Small, one logical change each, with a message that says what
changed and why. Reference the spec section when implementing one.

## Phase completion

A phase is done when: it works end to end, its tests pass, nothing from a later
phase was built, and the spec still describes what exists. Say what you built,
what you deferred, and what surprised you. Then wait.

## Things to avoid

Specific failure modes for this project. The ones the non-negotiables already
cover are not repeated here; these are the ones with judgement in them.

- **Skipping the `raw_card` preservation** on character import because parsing
  into fields seems cleaner. Lossy import is the top complaint about every other
  frontend, and `NormalisedCard` is deliberately not the app's own DTO — an
  app-local flag added to it is a card that no longer round-trips.
- **Letting a background task's failure surface as a generation failure.**
- **Adding a "quick" second inference path** that bypasses the generation
  service. There is one path.
- **Building the client one notch shallower than the server.** This is the
  defect this codebase has had most often, by a wide margin: the query, the
  column and the route exist, and nothing on screen can reach them. `GAPS.md`
  and the reachability guards exist because of it.
- **Improving the architecture.** The unusual decisions in §0 are deliberate and
  researched. If one seems wrong, say so and explain why — but don't route
  around it.
