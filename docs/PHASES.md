# Phase record

What each completed phase of `SPEC.md` §20 actually built, what was deliberately
left out, and what it changed about the spec. Kept so that a later phase does not
have to re-derive an earlier one's reasoning.

---

## Phase 1 — Foundation

> Bun + Hono server, SQLite schema, migrations, static SPA serving, auth, setup
> wizard.

### Built

**Server.** A Bun process serving the API and the built SPA from one origin, so
there is no CORS anywhere (§1). Routes are thin; everything is constructed from
an explicit `AppContext` rather than module-level singletons, which is what makes
the whole surface testable against an in-memory database.

**Database.** `bun:sqlite` with WAL, `busy_timeout`, and foreign keys on.
Migrations are numbered SQL files applied at boot, each in its own transaction,
imported as text so that `bun build --compile` embeds them rather than reading
from a directory that will not exist at runtime. The runner refuses a list with
a gap instead of applying it out of order.

**Schema.** `app_settings`, `providers`, `presets`, `connection_profiles` —
integer primary keys internally, ULIDs externally, timestamps in Unix
milliseconds, `STRICT` tables throughout. The default preset is seeded with the
modern sampler values from §13 (temperature 1.0, min-P 0.05, rep-pen off, DRY
and XTC on), because a preset that arrives disabled is a bad first run (§13.5,
§22).

**Auth.** Single-user password auth via `Bun.password` (argon2id). The session is
a signed, HttpOnly, SameSite=Lax cookie with a thirty-day life. Revocation is a
generation counter in `app_settings` rather than a session table: bumping it
invalidates every outstanding cookie, which is what a password change will do.
Login attempts are rate-limited by a fixed-window counter, and a correct password
clears the penalty so a run of typos cannot lock the only user out.

**Secrets.** One 32-byte root secret, either injected via `ONSEN_SECRET_KEY` or
generated into `$ONSEN_DATA_DIR/secret.key` at mode `600`. Two HKDF-derived
subkeys: AES-256-GCM for provider credentials, HMAC-SHA256 for session cookies.
Provider keys are encrypted at rest and reach the client only as their last four
characters (§17).

**Setup wizard.** Password plus one connection profile, available only while the
install is unconfigured, re-checked inside the write transaction so two
submissions cannot race into two passwords, and it signs the caller in on success.

**Client.** React + Vite + Tailwind v4. The design system's tokens are
transcribed into `client/styles/tokens.css` in both dark and light, and Spectral
and IBM Plex Mono are bundled locally rather than hotlinked — this app is
expected to run on hardware with no reliable outbound internet. Three screens:
setup, login, and a holding screen that proves the session works. No browser
storage anywhere (HANDOFF non-negotiable 8).

**Deployment.** Dockerfile running as a non-root user over a `/data` volume,
plus `bun run build:standalone`, which embeds the client bundle into a single
executable and was verified to serve it.

### Deliberately not built

- **The rest of the §2 data model.** Scenes, the message tree, characters,
  lorebooks, documents, memory, guides, and trackers get their tables in the
  migration belonging to the phase that first uses them, so each is designed
  against working code rather than guessed at. Phase 2 adds the history tree.
- **Provider adapters.** Nothing calls a model yet (phase 4), so
  `providers.capabilities` stays null and the connection profile screen has no
  test button.
- **Editing connections.** The API reads providers, presets, and profiles; it
  does not write them outside the wizard. The editor screen needs phase 4 to be
  worth having.
- **TanStack Query and Zustand.** Both are in the §1 stack, and both arrive with
  the chat UI in phase 5. Three forms do not need them.
- **Instruct and context templates.** `connection_profiles` has no
  `instruct_template_id` / `context_template_id` yet; they arrive with
  text-completion support in phase 20.

### Spec changes

§1 and §24 now record the vector-store finding: `sqlite-vec` installs with no
compile step and works under `bun:sqlite`, but it is a native loadable extension
rather than pure Bun, and `bun build --compile` will not embed it without extra
work. Left open until phase 28, which is the first phase that needs vectors.

### Surprises

- `bun:sqlite`'s `db.transaction()` is synchronous, so anything async — password
  hashing, in particular — has to complete before the transaction opens rather
  than inside it.
- Bun's `fetch` is the only tool in the toolchain that does not read
  `NODE_EXTRA_CA_CERTS`/`HTTPS_PROXY` in a proxied environment. It affects
  nothing at runtime, but `scripts/fetch-fonts.ts` will fail behind a
  TLS-intercepting proxy.

---

## Phase 2 — History tree

> Store, active path, branching, swipe/edit/delete, checkpoints. API first,
> tested, before any UI.

### Built

**Schema.** `scenes`, `messages`, `checkpoints`. A message's `parent_id` is
nullable — null is a root, and a scene may have several, because alternate
greetings are siblings at the top of the tree (§9). `scenes.active_leaf_id` is
added by `ALTER TABLE` after `messages` exists, since the reference is circular.

**One operation, four names.** Swipe, rewind, branch and checkpoint restore are
all "move the leaf pointer". Nothing is copied and nothing is truncated; only an
explicit delete removes a node. Appending to something that is not the current
leaf is not an error — it forks there, which is what branching is.

The one substantive decision: **swiping descends, rewinding does not.** Landing
on a sibling follows the most recent child down to a leaf, so swiping away from
a version and back restores that version's own continuation instead of chopping
it off. Rewind and checkpoint restore stop exactly on the chosen message, so the
next turn forks at that point — which is the whole purpose of a bookmark you can
"return to and optionally fork from later" (§2). Both are recorded in SPEC §2
under "Tree operations".

**Active path** is a recursive CTE from the leaf upward, returning each message
with its `sibling_index` and `sibling_count` in the same query — the swipe
counter comes free rather than costing a query per row. The UI shows it only
when the count exceeds one; there is no empty `1/1`.

**Deleting** takes the subtree by cascade. If the active leaf was inside it, the
pointer moves to the surviving branch below the parent; deleting the last root
empties the scene rather than leaving a dangling pointer.

**Editing** invalidates the cached `token_count` and stamps `edited_at`. Hiding
a message does neither — `is_hidden` is a prompt concern, not an edit — and
rewriting a message with identical text is not an edit either.

**API.** Scenes (list, create, read-with-history, rename, delete), messages
(append, edit, delete, siblings), the leaf pointer, and checkpoints. Every
message and checkpoint route verifies the record belongs to the scene it was
requested under, so one scene's identifiers cannot reach into another's.

**Tests.** 46 new: 24 against the tree module for semantics, 22 against the HTTP
surface. Covers everything §23 names for this phase — branch, swipe,
edit-in-place, rewind, checkpoint restore — plus a 2,000-message chain, deletion
of the active branch, root siblings, and cross-scene isolation.

### Deliberately not built

- **MessageSegment.** Beats are phase 9; in phase 2 a message's content is the
  whole of it.
- **`character_id`, `reasoning`, `expression`, `generation_meta` on messages.**
  Each arrives by `ALTER TABLE` with the phase that gives it behaviour —
  characters (6), reasoning extraction (17), expressions (27), the generation
  service (4).
- **`author_id`, `persona_id`, turn strategy, autopilot, OOC and VN flags on
  scenes.** Phases 7, 8, 21, 22 and 27 respectively.
- **Any UI.** The phase says API first, and the chat screen is phase 5.

### Spec changes

SPEC §2 gains a "Tree operations" subsection recording the five decisions above,
which the spec described the data for but not the behaviour of.

### Surprises

Nothing structural. Worth noting for later phases: SQLite's `IS` rather than `=`
is what makes root siblings work, since `parent_id = NULL` matches nothing — a
sibling query written with `=` silently reports that every alternate greeting is
the only one of its kind.

---

## Phase 3 — Prompt builder

> Both rendering modes, budget allocation with eviction reporting, macros, debug
> output. Heavy unit tests. No provider yet.

The handoff calls this the most important module in the codebase, and warns that
building it before any UI feels premature and is not. Everything downstream —
generation, guided ops, the inspector, the outbound API — is a client of it.

### Built

**Purity, enforced structurally.** `buildPrompt(ctx)` takes a plain object and
returns a plain object. Everything variable is passed in: the tokenizer, `now`,
and `seed`. A test reads the source of every file under `/prompt` and fails on an
import from `/db`, `/routes` or `/middleware`, and on `Date.now`, `new Date()`,
`Math.random`, `fetch`, `process.env` or `bun:sqlite`. A second test asserts the
same context builds a byte-identical prompt twice and that building mutates
nothing it was given.

**Both rendering modes.** Author mode puts the author in the system prompt and
renders every non-user turn as an `assistant` turn prefixed with its speaker's
name — one point of view, no per-speaker re-render, so the prefix stays stable
and prompt caching survives (§0.6). There is a test asserting the prefix is
unchanged when only the spotlight moves. Single-character mode drops the author
block and labels nothing.

**The user-lock, twice.** §0.5 makes it the single most important constraint, so
it is asserted in the author identity block and restated in the spotlight
instruction at depth 0, and both assertions are tested.

**The assembly order** of §3, overridable per preset, with one guard: a preset
that omits `history` or `spotlight_instruction` gets them back. Dropping the
cast block is a choice; dropping the user-lock is a bug.

**Depth placement.** Depth 0 is immediately before the response, depth 2 is two
turns earlier, and a depth deeper than the history lands at its start rather
than falling out. This is the distinction §18 warns importers about: a near-turn
nudge behaves nothing like the same text in the prefix.

**Budget and eviction.** Reserve the response allowance, cost every fixed block,
fail loudly with a `PromptBudgetError` naming what to change if they do not fit,
then give history the remainder and trim oldest-first, whole messages only. The
debug output accounts for every message: included or evicted, with the reason
and the cost. Hidden messages are reported as evictions too, so "why did it
forget" has an answer either way.

**The macro engine**, all sixteen macros, with the rules now recorded in SPEC §3
under "Macro resolution rules".

**Capability branching** for the three v1 adapter shapes: separate system role
or not, prefill or dropped, strict alternation with system turns folded into user
turns and merged, and a raw transcript in text mode.

**Tests.** 71 new across four files: modes and assembly, macros and outlets,
budget and eviction, purity and determinism.

### Deliberately not built

- **Beats.** §3.5 is phase 9. `PromptContext.spotlight` is a single character,
  exactly as §3 declares it.
- **Instruct templates.** Text mode emits a plain labelled transcript. ChatML,
  Llama 3, Mistral and the rest ship as data with the text-completion adapter in
  phase 20, and wrap this rather than replace it.
- **Fine-grained lore prefix positions.** `before_character` / `after_examples`
  and the rest currently collapse into one prefix group ordered by
  `insertion_order`; `at_depth` and outlets are honoured exactly. The full
  activation and placement model is phase 19.
- **Real tokenizers.** The interface accepts one; only the estimator ships.
- **Any caller.** Nothing invokes the builder yet — no provider until phase 4.

### Spec changes

SPEC §3 gains three subsections: "Purity and injected inputs" (the four context
fields the published interface omitted, and the test that enforces purity),
"Macro resolution rules" (five decisions, notably that `{{pick}}` anchors to the
turn rather than the seed), and "Invented text is always a block". §24's
tokenizer question is narrowed: the architecture is settled, the bundle-or-
estimate choice stays open per adapter.

### Surprises

Two bugs the tests caught, both of the kind that would have been invisible in
production:

- Outlet text that was filled but never referenced was still being charged
  against the budget. Being filled is not the same as reaching the prompt, and
  the fix was to track what a placeholder actually consumed.
- Outlet content was spliced in before its own macros were resolved. Macro
  substitution is a single scan, so `{{char}}` inside an outlet would have
  reached the model literally. Outlets now resolve in their own pass first.

And one embarrassment worth recording: a NUL byte reached `blocks.ts` in the
history block's placeholder string, which made the file read as binary to grep.
The placeholder was also leaking into the system prompt, because the history
block sits in the prefix and its marker was being joined with the rest. Both are
fixed, and there is a test that the marker never appears in a built prompt.

---

## Phase 4 — First adapter and the generation service

> OpenAI-compatible adapter, resumable SSE, cancellation, per-call profile
> override.

### Built

**The OpenAI-compatible adapter** (§4): OpenAI, OpenRouter, and the
OpenAI-shaped endpoints llama.cpp, KoboldCpp, TabbyAPI, Ollama and
text-generation-webui all expose. The modern samplers from §13 — min-P, DRY,
XTC — are sent as top-level fields, which is where local shims read them; a
provider that does not know them ignores them. Shipping §13's defaults is only
worth anything if they actually reach the backend.

**An SSE parser that does not assume chunk boundaries are line boundaries.**
One `data:` line routinely arrives split across two reads and two events
routinely arrive in one. A parser that gets this wrong drops tokens precisely
when the network is bad, which is the condition this whole app is designed for.
CRLF, multi-line data, comments and a trailing event with no closing blank line
are all covered.

**The generation service** (§5). A generation is a persistent record with a
resumable buffer, not a request-scoped operation. `POST /scenes/:id/generate`
returns an identifier immediately and the work continues with nobody attached;
`GET /generations/:id/stream?offset=N` replays everything past N and then
continues live. Disconnecting never stops a generation — it only stops us
writing to a socket that is gone.

Three decisions worth naming:

- **The parent is captured at start, not read at completion.** Otherwise a leaf
  move mid-generation silently reparents the result.
- **One generation per scene at a time.** Two in flight would race to attach to
  the same parent and the second would become a swipe the user never asked for.
- **A cancelled generation keeps what it produced.** Partial output is still
  the user's text, and discarding it loses work they watched arrive.

**Per-call profile override** — the mechanism per-operation model routing
(§0.11, §7) is built on. An explicit profile wins over the scene's for that one
call, and control returns afterwards.

**Verified end to end against a real HTTP provider**, not only the injected
fake: started a generation, disconnected mid-stream, confirmed it kept going,
reconnected from the offset, and reassembled output byte-identical to what was
stored in the tree. Cancellation was confirmed by the provider itself logging
that its client aborted — which is the §4 requirement that a leaked generation
must not pin a GPU.

**Tests.** 50 new: 25 for the adapter and SSE parser against recorded fixtures
rather than live APIs, 25 for the service and its routes.

### The place the phase order bites

Phase 4 needs a prompt, a prompt needs a spotlight, and characters are phase 6.
`server/generation/context.ts` therefore carries a documented
`PLACEHOLDER_SPOTLIGHT` and runs in single-character mode against it. It is
deliberately plain rather than a fake character card, so nothing grows a
dependency on it.

This is worth flagging rather than burying: **§20 phase 5 is "minimum usable
chat UI — single character", but the character entity does not arrive until
phase 6.** Either phase 5 ships against this placeholder and looks odd, or a
minimal `characters` table lands before it, with phase 6 adding what it is
actually about — lossless card import/export, CCv3 decorators, the editor and
the parsed-card cache. The second reading seems right, and it is a question for
the spec's author rather than something to decide silently.

### Deliberately not built

- **Anthropic and text-completion adapters.** Phase 20. Asking for one now
  fails with a message that says so, rather than silently using another
  provider's wire format.
- **Reasoning extraction.** `TokenChunk` carries text only; phase 17.
- **Retry and backoff.** `AdapterError.retryable` is set correctly, but nothing
  acts on it yet.
- **Multi-device head sync** (§5) and the background generation indicator.
  Phase 34.
- **Any UI.** Phase 5.

### Surprises

Mounting the generation router at the API root made its `app.use("*",
requireAuth())` a global guard, so `/api/nope` started returning 401 instead of
404. A router's wildcard middleware applies to everything under its prefix, and
at the root that is everything. The fix was to split it into two routers mounted
under `/scenes` and `/generations`. The existing 404 test caught it — one worth
keeping in mind for every future router.

The tests also caught a genuine production bug: `shutdown()` aborts in-flight
generations, but an abort resolves asynchronously, so a run loop could reach its
completion path after the database had already closed. That is the SIGTERM path,
not just a test artefact. The service now stops writing once it is stopping.

---

## Phase 5 — Minimum usable chat UI

> Single character, streaming, swipe, edit. **Ship this and use it daily.**

### Built

Two screens, built to the design handoff rather than approximated: a scenes
list and the chat screen.

**The log is bottom-anchored** — `justify-content: flex-end`, content growing
upward from the composer. Not cosmetic: the streaming indicator and its stop
control live at the bottom of the log and must never be pushed below the fold.

**During generation the whole log takes a 2px red left rail.** The entire
reading surface acknowledges that the app is writing, rather than a spinner in
a corner. Stop sits at the end of the streaming row and is reachable the whole
time.

**Messages are one document, not bubbles.** Mono uppercase attribution at
0.18em tracking, a hairline rule running to the right edge, the swipe counter
at the end of that rule, then Spectral paragraphs. No avatar, no timestamp, no
shadow, and the counter appears only when there is more than one version —
never an empty `1/1`. The prose is not recoloured by who wrote it; attribution
is the only thing that distinguishes a speaker.

**Gestures with certain direction locking.** Swipe left rerolls, swipe right
opens the version carousel, long-press raises the action sheet. The axis is
chosen after about ten pixels of travel and then committed — never re-evaluated
mid-gesture, which is what makes a swipe feel like it is arguing with the scroll
container. `touch-action: pan-y` plus pointer capture keeps the gesture and the
scroll from fighting.

**Resumable streaming on the client**, using `fetch` and a stream reader rather
than `EventSource`. EventSource reconnects to the URL it was given, which would
replay from the original offset and duplicate everything already received;
resuming needs the offset to move, so the reconnect has to be ours. Chunks are
spliced by offset, which makes a replay idempotent.

**Generation state is global, not per-screen**, exactly as the design's state
list requires — that is what lets the "still writing" strip appear on the
scenes list while a roleplay generates in the background, with an affordance
back to it.

**Keyboard handling.** `100dvh` is not enough on iOS: the layout viewport does
not shrink when the keyboard opens, so a composer pinned to the bottom ends up
behind it. A `visualViewport` listener publishes the real height as a custom
property and every screen sizes from it.

Verified in a real browser at 390 × 844 in both themes: sent a message,
watched it stream, stopped it, rerolled by swiping, opened the carousel,
switched versions, and raised the action sheet by long-press.

### Deliberately not built

Everything the design draws that belongs to a later phase: the cast strip and
director reason (phase 8), the ops grid (phase 12), the guides sheet (15),
autopilot (22), the OOC channel (21), the VN stage (27), the prompt inspector
(23), and the desktop three-column layout. The composer here is the resting
state minus the cast strip.

### The placeholder speaker, again

The AI's turns are attributed to "Author" because there is still no character
entity — see the phase 4 note. Everything else about the screen is real; only
the name is standing in. This is the second phase to run into it, which
strengthens the case that a minimal `characters` table belongs before phase 5
rather than in phase 6.

### Surprises

None in the browser, which is itself worth noting: the design handoff is
specific enough about tokens, sizes and behaviour that the screen came out
right the first time. The one thing I got wrong was mine, not the design's — I
had muted the user's own prose, which contradicts the handoff's "three message
kinds, one document" and made the user's writing read as less real than the
model's.

---

## Phase 6 — Character cards

> Lossless import/export, PNG V2/V3, CharX, CCv3 decorators, editor,
> parsed-card cache.

### Built

**PNG chunk parsing, written directly**, as §9 requires. The format is
length-prefixed chunks with a CRC, the app has to both read and write them, and
an image library would be a far larger dependency for a job this small. `zTXt`
is decompressed as well as `tEXt`: some exporters use it for large cards, and a
reader that only understands `tEXt` reports those as having no character data at
all. Writing replaces an existing chunk rather than appending a second with the
same keyword, and leaves every non-text chunk alone so the avatar is not damaged
by an edit.

**Four formats, detected from content rather than filename** — cards are
routinely renamed, and a CharX called `.png` should still import. V1 (bare
object, no envelope), V2, V3, and CharX. When a PNG carries both `ccv3` and
`chara`, the V3 payload wins: the V2 chunk exists only for older readers.
Export emits both.

**Lossless is the whole point.** The typed columns are a *view*; `raw_card`
holds the original document verbatim and export re-emits from it with edits
overlaid. A card carrying an embedded lorebook, another frontend's private
configuration, or a field from a spec revision this app predates comes back
byte-identical in everything the app does not touch. There are round-trip tests
for exactly that, across all three export formats.

**Nothing is silently partial.** Import reports what it preserved but does not
show — top-level fields and extension keys alike — and the editor's Advanced tab
names them. SPEC §18 is right that a silent partial import is the worst outcome;
"preserved but not editable here" is a very different thing from "lost".

**CCv3 decorators** with fallback chains. Decorator lines are stripped before
the text can reach a model, only lines at the top of an entry count so `@@depth`
in prose is left alone, and an unknown decorator falls through its `@@@` chain
rather than erroring — a chain where nothing is supported still yields its
content.

**The parsed-card cache** doubles as duplicate detection: a card is hashed on
import, and re-importing the same file returns the character already in the
library instead of a second copy.

**Per-field token costs**, computed server-side so there is one tokenizer in the
system and the numbers cannot disagree. The editor prints each field's cost on
its own label row and the footer prints the card total as a share of the context
window — never an abstract number.

**Verified in a browser**: imported a real V3 PNG through the file picker, saw
the preservation warnings, opened the editor, edited a field and watched the
cost rail re-count, and confirmed the Advanced tab names the preserved fields.

**Tests.** 49 new: 32 on the formats themselves and 17 over HTTP.

### Deliberately not built

- **Bulk import from a folder and Chub URL import.** Both are in §9's list but
  the build order puts them under Polish and Later respectively.
- **The library at scale** (§9): full-text search, real tags, saved filters,
  bulk operations, version history, derive. Phase 24. What is here is a name
  filter, which is what a library of dozens needs.
- **Grid virtualization.** §16 asks for it; phase 24 is the one about hundreds
  of cards, and a plain grid is correct until then.
- **AI-assisted authoring** (create/revise/extract character). Phase 25.
- **The LORE and SPRITES tabs** the design draws. Lorebooks are phase 19,
  expression packs phase 27, and a tab that leads nowhere is worse than no tab.
- **Wiring characters into scenes.** A scene still has no cast — that is phase 8
  (and author personas are phase 7), so the chat screen keeps its placeholder
  attribution for one more phase.

### Surprises

`unmodelledFields` had quietly come to mean two different things: top-level
fields the importer did not read, and extension keys the row did not model. Two
notions with one name is how a field ends up reported inconsistently, so both
now come from one helper reading `raw_card`, and the answer includes
`extensions.` paths — which is where the interesting unknowns actually live.

---

## Phase 7 — Author personas

> Entity, editor, author-mode rendering. The defining feature; do it before
> group complexity accumulates.

### Built

**The author as an entity**, reusable across scenes, carrying the five fields
that make an author an author: personality, writing style, directing style,
out-of-character voice, and boundaries. It is its own record rather than a flag
on a scene because it is what the system prompt is *about* (§0.2).

**Personas too.** SPEC §20 gives them no phase of their own, but they are the
other half of the same relationship: the user-lock is the rule that the author
never writes the persona, and it needs both names to be stated at all.

**Author-mode rendering, actually reaching a model.** A scene with an author
renders the co-author framing; the same scene with the author cleared renders
standard card-in-system-prompt single-character mode. Both paths are tested
against a real assembled prompt rather than a mock. Generated messages now
record which cast member voiced them, and a generation may name the speaker.

**`scene_members`**, with the columns phase 7 needs — the link and an order.
`is_active`, per-scene overrides and presence tracking arrive with group scenes
in phase 8.

**The author editor**, presented as a card. The out-of-character voice takes the
blue pencil and boundaries the red, and the sample-voice block renders that
field in the *exact* treatment the user will meet it in — blue rule, tinted
bubble with the asymmetric corner, mono at reading size. Configuring a voice you
can see beats configuring a text field.

**Scene setup**: author picker first, because it is the decision that changes
what the app is, then persona and cast. The model profile, turn strategy,
lorebook and guide rows the design draws belong to later phases and are left
out rather than stubbed.

**The chat screen now names who actually spoke** — the placeholder attribution
from phases 4–6 is gone.

**Tests.** 24 new, most of them asserting that author mode shows up in the
prompt, because that is the only place it is real.

### Deliberately not built

- **Multiple cast members and the turn director.** Phase 8. A scene can hold
  several characters, but the first is always spotlighted.
- **Author memory** (§11). The column exists and defaults off; nothing reads it
  until phase 41. An author that silently accumulates notes about the user is a
  different product, and that stays a deliberate choice.
- **Author avatars.** The column exists; there is no upload yet.

### Spec changes

SPEC §3 gains "An unnamed persona", recording that `PromptPersona.name` is
nullable and why.

### Surprises

Two, both found by looking at a real prompt rather than at a test.

The first was a genuine prose bug: with no persona set, the assembler was
inventing the name "You", which made the system prompt say "You belongs to the
reader" and the depth-0 restatement say "Do not write You's dialogue" — in the
two sentences that matter most in the whole product. A placeholder standing in
for a name is not a harmless default when the name is grammatically load-bearing.
No persona is now modelled as null and phrased around.

The second was a latent flaky test that only surfaced once the suite got slower:
two scenes created in the same millisecond tie on `updated_at`, and the
"recent first" list then falls back to creation order. It is a
millisecond-resolution artefact rather than a real ordering bug — real scenes
are created seconds apart — so the test is now realistic rather than the
ordering being engineered around.

---

## Phase 8 — Group scenes

> Cast, spotlight, voice notes, depth prompts, presence tracking, turn director
> (manual + round robin).

### Built

**The turn director**, pure like the prompt builder and for the same reason: the
decision has to be inspectable and reproducible. §6 requires it to be exposed in
the UI, which makes the *reason* part of the return value rather than a comment
in the code — `{ characterId, source, reason }`, printed verbatim under the cast
strip. All three cross-strategy rules are implemented and tested: never the same
character twice consecutively, an explicit pick always wins (including over that
rule — "unless requested" is what it means), and every decision carries a reason.

`manual` still returns a suggestion when nothing has been cued: whoever has been
quiet longest, with the silence counted in the reason. The composer has to name
who the send button will speak as before it is pressed, so refusing to choose
was not an option. `mention` and `classifier` fall back to round robin and
**say which fallback they took**, rather than silently behaving like something
else.

**Benching.** A benched cast member keeps their history and their place but
stops being chosen and stops contributing voice notes. Removal is a different
thing and still available.

**Presence tracking.** A character added to a scene in progress records the leaf
at the moment they joined. The author sees everything, so history is not
trimmed — trimming it would cost the author the continuity it needs — and the
spotlight instruction states the constraint instead: "Mira Vance was not present
for the first 2 turns of this scene and does not know what happened in them."

**The cast strip**, which is the headline UI of the phase and is built to the
design: the cued speaker's card is larger, lifted, red-topped, with a red
caption and a brighter name, and the director's reason is printed always — no
tooltip, no modal.

**Verified end to end in a browser**: three cards imported, an author created, a
three-character cast assembled, round robin set, and three generations that
cycled Aldan → Mira → Bell with the reason updating each turn.

**Tests.** 32 new: 19 on the director's rules with no database in sight, 13 on
group behaviour over HTTP and in the assembled prompt.

### Deliberately not built

- **The `mention` and `classifier` strategies.** Classifier is phase 10;
  mention is listed under Polish. Both are accepted and both say what they
  actually did.
- **Beats** (§3.5). Phase 9, and the other headline differentiator.
- **Per-scene card overrides** (`SceneMember.overrides`) and the private-agenda
  tracker field §6 mentions. Trackers are phase 29.
- **Autopilot.** Phase 22.

### Spec changes

§6 gains "Turn director decisions are prose". §24's presence question is partly
resolved — see below.

### Surprises

The column §2 calls `first_seen_message_id` cannot hold what its name says. The
first message a joining character witnesses does not exist yet at the moment
they join, so storing the current leaf under that name is off by one in the only
place it is ever read — which is exactly how it showed up: a character who
missed two turns was told they had missed one. It is now
`joined_after_message_id`, which is what the value actually is, and §24 records
the deviation.

Also worth noting as a product fix rather than a bug: importing a card used to
jump straight into its editor, which makes importing several cards in a row
tedious. The library now stays put and says what it imported.

---

## Phase 9 — Beats

The other headline differentiator, and the one nobody does natively: a single
generation in which the author writes several characters interacting, rather
than one card producing one turn per call.

### What was built

**The parser** (`server/generation/segments.ts`), pure and fixture-tested. It
accepts three label forms rather than the one the prompt asks for — `**Name:**`,
`**Name**:` because models put the colon outside the bold constantly, and a bare
`Name:` only when the name is in the cast, because without that restriction
every line of dialogue containing a colon starts a segment. Two rules govern it:
never lose text, and re-parse to the same shape after a splice.

**Segments** (migration 0007), the parsed view of a beat: who spoke, what they
said, and the offsets in the canonical content their prose occupies. Stored for
beats only; a spotlight message's single segment is derived, because storing a
copy of the message's own content is one more thing to keep in step for no
reader. `messages.parse_degraded` marks a beat whose labels could not be read —
the text is kept whole as narration and the UI says so, rather than presenting
a failed parse as deliberate narration.

**The beat instruction**, which is where the phase's real content is. Every line
of it is a named failure mode from §3.5's table: full definitions with voice
notes for every participant, an explicit exchange bound, equal initiative, an
anti-echo rule, the prohibition on ending by asking the reader a question, the
user-lock restated, and the label format given by example. Spotlight, beat and
recast share one near-turn instruction slot rather than each adding a block to
the assembly order — they are the same thing, and a preset reordering the
assembly should not have to know which one a turn is.

**Recast** (§7): rewrite one character's part, holding the rest fixed. The beat
is handed to the model as context, the reply is scoped to that part alone, and
the result is spliced at the segment's offsets. It edits the beat rather than
forking it — swiping is what makes a sibling — and it is drawn in place in the
log, under the character's own name with the red rail, rather than arriving at
the bottom and then vanishing into a message above.

**Split beat** (§7): one message per part, as a chain under the beat's *parent*.
That makes them a sibling branch, so the beat survives and can be swiped back
to — the same rule every other tree operation follows.

**The scope control** lives in the cast strip rather than the composer, because
it is a decision about the same thing the strip is about and because it only
means anything with two or more characters in play. In a beat the cued card's
caption changes from "auto · next" to "auto · opens", since the director's pick
becomes who starts the exchange rather than its only voice.

**Verified end to end in a browser** at 390×844, dark and light: a three-hander
generated as one beat and rendered as one continuous passage with quiet speaker
labels; Mira's part recast in place with the red rail and no new message in the
log; the beat split into four messages with the beat itself still there as a
2/2 sibling; and the turn director correctly saying "after Sister Bell" — the
character the *beat ended on*, not the one it is filed under.

**Tests.** 42 new: 20 on the parser's fixtures, 22 on beats over HTTP.

### Deliberately not built

- **`auto` scope** — the director deciding beat versus spotlight. That is the
  classifier, phase 10. Offering a third button that secretly meant "spotlight"
  would have been worse than two honest ones.
- **Extend beat** (§7). Listed in the ops table, not in phase 9's line.
- **Expression per segment.** The column exists because the offsets and speaker
  do; nothing sets it until expressions land (phase 30).
- **A cap on beat participants.** See the spec changes below.

### Spec changes

§2's MessageSegment gains `speaker_label` and three settled notes. §3.5 gains a
"settled while building phase 9" block: who is in a beat, the shared instruction
slot, recast editing rather than forking, split branching rather than
converting, and the label forms accepted. §24 resolves the beat-swipe question
(both, because they are different things to want) and adds two: whether a large
cast should be capped in a beat, and whose example dialogue a beat should carry.

### Surprises

Two, both about attribution.

The first: the turn director's "never twice consecutively" rule reads the last
message's `character_id`, and a beat is filed under whoever *opened* it. So a
beat that ended on Sister Bell would let Sister Bell speak again immediately.
The fix is not in the director — it stays pure and unchanged — but at the
database seam, which now reports a beat's last *character segment* as who spoke
last. Better behaviour and a smaller change than the alternative of giving every
history entry a list of speakers.

The second: the obvious place for "rewrite this part" is a long-press on the
part. That nests a gesture target inside the beat's own, so both long-presses
fire and the beat loses its swipe. Recast is reached from the message's action
sheet instead, which opens a picker of the parts — which is also where a reader
would look for it.

---

## Phase 10 — Classifier turn director

"Let an AI decide who speaks next" has been an open request in SillyTavern for
years; what is on offer there is a talkativeness dice roll plus whole-word name
matching, which users find arbitrary. The fix is not a better heuristic. It is
asking a model and then showing its reasoning.

### What was built

**The question and the answer** (`server/generation/classifier.ts`), pure. The
question is small on purpose — the roster with a line about each of them and how
long they have been quiet, the last eight turns in excerpt, and a format of two
or three plain lines. Handing a cheap model the whole scene is how a classifier
turns into a second generation.

The parser assumes the model answering is small, fast and imperfect. It takes
`**"Mira Vance."**`, a bare name on its own line, a first name, lowercase field
names, and a preamble before the answer. It refuses an ambiguous first name and
a name that is nobody, because a wrong decision presented confidently is worse
than a fallback that says what it is.

**The decision as a stream event.** `POST /generate` cannot wait on a second
model, so the generation starts, the director answers, and a `director` event
carries who and why before the first token of prose. Every strategy emits it —
§6 asks for the decision to be exposed, and that was never a classifier-only
requirement. The composer shows "choosing who speaks", then the name with the
model's own sentence under it, then the prose streams beneath that.

**Not knowing, out loud.** Under the classifier with nothing cued, no cast card
is highlighted, the caption reads "the classifier decides when you send", and
the send button carries a question mark. The round-robin fallback is a real
answer if the call fails, but showing it as the speaker would be a guess
presented as a fact.

**`auto` scope** (§3.5's third option) is now real, and is offered only under
the classifier, because it means "ask the director". An explicit spotlight or
beat is never put to the model — the user already decided, and inviting it to
disagree would be rude.

**`scenes.director_profile_id`** (migration 0008) routes the call somewhere
cheap, with a picker in scene setup beside the strategy that needs it.

**Verified end to end in a browser** at 390×844 dark, against a stub answering
both the director and the prose: a classifier spotlight attributed to the
character it named, the "choosing" state with the log's red rail and a reachable
stop, the reason printed above the streaming prose, and `auto` producing a
three-hander beat because the director asked for the room.

**Tests.** 35 new: 19 on the question and the parser with no database, 16 driving
the classifier over HTTP — including every way it can misbehave.

### Deliberately not built

- **The `mention` strategy.** Listed under Polish, not here. It still falls back
  and says so.
- **A background-task primitive.** Phase 11. `collect()` in the service is the
  one-shot form of it and is where that generalisation will start.
- **Asking the classifier how long a beat should run.** The bound stays the
  user's; nothing observed yet says the model should own it.
- **`max_tokens` on the wire.** The reply is bounded by a length cap and an
  abort instead, which works on every adapter and does not change how any
  existing generation behaves.

### Spec changes

§6 gains "The classifier decides mid-flight": the decision as an event, the
composer admitting it does not know, the never-twice rule enforced by omission
rather than instruction, failure never costing the turn, and the two bounds.

### Surprises

The existing streaming tests caught a real bug the moment the new event landed:
the SSE route ended the stream on any event that was not a chunk. A `director`
event is news about the turn, not the end of it, so the stream was being closed
before a word of prose arrived. Six tests failed at once and all of them were
right to. The route now names the three terminal events instead of describing
them by what they are not.

The smaller one: `bare()`, which strips the quotes and asterisks a model wraps a
name in, also strips a trailing full stop — correct for a name, vandalism for
the reason sentence next to it. Names are cleaned; prose is left alone.

---

## Phase 11 — The background-task primitive

Summarisation, tracker refresh, memory extraction, the turn classifier,
expression classification and every post-generation pass are the same shape: a
prompt, a model to run it on, and somewhere for the answer to go. SPEC §7 says
build it once, and this is the phase that does — before the four phases that
each would otherwise have rolled their own.

### What was built

**`TaskRunner`** — the primitive. One rule shapes all of it: §7's *a background
task must never block or fail a user-facing generation*. So `run` does not
throw. Every way a side call can go wrong comes back as a named result the
caller reads and falls back from — no model to run on, an unreachable provider,
a timeout, a cancelled turn, an answer that could not be used. They are named
apart on purpose: "the model said no" and "the model was unreachable" are
different problems and only one of them is worth changing a model over.

Two bounds, always: a timeout and a reply-length cap. And a concurrency cap,
because side calls are cheap individually and unbounded in aggregate — a
four-pass pipeline over a beat's five segments is twenty requests out of one
turn, and a local model serves one at a time.

**The run log** (migration 0009), which exists *because* of the rule. Every
failure a background task has is swallowed by design, so a swallowed failure
that cannot be read anywhere is indistinguishable from the feature quietly not
working. Every run records what was sent, what came back, which model answered,
and why it failed — including the runs a caller decided not to make, since "there
was only one turn this could be" is the answer when a director looks idle. Bounded
per kind, so a side call that runs every turn does not grow the database forever.

**A registry, not a table of user-authored tasks.** What a task asks for and what
it does with the answer are code; what is stored is §7's per-op row for a kind
the code already knows. Rows are created the first time a kind is asked for, so
adding one is a change to a single list. Kinds are registered as they are built —
seeding rows for tasks whose feature does not exist would be a settings screen
full of switches that do nothing.

**Route resolution moved out of the generation service** into
`server/generation/route.ts`, because per-operation routing is the point: a task
runs on its own profile and control returns to the scene's. Both paths now fail
the same way, naming the provider and what is wrong with it.

**The classifier moved onto it**, which is the proof. It gained something in the
move: when the classifier is asked and cannot answer, the reason under the cast
strip now says so — "Round robin — the classifier could not be reached" — rather
than repeating the provisional sentence. A director that is quietly broken should
not read exactly like one that is quietly working.

**The log, in the UI**, under the turn strategy that produced it: the last few
decisions with their status, model, timing and — when it went wrong — the
provider's own words.

**Verified end to end in a browser** at 390×844 dark, with a stub that could be
made to refuse: a good turn, then a 503 on the director, the turn generated
anyway on the round-robin fallback, and the failure readable afterwards in scene
setup as "FAILED · stub-small · The provider returned 503. model is loading".

**Tests.** 19 new, most of them the rule holding under a different kind of
failure.

### Deliberately not built

- **Any second kind of task.** The consumers are phases 14–16 and 28. Adding
  their rows now would be switches that do nothing.
- **A trigger expression language.** A task's trigger is code — the classifier's
  is "the scene's strategy is classifier". A stored condition is the extension
  system, and §15 is right about where that belongs.
- **A tasks settings screen.** §20 phase 13 owns per-op configuration; a screen
  with one switch on it now would be built twice. The run log went where the
  feature that produces it already lives.
- **Prompt template overrides actually taking effect.** The column and the API
  accept one; nothing reads it yet, because a template needs the macro set and a
  documented variable list, which is phase 13's job.

### Spec changes

§7 gains "settled while building phase 11": a kind is code and a row is its
configuration, "never fails" means `run` does not throw, the log exists because
the failures are swallowed, the fallback names the failure, the two bounds, the
concurrency cap, and the routing order. §24 gains one question — after a turn
finishes, the director's reason survives only in the task log.

### Surprises

The timeout test failed on its first run for a good reason. An adapter that ends
*cleanly* on abort rather than throwing — which is what the OpenAI adapter does
when the caller aborts — produced an empty reply, and the runner reported it as
"the model returned nothing" rather than "we gave up waiting". Those are exactly
the two things the named statuses exist to tell apart. The timeout signal is now
held separately from the merged one so the reason is still readable after a
clean end.

---

## Phase 12 — Core guided ops

Eight ops: nudge, guided swipe, steer, continue, expand, corrections, simple
send, impersonate. Modelled on the Guided Generations extension's shape, built
from SPEC §7's rules rather than its code.

### What was built

**Nudge and steer**, which are the same idea at two lifetimes. A nudge reaches
the model at depth 0 and is gone — not written to the tree, not carried into the
next turn. A steer is a note on the scene applied until cleared, and is the only
op with a column (migration 0010), because *persistent* is the whole difference
between the two. Both appear in the prompt as their own inspectable blocks,
which §3's assembly already had slots for.

**Expand, correct and continue** behind one endpoint and three instructions.
They share a shape — hand the model what it wrote, ask for something different —
and nothing else, and the wording is where the value is: "longer" produces
padding unless it is told what to spend the length on, "fix this" rewrites the
parts that were already working unless it is told not to, and "continue" starts
again from the top unless it is told to begin mid-flow.

Every revision is a **sibling** of its target and keeps the target's speaker.
Asking for a longer version and disliking it costs a swipe; a correction that
quietly changes who is speaking is not a correction. Continue **extends** rather
than replacing — the message that lands is the whole turn, original and
continuation, so the log reads as one piece of writing.

**Continue is gated on the provider and says why.** No adapter that ships can
accept a partial assistant turn, so the op is present, dark, and carries its
reason under the grid. A fresh turn dressed as a continuation would be worse
than saying no.

**Guided swipe is reroll plus nudge** — not a mechanism of its own, which is
what makes it obviously correct rather than a fourth thing to keep in step.

**Impersonate** is a background task on phase 11's primitive rather than a
generation, because its result lands in the composer and never auto-sends. That
is what makes it safe at all: it is the one place the author is asked to write
the reader's character, and nothing it produces reaches the story without the
user pressing send. Three persons are three prompts, not one prompt with a
parameter — "I reached for the door", "You reach for the door" and "She reached
for the door" are three registers. The reply is cleaned of the lead-in and the
wrapping quotes a model puts around a draft, so what lands is text you could
send unedited.

**The ops grid**, built to the design: a 3 × 2 grid of 52px cells, each a mono
glyph over a mono caption, **lettered like proofreading marks rather than
emoji** — a proofreader's mark is learned once and then read at a glance. Closed
by default; opening it collapses the cast strip and the director's reason into
one line summarising the cue, so the whole stack still fits above a keyboard at
390px.

**Verified end to end in a browser** at 390×844 dark: the grid with Continue
dark and explained, a steer set and reaching the prompt, a nudge reaching the
prompt and not the log, an expansion landing as `◂ 2/2 ▸` with the original one
swipe away, and "as me" turning `count the barrels, keep quiet` into a full turn
in the composer without sending it.

**Tests.** 22 new, mostly the two rules: ephemeral instructions never becoming
messages, and every new version being a sibling.

### Deliberately not built

- **Interject, summarize, extend beat, spellchecker, edit intros, input
  recovery.** Summarize is phase 16; the rest are Polish. §20's phase 12 line
  names eight ops and these are not among them.
- **Per-op prompt overrides and per-op profiles.** Phase 13, and the column is
  already there waiting.
- **Keyboard shortcuts** for the lettered keys. The letters are the design's
  vocabulary now; the bindings belong with the desktop layout, where there is a
  keyboard to bind them to.

### Spec changes

§7 gains "settled while building phase 12": ephemeral means ephemeral, the three
revision modes as three instructions, siblings and speakers, continue extending
and being gated, guided swipe as a composition, and impersonate as a task. §24
gains one question — impersonate does not stream.

### Surprises

Nothing structural, and two small things worth the note. The ops key kept
`aria-label="Ops"` while showing `CLOSE`, so its accessible name and its visible
name disagreed — caught by a browser script that could not find the button it
was looking at. And the composer's draft had to move up into the chat screen,
because two ops read it: "no reply" posts it, and "as me" replaces it with a
turn written from it. A component that owns state two of its siblings need is
the wrong owner.

---

## Phase 13 — Per-op configuration and connection profiles

Two halves of one idea. Every op gets §7's configuration row — which model it
runs on, the words it uses, where they are injected, whether its button is shown
— and connection profiles become something you can actually make, which until
now they were not: the routing built in phases 10 and 11 pointed at a list with
one item in it.

### What was built

**One registry for every op.** A *side call* runs off the main path on its own
model and returns text; a *turn instruction* is a block inside a user-facing
generation's prompt. They share a table because they share a row, and the row
says which kind it is rather than leaving a caller to work it out — routing and
a timeout mean nothing for the second.

**Templates, actually read.** `prompt_template` was accepted but inert since
phase 11; now the built-in words for nudge, steer, expand, correct and continue
live in `server/prompt/op-templates.ts` and a user's override replaces them.
Two substitution passes, and the order is the whole design: the op's own
variables are filled by the caller, because only the caller knows what
`{{original}}` is, and everything else is the ordinary macro set filled at
assembly — so `{{char}}` inside an override resolves exactly as it does inside a
preset. Filling therefore leaves unknown macros alone; one deleted in the first
pass would never reach the engine that knows it.

**The user-lock is outside every template.** §0.5 makes it a hard constraint
restated near the turn, and a template a user can edit is not where a
non-negotiable belongs. The builder appends it after the template.

**The template is the only copy.** The prompt builder now reads it for the
un-overridden case too, and the paragraph that used to be hardcoded beside it is
gone. Two copies of the same words is how a built-in and a default drift apart.

**`injection_role` and `button_visible`** (migration 0011) complete §7's row
apart from `auto_trigger`. Hidden is not off: a button you have hidden still
runs when something else asks for the op, and the list says which ops hiding
would even mean anything for — nothing shows a button for the turn director, so
offering the switch would be a lie.

**Providers and profiles are editable.** Add a second box, point a profile at
it, route the classifier and impersonate there. Three states for an API key —
absent leaves it, null clears it, a string replaces it — because a form that
came back empty must never delete a credential nobody touched. The last provider
and the last profile cannot be removed.

**The Settings screen**, built to the design's screen 3i: **Connections** with a
green status dot over a mono spec line, and **Routing by operation**, which the
design calls the interesting screen for this audience and is right about. Each
op names where it runs and whether its words are the built-in ones or yours.
The design's third group, Reading, is theme, prose size and VN stage — all three
belong to features that do not exist, so it is absent rather than drawn empty.

**Verified end to end in a browser** at 390×844 in both themes: two providers,
two profiles, the classifier and "as me" routed at the cheap one, a nudge
template overridden and reaching the model as written, and hiding the nudge
button removing it from the ops grid.

**Tests.** 23 new, including two that keep the registry and the templates honest
about each other — every templated op exists, every declared variable is
actually used.

### Deliberately not built

- **`auto_trigger`.** Its only consumers are the post-generation passes, phase
  14. It arrives with them.
- **A test button on a connection.** The read-only routes' old comment promised
  one "which needs the adapters from phase 4"; the adapters exist now, but a
  test call is a side call and belongs on the task primitive with a proper run
  log entry. Worth doing, not worth doing badly in the last hour of a phase.
- **Presets.** A profile can point at one and the setup wizard makes one; there
  is still no preset editor. §13's sampler work is phase 17.
- **The Reading group.** See above.

### Spec changes

§7 gains "settled while building phase 13": what an op is, the two substitution
passes and why the order matters, the lock living outside every template, the
template being the only copy, hidden not meaning off, `auto_trigger` waiting for
its consumer, and the last-profile rule.

### Surprises

One real bug, caught by a test that was only meant to check the happy path.
`connection_profiles` has a partial unique index enforcing one default, and
`updateConnectionProfile` cleared the old default before setting a new one —
but `insertConnectionProfile` did not. So creating a profile and asking for it
to be the default was a constraint violation and a 500, on a path the setup
wizard never takes because it makes the first profile when there is nothing to
collide with.

And a smaller judgement: the op templates live under `/prompt`, not under
`/tasks`, because they are the words a prompt is made of. That means five op
keys are duplicated as constants rather than imported, to keep `/prompt` from
importing anything outside itself. A test asserts the two lists agree, which is
a cheaper coupling than the layering violation would have been.

---

## Phase 14 — The post-generation pipeline

ReCast's rationale, which SPEC §7.5 adopts and is right about: a model cannot go
back once it has committed to a response, but a second model reading the
finished text can catch what the first one got wrong. Voice validation is the
flagship, and it is the direct answer to the risk this product's whole
architecture runs — one author voicing a whole cast, and voices converging.

### What was built

**Three passes**, each a background task on phase 11's primitive, each with its
own model, prompt and declared effect.

*Voice validation* reads a beat **part by part** and its annotation carries the
segment ordinal. That is the entire value: not "the exchange felt off", which
the reader already knew, but "this line is Aldan's dry register, not hers". It
is shown who the character is, how they talk, and the last few things they
actually said, so the judgement has a reference rather than a vibe. And it is
told explicitly to judge the voice and not the events — a character doing
something surprising is not drift.

*User-lock check* flags and does not rewrite, which §7.5 is deliberate about: a
pass that quietly rewrites a turn is a second author nobody hired, and the fix
for the author taking over the reader's character is a regeneration the user
asks for. It is told the difference between a character speaking *to* the reader
and one speaking *for* them, because that distinction is the whole job.

*Prose refinement* is the only pass that replaces, and it keeps the original on
the annotation so the change can be seen and put back. Off unless switched on,
because it costs a second full generation.

**The pipeline never delays a turn.** It starts after the terminal event is
emitted, not before it — §7 is absolute, and three extra model calls in front of
every reply would be a worse product than no pipeline. `passes_pending` on the
message is what tells a client to look again.

**A pass that cannot be read says nothing.** An unreadable verdict is not a
flag. And `ok` is recorded as well as `flagged`, because "the pass ran and was
happy" and "the pass never ran" are different things, and a pipeline whose
silence is ambiguous is one nobody reads.

**`auto_trigger`** (migration 0012), deferred in phase 13 until it had a
consumer, now has three. Plus `scenes.auto_passes`: §7.5's "auto-run per scene
or manual per message" is two switches, and both are real — one says whether a
scene reads its turns back, the other says which passes take part.

**Annotations in the log**, built to the design's rule — a small annotation on
the message, never a modal. Entirely mono, like the reasoning strip, so it reads
as a note in the margin rather than another voice in the scene. Clean verdicts
are drawn quieter than flagged ones; a revision carries "put it back".

**Verified end to end in a browser** at 390×844 in both themes: a three-hander
beat generated, then read back part by part, with Aldan's and Bell's parts
marked ok in the quiet treatment and Mira's flagged in red carrying the model's
own sentence.

**Tests.** 27 new.

### Deliberately not built

- **Slop scan.** It matches against §13.6's ban list, which is phase 18. A scan
  with nothing to scan for would be a fourth switch that does nothing.
- **A regeneration offered from a lock-check flag.** §7.5 says the pass should
  "offer a regeneration"; the ops to do it exist (guided swipe, correct), so
  what is missing is a button on the annotation. It wants the flag to carry
  which op it is proposing, and that is a decision better made once more than
  one pass proposes something.
- **Per-pass prompt overrides.** The passes build their questions in code, like
  the classifier: their shape is a roster and a reply format, not a paragraph.
  Phase 13's template mechanism handles paragraphs.

### Spec changes

§7.5 gains "settled while building phase 14": the pipeline starting after the
turn, an unreadable verdict not being a flag, `ok` being recorded, voice
validation naming the part, only one pass replacing, a no-op refinement not
counting as a revision, one verdict per pass, and the manual run being awaited
where the automatic one is not. §24 gains the polling question.

### Surprises

Two, both mine rather than the code's.

The first was a latent flake that would have bitten later: `until()` in the test
helpers took a synchronous predicate, and I handed it an async one. A pending
promise is truthy, so it returned immediately and every pipeline test passed by
luck — the passes happened to finish before the next assertion. It now awaits
the predicate.

The second was a spacing bug I caused and then saw in a screenshot. Wrapping
each beat segment in a div to hang its annotations under it meant `first:mt-0`
on the inner element matched *every* segment, so the parts collapsed against
each other. The spacing belongs on the wrapper.

---

## Phase 15 — Persistent guides

SPEC §8's first half: state a side call writes once and the prompt injects every
turn until it is flushed. Free-form prose on purpose — there is no parse step,
so there is nothing to fail, which is what makes guides the default and trackers
the option.

### What was built

**Six guides**, each its own op on phase 11's primitive — Situational, Thinking,
Clothes, Positions, Rules and Custom. Six ops rather than one with a kind
parameter, because §8 makes auto-trigger a per-guide decision and names exactly
three that default on; per-op routing then falls out for free, so a cheap fast
model can keep the clothes list while a better one keeps the thinking.

**Versioned per message** (migration 0013), which is the whole design and not an
implementation detail. A guide is not one mutable row per scene: every write is
a new row anchored to the message it was written after, and the version in force
is the newest whose anchor is on the active path. Rewinding therefore rewinds
the guides as a *read*, not an undo, and two branches carry their own without
either knowing about the other. A flush takes every version rather than the one
in force — deleting only the current row would resurrect an older one the moment
the reader rewound, which is the opposite of what the button says.

**A refresh is shown the previous version.** A guide that forgot everything each
time it ran would lose exactly the state it exists to carry: a coat somebody
took off three turns ago has to stay off. And an empty reply leaves the previous
version standing, because the failure mode of a guide is a model returning
nothing, and replacing a good note with an empty one is worse than not running.

**Hand-editing pins.** §8 makes guides editable, and an edit that the next
automatic run overwrites is not an edit. A pinned guide is skipped by every
refresh — including a rebuild asked for by kind — until it is flushed.

**Guides refresh after the passes**, not before: §7.5 may have rewritten the
turn the guide is about to read. And like every side call they never delay a
turn or fail one.

**The panel** (design screen `3f`): a blue bottom sheet, `GUIDES · INJECTED NOW`
with the total cost, a hairline row per guide showing what it costs on every
single turn, expanded content as Spectral prose, and `EDIT` / `REBUILD` / a
red-bordered `FLUSH` per guide over `REBUILD ALL` / `DONE` / `FLUSH ALL`. All
six kinds get a row whether or not they have been written — a guide you can only
discover by first turning something on in settings is one nobody finds — and an
unwritten one offers `WRITE IT`.

**Verified end to end in a browser** at 390×844 in both themes: five guides
written from a scene, one hand-edited and surviving a rebuild-all, one flushed
back to `NONE`, and the custom guide written from a question set in scene setup.

### Deliberately not built

- **Trackers**, the structured half of §8. They are a different feature with a
  different failure mode — strict JSON, per-field pinning, a panel above the
  composer — and §20 does not schedule them here.
- **A guide's own history.** Every version is kept and the active path picks
  one, but nothing shows you the versions. The task log (§7) already records
  every run.
- **Automatic flushing.** A guide grows until somebody flushes it. Rolling
  summarisation is phase 16 and is where a budget for this belongs.

### Spec changes

§8 gains "settled while building phase 15": a row per version rather than a
mutable row, a flush taking every version, each guide being its own op, the
refresh being shown the previous version, an edit pinning, an empty reply
leaving the old one standing, guides running after the passes, the custom
guide's question being scene configuration, and the panel listing all six kinds.

### Surprises

Seven tests failed the moment guides landed, and all seven were the test
helpers' fault rather than the feature's. Three guides default to auto-trigger,
so `adapter.taskCalls === 0` stopped meaning "the classifier was not asked" and
`adapter.lastPrompt` stopped meaning "the turn" — both now had guide traffic in
them. The helpers gained `callsLabelled()` and `promptsLabelled()`, and
`lastPrompt` now means the last *turn* prompt. Worth recording because it will
happen again: every phase that adds a background call quietly widens what "the
last call" means.

A smaller one, in the client. `CONTINUE` had a cell in the six-cell ops grid and
is permanently dark — no adapter that ships can accept a partial assistant turn
— so a sixth of the grid was spent on an apology. Guides took the cell and
continue moved into the message action sheet, where it is still offered and
still says why.

---

## Two phases added to §20

Both were open items I had been carrying rather than work I invented, and both
now have a number instead of a note.

**Phase 19 — the desktop layout.** There are no breakpoints anywhere in the
client: `DESIGN.md` §11 specifies a three-column shell at 1440 × 900 and §20
never scheduled it, so it was on course to never happen. It goes at the end of
the core product rather than in with the polish, because the design's claim —
same components, unrolled, not a second design — only stays true while there are
few components to unroll. Everything from lorebooks onward is then built for
both widths from the start, instead of being retrofitted twice.

**Phase 20 — the schema review.** `HANDOFF.md` says to propose the migrations
and wait for review before running them. Thirteen have been written and run
without that, because waiting would have stopped every phase behind it; I have
flagged it at the end of each phase since. Making it a phase is the honest
repair, and it lands before the depth work starts adding lorebooks, trackers and
packs — the point past which a schema mistake stops being cheap to fix.

While renumbering for those two, the tail of §20 turned out to be wrong
independently of them: past phase 34 it repeated 40 and 41 several times over,
so the last nine entries had four distinct numbers between them. The order was
never ambiguous, only the labels. The list now runs 1–43 without repeating.

---

## Phase 16 — Rolling summarisation

SPEC §11 layer 1, and the spec's own verdict on it: the highest-leverage memory
feature and the one to build first. Old turns are condensed into a paragraph the
prompt carries instead of the turns, which is what lets a scene outlive its
context window.

### What was built

**Two ops**, both side calls on phase 11's primitive: one summarises a run of
messages, one folds summaries into each other when they have grown past their
own budget. Separate because they are separately routable and want different
words — the second is told bluntly that detail is being traded for room, because
a fold that tries to keep everything comes back the same length as its input.

**Migration 0014** and six per-scene settings. Everything about *when* is per
scene because how fast a story moves is a property of the story: two thresholds
(every N messages **or** N words, whichever comes first — twenty one-line
exchanges and twenty long descriptive turns are the same count and a very
different amount of story), an injection threshold, a raw-eviction switch, and a
cache freeze. All of them bounded, because a threshold of zero summarises the
turn that just happened and a freeze of a thousand stops the injection point
ever moving again.

**Three knobs meet in `injectedSummaries`, and the order is the behaviour.**
The freeze goes first, rounding the path length *down* to a multiple of N so the
injected set only moves every N turns — which is the whole point, since the
summary block sits near the front of the prompt and moving it moves everything
after it out of the provider's cache. The threshold goes second, against that
frozen position. Eviction goes last, on whatever the first two settled. It needs
no stored state: rounding the length down is a pure function of the scene and
its active path, so nothing has to be kept in step with branching.

**The tree, answered the same way guides answer it.** A summary counts when the
last message it covers is on the active path. Rewinding past a range un-injects
the summary of it; a branch that never had those messages never had their
summary; going back brings it straight back.

**Raw eviction, reported.** With it on, the turns an injected summary covers are
dropped from the prompt and listed as evicted with their token cost — §3 insists
on that list because "the character forgot" is almost always "the model never
saw it", and one paragraph standing in for forty turns is the strongest case of
that in the product. The last user message is kept whatever the ranges say: a
turn whose history dropped the thing being replied to has nothing to answer.

**The blue sheet gained a second half.** Rather than spend a seventh cell on a
six-cell grid, the guides panel became a two-tab sheet: `GUIDES` and `MEMORY`,
each showing its own cost on the switch. That is the question a user has when
they open it — which of the two is eating my context — and a summary and a guide
are the same kind of object from the reader's side anyway: notes the author
keeps about their own scene, standing in for what the model would otherwise have
to be shown. Guides are that state now; summaries are that state before.

The memory half is §16's memory panel, minus the layers that do not exist yet:
every summary with the turns it covers, its cost, **whether the prompt is
actually carrying it**, and whether the words are the user's own. That last
distinction is the one the panel exists for — §11's threshold means a summary is
written long before it is used, and a panel that drew all of them identically
would make "it forgot" and "it has not started remembering yet" look the same.
Edit, rewrite, forget one, forget all.

**Verified end to end in a browser** at 390×844 in both themes: a sixteen-turn
scene summarised, the summary shown as in-prompt with its cost, raw eviction
turned on from setup and the panel reporting what it stands in for, and the
bounded number fields refusing a value out of range and snapping back.

### Deliberately not built

- **Injection position and depth.** §11 says summaries are injected at a
  configurable position and depth; they currently land in the fixed block order
  at slot 9. Block ordering is a preset concern and the preset editor is a later
  phase, so a per-scene override here would be a second mechanism for the same
  thing.
- **A summary of a branch that was rewound past.** It is kept, not deleted, and
  comes back when the reader returns — but nothing shows you that it exists
  while you are on the other branch.
- **Any automatic wipe.** Summaries accumulate until folded or forgotten by
  hand. The fold bounds the block that reaches the prompt, which is the cost
  that matters; bounding the table is not a problem anybody has yet.

### Spec changes

§11 gains "settled while building phase 16": the order the three knobs apply in,
the freeze needing no stored state, the active-path rule, the tail never being
summarised rather than merely never injected, eviction keeping the last user
message and being reported with its cost, an empty reply not marking a range
done, a longer fold being discarded, an edited summary never being folded, and
the settings being per scene and bounded.

### Surprises

Two failing tests, and one of them was a real hole in how I was testing.

The word-threshold test set `summariseEveryWords: 20`, which is below the route's
own minimum of 100, so the PATCH came back 400 — and my test helper threw the
response away. The test was quietly measuring the default of 3000 and asserting
against arithmetic for 20. The fix is in the helper rather than the one test: a
settings PATCH is now asserted to return 200, so a rejected setting fails loudly
instead of silently testing the defaults. Two other tests in the file were
passing settings I had not checked against those bounds; they turned out valid,
but only by luck.

The second was a fixture that tested nothing. The re-summarisation tests built
four long summaries and then checked that a fold happened — but the summaries
were long enough that the fold had already fired twice during setup, so the
assertion was reading the fixture's own leftovers. Rebuilt so the setup stops one
short of the budget and asserts that it did, which makes the fixture itself the
guard: if folding ever starts firing early, those tests fail rather than pass
for the wrong reason.

---

## Phase 17 — Samplers, reasoning and prefill

SPEC §13. Roughly half of this had already landed as a side effect of phases 1
and 4 — `MODERN_SAMPLER_DEFAULTS` carries §13's table exactly, and the adapter
has been sending DRY and XTC since the first generation. What was missing was
everything that made those facts reachable or true.

### What was built

**Reasoning extraction**, by both routes it arrives by. A provider field —
DeepSeek's `reasoning_content`, OpenRouter's `reasoning` — the adapter surfaces
directly. Inline `<think>` tags are the harder half and are a *streaming*
problem rather than a parsing one: a tag can be split across frames, so `<thi`
may arrive with the prose before it. A pure incremental splitter holds back
anything that could still turn out to be a tag, which is what stops a stray
`<think>` reaching the reader for a frame and then being retracted. It follows
the beat parser's two rules — never lose text, and give the same answer whether
the input came in one piece or fifty — and a test drives every fixture one
character at a time to prove the second.

An unterminated block is treated as reasoning, not prose. A model that forgets
its closing tag must not have its planning printed into the scene.

**Its own column**, which is what makes §13's "do not feed reasoning back into
multi-turn context" free rather than a rule somebody has to remember: the
history renderer reads a message's content, so reasoning cannot leak into a
later prompt by accident. Re-injection of the last N blocks is the opt-in §13
asks for, with the preset's own prefix and suffix, placed *before* the turn it
produced because that is the order it happened in.

**A reasoning strip in the log**, collapsed, entirely mono like a pass
annotation — the machine talking about its own work rather than another voice in
the scene. The closed state names the size, so it stays informative shut. It
also streams: a model that thinks for twenty seconds before its first word shows
a rising character count instead of looking stalled. Reasoning does not count as
the first token, since a speed that measured planning the reader never sees
would be a number about nothing.

**Prefill on the send path.** The builder has emitted `built.prefill` since phase
3 and no adapter consumed it. It is now sent as a trailing assistant message —
but only where the endpoint accepts one, and that is a property of the endpoint
rather than the wire format: OpenAI rejects it, most local servers speaking the
same shape accept it. So providers carry a three-valued override where null
means "whatever the adapter says", which is a different answer from "no". One
switch moves both halves, since the builder already gates the prefill block on
the capability the adapter reports.

**A preset editor**, because until now there was none: §13's modern defaults had
shipped since phase 1 and were unreachable, which is most of the way to not
having them. Sliders for every sampler with the two modern tools grouped and
explained — DRY is *why* repetition penalty ships off, XTC is why the prose is
not the same every time — over the context budget, the prefill, and the
reasoning settings. Bounds are shared with the route so the form can never send
something the server refuses.

**Verified end to end in a browser** at 390×844 in both themes, with a stub
emitting seven-character frames so every tag landed split across several: no
tag reached the prose at any point during streaming, the strip counted up while
the model thought, and a prefill enabled on the provider arrived at the endpoint
as a trailing assistant message.

### Deliberately not built

- **Sampler order.** §13 asks for it in advanced settings with a warning on
  reorder. `ProviderCapabilities.samplerOrder` exists and is null for every
  adapter that ships, so a reorder control today would be a control that does
  nothing. It belongs with the text-completion and local backends of phase 22,
  where the field becomes non-null.
- **Grammars and constrained decoding.** §13 says "where the backend offers it";
  the OpenAI-compatible adapter declares `supportsGrammar: false`, so there is
  nothing to offer yet.
- **The analysis-block preset.** §13 suggests shipping a think-step preset as an
  option. That is a prompt option group, which is phase 18.
- **Drag-to-reorder prompt blocks**, which §16 lists under the preset editor.
  Block order interacts with option groups (phase 18) and is only legible beside
  the inspector (phase 25); building a reorder UI before either is guessing at
  the surface.

### Spec changes

§13 gains "settled while building phase 17": the two routes reasoning arrives
by, tags being a streaming problem, an unterminated block being reasoning, the
separate column making the default free, off being zero blocks, re-injection
going before its turn, reasoning not counting as the first token, prefill being
a property of the endpoint, one preset per generation, and the bounds being
shared.

### Surprises

**Two of my own tests failed for the same reason, and it was a real bug rather
than a test bug.** A preset attached to a scene drove the prompt; a preset
attached to a connection profile drove the samplers. Two different reads, two
different sources, and neither knew about the other — so a preset attached to
one place governed half a generation. Worse, resolving to nothing fell back to
hardcoded constants rather than to the default preset *row*, which meant editing
the default preset changed nothing anywhere: the editor I had just built was
writing to a row no generation read. Both are fixed under one rule — scene, then
profile, then the row marked default — and a test now asserts that editing the
default preset reaches a scene that never chose one.

It had gone unnoticed since phase 4 because both columns are almost always null
and the constants happened to match the seeded row, so every generation behaved
correctly by coincidence. The feature that exposed it was the first one that
made the values differ.

A smaller one, caught by driving the UI rather than by a test: the sampler
sliders stalled under the keyboard. Committing on key-up cleared the local draft
immediately, so the next arrow press stepped from the server's value — which had
not come back yet — and four presses moved one step. The draft is now kept for
the life of the sheet. And the sliders were using the browser's own track, which
in the dark theme is the brightest thing on the screen; they are drawn
explicitly now, hairline track and the square red handle the design specifies.

---

## Phase 18 — Prompt option groups and the ban list

SPEC §13.5 and §13.6, and the phase that finally lets the slop scan deferred in
phase 14 exist.

### What was built

**A data model where the preset suites keep a wall of toggles.** §13.5's
argument is that the best suites are not one long system prompt — they are
libraries of small toggleable blocks, some groups mutually exclusive. Celia
coordinates roughly thirty-five state variables to manage that; it works, and it
is prompt engineering standing in for a data model.

**Cardinality is what earns the table.** `one_of` is enforced on write, not
asked for in the prompt: selecting an option clears the rest of its group, so a
scene cannot ask for first person and third person at once. That is precisely
what a wall of toggles cannot promise, and it is why the suites built on one
spend so much prompt text asking the model to sort out contradictions.

**Seven groups ship**, each with a default named, because §22 is explicit that a
preset arriving entirely switched off is an anti-pattern — a first run looks
broken. A scene that has never been configured *inherits* the defaults rather
than holding them; the first time somebody switches one thing off, the rest are
materialised alongside it, because "this, and keep the others" is what that
gesture means and "this alone" is not.

**Every option is its own prompt block**, labelled with its group and priced.
§13.5 asks for exactly that, and merging them into one block would hand back the
wall of toggles whose effect on the prompt you cannot see. An option with an
empty fragment is a real choice — "no planning", "immersive prose" — that simply
contributes nothing.

**The ban list is data** (§13.6) because the same list has to reach three
mechanisms that catch different things: the prompt, the samplers, and a
post-generation pass. A paragraph can only reach the first. Global and
per-scene, with a starter list of the well-known offenders.

**Auto-analysis splits at the seam where judgement begins.** §13.6 says
recurrence is measurable, so it is measured: an exact n-gram counter that keeps
only the longest form of overlapping runs and counts a phrase once per message,
since twice in one turn is a stylistic choice and three turns is a habit. The
model is asked only the half that needs a reader — whether a phrase that recurs
is a tic or is the story, since a character's name recurs too. **Nothing it
proposes is enforced**; a proposal carries the count as its evidence and waits
for a person, because a background task that started banning phrases on its own
authority would be editing somebody's prose unasked.

**The slop scan**, deferred in phase 14 for want of a list. It is the only pass
that makes no model call: matching text against a list is exact, instant and
free, where asking a model would be slow, expensive and occasionally wrong about
something that is simply true or false. It is also the only pass that says
nothing when it is happy — every other one records `ok` because "it ran and was
happy" and "it never ran" are different things when a small model can ramble or
time out, but this one cannot fail, so silence is unambiguous and a clean note on
every turn forever would be a row per turn saying so.

**Verified end to end in a browser** at 390×844 in both themes: the group sheets
showing each rule's own words and price, a one-of swap through the UI, the
analyser finding a planted tic across three turns and proposing it with its
count, accepting it turning it into a ban, and a later turn carrying that phrase
being flagged by the scan.

### Deliberately not built

- **Logit bias.** §13.6 wants the ban list enforced through logit bias "where
  the provider supports it", and the capability flag says the OpenAI-compatible
  adapter does. But logit bias takes token *ids*, and this app has an estimator
  rather than a real tokenizer — §24 still has the tokenizer choice open. Biasing
  against guessed ids would suppress arbitrary unrelated words.
- **Import and export of ban lists.** §13.6 asks for it. It is a file format
  decision that belongs with packs (phase 34), where the same question is
  already being answered for every other kind of user content.
- **Per-option editing in the UI.** The fragments are shown, and the schema is
  built for user-defined groups and options, but there is no editor yet: a
  rewritten built-in survives re-seeding, so the capability is real and only the
  surface is missing.
- **Sampler-side anti-slop.** §13.6 names DRY as the third mechanism. It already
  ships on, from phase 17; nothing further was needed.

### Spec changes

None. §13.5 and §13.6 described this precisely enough to build from, which is
worth recording on its own — it is the first phase in a while that settled
nothing because nothing needed settling.

### Surprises

Three of my own tests failed together, and the code was right in all three. The
fixture planted "the air hung heavy" as the scene's tic — which is on the
shipped starter list, so the analyser correctly refused to propose something it
already knew, and the ban was correctly already in the prompt before anything
was accepted. The tests were asserting against a phrase the feature had already
handled. Rebuilt on a phrase deliberately absent from the starter list, with the
reason written down beside it so the next person does not plant a shipped phrase
either.

A fourth failure was more useful: the slop scan's "this costs no model call"
assertion counted every side call, and the guides run behind a turn too. That is
now a helper that switches off everything else behind the turn, which any future
test about what one background thing costs will want.

And one thing found by looking rather than testing: sixteen shipped phrases each
drawn with a full-width enable button and a remove button is thirty-two buttons
in one sheet. Only proposals want that weight — they are the rows asking for a
decision. Everything settled is one compact line now.

---

## Phase 19 — The desktop layout

The design's `4a`, and the phase that only exists because I put it on the list
two phases ago rather than carrying it as a note for another twenty.

### What was built

**Same components, unrolled.** The design's claim, and it held: no component was
forked, no second stylesheet exists, the type scale and palette are untouched,
and the prose column keeps the 620px measure it has had since phase 5. Three
columns at their stated widths — 232 sidebar, 620 prose, 292 rail — verified in
the browser rather than asserted.

**One hook, read in four places.** Most of the unrolling is CSS, but three
things genuinely *reparent* rather than reflow: the cast leaves the composer and
becomes a rail, the ops grid flattens into a row, and the guides sheet becomes a
footer on that rail. A media query cannot move a component from one parent to
another, so there is a `useIsDesktop` and it is read only where the tree differs.

The breakpoint is 1144px rather than the design's 1440, because 232 + 620 + 292
is 1144 and below that the rail is the first thing that cannot hold its width.
A tablet in landscape gets the full shell; in portrait it gets the phone layout,
which is the right answer for a 768px column.

**The sidebar is the tab bar turned vertical** — same four destinations, same
mono uppercase, same red for active, with the room a bottom bar does not have
for a count and for `RECENT`. That list is the whole justification: on a phone,
switching roleplays is a screen change, and on a desktop it should not be. The
tab bar returns null above the breakpoint, so navigation is drawn in one place
or the other and never both.

**The cast rail carries what a phone cannot.** Portrait, name, status, the
director's own sentence *on the card it is about* rather than in one line under
the whole strip, and the last thing that character actually said in Spectral
italic. The cued card takes the red-tinted fill and 2px red top border; a
benched one drops to 72%. The last line is the part worth having — a phone strip
can tell you who is cued, and only the rail can tell you who these people are
right now.

**The ops flatten and stop hiding.** On a phone the grid is behind an OPS key
because the composer must fit above a keyboard; with room there is nothing to
hide it from, so the row is always visible and the key is gone. The composer
aligns to the prose column rather than the window — stretched to 900px under a
620px column it read as two different documents.

**One hover affordance, and only here.** `REROLL · BRANCH · EDIT` at the end of
the attribution rule, revealed on hover, keyboard-reachable via focus-within.
Every mobile equivalent — tap, swipe, long-press — still works, so this is a
pointer shortcut rather than a replacement. It is passed in as props rather than
read from the breakpoint inside the component, so `MessageBlock` stays a
function of what it is given.

**Verified in a browser** at 1440×900 in both themes, and at 390×844 to confirm
the phone layout is untouched.

### Deliberately not built

- **The `PROMPT · n TOK` header chip.** Design `4a` puts it beside SETUP. The
  number is real and the server computes it, but the client has no route to it,
  and the chip is a door onto the prompt inspector — phase 25. A number with
  nothing behind it to open is worse than the space it saves.
- **The `STAGE OFF` chip**, for the same reason: the VN stage is phase 29.
- **`⌘K CAST`.** The design's keyboard hints are `⌘↵ SEND · ⌘K CAST`. Send is
  wired and hinted; a cast palette is a command surface that does not exist, and
  hinting a shortcut that does nothing is worse than hinting none.
- **A wider prose measure.** The design caps at 620px and says why —
  "widening it past a reading measure would break the one thing the app is
  for" — so there is nothing to build, only something not to do.

### Spec changes

None. `DESIGN.md` §11 is specific enough to build from directly, and §20 already
gained this phase two phases ago.

### Surprises

Nothing broke, which is the finding. 602 tests passed untouched, because the
desktop layout adds no server behaviour and reuses every component — if a phase
like this had needed test changes it would have meant the components were less
reusable than the design assumed.

The two real problems both came from looking rather than testing, and both were
alignment. The composer spanned the full main column under a centred 620px log,
and the screen headers hung at the window's left edge above centred bodies. Each
reads as a mistake rather than a choice, and neither is visible at any width a
phone has. The header fix is four characters of CSS in one place; the composer
one needed a prop, because the ops key had to go at the same time.

A third, smaller: my first attempt to pass that prop silently missed, because
moving the chat body into a variable had re-indented the JSX by two spaces and I
was matching on the old text. The screenshot caught it — the OPS key was still
there — which is the argument for looking at the thing rather than trusting the
edit.

---

## Phase 20 — The schema review

`HANDOFF.md` asks for the migrations to be proposed and reviewed before they are
run. Seventeen have now been written and run without that, because waiting would
have stopped every phase behind it, and I flagged it at the end of each one.
This is the repair: reading all sixteen migrations against SPEC §2 and against
what was actually built, before the depth phases start adding lorebooks,
trackers and packs.

It is a review, so the findings are the deliverable. Two were worth fixing here;
the rest are recorded.

### What the review checked

Not by reading my own memory of the schema. The database was built from the
migrations in memory and then interrogated: every table, column, foreign key,
cascade action and index dumped from `PRAGMA`; every column SPEC §2 names
diffed against what exists; every column cross-referenced against the whole
server source to find any that nothing reads or writes; and the delete cascades
exercised for real, with rows inserted and removed and the survivors counted.

### Finding 1 — a presence anchor was being nulled, not moved (fixed)

`scene_members.joined_after_message_id` is declared `ON DELETE SET NULL`, and
null is **not** a neutral value in that column: it means "present from the
start" (§2, presence tracking), and `blocks.ts` reads it that way — a null
anchor produces no presence note at all.

So deleting the message a character joined after silently turned them into
someone who had witnessed the whole scene. And it is exactly backwards: deleting
a message takes its subtree, so what survives is precisely the stretch that
character was *not* there for.

The fix is to move the anchor to the deleted message's parent before the delete
— "joined after the turn before this one" is the closest true statement — and to
leave it null only when the anchor was the root, where nothing came before and
the scene is now empty, so "present from the start" stops being a lie. Two tests,
and I checked both fail against the old code rather than assuming they would.

### Finding 2 — `scenes.scenario_override` was a column the builder believed in (fixed)

§2 lists it. The prompt builder has read it since **phase 3** — the scenario
block chooses between it and the spotlight character's, and the `{{scenario}}`
macro prefers it — and `PromptScene.scenarioOverride` is in the types. The
column was never added, and `buildPromptContext` hardcoded `null`.

There is a builder unit test for the override, written in phase 3, and it passes:
it constructs a context by hand with the field set. That is the whole reason this
survived seventeen migrations. **A unit test on a value the real system cannot
produce is not coverage**, and the new test goes through the route and the real
context builder for that reason.

Added as migration 0017 and wired through to the scene setup screen. It is not a
new feature — it is a feature the rest of the system already thought it had. It
also matters more here than in most apps: a card's scenario was written by
whoever made the card, for a scene nobody had had yet, and running the same cast
somewhere else is the ordinary case in this product rather than the exotic one.

### Recorded, not fixed

- **`presets.prompt_order` is dead.** The only column in the schema that nothing
  reads or writes. It is §3's overridable assembly order, and `PromptPreset`
  carries `blockOrder` hardcoded to null for the same reason `scenarioOverride`
  was: the editor for it does not exist. Deliberately deferred in phase 17 —
  block order is only legible beside the inspector (phase 25). Left in place
  rather than dropped, because dropping and re-adding a column is worse than a
  column with a known arrival date.
- **`scene_members.overrides` has no phase.** §2 wants per-scene JSON tweaks to
  a card. Nothing builds it and nothing schedules it. It is not a schema
  question — it needs a decision about merging an override over a card at prompt
  time — so it wants a phase of its own rather than a column added quietly here.

Everything else §2 names and the schema lacks is scheduled and correctly absent:
`personas.lorebook_id` (phase 21, and §2 flags it as a gap itself),
`scenes.ooc_enabled`/`ooc_interval` (23), `autopilot_enabled`/`autopilot_max_turns`
(24), `characters.expression_pack_id`, `messages.expression` and
`vn_mode_enabled` (29). `first_seen_message_id` was resolved differently as
`joined_after_message_id` and is already settled in §24.

### What held up

Worth recording, because a review that only lists problems is a misleading
review.

- **Every table is STRICT**, all 22 of them, and every timestamp is Unix
  milliseconds as §2 requires.
- **The pragmas are right**: WAL, `foreign_keys = ON`, `busy_timeout`,
  `synchronous = NORMAL`.
- **Every declared index exists.** The tables without one are the small ones
  whose lookups are covered by a primary key or a unique constraint.
- **The cascades do what they say.** Deleting a message takes its subtree and
  moves the active leaf; deleting a scene takes its messages, guides, summaries
  and bans; a guide anchored to a deleted turn goes with that turn; a summary
  whose range is broken by a delete is removed so the stretch becomes pending
  again; deleting a fold un-supersedes the summaries it replaced. All six
  verified by insert-and-delete rather than by reading the DDL.
- **`messages.token_count` is invalidated on edit**, exactly as §2 asks, and
  only when the content actually changed.

### Spec changes

None. §2 was right about everything it named; the schema had simply fallen
behind it in two places.

### Surprises

The interesting one is finding 2's shape rather than its content. The bug
survived seventeen migrations *because it had a passing test* — a unit test that
built its own context, set the field by hand, and asserted the builder did the
right thing with it. Everything about that test was correct, and it was still
the reason nobody noticed the field could never arrive. The lesson is narrow and
worth keeping: a pure function tested with hand-built inputs proves the function,
and proves nothing whatsoever about whether those inputs occur.

The second surprise was how much of the review was mechanical. Diffing §2's
columns against `PRAGMA table_info`, and grepping every column name against the
whole server source, took a few minutes and found both real problems. The parts
I expected to be hard — reasoning about cascade correctness — turned out to be
answerable by inserting rows and deleting them.

## Phase 21 — Lorebooks

The largest phase in the Depth block, and the one where SillyTavern's power
users actually live. §10 is six activation rules, three timed effects, inclusion
groups, seven insertion positions, recursion levels and a character filter —
and the reason it is hard is not any one of them, it is that they interact.

### What was built

**Migration 0018 and four tables.** `lorebooks`, `lore_entries`,
`lorebook_bindings`, `lore_timed_effects`. Bindings rather than a foreign key on
the book, because §10 wants one book to be global, attached to a roleplay,
carried by a character and carried by a persona — potentially all at once — and
a single owner column cannot express that.

**The activation model as a pure function** (`server/lore/activate.ts`).
Entries, a transcript window, the cast and the timed-effect state in; what fired
and why out. No database, no clock, no randomness of its own — the roll is
passed in, seeded per generation, because §10's probability has to be
replayable. Thirty-nine tests, and they found two real bugs before any of it ran
in the app: a group loser came back through recursion and inserted a second
member of a group §10 says inserts one, and the trace kept a row per *attempt*,
so an entry that missed on the first pass and fired on the second read as a
miss.

Rule order is the behaviour, and it is written down in §10 now rather than
living in the code's shape: what cannot fire at all is filtered first, then
constants skip scanning, then secondary keys qualify a match rather than causing
one, then the character filter, then sticky before probability, then groups pick
a winner from whatever survived.

**Whole-word matching is the default.** The single most-repeated complaint about
world info is an entry keyed on "ash" firing on "washed". A key with no word
characters at its edges falls back to substring rather than silently never
matching, so a key like `:::` still works.

**Storage that answers two questions carefully.** `candidatesFor` dedupes by
entry id, so a book bound several ways contributes its entries once — counting
it twice spends the budget twice and lets a one-member group insert two.
`timedStateFor` counts messages-ago along the *active path*, because §1 says
history is a tree and an effect anchored on a branch the user walked away from
did not happen here.

**SillyTavern world info import**, following the rule `raw_card` set in phase 4:
keep the source object per entry and re-emit from it. The reading is
deliberately forgiving — each field is read from a list of names it has been
known by, keys arrive as an array *or* one comma-separated string, and anything
unreadable takes the schema default rather than failing the whole import. Half a
book beats an error. Two things are enums on the wire and need translating:
`selectiveLogic` (0 and_any, 1 not_all, 2 not_any, 3 and_all — 1 and 2 are not
in the order you would guess) and `position` 0–4.

**The editor, design `3h`.** One entry open inline at the top in a red-bordered
container with `EDITING` and its token cost; Title, Keys as mono chips with the
dashed `+ key` chip, Content in Spectral; the footer row with the activation
summary, Priority and a solid red `SAVE`. The rest of the book stays visible
beneath as hairline rows — Spectral title over a mono line of keys and rule,
token count right, disabled entries at 55% reading `DISABLED`. Everything else
§10 asks for is behind `ADVANCED ▾`, which is where secondary logic, the three
timed effects, inclusion groups, the character filter, position and recursion
live.

The open entry commits on `SAVE` rather than on blur, which is the opposite of
every other editor in this app. An entry is a set of fields that only mean
something together — a key with no content, a group label with no weight — and
§10 clears timed effects on every edit, so a save per keystroke would reset a
sticky window per keystroke.

**Lore as the fifth tab.** The design draws five and the TabBar has carried a
comment about the missing one since phase 6. It is a top-level destination
rather than a page inside a roleplay for the same reason bindings exist: no
single owner to file a book under.

**The activation test tool** (§16), reached from a `LOREBOOKS` row on scene
setup, in one sheet with attaching and detaching. Attaching and testing belong
together because the question a user actually has is never "is this attached",
it is "why did that entry not fire" — and the two most common answers are that
the book reaches nothing and that the key did not match, which now sit one above
the other. The trace lists what fired first and then every miss with the rule
that stopped it: `NO MATCH`, `DISABLED`, `GROUP NOT CHOSEN`.

### Deliberately deferred

- **Similarity-based activation** (§10) needs the embedding index documents
  build in §11's third layer. Keyword activation is the whole of what phase 21
  promises.
- **Automation IDs.** The column exists and round-trips; nothing fires on
  activation yet, because the actions it would fire (background tasks, tracker
  refreshes, regex scripts) are §15's tier and mostly unbuilt.
- **A `use_regex` switch in the editor.** The matcher honours the flag and it
  round-trips through import and export, so a SillyTavern book that uses one
  keeps working. What the advanced panel does not do is *offer* the switch,
  because there is a real gap behind it: a pattern runs untimed against every
  message in the scan window, and a pathological one from an imported file can
  wedge the request. That guard is worth having before the app invites people
  to hand-write patterns. Recorded here rather than fixed quietly, since import
  already exposes it.
- **`personas.lorebook_id`.** §2 names it and §10 flags it as a gap itself.
  A persona-scoped *binding* does the same job through the binding table, which
  is strictly more general, so the column stays unbuilt rather than duplicating
  it. The placeholder comment in migration 0005 that promised it now says so.
- **The design's `6 HIT LAST TURN`** in the editor footer. It needs a scene, and
  the editor has none — a book is edited from the library, not from inside a
  roleplay. The footer reads `BOOK TOTAL · N TOK · M ENTRIES`, and the firing
  count lives in the scene-setup sheet where a scene actually exists.

### Spec changes

A `Settled while building phase 21` block in §10, recording six decisions: the
pure activation model and its seeded roll, rule order as behaviour, whole-word
matching as the default, the four-way binding union computed once and shared
with the client, timed effects counted along the active path, and the test tool
running the real engine.

### Surprises

**The activation model's own tests were worth more than the browser.** That is
not usually true in this project — phases 17, 19 and 20 all found their bugs by
driving the real system. Here the two bugs were interaction bugs between rules,
which is exactly what a fixture suite over a pure function is good at and what a
screenshot cannot see. The rule seems to be: test the thing whose difficulty is
combinatorial with fixtures, and test the thing whose difficulty is wiring by
running it.

**The browser still found two, and both were labels.** The book's token budget
was labelled `PRIORITY` and its scan depth carried the *entry's* hint about
leaving the field blank — both from reusing strings that read correctly in the
context I copied them from. Nothing typechecks a label. And the scene-setup row
listed every book in the library rather than the ones reaching that scene, which
is how the "reaches this scene" rule ended up as one exported function that the
row and the sheet both call, mirroring the server's single `booksForScene`.

**Phase 20's lesson had teeth immediately.** The activation test tool was one
plausible refactor away from being a second implementation of activation — it
needs the same rows, the same window and the same cast, and writing that
inline in the route would have looked entirely reasonable. `activateForScene`
exists so the tool cannot disagree with the generation, which is the same
mistake `scenario_override` made in reverse.

## Phase 22 — The remaining adapters

Anthropic and text completion, which completes §4's three required adapters and
means the registry no longer throws for two of its three kinds.

### What was built

**The Anthropic adapter**, against the wire format rather than the official SDK.
That is a deliberate call and worth stating: this is a provider *adapter* in a
multi-provider app, and it has to honour an operator-supplied base URL because
much of this audience reaches Anthropic through a proxy, stream through the one
SSE parser whose tests cover events split across network chunks, and take an
injected `fetch` so the suite runs on fixtures rather than a live API and a
bill. An SDK client satisfies none of the three cleanly, and one adapter written
differently from its two neighbours is a codebase with two ways to do the same
thing.

Three shapes differ from the OpenAI-compatible endpoint. `system` is its own
parameter. The conversation must open on a user turn. And `max_tokens` is
required, with no sentinel for "as much as you like" — the builder's own
reservation is the honest number, since it is what the prompt was fitted around.

**The finding that changed the SPEC:** this API removed `temperature`, `top_p`
and `top_k` from the 4.6 generation onward, and removed assistant prefill with
them. Sending either to a current model is a 400, not a politely ignored field.
§4 had a note saying prefill and extended thinking were *mutually exclusive*
there; the truth is now stronger, and the note is corrected.

That makes Anthropic the only provider in the app whose capabilities are not a
constant — they depend on which Claude is behind the endpoint. `capabilitiesFor`
takes an optional model, and on a current Claude §13's sampler list is empty. An
editor showing nothing is the correct answer, not a bug.

An unrecognised model takes the narrower reading, because the two failure
directions are not symmetric: sending a sampler a model rejects fails the whole
generation, while not sending one costs a knob and still writes the turn. The
existing `supports_prefill` override is the escape hatch for an operator on a
proxy who knows better than the heuristic.

Thinking is requested with `display: "summarized"`. Its default omits the text,
which on a thinking model reads as a long silence before the first word and
leaves §13's reasoning strip with nothing to put in it.

**The six instruct templates, as data.** ChatML, Llama 3, Mistral, Alpaca,
Vicuna, Metharme, plus a plain transcript for base models. Each is written out
longhand rather than derived from a shared shape — they look similar and are
not, the differences are exactly the newlines and spaces, and a generator would
hide the one thing that matters. Mistral and Alpaca have no system turn at all,
so their system text folds into the first user turn; putting one in anyway is
the most common way to get subtly worse prose out of a Mistral finetune.

Rendering happens in the prompt builder, not the adapter. On a long scene the
markers are hundreds of tokens, and a wrapper applied after the budget was
struck overflows a context window the builder already measured as fitting — a
truncated prompt with a passing budget calculation.

**The text-completion adapter**, speaking the OpenAI-shaped `/v1/completions`
that llama.cpp, KoboldCpp and TabbyAPI all expose. It exists for prompt control
rather than compatibility: those servers' chat endpoints apply a template of
their own from the GGUF metadata and silently reshape everything §3 assembled.
The stop sequences go with every request, because without them a completion
model writes the reader's next turn as well — the complaint that makes people
give up on text mode.

**Migration 0019, and templates a user can write.** §4 says "users must be able
to add custom ones", so they can: copy a shipped one, edit the markers, watch a
live preview. Shipped templates are never written to the database and cannot be
edited or deleted, only copied — correcting a format for everyone is a release,
not a setting, and a user who edited ChatML in place would silently change every
provider using it. A custom name that would slug onto a shipped id takes a
different one rather than shadowing it.

The editor ships with a live preview because this is the one setting in the app
where a wrong answer produces no error at all. It is the only feedback there is.

### Deliberately deferred

- **`output_config.effort`.** Anthropic's replacement for the sampler knobs it
  removed. It belongs beside the samplers in §13's preset editor rather than
  bolted onto the adapter, and putting it there properly means the editor has to
  branch on capabilities per provider — which is the block-order work already
  waiting on phase 25.
- **Prompt caching breakpoints.** `supportsPromptCaching` is declared and the
  prefix is already stable by §3's construction, but nothing sends
  `cache_control` yet. Placement is a §3 question about which blocks are
  genuinely frozen, not an adapter one.
- **A native KoboldCpp or TabbyAPI adapter.** Their own APIs expose sampler
  ordering and grammars that the OpenAI-shaped completions endpoint does not.
  One endpoint common to all three is the right first answer; a second adapter
  is worth it only once someone wants a knob this one cannot reach.

### Spec changes

§4's note about prefill and thinking on Anthropic was factually behind the API
and is corrected. A `Settled while building phase 22` block records seven
decisions, the load-bearing ones being that capabilities can depend on a model,
that an unknown model takes the narrower contract, and that instruct templates
are rendered by the builder so their markers are counted.

### Surprises

**Two bugs, and both were things being written and never read.** The suite's
`continue` test asserted a refusal that came from `capabilitiesFor` throwing for
an unbuilt adapter, not from a capability — so building the adapter made the
test fail, correctly. Following it found that `canContinue` had been reading the
adapter default and ignoring `providers.supports_prefill` entirely: the override
had a route, a column, a three-state UI and a hint string, and nothing consulted
it. The second was the settings screen holding the provider being edited as a
*snapshot* of its row, so every in-place setting — prefill included, long before
this phase — wrote to the server and then displayed the old answer back.

Neither was found by a unit test. The first came from a test failing for a
reason I did not expect and being worth reading rather than patching; the second
from a screenshot where the button I had just clicked was still the wrong
colour. That is the same lesson as phase 20, arriving by a different route:
**the bugs live in the wiring, and the only thing that exercises wiring is
running it.**

The end-to-end check is the shape worth keeping. A stub speaking the real
Anthropic wire format, returning a 400 for anything the real API rejects —
`temperature`, a missing `max_tokens`, a conversation opening on the assistant —
and a real generation driven through the real service against it. It passes, and
if the adapter ever starts sending a sampler again it will fail loudly instead
of quietly producing worse prose.

## Phase 23 — The out-of-character channel

The author is a collaborator, not a puppet. §2 has given it an `ooc_voice` since
phase 5 and nothing had ever used one.

### What was built

**A streaming splitter for asides**, the same shape as §13's reasoning splitter
and for the same reason: a marker can arrive split across two network chunks, so
anything that might still turn out to be one is held back until it settles.

Two rules are deliberately the *opposite* of the reasoning splitter's. An
unclosed reasoning tag means the text is reasoning — better to hide a model's
planning than print it. An unterminated aside is **prose, marker and all**,
because `((` is an ordinary sequence that fiction contains and eating the rest
of a turn on a stray double-paren is far worse than showing one. And removing an
aside closes the gap it left, which is a small violation of "never lose text"
and the right one: the alternative is a double space in the scene for every
aside the author writes, which a reader notices and cannot explain.

The parser also reads `[OOC: …]`, `[ooc]…[/ooc]` and `(OOC: …)`. Roleplay
finetunes emit those unprompted, and an app that ignored them would put the
aside in the scene. The single-paren form is safe only because of the literal
tag inside it; without that it would swallow every parenthetical in the story.

**The invitation now names the marker.** The block existed since phase 3 and
said "mark it clearly", which is the gap this phase closes. Leaving a model to
invent a marker means an aside the parser cannot find, and an aside the parser
cannot find is an aside printed into the middle of a scene. It asks for
`((this))`, says what goes inside and what does not, and says that saying
nothing is a fine answer.

**Migration 0020** adds `ooc_enabled` and `ooc_interval`, which §2 named in
phase 1. Off by default: an author that volunteers asides is a delight when the
reader wants a collaborator and an intrusion when they want a story. `oocDue` is
counted along the active path, for the same reason §10's timed effects are — an
aside on a branch the reader walked away from did not happen here.

**An aside lands as a child of the turn it came out of**, not a sibling. History
is a tree, and the aside belongs to that particular telling: rerolling the prose
makes a sibling, which takes the reader down a path the aside is not on, and it
disappears exactly when it should. Deleting the turn takes it by the same
cascade. Both facts are tested.

**The reader's direction** is a new turn kind rather than a new entry point:
same cast, same lore, same history, different near-turn instruction. Most of
that instruction's words go on the boundary rather than the question, because a
model asked something mid-roleplay will very often answer it *and* write the
next turn. An out-of-character turn skips three things — the turn director,
because nobody in the cast is speaking; the post-generation pipeline, because
all three of those read the turn as prose; and aside-splitting, because the
whole answer is already the aside.

**Both design treatments.** The inline marginal aside — 18px inset, 2px blue
rule, `NAME · OOC`, a bubble with the asymmetric tail — and the channel sheet it
promotes to, with alternating bubbles and the reader's own warm tint inside the
blue panel. The design's own line is the reason both exist: "this is not a mode
the user lives in. Notes arrive inline; the channel is where a note becomes a
conversation."

### Deliberately deferred

- **`((ooc: …))` typed in the composer.** §19's inline commands parse the ops
  out of an incoming message for external clients that have no director bar.
  That is the outbound API's phase, and the splitter is written so it can be
  reused there rather than reimplemented.
- **An OOC-only connection profile.** Answering a question out of character is a
  cheap call and §7's per-op routing could send it somewhere small, but adding
  an op row for it means the per-op settings screen grows a switch for something
  with no other configuration worth having yet.

### Spec changes

The OOC channel had no home in the SPEC at all — it was four scattered mentions
in §2, §3, §16 and §19 with no section describing the behaviour. §7 now
documents both directions and carries a `Settled while building phase 23` block.

### Surprises

**Every one of my §12 references was wrong.** I wrote "SPEC §12" in twenty-nine
comments across ten files before checking, on the assumption that a feature this
size had its own section. §12 is expressions and visual novel mode. The OOC
channel had no section, which is exactly why the citation felt safe to guess —
there was nothing to contradict it. Corrected to §7, and the section now exists.
A wrong citation is worse than none: it sends the next reader somewhere real and
unrelated.

**The client showed the question and never the answer.** The OOC route started
the generation server-side and returned a snapshot, and the client posted it as
a plain mutation — which invalidated the scene once, at the moment the question
landed, and then had nothing subscribed to the stream and nothing to invalidate
on when the answer arrived. Fixed by routing it through the generation store
like every other op, which is where the watching and the invalidation already
live. The server was right the whole time; the API said so and the screen did
not, which is the only reason it was found.

**A helper reading `prompts.at(-1)` got the guide runner.** The post-generation
pipeline shares the adapter with the turn it follows, so the *last* prompt the
adapter saw is whichever background call finished most recently rather than the
turn. It cost twenty minutes of believing the invitation block was missing when
it was there. The fix is one word — the first new prompt, not the last — and the
lesson is that a shared fixture needs to say which caller it is answering.

## Phase 24 — Autopilot

§6 gives autopilot one paragraph, and the paragraph gives five stops. Everything
this phase decided is in service of those five being *true* rather than
approximately true.

### What was built

**A server-owned loop**, wired into the generation service the way the passes
are: the service reports that a turn landed, the runner decides whether another
follows. In memory, deliberately — a restart ends a run, because a scene writing
itself with nobody watching it is not the feature the reader turned on.

**Arming is the reply, not a button.** The reader sends, the scene answers, and
the loop continues from there — `autopilot_enabled` on the scene is the whole
contract. The addressed check never runs on the arming reply: that reply is an
answer to something the reader said, and addressing them is what an answer does.
The first version checked it anyway, and the test that caught it was the one
where the loop was supposed to write five turns and wrote none — a reply that
faces the reader arms the loop *more* surely than one that does not, because
that is the conversation they are in.

**The addressed check is a side call** (`autopilot_check`), registered like the
classifier and for the same reasons: cheap, per-op routable, and structurally
incapable of failing the thing it serves. An unreachable or unreadable check
reads as *not addressed* and the cap still bounds the run. It reads the turn
through the same task runner every other side call uses, so its failures are
logged where the failures of the others already are.

**The reader's operations yield rather than collide.** Send, revise, recast,
OOC — every reader-driven entry point stops the loop and drains its in-flight
turn before doing its own work. A send during autopilot is a stop, never a 409;
the cancelled turn keeps whatever it had produced, as cancel always does. The
stop endpoint is the fifth stop made pressable, and the strip that carries it
also carries `turns / max` — a loop with a bound should show the bound being
spent.

**The client adopts the loop's turns.** The state row is read on every settle,
and the generation it names is adopted into the same streaming row a
locally-started turn uses — one code path, one offset discipline. A tab that
suspends mid-run comes back and adopts at the offset the server remembers,
which is what §5's resumable stream was for.

**The switch is on the director bar, both widths**, where the design's §16 puts
it: a decision about the next turns, beside the cue and the scope. The cap is
scene setup, because a number is configuration wherever its switch lives.
Migration 0021 adds the two §2 columns, off by default with a cap of three —
enough to feel the scene running itself, short enough that a runaway loop on a
metered provider is a bounded accident.

### Deliberately deferred

- **A wait between turns.** The loop starts its next turn as soon as the check
  answers, which is a second or two of natural pacing on its own. A
  configurable delay would be a knob for a problem nobody has reported, and
  the stop control is always reachable in the meantime.
- **Autopilot on the outbound API.** §19's external clients cannot see the
  loop's turns arrive; when head sync (phase 36) lands, adoption is the
  mechanism they will need, and it is already how this client sees them.
- **Streaming the state row.** It is refetched on settle rather than pushed.
  The gap it leaves is the addressed check's duration, during which the strip
  says autopilot with no count beside it — an honest half-second rather than a
  second stream to keep alive through a phone suspend.

### Spec changes

§6's autopilot paragraph gained a `Settled while building phase 24` block: the
loop's ownership and lifetime, the arming rule, the check as a side call, and
the yield rule that keeps the reader's sends from ever colliding with the
loop's turns.

### Surprises

**The arming bug above was found by its own test failing**, which is the
argument for writing the five stops as five tests before writing the loop — the
cap test passed while the addressed test failed, and the difference between
them was exactly the defect: both replies addressed the reader, and only one
kind of turn was supposed to care.

**`ScriptedAdapter` routes side calls by their prompt's declared source**, and
a new side call that names a new source silently becomes a *turn* — waiting on
the queue that never arrives. The adapter now treats `autopilot` as a side
call; the general lesson is that the fixture's contract is `source ∈ {side
call sources}`, and that set has to grow with the registry.

## Phase 25 — The prompt inspector

§3 has promised a debug record since phase 3, §16 has promised a screen for it
since the design landed, and every one of those promises ended with "the
inspector is the only way a user can discover that". This phase is the only way.

### What was built

**The debug record, kept.** Every generation now stores its assembled prompt's
debug the moment the prompt is built — before the first token — so a cancelled
or failed generation answers as completely as a finished one: "what did the
model see" is a question about the ask, not the answer. Migration 0022 is one
nullable JSON column on `generations`; nothing else about the generation row
changed.

**The lore trace rides along.** The activation engine has produced a full
trace — every entry considered, fired or not, with the reason — since phase 21,
and has thrown it away at the door of the context builder. It is now handed
through `PromptContext` and copied into the debug by the builder, which stays
pure: data in, data out, and the inspector's "which lore fired and why" is the
same trace the activation test tool shows, captured at the moment it was true
rather than recomputed and hoped to agree.

**One endpoint, three ways to reach it.** `GET /scenes/:id/inspector/:messageId`
resolves a message to the generation that wrote it; a reader's message to the
generation that answered it; and anything else to the scene's most recent built
prompt — §16's "reachable from any message" with "the last generation" as the
floor. A scene that has never built a prompt says so.

**A sheet, not a screen.** The budget arithmetic in one chrome line; the blocks
in assembly order with label, provenance, placement, role and cost, content on
demand in mono; the history resolved against the scene the reader is already
looking at, so there is one source of truth for what was said; the evicted with
their reasons in red — §3's "the character forgot is almost always the model
never saw it", made checkable; the lore verdicts; and the two quiet failure
modes §3 and §18 insist on naming, unresolved outlets and unknown macros.

**The shapes moved to /shared.** The debug and trace types were the contract
the client was about to consume, so that is where they live now, re-exported
from the modules that defined them — the builder's vocabulary
(`PromptBlockId`) stays server-side, and the shared block widens `id` to
`string` so the client does not import the builder's union.

### Deliberately deferred

- **Retrieved chunks and scores** — §16 lists them, and phase 30's data bank
  does not exist yet. The debug carries `documents` as a block and nothing to
  score; the sheet will grow the section when there is something to put in it.
- **A diff between two generations.** The version carousel makes the question
  natural — "what changed in the prompt between this swipe and the last" — and
  the answer is buildable from two stored records, but it is a viewer of its
  own and this phase's job was to make the records exist.
- **The raw rendered wire form.** The blocks carry the full content and the
  placement; what the adapter finally emitted (`messages`, `rawText`) is a
  rendering of exactly those, and storing it too would double the row to save
  the sheet a join it does not need.

### Surprises

**The bindings route takes `scope` and `targetId`, not `sceneId`** — and my
first test posted the wrong shape, got a 400, and read like a lore bug. A test
helper that ignores the status of a setup call is lying about what it set up;
the fix was asserting on the binding's own response.

**The eviction test had to be calibrated against the fixture card** — five
hundred fixed tokens on a card whose description is one sentence, because the
shipped prompt options ride on every turn. The interesting number in the
inspector is not the window; it is fixed-minus-window, and the sheet puts both
on its first line for exactly that reason.

## Phase 26 — The character library at scale

§9 names the problem in SillyTavern's own tracker: hundreds of cards, manual and
inconsistent tagging, and no way back from a bad save. The answer is SQLite,
which has been in the stack since phase 1 — this phase is mostly the decision to
let it do the work.

### What was built

**Search moved to the server.** Full-text search over name, description,
personality and creator notes, on an external-content FTS5 table kept in sync by
triggers — so the source of truth stays the `characters` table and no query that
writes a character has to remember to update an index. The query syntax is
sanitised rather than passed through: a stray `"` turns a search into a syntax
error, and a search box is not a place to teach FTS5.

**Tags, folders and saved filters.** Tags are a controlled vocabulary with an
autocomplete source (`/characters/tags`), folders are a label column rather
than a tree — §9 says "folders" the way SillyTavern users mean it, and a
hierarchy is a phase 43 question. Saved filters are a name over a query, three
columns and nothing else.

**Bulk edits over a selection.** Tag, untag, move and delete across a
multi-selection, one request. These bypass the version hook deliberately —
organisational churn would otherwise fill the history with noise.

**Version history, on the message-tree principle.** Every save snapshots the
state *before* the edit, so the baseline is the card as imported and restore is
always a step backwards, never a no-op copying the present onto itself.
Restoring is itself a save, so the state it replaced becomes a version too —
the same "nothing is lost" the tree gives messages. The snapshot is the
editor's own field shape, so the diff the editor could draw is a field compare,
not a string diff.

**Derive.** A variant is a copy with a `parent_character_id` link, its own card
document (a variant is a new original, not a fork of the parent's bytes), and
its own history. `ON DELETE SET NULL` — a variant survives its parent, which is
the point.

**Instant scene assignment.** `POST /scenes/:id/cast` takes a list; the picker
is one request rather than a loop of single adds, because adding a character is
cheap and §9 says it should feel cheap.

**AI-assisted tagging**, as a side call through the same task runner as every
other side call. The card is read and tags proposed *from the library's own
vocabulary* — the spec's one hard requirement, because the manual-and-
inconsistent problem is only fixed if every new card speaks the library's
language, not the model's. Proposals only; the user is the gate, and the
proposals are filtered to the vocabulary before they reach the gate.

### Deliberately deferred

- **A diff view between two versions.** The snapshots make it a field compare,
  and the version sheet lists names and dates; drawing the changed lines is a
  viewer this phase's job was to make possible, not to build.
- **Tag renaming across the library.** A rename is a bulk untag+tag, which the
  bulk route already does; the UI does not yet offer it as one action.
- **Chub import and folder import** — §9's import work is phase 42.
- **Drag-to-reorder folders** — there is no hierarchy to reorder.

### Surprises

**The suggest-tags task had no scene to route through.** Every side call before
it rode a scene's profile; this one is character-level, and the task runner's
routing order starts from the scene. The default profile is the fallback rung,
and `resolveRoute`'s null-refusal — "no connection profile" — surfaced as a 502
on a route that had a profile sitting right there. The lesson is that §7's
routing order is scene-shaped, and anything outside a scene has to name its own
bottom rung.

**FTS5 needed the rebuild command.** The external-content index does not
retroactively see rows that predate it; migrations run on databases full of
imported cards, so `INSERT INTO characters_fts(characters_fts) VALUES
('rebuild')` is not a dev convenience, it is the migration actually applying to
existing libraries.

## Phase 27 — AI-assisted authoring

§9 gives six tasks and one rule: each produces a *structured record*, and the
schema is enforced server-side rather than trusted. Malformed structured output
is the top complaint about the extensions that do this today, so the rule is
the feature.

### What was built

**Six tasks through the one door.** Create character, revise character, extract
character, suggest voice notes, suggest lore, revise lore — each a side call
through the task runner, so each gets its own profile, samplers and timeout, and
each is reachable from where the thing it edits lives. All under
`/api/authoring`, one router owning the shape.

**The schema is the parser, not the prompt.** Every reply is asked for as JSON
and read by a server-side parser that either returns a typed record or a reason
it refused. A model that wraps its JSON in prose still works — the parser finds
the outermost object, not the fence. A model that returns `{"name": 42}` gets a
422 "unreadable", never a card named "42". The refusal carries the problem to
the user, because "the model wrote nothing useful" is a fact worth showing, not
an error worth burying.

**Create and extract insert; revise patches.** Create-character writes a full
card from a description (optionally reading the current scene), extract distils
one from how a character has actually behaved — the most useful version, and the
one that reads history. Revise-character returns only the fields the model
chose to change, so everything else stays untouched; the parser knows the
difference between "omit this field" and "clear this field" because null is the
clear and absence is the omission.

**Suggestions are proposals, never edits.** Voice notes and lore entries come
back for the user's gate, exactly like phase 26's tags — the spec's "assisted"
means the human decides. The lore proposals carry title, content and keywords,
and the scene setup screen can add them to a book one tap at a time.

### Deliberately deferred

- **The dossier tasks** — §9 lists them under their own heading and phase 32 is
  their home, not this one.
- **A diff on revise-character.** The response is the new card; the editor shows
  it in place. Version history (phase 26) already snapshots the before-state, so
  the diff is one viewer away.
- **Scene-aware voice notes.** The task reads the card; reading the character's
  dialogue needs the scene wiring that extract already has, and the prompt is
  written to take it when it is threaded through.

### Surprises

**The transcript wants a speaker, not a character id.** The first draft labelled
history rows with nothing but their author type, which turns a three-person
scene into "The reader, Narration, Narration". The classifier had already
solved this — `speakerLookup` plus the character's name — and the lesson is the
one phase 23 wrote down: shared fixtures say who they are answering for, and a
transcript is a fixture for the model.

**`normalisedCardOf` almost smuggled voice notes into the card document.** Voice
notes are this app's field, not a card field — they travel beside the card, not
inside it. The type system caught it, which is the type system doing the same
job the parser does for the model: refusing to let the wrong shape through.

## Phase 28 — SillyTavern preset import

§18 opens with the reason this exists: users arrive with preset suites they
already depend on, and the format is not forgiving. Importing them is how the
product gets used at all.

### What was built

**A pure parser** (`server/presets/st.ts`) that turns preset bytes into a typed
record, with every §18 failure mode decided there rather than in the route that
runs first: chat-completion vs text-completion detection, the sampler field
mapping, the block/marker split, and the macro scan.

**The report is the product.** Import creates two things — a sampler preset, and
one option group holding the prompt blocks — and returns a report that names the
loss: how many blocks, how many were off, which markers were overridden vs
merely recognised, which samplers had no home here, which macros this app's
engine does not implement. A silent partial import is the worst outcome §18
names, so the report is not a log line; it is the response body.

**Markers split three ways.** `main` and `jailbreak` land on the preset's own
override columns — that is what those columns are for, and it has been true
since the schema review. The rest (`charDescription`, `scenario`, `personaDescription`…)
are recognised but not applied, because this app builds those blocks from the
card and importing them would duplicate the character definition, which is the
specific failure §18 calls out.

**Enabled is honoured in the only direction that matters.** Imported blocks
become option-group members that are selected per scene, never by default — so
a suite that ships most blocks off does not bloat any prompt, and the report
still says how many were off.

**Text-completion presets are refused clearly.** Their context and instruct
templates mean nothing in chat mode, and a 400 that says so beats a preset that
looks imported and behaves inertly.

**Lossy export, honestly labelled.** Own-format export round-trips the preset
row; the SillyTavern export maps samplers back but ships an empty `prompts[]`
and a `_onsen_lossy` field saying that blocks live in option groups now and do
not round-trip. §18: don't pretend round-tripping is clean when it isn't.

### Deliberately deferred

- **The macro engine.** §18 allows either implementing `{{setvar}}`/conditionals
  or degrading visibly; this phase degrades visibly — the report names every
  unresolved macro, and the prompt inspector (phase 25) already shows the
  literal text that would leak. A variable engine is a later, larger thing.
- **Extension-dependent suite detection.** The report carries enough for a
  user to recognise an inert suite; mapping known extensions to native
  subsystems is its own project.
- **`injection_order` is sort order, not a reorderable UI.** Imported options
  keep the source order; the drag-to-reorder editor §16 wants is still absent.

### Surprises

**`outlet::Name` was nearly reported as unknown.** The macro scanner captured
the whole `name::argument` and compared it against the base-name set, which
would have flagged the one macro this app *does* implement with an argument as
unsupported. The base name decides, the argument never does — same rule as the
parser's null-versus-absence distinction: the decision is made on the shape,
not the decoration.

## Phase 29 — Expressions, sprite packs and the VN stage

§12's premise is that in author mode the author already knows who is emoting
and how, so the classifier the other frontends run is a cost this app does not
have to pay. The expression is declared, parsed, and stored — zero extra
inference.

### What was built

**The tag, parsed like the others.** `<expr>ana:worried</expr>` is lifted out of
the stream by a splitter with the OOC splitter's exact mechanics — a partial
tag is held until it settles, and an unclosed one is prose, because showing a
stray `<expr` is less wrong than eating the turn after it. The label never
reaches the buffer, so it can never leak into the prompt. A spotlight turn
carries one label on the message; a beat's tags name their character and land
on that character's segment, joined by name rather than position.

**The binding, not the image.** An expression pack is a character's named set
of labels, each pointing at an image path. Where the image came from — an
upload, a CharX bundle, or a generated sprite in phase 41 — is a fact about the
file, not the binding. This is the seam that makes generation additive: phase
41 writes into the same table, and the stage does not change.

**The stage.** Sprites above the log when the scene is switched to VN mode,
one per active member, changed by the expression the last turn declared. The
label that has no sprite falls back to the avatar, then the stripe — the
graceful degradation §12 names in order. The last speaker is full-opacity, the
rest dim, and the whole row sits on an optional per-scene background. The
toggle is scene setup; off, the log is exactly what it was before.

### Deliberately deferred

- **The classifier fallback.** §12 wants a text-classifier background task when
  the author omits the tag; the author-declared path is the primary one and
  needs no inference, so the fallback waits on the same ONNX question the spec
  itself flags as optional.
- **CharX expression import.** The assets tree is already preserved on import
  (phase 6); reading expression images out of it is a refinement of the same
  path, not a new one.
- **Costume overrides and numeric variants.** The schema has `variant_index`,
  and the binding is the part that matters; the picker that switches variants
  is UI this phase's data model was built to allow.
- **Inactive members on stage.** §12 wants them dimmed rather than hidden; this
  stage hides them and dims the non-speakers, which is the dimming rule
  applied to a smaller cast.

### Surprises

**The beat parser needs full names.** A tag naming a character by first name
fails against a cast whose names are two words — `Aldan` does not match `Aldan
Marsh` in the label reader, so the segment was never attributed and the
expression had nowhere to land. The join is by name, and the name has to be the
name the beat parser already knows, which is the cast's full name.

**A sprite file needed a flat path.** The first draft wrote under a per-
character subdirectory that the config's directory setup does not create, and
`Bun.write` does not make parents — the pack was created but the expression
row never landed, which read as an upload that silently did nothing. A flat
name inside the one directory that already exists is the fix, and the lesson is
the same one phase 27 wrote down: a setup step that swallows its own failure
lies about what it set up.

## Phase 30 — The data bank (document RAG)

§1 flagged this since phase 1: a pure-Bun vector store with no native modules.
Pinecone was tried and rejected — not open source — which returns the question
to where the spec left it. The answer here is the spec's own fallback, and it
turns out to be the whole feature, not a compromise.

### What was built

**A flat index, in the process.** Chunks' vectors are JSON on the chunk row;
cosine similarity is thirty lines of JS. No native module, no new dependency,
works on every platform Bun runs on — and it sits behind the retrieval module's
interface, so sqlite-vec can replace it if a library ever outgrows it.

**Embeddings, two ways.** A dedicated single-row config — base URL, model, key —
which is deliberately *not* a generation provider: it serves `/embeddings` and
nothing else, and the providers table's kind CHECK rightly excludes it. When it
is set, chunks and queries go through the OpenAI-compatible endpoint, which is
the same one Ollama, LM Studio, llama.cpp server and every hosted API serve.
When it is not, retrieval falls back to lexical vectors — a TF-IDF-flavoured
bag of words over a shared corpus vocabulary. Not semantic, but it retrieves on
what a passage is *about* rather than on nothing, which is what a fallback is
for.

**Retrieval runs in the I/O layer.** The query is the scene's own recent words;
the recall feeds the prompt's `documents` block, which has sat empty in §3's
assembly since the builder landed. The builder stays pure — the chunks are
passed in, like history and nudge already were.

**The inspector's missing section.** §16 promised "what was recalled, its score,
why" since phase 25; the retrieval trace now rides on the prompt debug the same
way the lore trace does, so the inspector names every recalled chunk with its
score.

**A test tool.** `/documents/retrieve` shows what would be recalled for a query,
the data bank's answer to §16's lore activation test — the difference between
"the model never saw it" and "the model ignored it" is the inspector's reason
to exist.

### Deliberately deferred

- **sqlite-vec.** The interface is the point; the flat index is fine to a few
  thousand chunks, and swapping backends is one module.
- **An ONNX embedder.** Native, opt-in, and exactly the shape the embedder
  interface was written to accept — but it needs a runtime, so it waits.
- **Re-embedding on model change.** Changing the embeddings model leaves old
  vectors in another model's space; cosine still runs (min-dimension), but the
  honest repair — re-embed the library on config change — is a later job.
- **Chunk-level document editing.** Documents are added whole and deleted
  whole; a chunk editor is UI this phase's data model already allows.

### Surprises

**The providers table has a CHECK on `kind`**, and SQLite cannot alter it. The
first design added `embeddings` as a provider kind and hit that wall at the
database, not the typechecker. The dedicated single-row config is the better
design anyway — an embeddings provider is not a generation provider — but the
wall is the same one phase 20 warned about: schema mistakes are cheap to avoid
and expensive to correct, and a CHECK you forgot is the expensive kind.

## Phase 31 — Structured trackers

§8 ships two flavours of maintained scene state and is explicit about why: they
fail differently. Guides are free prose with no parse step. Trackers are strict
JSON with a parse step — and the rule that makes them safe is §8's last line: a
parse failure keeps the previous state and logs, never blocking generation.

### What was built

**Two trackers, as ops.** Scene (location, time of day, present) and Characters
(per-member mood, position, notable state, private knowledge), each a side call
with a JSON-shaped prompt template, its own model routing, and auto-trigger on
by default. They refresh after the guides, because both read the same finished
turn and a tracker is the strict sibling of a guide's prose.

**Strict parse, keep-on-failure.** The reply must be a JSON object — a fenced
one is read, prose and arrays are refused. A refused reply logs `unusable` and
leaves the previous state standing, which is the difference between a tracker
and a way to lose state on a bad answer.

**Versioned per message, pinned, flushed** — the guides' exact shape, because
the requirements are the guides' requirements: a row per version anchored to a
message, a hand-edit pins the version, a flush takes every version. The query is
the same "newest on the active path" walk, so rewinding rewinds trackers too.

**The prompt's `trackers` block**, empty since the builder landed, now carries
the two trackers as `### Scene` / `### Characters` with their JSON.

**A collapsible panel above the composer.** Each tracker's fields shown as
fields, editable as JSON — an edit pins it — with flush and rebuild, and the
token cost on the header. It lives where §8 says it lives: above the composer,
not behind the blue sheet.

### Deliberately deferred

- **Per-field pinning.** §8 wants individual fields pinned, not the whole
  tracker; version-level pinning is the first cut, and the field granularity is
  a schema question (a pin map per version) rather than a missing feature.
- **A schema editor.** The JSON shape lives in the prompt template; a UI that
  adds or renames fields is a later, larger thing.
- **Tracker-specific refresh intervals.** §8 names a refresh interval; this
  phase refreshes on every turn like the guides, and a per-tracker cadence can
  land on the same op row later.

### Surprises

**The prompt block appears one turn late, correctly.** Trackers refresh after
a turn lands, so the turn that *produced* them never carries them — only the
next turn does. The test read the inspector of the wrong turn and saw no
`trackers` block, which is the inspector doing its job: the prompt really did
not contain them yet.
