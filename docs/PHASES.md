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
