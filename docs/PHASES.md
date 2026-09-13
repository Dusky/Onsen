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

**The client** — an Automation section in Settings: the scripts, the triggers,
a sheet for each, and the test panel inside the script editor rather than
beside it.

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
- **Chub import and folder import** — §9's import work is phase 42. (Folder
  import landed in phase 43 instead; phase 42 was deferred.)
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

## Phase 31 — Schema reconciliation

Not a feature phase; the repair phase 20 did, done again because six migrations
have landed since. The schema review's lesson was that a CHECK you forgot is the
expensive kind of mistake — phase 30 proved it by hitting `providers.kind` the
hard way. This pass writes down what that hit taught, before the depth phases
(dossiers, memory, packs) run into the same wall.

### What was done

**§2 reconciled to migrations 0001–0026.** The data model now names every table
that exists — tasks, option groups, bans, guides, trackers, annotations,
instruct templates, character versions, saved filters, the embeddings config —
and marks every entity that is still only a target: memory, regex scripts,
presence tracking, per-persona lore. The divergences where reality is simpler
than the sketch are recorded rather than papered over: the document store is a
flat index with JSON vectors, not an embedding blob; the expression link runs
`expression_packs.character_id`, not a column on the character.

**Schema discipline written into the handoff.** Three rules, in the Database
section where the next reader starts: new state is a new table, never a new
value on an old CHECK; the exact table-rebuild dance for when a CHECK must
change; and the `characters_fts` rebuild obligation for any migration touching
the searchable columns.

**A migration lint test.** `test/migrations.test.ts` reads the directory and the
registry and asserts they agree, gapless. A migration that exists on disk but
never runs is a silent, expensive divergence, and it is now impossible to merge
one without a failing test.

### Surprises

**The repair was mostly documentation.** Read end-to-end, the schema is actually
healthy: twenty-six migrations, STRICT throughout, no orphaned tables, foreign
keys intact, and the dangerous pattern — widening a CHECK — had only happened
once, and that once taught the rule. The debt was in the *map*, not the
territory, which is the best possible version of schema drift and also the one
easiest to fix with a lint test and a paragraph instead of a rewrite.

## Phase 31½ — The completion sweep

Not a build-order phase; a pass over the half-built things, run after the
schema repair and against DESIGN.md this time. Each item was already a feature;
this closes the loop on it.

### What was done

- **The §16 provider test button.** One round trip to the provider's own
  endpoint, reported with its latency or the HTTP failure — so a bad key reads
  there rather than on the first generation.
- **Autopilot banner reconciled to DESIGN §256.** `AUTOPILOT · N OF M` and the
  stop is `TAKE OVER`, as the design names them.
- **Revise-lore reached its editor.** The lore entry editor has a revise-with-AI
  action that updates title, content and keys from the finished entry.
- **CharX sprite import.** CharX bundles now import expression sprites from
  their `expressions/` tree into the pack, named by filename stem, with the
  count reported rather than silent.
- **Global documents.** The data bank gains a visible-in-every-scene toggle.
- **The character grid is virtualized** (`@tanstack/react-virtual`), three to a
  row, only visible rows mounted — DESIGN §289.
- **The character editor's SPRITES tab.** DESIGN §295 gives sprites their own
  tab; they had been buried in Advanced.

### Still outstanding, deliberately

- **The message log's virtualization landed after this entry was first
  written.** It is the same pattern as the grid: `@tanstack/react-virtual`
  dynamic measurement, behind a 200-message threshold so short scenes keep the
  exact plain render, the live tail (streaming turn, stop strip) in normal flow
  below the virtualized area, and the virtualizer owning the follow-to-bottom on
  new messages. It builds and the suite passes; it still wants the three visual
  checks — a long scene scrolling smoothly, a streamed turn growing under the
  fold, and swipes/rewind landing correctly — on a real device.
- **The LORE tab** in the editor (§295) belongs to character-bound lore, which
  is phase 32's dossiers and their ilk, not this pass.

## Demo content and the author's own user guide

Not a build-order phase; a first-run fill. Two things seeded together because
they serve the same first run: a cast to talk to, and a scene where the author
already knows how the app works.

- **A demo cast** — Elira Voss (the innkeeper), Dusky (the tracker) and the
  Warden, with distinct voices and example dialogue — plus the author Mara and
  a "You" persona, in a scene called *The Last Inn* with an opening line. A
  "Load the demo cast" button on the empty library creates it all, idempotently.
- **The user guide is the data bank's first global document.** A concise,
  user-facing guide — not the dev spec — is ingested as a global document, so
  the author can be asked "how do I make a beat" or "what is a lorebook" and
  retrieval answers it from the same path that recalls any other reference
  material. This is the data bank dogfooding itself.

## Field fixes and settings work, between the phases

Not build-order phases; the small, load-bearing things a reader asked for
while using the app, each landed as its own commit.

### The migration that had been edited after it ran

The data bank's `embeddings_config` table was briefly appended to migration
0025 *after* a live database had already applied version 25 — so that install
never got the table, and the demo seed's document ingest failed with
`no such table: embeddings_config`. The fix: 0025 was restored to what actually
ran, and 0027 carries the table, so fresh databases and the drifted one
converge. This is the trap the registration lint *cannot* catch (the file stays
registered), and the 0027 header records it for the next reader.

### Generation-start failures are shown, not logged

A refused POST — the scene has no connection profile, a bad request — used to
land only in the browser console. It is now a red strip above the composer with
the reason, a one-tap **Set a profile** for the no-connection case, and a
dismiss. The store keeps `startError` apart from `active.error`: a turn that
never began is a different thing from a stream that died. The demo scene is
seeded with the default profile and preset, because a demo that cannot generate
is a broken demo.

### Pulling a provider's model list from its own API

A **Fetch** button beside the model field — in the provider editor and again in
the profile editor — queries the provider's own endpoints and fills a datalist,
so the reader picks from what the endpoint serves instead of typing a model
string. The endpoints are tried in order and normalised the way SillyTavern's
backends do (OpenAI `/models`, Ollama `/api/tags`, Tabby `/v1/model/list`). The
call is server-side: the key crosses transiently and is never stored.

### A reply that appeared only on refresh

The scene refetch was wired to run after the SSE reader loop closed, which a
proxy or a dropped connection can leave hanging past the moment the reply had
already landed in the database. The fix moves the invalidation onto the
terminal event itself — the one place guaranteed to run — so the message shows
the instant `done` arrives. The general lesson: a refetch wired to "the stream
loop eventually exits" is a refetch that sometimes does not.

## Phase 32 — Character dossiers

For the characters who arrive during play rather than being authored up front:
the innkeeper who turned out to matter.

### What was built

**The architecture, which the SPEC had guessed wrong.** §22 asked whether a
dossier should be its own entity or a character with a `provisional` flag, and
leaned to the latter. It is neither, and the reason is in §11's own sentence:
dossiers are "injected by relevance rather than always". A cast member is
injected *always* — that is what being in the cast means — so a provisional
character would either cost tokens every turn or need a second injection rule
bolted onto the cast.

Relevance injection already exists. It is §10, built in phase 21. So a dossier
is two things at once: a row with the five fields §11 names, which is what the
reader edits, and a lore entry keyed on the name, which is how it reaches a
prompt. Keys, scan depth, the token budget, sticky, the character filter and
§16's activation test tool all come free.

This was the reader's call, not mine to guess — they asked how SillyTavern
handles it, and the research settled it. **SillyTavern has no dossier feature at
all**; what its users do for an NPC who emerged is write a World Info entry in a
chat-scoped lorebook, which is this schema's scene binding. The prior art
endorses routing through the lore engine and against inventing a second
injection path. Worth recording that the question came from them: my own
instinct had been to ask, and the answer was better than either option I had
drafted.

**The entry is derived, never edited.** Every write goes through `renderDossier`,
so it cannot drift from the fields it came from — the same rule §8's guides
follow, and the reason a dossier can be edited without anyone reconciling two
copies.

**The buried tier never reaches a prompt.** §11 tiers knowledge into public,
private and buried. Buried means the author knows it and has not revealed it,
and injecting it every time the name is mentioned is exactly how a secret gets
spoken aloud two turns later. It is kept, shown to the reader *beside a preview
of what the prompt actually gets*, and travels only on promotion — a card is the
author's own reference, so withholding it there would lose the only copy. The
prompt was also told the field would be withheld, because a model that knows a
field is not going to the model writes a secret in it rather than a hint.

**Recurrence is counted, not classified.** Who recurs is a question about string
frequency; a model call per turn would cost a request to get a worse answer
nobody could debug. Counted in *separate messages* — a name said three times in
one line is one moment, a name said once in three turns is a character who keeps
coming back. The model is asked one question, once a name has earned it.

### Deliberately deferred

- **Three options SillyTavern's engine has and §10 does not**, all noticed while
  comparing and all §10 refinements rather than dossier work: matching against
  character and persona *definitions* as well as the transcript (directly
  relevant here — a dossier should fire when another card's description names
  them), an *exclude* mode on the character filter, and per-entry gating on
  generation type (Normal/Continue/Impersonate/Swipe/Regenerate/Quiet).
  Bundling them would have made this two phases.
- **Automatic dossier writing.** The detector offers; nothing is written until
  the reader taps a name. A background task that wrote dossiers unprompted would
  fill the book with the app's guesses about who mattered.

### Spec changes

§11 gains a `Settled while building phase 32` block with seven decisions, and
§22's open question is struck through and pointed at it — the first of that
list's questions to be answered by building the thing.

### Surprises

**The browser found a design problem the tests could not.** The per-scene
Dossiers book is a real lorebook bound to the scene, so it turned up in the
scene-setup Lorebooks row as though the reader had made it — and offered
*Detach*, which would have left dossiers rendering into a book reaching nothing,
silently. Lorebooks now carry a `managed` flag: shown, so the tokens are
accounted for, with no Detach. Nothing in the test suite would ever have
noticed, because every test addressed dossiers through their own routes.

**Three false failures in a row, all mine.** `innerText()` returns
CSS-*transformed* text, and this design uppercases nearly all its chrome, so
`/Hollis/` never matched a button rendering as `HOLLIS · 3 TURNS` — while
`getByRole(name:)` matched fine, because accessible names are computed from the
DOM before `text-transform`. A textarea's contents are not in `innerText` at
all. I burned two rounds re-running against a wiped database on the theory that
it was state leakage, when the screenshot I eventually opened showed the feature
working perfectly the whole time. **Read the screenshot before theorising about
the data.**

---

## A UI/UX pass, desktop and phone

Not a phase. The desktop layout had never been looked at with intent — it was
built to the design's three columns and then only ever checked for "the pieces
are where the doc says". Asked to look at it as a user rather than as a
checklist, the verdict was *bare and confusing*, and the phone had not been
looked at at all.

### What was wrong, and what changed

**The reading measure was applied to screens nobody reads.** The design caps the
prose column at 620px and says why: widening it past a reading measure breaks
the one thing the app is for. That reasoning is about story text, and it had
been over-applied to every screen — so Settings, the roleplays list, the
library, authors and lorebooks all sat in a 620px ribbon down the middle of a
1440px window. Those screens are rows and grids; the measure bought them
nothing. They now take a `--onsen-list-measure` of 860px, with the forms
(scene setup, the character editor, the lorebook entry editor) keeping 620,
because a textarea 860px wide is a worse place to write than one 620px wide.

**A roleplay row said nothing about the roleplay.** The design specifies title,
time, a line of prose excerpt, and a mono footer with the cast and the counts.
Only the first two existed; the excerpt slot was occupied by the reply count,
which the footer was also going to carry. Two scenes from the same card were
therefore indistinguishable. `SceneDto` gains `lastLine` — the opening of the
newest turn, whitespace collapsed — and the row now carries the cast as well.
The design asks for initials there; initials are right for a crowd and wrong for
a duet, since a row reading `A` says less than one reading `ALDAN`, so it is
names up to three and initials past that.

**Every message rule stopped 118px short of the column.** The hover actions
(reroll, branch, edit) sat in the header's flex row at `opacity-0`, which hides
them without giving back their width — so on a wide screen every rule visibly
ran out early, for buttons nobody could see. They are painted over the rule's
right end now instead of laid out beside it.

**The settings screen explained itself in ink nobody could read.** The copy was
already right — "Where the models are. One box or twenty." — at 9px in the
dimmest ink on the palette, which is a hint written and then hidden. Sixteen of
them go to 10px with looser leading. Alongside: `OPENAI_COMPATIBLE` was leaking
to the screen as a raw enum, rows had no chevron so nothing looked openable, and
the page titled itself `Connections` while carrying seven sections.

**Two identical red buttons asked which one was real.** The scenes footer's NEW
ROLEPLAY duplicated the sidebar's on desktop; the footer is now phone-only.

**`Write` did not say what it did.** The library's AI-authoring button is now
`Write with AI`, next to `New card`, which is the distinction it was making.

**Three columns of cards on a 1440px screen are letterboxes.** The library grid
takes five on desktop and three on a phone.

### Deliberately deferred

- **Search on the roleplays list** (design §266). A search field earns its place
  at a scale this install has not reached, and adding it now would be scaffolding.
- **The library's filter selects vs the design's chips.** Left as selects. Chips
  win when the value set is small and fixed; tags and folders are user-generated
  and unbounded, and a chip row that wraps to four lines is worse than a select.
- **Red as both "live" and "selected".** A segmented control showing `OFF`
  selected paints `OFF` red, and red elsewhere means *now*. It reads oddly, but
  the fix is a second selection colour across every segmented control in the
  app, which is a design-system decision rather than a pass.

### Surprises

**The bareness was mostly one CSS variable and one missing field.** The instinct
was that a wide screen needed more furniture — a denser rail, another panel. It
needed the column it already had to be the right width, and the row it already
had to say what the design had always said it should say.

---

## Phase 33 — Regex scripts and event triggers

§14's substrate for the long tail: "if you give them nothing, they will hit
walls you never anticipated." Two halves. Scripts say *how* text is changed;
triggers say *when* something runs.

### What was built

**The script engine** (`server/scripts/apply.ts`) — pure, the way `/prompt` is
pure. Find and replace with numbered and named capture groups, `$&` and `$$`,
macros in the replacement, ordered execution, individual toggles, and a trace
saying what each script did. Patterns and flags are validated as a pair when
written, not on the turn that needed them.

**The four apply stages**, which differ in what survives:

| Stage | Changes | Leaves alone |
| --- | --- | --- |
| `user_input` | The reader's message, before it is stored | — |
| `ai_output` | The model's prose, before it is stored | The out-of-character aside |
| `display_only` | What the log shows | The stored text and the prompt |
| `prompt` | The transcript on its way into a generation | Everything on disk |

**Three scopes** — global, one character, one scene. A character-scoped script
follows the speaker rather than the room.

**A test panel that runs the live engine.** `POST /api/scripts/test` takes
text, a stage and optionally a roleplay, and returns the before, the after, and
what each script did — writing nothing.

**Event triggers** — five events (`scene_start`, `user_message`,
`before_generation`, `after_generation`, `lore_activation`) bound to three
actions (refresh a guide, refresh a tracker, fire a regex script over the
newest turn). `lore_activation` is the consumer §10's `automation_id` never
had: the column has been stored and round-tripped since phase 21 with nothing
reading it.

**Running a trigger by hand.** `POST /api/triggers/:id/run` against a named
roleplay, because a trigger bound to `lore_activation` may not fire for days
and "did I wire this up correctly" should not be a question only the scene can
answer.

### Deliberately deferred

- **A trigger that runs an arbitrary background task.** §14 names it; the task
  primitive refuses it. A task request carries a prompt "built by the caller,
  because only the caller knows what to ask", so there is no generic way to ask
  an arbitrary op a question. The ops a trigger can run are the ones something
  already knows how to ask, which is the guides and the trackers.
- **Scripting the stream.** A `display_only` script lands when the finished
  message is read back, not mid-stream.
- **A regex timeout.** A catastrophic pattern will hang the request that runs
  it. JavaScript cannot interrupt a regex, and this is single-user software
  where the author of the pattern is the only person it can hurt. What is
  guarded is the compile: an invalid pattern is a reported failure rather than a
  thrown one, and the other scripts in the chain still run.
- **Editing a script's scope, or a trigger's event and action.** Each decides
  which columns are legal, and the schema refuses a row where they disagree.
  Changing one is writing a different script.

### Spec changes

§2's `RegexScript` sketch gains real column names and an `EventTrigger` entity
beside it; the reconciliation block stops listing `RegexScript` as unbuilt. §14
gains a `Settled while building phase 33` block with eleven decisions.

### Surprises

**The spec asked for something its own primitive forbids.** §14 says an action
can "run a background task". The task runner's own comment says a request's
prompt is "built by the caller, because only the caller knows what to ask" —
which makes a generic task action impossible to write. The resolution is that
the guides and the trackers *are* background tasks, and they are exactly the two
that already know what to ask. Reading one section against another settled it;
guessing at an action shape would not have.

**Counting the replacements cost the reference expansion.** `String.replace`
expands `$1` and `$<name>` for a string replacement and not for a function — and
a function is the only way to count matches. So the count meant re-implementing
`$&`, `$$`, `$1`…`$99` and `$<name>` by hand, against the arguments the callback
receives, whose shape depends on whether the pattern has named groups at all.

**The test panel could not test anything.** The first version ran the *saved*
scripts for a stage, so the "Try it" button in the editor returned the input
unchanged — while the comment above it said, in as many words, that putting the
panel anywhere else "would mean saving a script to find out what it does". The
tests passed because they only ever tested saved scripts. The browser found it
in one click. `POST /scripts/test` now takes an optional draft and runs that
instead.

**A bottom sheet is a phone shape.** Stretched across 1440px it stops reading as
a sheet and starts reading as the page having been replaced. Every sheet in the
app had this; it took building a new one to notice.

**Guide kinds were reaching the screen as `situational`** — the same raw-enum
leak the UI pass had just fixed for provider kinds, one section further down. The
labels already existed, on the ops in §7's registry, which is where the settings
screen has been getting `Clothes` and `Scene tracker` since phase 13. The action
list is named server-side now, so a trigger's row and its sheet cannot disagree.

**A test that proved nothing.** The first version of "an entry's automation id
fires its trigger, and only its own" pointed both triggers at the same script.
The wrong-id trigger firing would have been a second no-op over already-rewritten
text, so the test passed whether or not the scoping worked. It now points at a
different rewrite, and asserts the text that would have changed did not.

---

## Phase 34 — Packs

§15's tier 2: a shareable archive of everything tier 1 calls data.
`pack.json` plus one directory per kind, installed whole or not at all.

### What was built

**The format.** A zip — `fflate` again, as CharX uses — carrying a manifest and
`characters/`, `lorebooks/`, `presets/`, `authors/`, `options/`, `regex/`,
`triggers/`, `banlists/`, `assets/`. Characters travel as real cards, written by
the same exporter the library's own download button uses: a PNG where there is
an avatar, JSON where there is not. The PNG *is* the avatar, which is the whole
convention behind the format, so carrying the picture separately would mean
inventing a link between two files where one already exists.

**Preview.** `planInstall` reads the archive and the database and writes
nothing, so what it says is what the install acts on. The sheet shows what would
be added, what is already here, and refuses to enable the button when there is
nothing to do.

**Transactional install.** Every row inside one `bun:sqlite` transaction. A
document that cannot be installed takes the whole pack with it; a *card* that
cannot be parsed is one skipped item with its reason, because the rest of the
archive is still coherent.

**Exact uninstall.** `pack_rows` records `(pack, table, row id)` as the install
goes. Uninstall deletes by that, not by name.

**Export.** Pick what goes in — a pack is something to share, not a backup — and
the archive that comes out installs into a fresh install.

### Deliberately deferred

- **`/tasks/`.** §15's tree lists it. An op's configuration is not a row a pack
  can own: the registry is fixed and its rows are created at boot, so "install"
  would mean overwriting settings the reader chose and "uninstall" would have
  nothing to remove. `/triggers/` took its place in the tree.
- **Overwriting.** See the spec block: overwrite and exact uninstall cannot both
  hold, and exactness is what §23 asks for.
- **Installing from a URL.** §15 says "a file or URL". The file half is here;
  the URL half is a fetch, a size cap and a redirect policy, and it can wait
  until there is somewhere to fetch from.
- **Dependency declarations.** §24's open question, now answered: flat.

### Spec changes

§15 gains a `Settled while building phase 34` block with nine decisions; §24's
pack-dependency question is struck through and answered.

### Surprises

**Plan and install were reading different things.** The planner walked the
archive's JSON documents; the installer re-derived cards from the asset tree. So
a card arriving as a PNG was checked for collisions by its *filename* — and a
pack carrying `Hollis.png` would install a second Hollis beside the one already
in the library. They walk one candidate list now, which also moved card parsing
into the preview: a malformed card is named before anything is written rather
than discovered halfway through.

**`changes` is not a count of what you deleted.** `uninstallPack` summed the
driver's reported changes and got two for one lorebook, because the number
depends on what cascaded. It counts by looking now — the row was there, and now
it is not — which is what "removed" should mean anyway.

**A pack could ship a book the app writes for itself.** The dossiers lorebook
from phase 32 turned up in the export picker. It is bound to one scene and
filled by the app, so packing it would ship a book that reaches nothing on the
other side. Found by exporting a pack in the browser and reading the list.

**A ban phrase the reader already had was being claimed by a pack that also
listed it.** `addBan` bumps a count rather than duplicating, so the row the pack
"added" was the reader's own — and uninstalling would have taken it. The install
checks first now, which is the same class of bug as owning by name instead of by
id, one layer down.

---

## Phase 35 — Outbound webhooks

§15's out-of-process escape hatch, and the one it says to build early because
it "may remove the need for tier 3 entirely".

### What was built

Five events, the five §15 names: `message.created`, `generation.complete`,
`beat.parsed`, `tracker.updated`, `lore.activated`. Each is a moment that
already existed in the app, so subscribing forwards something that happened
rather than computing something new for a listener.

A subscription is a name, a URL, a set of events, and optionally one roleplay.
It carries its own delivery log — the last fifty attempts, with status, response
code, duration and whatever the receiver said.

The sender never blocks. Emitting starts the work and returns; three attempts
with a short backoff; a five-second timeout; every failure caught.

Signing is Stripe's scheme, and `verifySignature` ships beside the sender so a
receiver has a reference implementation and the tests have something to check
against.

### Deliberately deferred

- **A per-subscription event filter finer than the event name.** "Only messages
  from Kestrel" is a thing someone will want; it is also a query language, and
  a receiver can drop what it does not want.
- **Delivery replay.** The log records what happened; it does not keep the body,
  so a failed delivery cannot be re-sent. Keeping every payload for fifty
  deliveries per subscription is a different feature with a different cost.
- **Inbound webhooks.** §19's outbound OpenAI-compatible API is the other half of
  the escape hatch and is phase 37.

### Spec changes

§15 gains a `Settled while building phase 35` block with seven decisions.

### Surprises

**Nothing surprising in the code, and that is worth saying.** Nineteen tests
passed on the first run, which for a feature this size usually means the tests
are not testing anything. So it was driven against a receiver written from
scratch in twenty lines — its own HMAC check, no shared code with the app — and
that receiver verified both a test delivery and a real one. Then the receiver
was killed mid-session: the message still wrote, the reply still returned, three
attempts were logged with the connection error, and the failure counter moved.
The independent check is what made the green suite mean something.

**A URL in the chrome typeface came out shouting.** The subtitle style
uppercases everything, which is right for `BUILT-IN` and wrong for
`HTTP://127.0.0.1:9788/HOOK` — a path is case-sensitive, and that is not what
the reader typed. The URL keeps its own case now; the state beside it stays
chrome.

**A button labelled with a state.** The subscription sheet had `OFF` where the
action belongs, next to a row that already shows whether it is off. It says
"Switch it off" now — the same plain-language problem as `situational` and
`OPENAI_COMPATIBLE` in the two phases before, which suggests looking for it
deliberately rather than waiting to notice.

---

## Phase 36 — Multi-device head sync, background indicators

§5's last two paragraphs. The same scene may be open on a phone and a desktop;
they should converge, and where they cannot converge silently the device that
did not write should find out rather than have the story change under it.

### What was built

**A per-scene channel** — one SSE stream per open scene, carrying leaf moves,
generation start and finish, and history changes. In process and in memory: this
is one server serving one person's devices, and an event nobody was connected
for is about state the reconnecting client reads from the database anyway.

**An origin per tab.** A header the client sets, carried through the handler in
`AsyncLocalStorage`, so the storage layer can say who moved the head and the
device that moved it can ignore its own echo.

**The "chat moved" prompt**, in the blue pencil — the app talking about its own
machinery, not something happening in the story — and the held view behind it.

**The cross-screen generation indicator**, moved out of the roleplays list and
into the shell. The design asks for it on every screen that is not the
generating roleplay's chat; it was on the one screen a reader who wandered off
is least likely to be looking at.

**The completion chime**, synthesised, optional, server-side, and only when the
tab is in the background.

### Deliberately deferred

- **Presence.** Knowing *that* the other device is looking is a different
  feature from knowing what it did, and nothing in §5 asks for it.
- **Conflict on a message edit.** Two devices editing the same turn is
  last-write-wins with no prompt: the loser sees the text change, which is what
  an edit looks like from the outside anyway.
- **Sync outside a scene.** The library and the settings screens do not listen.
  Nothing there changes under a reader mid-sentence.

### Spec changes

§5 gains a `Settled while building phase 36` block with eight decisions.

### Surprises

**The first working version was wrong in the interesting direction.** Two
browser contexts, a phone and a desktop, same scene: the phone wrote a line and
the desktop's banner appeared. It also already showed the line — a background
refetch had converged it behind the prompt. So the banner was announcing a
divergence that no longer existed, and the fix was not to clear the banner but
to stop the log converging behind it.

**Then the signal itself was wrong.** Carrying "where the head was" makes an
append and a rewind look identical, because a rewind also starts where the
reader is. The right signal is the *new head's parent*: a device showing that is
looking at the turn the new one continues. With "previous", a rewind converged
silently — swallowing exactly the case the prompt exists for. Both versions
passed their tests; two browsers found both.

**A test premise, not a bug.** The first rewind drive did nothing, because
`setActiveLeaf` descends to the leaf of the subtree by default — so pointing it
at the first message put it straight back on the last one. Twenty minutes went
into the client before reading the function being called.

**A one-render lag that read as a dead feature.** The chat screen computed the
displayed head, passed it into the channel hook, and got the move state back —
a cycle, resolved with a ref, which meant the hook always saw the *previous*
render's value. With no re-render after the scene loaded, that value stayed
`null` forever, and `null` was the "nothing to diverge from" branch. The hook
owns that state now; nothing feeds back into it.

---

## Phase 37 — The outbound OpenAI-compatible API

§19. Another client points at `scene/the-pass` and this app answers like a
model, running the whole pipeline behind it.

### What was built

**`GET /v1/models`** — every roleplay that has opted in, plus one forced-speaker
id per active cast member, filtered to what the presented key can reach.

**`POST /v1/chat/completions`** — streaming and not, in OpenAI's shapes, with
`last_message` history reconciliation: the final user message, the stored
history, and the incoming array otherwise ignored.

**Bearer keys** — minted, hashed, shown once, revocable, optionally scoped to
one roleplay, rate-limited per key, with a request log that records the
failures too.

**Inline ops** — §19's `((nudge:))`, `((steer:))`, `((clear steer))`, `((as:))`,
`((ooc:))`, `((continue))`, `((swipe))`, parsed out and stripped before the
message enters history.

**Double-assembly protection** — a warning header and a line in the request log,
never a refusal.

**Two switches**, on two screens: the keys in Settings, the per-roleplay switch
in that roleplay's setup, each with a hint pointing at the other.

### Deliberately deferred

- **`author/<slug>` and the `stateless` history mode.** They need a prompt path
  with no scene behind it, and every path in the builder has one. They are not
  listed in `/v1/models` either: advertising an id that answers with a 400 is
  worse than not advertising it.
- **`passthrough/<profile>`.** Small, but it needs adapter plumbing outside the
  generation service, and §19's own warning — "never expose upstream provider
  keys through passthrough responses" — deserves its own attention rather than
  being tacked onto the end of a large phase.
- **The `sync` history mode.** §19 calls it "more failure modes" itself. It is a
  diff against a tree, and the default already works with any client.
- **`POST /v1/completions`.** §19 marks it optional.

### Spec changes

§19 gains a `Settled while building phase 37` block with nine decisions.

### Surprises

**The length floor suppressed the strongest evidence.** Double-assembly
detection required two signals and 200 characters, which a short assembled card
slipped straight under — `{{char}}`, `Personality:` and `<START>` all present,
and the check said no. Macro residue stands alone now, at any length: a person
writing an instruction does not type `{{char}}`, so a threshold that could
overrule it was deciding a question the evidence had already answered.

**Asides and commands share a syntax.** §19's `((nudge: ...))` and §7's
`((she has no idea))` are the same shape, and the first parser treated a bare
aside as a command with a very long name. It was left in the text either way,
but reported as an unknown command — a lie about what the reader wrote, in a
field the request log shows back to them.

**Two of the four model kinds are not built, and the list says so by omission.**
The first version listed `passthrough/<profile>` because it was cheap to
enumerate, and the completions endpoint answered it with a 400. A client reading
that list would have had every reason to expect it to work.

---

## Phase 38 — Narrative memory

§11's third memory layer, and the first phase in the **Later** block. Entities,
relations and salience, off by default.

### What was built

**The ranking, as pure arithmetic** — `combineSalience`, `decayed`, `scoreMemory`
and `rank`. The whole feature is a ranking, and one that could only be inspected
by running a model against a live scene is one nobody can reason about.

**Extraction as a background task** — a registry op at temperature 0.2, asked
for three salience signals rather than one number, shown what it already knows
so it says what *changed* rather than restating the cast list every turn.

**A merge that accumulates**, protects a reader's edits, and takes the higher
salience of the two.

**Recall on the prompt path** — the blend, the relations travelling with the
entity they belong to, and a trace the inspector can read.

**A panel in scene setup** — the graph, editable, with the reader's own entries
marked in the blue pencil, because a promise nobody can see is not one.

### Deliberately deferred

- **Author-scoped memory.** §2 sketches `MemoryEntity.author_id` beside
  `scene_id`; only the scene binding is built. §11's *author memory* is a
  lorebook with an owner rather than an entity graph, and it is phase 39.
- **Relation editing.** Relations are shown on the entity they belong to and
  deleted with it; there is no editor for one on its own. The entity is the
  thing a reader thinks about, and an editor for the edges would be a graph tool
  in the middle of a story app.
- **Decay as a background sweep.** Salience is stored as extracted and decayed
  at read time, so nothing has to run on a timer and no scene's memory quietly
  changes while nobody is looking at it.

### Spec changes

§11's layer 3 gains a `Settled while building phase 38` block with seven
decisions.

### Surprises

**The form refused a value it had just been handed.** The salience input carried
`step="0.05"` while `combineSalience` rounds to three decimals, so a stored
0.833 failed HTML5 validation and the sheet could not be saved without the
reader changing a number they never touched. It is `step="any"` now — salience
is a continuous score, and a grid would be the UI dictating the model's
precision.

**Two sections on one screen both said "Remember what happened."** §11 layer 1
— the rolling summaries — already owned that phrase in scene setup, and layer 3
arrived with the same one. Playwright's strict mode found it before a reader
would have. Layer 3 is "Keep track of who and what" now.

**A file called `MemoryPanel.tsx` already existed**, and it is layer 1's
summaries panel. Writing the new component straight over it destroyed a working
one; git had it back in a second, but the near-miss is the point — two features
called memory, one layer apart, and the second one walked into the first one's
name without looking. The new one is `NarrativeMemory.tsx`, and it says in its
header comment which layer it is not.

---

## Phase 39 — Author memory

§11's optional cross-scene memory: what a writing partner remembers about you
between roleplays. Off by default, per author.

The whole design is one sentence of §11's: "a lorebook with `owner_author_id`
set, so it reuses keyword activation, budgeting, and the editor." Nothing here
is a second retrieval mechanism, a second budget or a second editor.

### What was built

**Migration 0036** — `lorebooks.owner_author_id` with a unique partial index
(one book per author), and provenance on entries: `written_by`,
`written_in_scene_id`.

**Ownership as a binding** — `booksForScene` matches the author's book on
`owner_author_id` alongside the four binding scopes. The book has no
`lorebook_bindings` row at all, which is the point.

**`AUTHOR_REMEMBER`**, a registry op with `autoByDefault: false`. It is shown
the recent turns and the titles it already holds, and asked for one note as
JSON: a thread left hanging, a name that keeps coming back, something about how
this reader likes to be written for. Explicitly *not* a plot summary — layer 1
has that.

**A section on the author's card** — the notes with their provenance, the token
budget, a link into §10's lorebook editor, and §11's one-click wipe.

**"Remember this" beside the roleplay**, because that is where there is
something to remember. When the author's memory is off the block says so and
where the switch is, rather than putting a second copy of the switch somewhere
that does not own it.

### Deliberately deferred

- **The "at scene end" trigger.** §11 offers "prompted at scene end or on
  request"; only the request is built. A scene has no end — it has a last
  message, and a note written every time a reader stops reading is the silent
  accumulation §11 warns against.
- **Editing a note in place on the author's card.** The link goes to the
  lorebook editor. §11 says the feature reuses the editor, and a second editor
  for the same rows is a second editor to keep correct.
- **Deduplication.** The op is shown what it already holds so it does not
  repeat, but nothing rejects a near-duplicate. Two notes about the same thing
  is a model problem with a reader-visible fix — the wipe, and the editor.

### Spec changes

§11's author memory section gains a `Settled while building phase 39` block with
eight decisions. §2's schema sketch gains `written_by` and
`written_in_scene_id` on `LoreEntry`.

### Surprises

**An `INNER JOIN` that dropped the only book it was written for.**
`booksForScene` joined `lorebook_bindings`, which is correct for every book that
has one — and the author's book has none, because ownership is what attaches it.
The book was invisible and the whole feature was a no-op. Every existing lore
test passed, because every book in them has a binding. A `LEFT JOIN` and the
ownership clause in the `WHERE`.

**`updateEntry` accepted two fields and wrote neither.** The patch type listed
`written_by` and `written_in_scene_id`; the `UPDATE` statement did not mention
them. TypeScript was satisfied — the type described the argument, not the SQL.
Provenance would have been a column that was always null behind a UI that
promised to show it.

**A budget of 0 meant uncapped, and 0 was what the screen showed.** The book was
made on the first note, so before then the author's card showed a token budget
of 0 for a book that did not exist — reading as "no limit" on the one screen
§11 asks to carry a hard cap. The book is made when memory is switched on now,
with a real default of 512.

**Two routes could write one flag.** `PATCH /memory/authors/:id` set
`memory_enabled`, and so did `PATCH /authors/:id`, which is what the toggle in
the UI had always used. Both worked, which is how they would have drifted. The
author owns the flag; the memory route owns the budget.

**The lorebooks list called it "Not attached to anything."** True of its
bindings, false of the book: it reaches every scene its author is in. It reads
"Written by Vesper" now, in the slot the other bindings use.

---

## Phase 40 — Optional tabletop module — not built

Skipped deliberately, with the reasoning recorded here so a later reader does
not have to reconstruct it.

§20 calls this one optional, and it is the only phase that does. What it asks
for is two features of very different sizes wearing one name:

- **Rolls and checks** — a die rolled server-side, a modifier, an outcome the
  model narrates rather than picks. Small, and mostly already here:
  `{{roll:NdM}}` has resolved server-side since §3's macros, which is the part
  the "don't roll dice in the model" rule exists to protect. What is missing is
  a *record* of a roll — an event on the message rather than a number
  substituted into a prompt — and outcome tiers.
- **Stat and inventory tracking as user-defined state schemas** — a schema
  language, a builder UI for it, validation, and a way for a check to reference
  a stat by name. That is a product, not a phase, and everything it would sit
  on is per-scene state that only tabletop mode would ever read.

Nothing else in Onsen depends on it, and `Mode: tabletop` in §8's prompt options
already lets an author run a table in prose without any of it.

If it is picked up later, the split above is the shape: rolls and checks as
recorded events first, and stats only if the checks turn out to get used.

---

## Phase 41 — Pictures, voices and captions

§20 gives this phase one line: "TTS, image generation, captioning." §17's tier 3
names the same three as the case for code extensions, and says not to design
that API speculatively. Those cannot both be followed literally. This is the
alternative tier 3 implies: the integrations built in, declaratively configured,
with the key handling and the "keys stay server-side" rule the providers table
already holds.

### What was built

**Migrations 0037 and 0038** — `media_services` (a purpose, a kind, and
otherwise the shape of `providers`), `media_assets` (content-addressed, with
provenance and both visibility switches).

**Two image adapters and one speech adapter** — the OpenAI shape for hosted
services and the local ones that emulate it, and A1111's `/sdapi/v1/txt2img`,
which is a genuinely different API: a real negative prompt, settings as
top-level fields, and the model as a checkpoint override. Speech is the OpenAI
shape only, because there is no single local TTS API and the local servers that
exist emulate that one.

**Vision through the existing adapters** — an optional `images` on
`NormalizedMessage` and a `supportsVision` capability. OpenAI emits content
parts, Anthropic emits blocks with the image first, text completion declares
false and the captioner refuses it.

**A caption is what reaches a prompt**, rendered as `[image: …]` on the turn the
picture belongs to. The bytes never do.

**Two switches per picture** — in the log, and in the prompt — after the user
asked for them, and the four states they produce are all things a reader wants.

**The client** — services in Settings, drawing and reading aloud on a message,
attaching in the composer with a pending strip, and a sheet on any picture
carrying its provenance and both switches.

### Deliberately deferred

- **An op that writes the image prompt.** A paragraph of prose is a poor prompt
  for an image model, and rewriting it well needs a model. The prose is stripped
  of speaker labels, emphasis and asides, and the prompt is editable — which is
  honest, where a bad automatic rewrite would not be.
- **ComfyUI.** Its API is a workflow graph rather than a request, so supporting
  it means shipping or importing workflow JSON and mapping fields into it. A1111
  covers the local audience with one adapter; Comfy needs a design.
- **Speech that plays as a turn arrives.** Reading aloud is asked for per
  message. Auto-narration needs a queue, an interrupt, and a decision about what
  happens on a reroll — three questions this phase does not answer.
- **Expression sprites and visual novel staging** (§12's other half) remain as
  they were; nothing here touches them.

### Spec changes

§12 gains a "Pictures, voices and captions" section with a
`Settled while building phase 41` block of ten decisions. §2's schema sketch
gains `MediaService` and `MediaAsset`. §20's line 41 points at §12.

### Surprises

**Two functions build a message DTO, and I wired one.** `messageDto` serves a
single write; `activePathDtos` serves the whole scene. Illustrating a message
succeeded end to end — the stub logged the request, the file was written, the
row existed — and the log stayed empty, because the scene read goes through the
other one. Nothing in 28 passing tests touched the gap. There is a test on both
paths now.

**`w-full` on a picture.** A 96px attachment stretched to the prose measure is a
large empty box with a dot in the middle of it, which is exactly what it looked
like. Images size themselves and are capped instead of filled.

**The stub's caption match broke on its own success.** With an image, `content`
is an array of parts rather than a string, so `last.includes(...)` was false and
every caption fell through to the default reply — which the stub streams slowly,
so an upload appeared to hang for thirty seconds. The bug was in the test
double, but the thirty seconds made a real design point concrete: the upload
awaits its caption on purpose, because the picture binds to the next line sent
and a caption still running when the reader presses send goes with a message the
author is told nothing about.


---

## Phase 42 — Chub import, community asset browsing (deferred)

§20's line 42 is "Chub import, community asset browsing." Not built, and not
because it ran out of room: every other phase reaches only the machine the app
is installed on. This one reaches out to somebody else's service — a third
party's search, their rate limits, their content, their availability, and their
terms — and it is the only phase in the build order that does. That is a
decision about what the app *is*, not a feature with an obvious shape, and it
was taken as its own decision rather than folded into a phase.

What was in scope for it and is now unclaimed:

- **Import from a Chub URL** (§9's other import line). The folder half landed in
  phase 43; the URL half needs the network policy above before it needs any code.
- **Browsing and searching a community library from inside the app**, with
  whatever preview, filtering and provenance that implies.

Nothing else depends on it. `PHASES.md` previously said "§9's import work is
phase 42", which was true when it was written and is no longer: folder import is
built and lives in phase 43.

---

## Phase 43 — Polish

§20's last line: "Polish — mention strategy, group greetings, bulk import, PWA."

Three of the four were the same shape, and it is the shape this project has
tripped over more than any other: **the schema, the parser and the strings all
existed, and nothing read them.** `turn_strategy` had accepted `'mention'` since
migration 0006 and the director quietly ran round robin. `group_greetings` was
parsed from V3's `group_only_greetings`, stored, editable and exported, and read
by nothing — because *no scene ever got an opening message at all*. The prompt's
token total had been computed, stored and served to the inspector since phase 25
and shown nowhere else.

### What was built

**Migration 0039** — `characters.mention_keywords`, a JSON array beside the
greeting arrays. On the character rather than on `scene_members`, so the
vocabulary travels with the card, is edited once, and rides along on export
under `extensions.onsen.mention_keywords`.

**The mention strategy** (§6) — `server/generation/mention.ts`, pure, scanning
the last message for each eligible candidate's name and keywords. Whole-word and
case-insensitive; the later match in the sentence wins, because "Ana, ask Bell"
is addressed to Bell. The reason quotes the keyword that fired — *"the captain"
in the last message* — and says only "Named in the last message" when it was the
name, so a reader who configured a keyword can see that it is the one that
worked.

**Scenes open** (§2, §9) — `server/scenes/greeting.ts`, called when a scene with
no messages gains its first cast member. Every alternate greeting lands too, as
a root sibling, so the reader gets them on the swipe carousel they already know
and this needed no UI of its own. A group scene prefers the opener's
`group_greetings` and falls back to their own first message.

**Bulk import** (§9) — `POST /characters/import/bulk`, taking a multi-select or
a whole folder, and reporting per file in the same add/skip shape a pack install
already reports. One unreadable file must not lose the other 199, so nothing is
a 400 except an empty upload.

**The PWA** (§16) — a web manifest, a hand-written service worker generated from
`client/sw-template.js` with the build's own hashed filenames, and an icon drawn
from the design system: a Spectral `O` over the red hairline. `/api` is never
cached, so "no offline chat sync" is a property of the code rather than a hope.

**The status bar's token count** — `SceneDto.lastPromptTokens`, read with
`json_extract` from the same `generations.prompt_debug` row the inspector falls
back to, so the two can never disagree.

### Deliberately deferred

- **Scene export.** Asked about during planning and left out: it is a format
  decision (whole tree plus settings, or the active path only) with a migration
  path to think about, not a polish item.
- **Import from a Chub URL.** §9 couples it with folder import, but §20 puts
  Chub in phase 42, which was deferred as its own decision. See above.
- **A 192px icon.** Chromium clamps its window below roughly 350px and returns a
  downscaled 512 with the rule cropped off, so the small size shipped is 256 —
  which every launcher accepts. Noted in `client/public/icons/README.md` so the
  next person does not rediscover it.

### Spec changes

§6's `mention` paragraph stops saying it falls back unconditionally and says
what it now does. §2 gains a `Settled while building phase 43` note on when a
scene opens. §16's PWA line points at what implements it. Migration 0039 joins
§2's schema sketch. §20's line 42 records the deferral.

### Surprises

**"The first cast member opens the scene" is not the same as "the first cast
member with a greeting opens it."** The first version seeded from whoever
happened to carry a `first_mes`, so casting a silent character and then a
talkative one opened the scene in the second one's voice. Four tests failed in
ways that looked like fixture noise and were not: who opens has to be readable
off the cast list, or it is not a decision the reader made.

**Twenty-eight tests failed the moment scenes started opening, and every one of
them was right to.** They were fixtures saying "a scene with ten turns in it"
that now had eleven. The fix was a `V2_CARD_SILENT` fixture so those tests keep
meaning what they say — but the twenty-eight were an accurate measure of how
much of the app had been built on top of an empty room.

**Cards carry "Mira Vance"; readers type "Mira".** The first browser drive of
the mention strategy chose the right character for the wrong reason — round
robin — because the full name never appeared in the message. Matching the first
word of a multi-word name is what makes the feature the thing people mean by it.
The tests all passed before that, because I had written them with full names in
the messages.


---

## Phase 44 — Moving in from SillyTavern

Not from §20's build order, which ended at 43. This came out of asking what was
still between Onsen and being a SillyTavern replacement, and the answer was not
features: **nobody could move in.** The whole import surface was three
endpoints — cards, world info, chat-completion presets. A switcher brought those
and abandoned every conversation they had ever had, plus their personas, their
instruct templates and their regex scripts, four of which were features Onsen
already had and simply did not accept SillyTavern's file for.

### What was built

**Migration 0040** — `scenes.import_source` and `scenes.import_hash`. A chat has
no stable identifier of its own, but the expected flow is "import, see six chats
skipped for a missing card, fix that, run it again", and a second pass has to
recognise the first one's work or the fix costs a duplicate of everything.

**`server/sillytavern/chat.ts`** — pure. JSONL in, a tree of turns out.

**`server/sillytavern/settings.ts`** — pure. Personas, instruct templates,
regex scripts, and the refusal for the one thing that cannot come across.

**`server/sillytavern/index.ts`** — classification by path, then apply in
dependency order: cards, personas, world info, templates, scripts, chats,
groups. Nothing throws for a bad file; every file gets a row in the report.

**`POST /api/migrate/sillytavern`** and a *Moving in* section in Settings. The
client filters before it uploads — a real install is hundreds of megabytes and
almost none of it is readable here — and sends each surviving file under the
path it had inside SillyTavern, because the folder is the only thing that tells
an instruct template from a context template from a sampler preset.

**The tree mapping**, which is the whole reason this is possible rather than
lossy: each SillyTavern turn becomes one node per swipe, siblings under the
previous turn's live node. Their linear-with-alternates *is* our tree, so the
swipe carousel walks an imported conversation's alternates without knowing they
came from anywhere. Phase 43's root-sibling work covers the opening message for
free.

### Deliberately deferred

- **Scene export.** Offered during planning and not picked, so Onsen still has
  no door out. Worth saying plainly: "you can move in but not out" is a fair
  thing for a self-hoster to be suspicious of, and it is the obvious next thing.
- **The Gemini adapter**, which is its own phase and shares nothing with this.
- **Chub URL import**, still waiting on phase 42's decision.

### Spec changes

§9 gains the import; §18 gains a `Settled while building phase 44` block of six
decisions; §2's scene sketch gains the provenance columns; §20 gains line 44.

### Surprises

**Three of the five importers were not idempotent, and only the browser drive
noticed.** Chats and cards dedupe on a hash of their bytes, which is exactly
right for them. Lorebooks, instruct templates and regex scripts have no hash of
their own — so re-running the import added a second copy of each, every time.
The tests all passed, because every one of them ran the import once. The
re-run is the *normal* second act of this feature, and it took looking at
`added 3, skipped 7` on the second pass to see it.

**"The ridge — The ridge".** A solo chat is named for its file and lives in a
folder named for the character, so pairing them is right. A group chat's file is
named for the group and so is the group, so pairing them says it twice. Also
found by reading the output rather than by a test.

**Every imported scene said NO MODEL.** `insertScene` takes a preset and a
profile and defaults both to null; every existing caller passes them, so nothing
had ever exercised the default. A migrated library where no scene can generate
is a poor first minute, and the fix was two lookups the demo seed already does.

**Playwright cannot fake `webkitRelativePath`** — but it will take a directory
path for a `webkitdirectory` input and populate it properly, which is the only
way to drive this feature's real client path at all.


---

## Phase 45 — Themes

Two criticisms, one answer. The app read flat, and it could not be customised at
all — where SillyTavern lets you set nearly every colour by hex, keep themes,
and write your own CSS.

Flatness was not an accident. §16's third rule — "everything is a page being
marked up" — mandated sharp corners, 1px hairlines and no shadows, and that is
why nothing on screen could be grouped or lifted. Once themes exist, that stops
being a global law and becomes a theme's own choice, which is what makes the two
complaints the same piece of work.

### What was already there

Most of it, which was the surprise:

- **89 CSS custom properties** in `tokens.css`, and `@theme inline` mapping them
  into Tailwind — whose own comment reads "a theme switch on `:root` re-colours
  the whole app with no rebuild". True, and never used.
- **Zero hardcoded hex values** in any component. Every colour already went
  through a token.
- A server-side key/value settings store, and `usePreferences` wired.
- The flatness was **one rule**: `@layer base { * { border-radius: 0 } }`.

And one thing that was not there at all: the Reading settings category, whose
own search words are `font, size, theme, prose, light, dark`, contained a single
control — a completion-chime toggle. `--onsen-prose-scale` existed, fed four
derived size tokens, and was set by nothing. The fifth instance in this project
of a mechanism built, promised in the strings, and driven by nothing.

### What was built

**Migration 0041** — a `themes` table, and the active one as a setting.

**Four depth tokens** — `radius`, `border-width`, `shadow-card`, `shadow-panel`,
plus `card-bg` and `card-padding`. All default to the flat original, so a theme
that says nothing about depth renders exactly what shipped before. A `.turn`
class on each message and a `.panel` class read them, so a turn becomes a card
without a single component knowing which theme is on.

**Seven shipped themes** — Ledger (the original warm palette, flat, kept so
nothing is lost), and six grounds that are deliberately not it: Bottle,
Nocturne, Graphite, Oxblood, Bone, Slate. Default is **Bottle at cards**.

**`GET /themes/active.css`** — the active theme as a stylesheet, linked from the
document, outside the auth wall because it is the login screen's colours too.

**Import and export**, with the rule that tokens are data and CSS is code: a
token that could close its declaration or reach the network is refused outright,
and an imported theme's CSS lands inert in a pending field, is shown with a list
of what it would be allowed to do, and runs only once approved.

### Surprises

**The theme did not reach the page, and said nothing about it.** `:root[data-theme]`
ties `:root:not([data-theme="dark"])` on specificity, so source order decides —
and Vite injects the app stylesheet after the document's own `<link>` elements.
The network served the right CSS and the page ignored it. Every unit test
passed; the browser drive printed `--onsen-color-bg = #f4efe4` five times in a
row for five different themes. The fix is `:root:root:root`, which outranks
anything the stylesheet can say without needing to know where the bundler put
it.

**Cream stripes on a bottle-green ground.** `--onsen-stripe` was a literal
gradient no theme overrode. Deriving it from the surfaces fixed it for every
theme at once, including ones nobody has written yet.

**A partial theme inherits the base's leftovers, and the light base's leftovers
are warm.** The first light theme came out with tan button borders and cream
bars, because it set fifteen colours and the stylesheet defines ninety. Padding
out the shipped themes would have fixed those seven and left every user-made
theme with the same trap, so the tokens that follow another are filled in when a
theme is serialised instead: `bg-card` follows `bg-raised`, `border-quiet`
follows `rule`. Change five colours, get a coherent app.

**A regex refactor of `tokens.css` went wrong quietly** — it stripped
definitions out of the base block while leaving the light block's literals in
place, which typechecks and renders and is simply wrong. Reverted and redone
with explicit replacements, and the derivation moved into the serializer where
it is pure and testable.

**The reachability test earned its keep again.** `GET /themes/active.css` has no
JavaScript caller — it is a `<link>` in `index.html` — so the scanner flagged it
as unreachable. The endpoint was fine; the scanner only read TypeScript. It
reads HTML now.

### Deliberately deferred

- **Wiring `--onsen-prose-scale`.** It is now the only thing left in this area
  that is built and undriven, and it belongs with a font-size control rather
  than being bolted onto a colour editor.
- **Importing SillyTavern themes.** Phase 44 reads a whole install and ST keeps
  themes under `themes/*.json`; mapping its key names onto these tokens is a
  natural follow-on and was not part of this.


---

## Phase 46 — The assistant

Asked whether a second agent with tools over the whole app was possible and
whether it was a good idea. Possible: yes, and most of the surface was already
there. Good idea: yes for the drudgery — §9 already calls managing hundreds of
cards "a significant unsolved problem" — and the first answer given was too
cautious about it. This is single-user software on a private network, and an
assistant that could only propose would be a worse version of the guided ops
that already existed.

### What was built

**Tool calling in the adapter layer**, which did not exist at all: a
`supportsTools` capability, `ToolSpec` and `ToolCall`, a `tool` message role,
and `tools` on `BuiltPrompt`. The OpenAI adapter sends them and reassembles the
streamed fragments — they arrive keyed by index with the arguments spread across
frames — into whole calls, flushed both on `[DONE]` and on a stream that simply
closes.

**Migration 0042** — threads and their messages, because the useful asks are
long and losing them on reload would make it a toy.

**Twenty tools** over cast, roleplays, lore, personas and themes, hand-written
rather than generated off the routes: the model chooses on the description, and
"the roleplays in this install, newest first" beats "GET /scenes".

**An undo.** Destructive calls snapshot the DTO first. Before this,
`character_versions` was the only edit history anywhere in the app.

### Deliberately deferred

- **Anthropic tool calling.** Its wire shape is content blocks with `tool_use`,
  not a `tool_calls` array. `supportsTools` is **false** there rather than
  claimed — this project has been bitten five times by a capability that was
  announced and not built, and a sixth would have been self-inflicted.
- **The client.** The server half is complete and tested; there is no UI yet.

### Surprises

**The SSE writes were not awaited, and it looked completely fine.** `void
stream.writeSSE(...)` races the stream closing when the turn ends, so every
answer came back as an empty body with a 200 and the right content-type. The
first debugging pass blamed the test harness.

**The loop called the real `createAdapter` directly**, so no test double could
reach it and it was quietly talking to the harness's llama.cpp profile — which
cannot use tools, which is why it then refused. Two bugs stacked into one
confusing symptom. It takes the same injected factory as the task runner now.

**A thread with no profile threw** instead of falling back to the install's
default: `resolveRoute` is written for scenes, which always have one.

**The scripted adapter had to learn a whole turn.** A turn is a loop — answer,
run tools, ask again with the results — so a test that scripts one round hangs
on the second. Every tool test scripts call-then-answer, and the queue survives
across `generate` calls, which is what makes that work.

---

## Phase 47 — Typography and hierarchy

Phase 45 fixed the two things the criticism named — the tan palette and the
flatness — and left the third untouched. Asked what was next, the honest answer
came from counting rather than from taste:

```
≤10px:        395 elements     (9px ×145, 10px ×112, 9.5px ×88, 8.5px ×45, …)
17px and up:   12 elements
uppercase:    218 uses across 44 files
font-weight:  30 font-medium + 3 font-semibold  ← in the entire client
.section-label:  167 uses      .screen-title: 6
```

The first diagnosis — "the type table is the bug, it needs rewriting" — was
**wrong, and was corrected before any code moved.** The table has a real serif
ramp (26 / 19 / 17.5 / 17 / 15.5 / 14.5). The app simply never climbed it.

The actual mechanism, found by reading `Field.tsx`: `.section-label` was drawn
as a *group heading* — "three groups, each a mono section label over hairline
rows" — and was then used as the *field label*. So there was no group heading
anywhere in the app, and every level of the hierarchy was set in the same 9px
uppercase mono. Help text under those labels sat at `text-[10px]` — **larger
than the label above it**, same face, same colour family, 148 times over.

This is the codebase's other recurring pathology, seen from a new angle: not
"mechanism built, nothing drives it" but *one element pressed into four jobs
because the phases that needed the other three never stopped to add them.*

### What was built

**Two roles that did not exist.** `.group-heading` (11px mono, 600, 0.18em,
with a rule running to the right edge) and `.explain` (13.5px Spectral). Plus
`.meta` and `.token-count`, which are not new roles — they are the one spelling
for a role that had been written twenty ways, 9px at 0.06em and 0.08em and
0.12em, 8.5px at 0.1em, none of the differences meaning anything.

**The two-voices rule was amended, with the user's decision on the record.** The
design says the app never sets chrome in Spectral and makes one exception for
the OOC voice, because it reads as "a person typing at you". A help line is the
same thing. Asked which way to go, the answer was to bend it: **mono names,
Spectral speaks.** `DESIGN.md` carries the amendment inline so the next reader
does not follow the superseded rule.

**148 explanation paragraphs swept mechanically**, plus 47 metadata spellings
collapsed, plus 16 group headings on Settings and 10 on scene setup. Small text
went from 395 elements to 200.

**`test/typography.test.ts`**, which is the actual deliverable. The defect was a
*distribution*, and a distribution is invisible to every review that reads one
file at a time. So the rules are counted, not trusted: nothing is both
`.explain` and `.chrome`; no explanatory paragraph is set as chrome; nothing is
below 8px outside the ops keys; and the small end of the app may not outgrow the
readable end by more than 2:1.

**A numbering defect from phase 46 fixed:** the assistant was written as §23,
which was already Testing requirements. It is §25.

### Deliberately deferred

- **Scene setup's group names are invented.** Scene / Direction / Scenario /
  Memory / Model / Off script / Playback name clusters that were already in that
  order — nothing was moved to fit them — but the names are mine, not the
  design's. `DESIGN.md` says every noun is provisional; these are more
  provisional than most.
- **The layout direction was still never picked.** Colour (Bottle) and depth
  were chosen in phase 45; Quiet / Instrument / Broadsheet was never answered,
  and this phase deliberately did not decide it by default.
- **`--onsen-prose-scale` still has no control.** Explanations now scale with
  it, so it drives more than it did — and it is still driven by nothing.

### Surprises

**The guard test found three violations on its first run**, in code the
mechanical sweep had just been over: a paragraph in `WebhookEditor` that
`truncate` had excluded from the sweep's filter, and a 7.5px caption in
`CastStrip` that was below the design's own floor. The sweep and the test
disagreed, and the test was right both times.

**Light mode could not be checked the usual way.** Forcing `colorScheme:
"light"` in Playwright changed nothing, because the install had an explicit
theme saved and an explicit choice correctly beats the system preference — the
phase-45 behaviour working exactly as designed, presenting as a broken test
harness. The check had to go through the app's own theme picker.

**The reachability guard had been checking four fewer routes files than it
claimed**, found while answering "what's next" rather than while building.
`endpoints()` silently skips any routes file it cannot find a mount for, and
three of them — `authors.ts`, `generation.ts`, `api-keys.ts` — export two
factories each, which the single-name import regex could not match. The fourth
was `agent.ts`, invisible because phase 46 mounted it with an explanatory
comment between the path and the factory and the scan could not read past it.

The file also carried a comment promising a "mounted-ness test below" that had
never been written — the project's signature pathology (a string promises it,
nothing drives it) sitting inside the very test written to catch that
pathology. That test exists now, and it is what found the other three.

Repairing it reported eleven orphans, of which eight were real: the assistant's
entire surface, unreachable exactly as phase 46 said it would be. They are now
listed individually in `DELIBERATE`, so building the client deletes them rather
than leaving a prefix that keeps excusing whatever lands there next.

**The first size was wrong and only the screen said so.** Explanations at
14.5px sat a half-pixel under the 15px row titles they explain, so the help text
read as loud as the content. 13.5px separates them. Nothing but a screenshot
would have caught that; the tests were green at both sizes.

---

## Phase 48 — Tools on every provider

Phase 46 built the assistant and shipped it working on one provider out of
three. Asked what was next, the answer given was: *"we need to be platform
agnostic when it comes to tools."* That is right, and the gap was worse than a
missing feature — the assistant would refuse outright on an Anthropic profile
and tell you to go change your settings.

### What was built

**Anthropic tool calling**, which is a genuinely different wire shape rather
than a renamed field. Definitions go up as `input_schema`. A call comes back as
a `tool_use` content block with its arguments dribbling in as
`input_json_delta`. A call sent back up carries its arguments **parsed**, not as
the JSON string every other layer holds. And results are not a role — they are
`tool_result` blocks inside a *user* turn, with every result for one assistant
turn in a **single** message or the API 400s.

**`test/adapter-tools-conformance.test.ts`**, which is the actual deliverable.
Each provider's dialect is its own; what must not vary is the contract — one
complete call, with an id, a name, and arguments the caller can parse. The suite
asserts that against every adapter declaring the capability, and **fails if an
adapter declares `supportsTools` without being listed in it**. A per-provider
test file is precisely how the gap stayed invisible: each one passed on its own
terms.

**`isError` now reaches the model.** It had been stored on every tool message
since phase 46 and read by nothing. Anthropic has a field for it; OpenAI does
not, and drops it. That is the ordinary shape of a capability difference.

**The refusal names the shape, not a vendor.** It used to say "point it at an
OpenAI-compatible profile". It now says a plain text-completion endpoint has
nowhere to put a tool call, which is the true reason and stays true when the
next adapter lands.

### Settled while building

- **The layout direction is Instrument** (see §16). Quiet and Broadsheet become
  presets over the same switches rather than separate screens.

### Deliberately deferred

- **Gemini.** Its tool format differs again (`functionDeclarations`, and parts
  rather than blocks). The conformance suite is built so that adding it is a
  row in a table plus an adapter — and so that shipping it *without* the row
  fails the build.
- **Parallel tool calls on Anthropic.** Two calls in one turn are parsed and
  tested; whether to run them concurrently is the agent loop's question, not the
  adapter's, and it still runs them in order.

### Surprises

**The honest `supportsTools: false` was load-bearing in the wrong direction.**
Phase 46's comment said declaring false beat announcing a capability that was
not built — which was right at the time and became the thing that hid the gap.
Honesty about a hole does not fill it, and nothing in the suite distinguished
"declared false because it cannot" from "declared false because nobody wrote
it yet". The conformance test now forces that distinction.

**A model emitting malformed JSON would have made a whole thread unsendable.**
Anthropic wants `input` as an object, so a bad argument string cannot simply be
passed through. Throwing would break every later turn rather than the one bad
call, so unparseable arguments go up as `{ _raw: "…" }` — the turn survives and
the model can see what it did.

---

## Phase 49 — Legibility, and a button that only looked broken

Four reports, all from actually using the thing.

### The fetch button

**It was never broken. It worked perfectly and showed nothing.** Driving it:
200 from the server, two models parsed, both present in the DOM — and
`visible text mentioning stub: false`. The results went into a `<datalist>`,
which renders nothing until the field is focused and typed into. On a phone it
often renders nothing at all. So the button did its whole job invisibly.

Fixed as a shared `ModelPicker`: the same call, with the answer as a list you
can see and press, a count, and a filter past eight models because OpenRouter
lists hundreds. **The same bug existed twice** — the provider editor and the
profile editor each had their own copy of the datalist — and the setup wizard,
where somebody meets this app for the first time and most needs the question
"what do I put in the model box" answered, had no fetch at all.

Also fixed underneath: the route accepted a `kind` and dropped it on the floor,
so an Anthropic provider authenticated with a bearer token it does not use and
got 401 on every candidate path, reported as "no models endpoint answered".

### The two figures that were transcribed faithfully and were wrong

**`#14120f` against `#16130f`.** Two points of lightness per channel between
the page and every surface raised onto it. Every sheet, composer and footer in
the app is `bg-raised`. The report was "a lot of dark on dark by default", and
it was exactly right — for forty-odd phases nothing that was meant to sit on
the page looked like it did.

**Chrome sized for a phone.** The report was "for the site to be usable I have
to zoom in on my browser like 130%", which is a statement about the default,
not about the reader. 213 sizes went up a step, and the floor rose from 7px to
9px.

`test/surfaces.test.ts` now measures the steps between surfaces. This is the
kind of defect that survives every screenshot review, because each screen looks
deliberate on its own and the bug is a relationship between two hex values in
one file.

### Deliberately deferred

- **A prose-size and interface-size control.** The right home for both is the
  Reading section, and `--onsen-prose-scale` is still driven by nothing. Raising
  the default was the fix for the report; a control is a separate feature.
- **`.surface` on every screen.** Applied to Settings and scene setup, the two
  long forms. The chat log is deliberately not a panel — it is the page.

### Surprises

**"Broken" meant "invisible", and the fix was not in the code that was blamed.**
The first instinct was a failing request. The request had never failed. Nothing
short of driving the button and asking the DOM whether a human could see the
result would have found it, and a unit test asserting `models.length === 2`
would have passed throughout.

---

## Phase 50 — Instrument

Three directions were drawn in phase 45 and the question sat open for five
phases. The answer was Instrument, with a good follow-up: *"but we can make
them all different options as layouts. maybe mix and match features?"* — which
is right, and is why Quiet and Broadsheet are recorded as presets over shared
switches rather than as three screens. The guardrail is in §16: a matrix of
toggles in place of a default is the incumbent's answer, and the default is
what the app is.

### What was built

**The deck.** Who speaks next with the reason printed beside it, the cast as
one segmented control, and a row saying what each subsystem is holding. It
collapses when the ops drawer opens — the same rule the cast strip followed,
because the whole stack has to fit above a keyboard at 390px.

**The cast as segments.** The cards carried a portrait nobody has supplied yet
and cost 70px of height where height is scarcest. A name in a segment carries
the same decision. The cards survive on the desktop rail, which has room for a
portrait and a last line — the one thing a phone cannot give them.

**The speaker's spine.** A 3px rail down each turn instead of a hairline
running right from the name. A rule between two turns reads as a divider; a
rail reads as belonging to one, which is what a speaker is. The turn being
streamed takes red, and nothing else in the log does.

**A hue per subsystem, and the two-pencil rule amended a second time.** Guides
keep the blue pencil, memory takes the green that until now lit only a
connection dot in Settings, media takes a brass. Red is deliberately absent
from the readout — it stays the colour of *now*. `test/surfaces.test.ts`
asserts the hues are far enough apart to read as different systems and that
none of them is the red pencil.

**Two figures the scene never carried.** `summaryCount`, which was reachable
only by opening the summaries sheet — a request that fetches the whole set to
learn one number. And `contextSize`, without which `lastPromptTokens` is a
figure with no denominator: it had been a bare number in the status bar since
phase 43, and is a gauge now, green until 90% of the window and red past it.

### Deliberately deferred

- **Quiet and Broadsheet as presets.** The switches they differ on are named in
  §16 — readout row, cast display, scene dek, attribution style — but nothing
  reads them yet. Instrument is hard-coded, which is honest for a default and
  dishonest for a preset system, and the next phase is the one that makes it a
  preset rather than a state of affairs.
- **The desktop deck is partial.** The readout row is there above the cast rail;
  the mock's per-subsystem groups, each with a line of their own content, are
  not.

### Surprises

**The redundant separator only appeared once both were on screen.** The
attribution rule running from the name to the right edge had been correct for
forty-nine phases; the moment the turn gained a rail it became a second
divider on the same block. The span survives — it is what the swipe counter
sits at the end of and what the hover actions are painted over — it just no
longer draws a line. Neither element was wrong on its own, which is the whole
difficulty of changing a layout rather than adding to one.

**The probe said the deck was missing when it was on screen.** Reading the
drive output rather than the screenshot, `deckText: null` looked like a
rendering failure; the regex was case-sensitive and the labels are uppercased
by CSS. A minute spent looking at the picture instead of the log settled it.

---

## Phase 51 — Empty states

*"the lore page, when empty, should like, prompt you to create a lore book and
make it easy to do so. currently it just says 'get fucked' essentially. the
same is true elsewhere. stuff just feels incomplete and shallow."*

Accurate. The copy was not the problem — `lore.empty` already read "No
lorebooks yet. Import world info, or start one." The problem was that it was
set as an 11.5px uppercase mono line, the smallest and coldest thing on the
page, floating in a void, while the two buttons that would act on it sat in a
footer at the other end of the screen. **Eight screens had a copy of that exact
paragraph.**

### What was built

**`EmptyState`** — what is missing as a statement, what the thing is *for* in
the explaining voice, and the action that ends it. Applied to roleplays, cast,
authors, lore, lorebook entries, scene cast, and the chat log.

**Copy that teaches rather than reports.** Every body says what the thing does,
not that there is none of it: a lorebook is world info that fires on keywords
so only what is relevant reaches the prompt; an author is the voice that plays
the whole cast; history is a tree so you can branch and keep both versions. An
empty screen is the one moment the app has the reader's whole attention and
nothing else on the page to compete with.

**Footers hidden while a screen is empty.** `ScenesScreen` already carried the
note — *two identical red buttons on one screen is a question about which one
is the real one* — and it applies exactly here.

**`test/empty-states.test.ts`**, which asserts every screen that can be empty
has one and fails on the old shape.

### Surprises

**The guard found four more sites than the survey did**, in panels and sheets
rather than screens: the desktop cast rail, the lore test result, the dossier
list, the cast picker. Those wanted the explaining voice without the card — an
inline empty is not a page — but all four were still whispering in tracked
uppercase mono.

**A copy bug surfaced by renaming a string.** The lorebook *entry* list used
`lore.empty` — which now reads "No lorebooks yet", inside a lorebook. It had
been wrong since the screen was built and was invisible while the string was
vague enough to fit both jobs.

---

## Phase 52 — Layout presets

*"but we can make them all different options as layouts. maybe mix and match
features? i dunno"* — right, and phase 50 recorded it as the plan without
building it. Instrument was hard-coded, which is honest for a default and
dishonest as a preset system.

### What was built

**Four switches, three named starting points.** `readouts`, `cast`, `dek` and
`attribution`; Instrument, Quiet and Broadsheet are sets of them. Stored as
four settings rather than one blob so a switch added later defaults on its own,
and read back through `presetOf` so the client is never told a preset name that
disagrees with the values under it. Touching a switch moves the label to
**Yours**; landing back on a preset's exact values names it again.

**Quiet's one-line cast control** — the name that answers, the director's
reason, and a `change` that cycles. **Broadsheet's dek**, which is not a new
field: it is the scene's own `scenarioOverride`, until now visible only in setup
and in the prompt. **Broadsheet's inline attribution**, the name set into the
opening of the paragraph rather than on a row above it.

**Two things fixed on the way, both from questions asked mid-build:**

- *"can we click around the ui while replies are generated? its kinda not
  clear."* You can — generation is server-owned, you can navigate away, close
  the tab, come back. But the **deck disappeared the moment generation
  started**, which is exactly backwards for a layout whose whole argument is
  that state stays on screen, and it made the screen look frozen at its busiest
  moment. It stays now. Cueing who speaks *next* while somebody is mid-turn is
  a real thing to want.
- *"the models list needs to support providers with hundreds of models."* It
  was a wrapped row of chips with a filter past eight. Against a stub serving
  400 OpenRouter-shaped ids that is a wall, so it is a search over a list now:
  the field first, one model per row, a live `76 of 400` count, and a render cap
  with "keep typing to narrow it" rather than four hundred rows drawn to show
  ten.

### Deliberately deferred

- **The desktop deck's per-subsystem groups.** The readout row is there; the
  mock's groups, each carrying a line of their own content, are not.
- **Presets on the desktop rail.** `cast` and `readouts` are honoured there;
  `dek` and `attribution` are read by the log and the header, which desktop
  shares, so those work. The rail itself does not change shape between presets.

### Surprises

**Both controls printed the same thing.** Broadsheet showed "Speaking next /
Named in the last message" as a header *and* "Mira Vance answers next" as a
line — the header belongs to the segments, and the line already says both.
Neither was wrong on its own; the pair only existed once a preset turned one
off. The reason is computed once now and rendered by whichever control is on.

**A capital letter in the wrong place, twice over.** Folding the reason into a
sentence produced "answers next — Named in the last message", because §6 says
the director's reason is shown *verbatim* and they are written as sentences. The
sentence had to bend around the reason rather than the reason around the
sentence: two sentences, not one joined by a dash.

**Two probes reported failures that were not there**, both times because CSS
uppercases the text and the regex did not. `deckText: null` and
`rows drawn: undefined` both looked like rendering bugs and were reading
mistakes. The screenshot settled both in seconds.

---

## Phase 53 — Voice

*"in actual use, the app feels very shallow and incomplete. the typography
still sucks, every single feature feels incomplete. the AI explanations every
cringe me tf out."*

All three are fair, and I put two of them there.

### The typography answer was in the file I built from

`Instrument.dc.html` — the direction that was chosen — carries this comment:

```css
/* Labels are readable, not decorative: 11px, sentence case, no tracking. */
```

| Mockup | uppercase | letter-spacing |
| --- | --- | --- |
| `Instrument` (chosen) | **0** | **0** |
| `Main` (Quiet) | **0** | 1 |
| `Broadsheet` | **0** | **0** |
| `Now` — *what ships today* | 18 | 19 |

The three directions all abandoned uppercase-tracked-mono. It survives in
exactly one mockup: the one drawn of the thing being criticised. **Phase 50
built Instrument's layout and kept the old label treatment** — 164 uppercase
elements and 155 letter-spacing declarations at nine different values — and
then phase 47 and phase 49 tuned that treatment twice without ever asking
whether it should exist.

### The copy was the same disease

178 explanatory strings, 15,276 characters, 165 render sites. Counted: **29**
em-dash asides, **31** rule-of-three comma lists, **8** definitional openers.
The design's own settings surface has *one* sentence on the whole screen and
explains by showing — a swatch labelled `live · now`, a one-line code sample
where a paragraph about custom CSS would go.

**Phases 47 and 51 made it worse.** 47 promoted explanations to Spectral at
reading size; 51 wrote a teaching paragraph for every empty screen and called
it the app's one chance to teach. Both were carefully done and pointed the
wrong way. The register was never the problem — the presence was.

### What was built

- **One tracking token, set to zero**, kept only so a theme can put tracking
  back. Zero uppercase utilities anywhere: the ops keys are capitals in the
  data, being proofreading marks rather than labels.
- **178 → 37 explanatory strings**, under one rule: *an explanation earns its
  place only if its absence would cause a mistake that cannot be undone.*
  Survivors are confirmations, the secrets shown once, and the machine settings
  whose label genuinely cannot carry them. Everything else **deleted, not
  rewritten** — 85 strings and 11,014 characters.
- **`test/voice.test.ts`**: no uppercase, one tracking token, a ceiling on
  explanatory strings, and no definition of a noun aimed at somebody already
  looking at the thing.

### Deliberately deferred

- **The other two complaints.** "Every feature feels incomplete" is a separate,
  measurable thing: the server is consistently one notch deeper than the
  client. `DELETE /scenes/:id` has zero client callers; `useUpdatePersona` is
  exported and called by nothing, so a persona's `description` — the field that
  reaches the prompt — is unreachable; three of four lorebook binding scopes
  are display-only; lore's `insertionRole` has zero client hits while the
  prompt builder consumes it. That is phases 54 and 55, with a field-level
  reachability guard.

### Surprises

**Two guards failed, and both were right to.** `typography.test.ts` caught "an
explanatory sentence dressed as a label" by looking for mono + small + dim + a
reading line-height — and it worked *because a real label was also uppercase
and tracked*, which excluded it. Removing the uppercase removed the signal the
heuristic depended on, and it began flagging the director's reason and a
parse-failure notice, both machine output and correctly mono. The check was
deleted rather than patched: the rule it approximated is now enforced directly.
`empty-states.test.ts` asserted `body: string` was required, which phase 51 had
made true and phase 53 made wrong.

**The first ceiling measured the wrong thing.** `.explain` renders both the app
explaining itself and the app reporting state — "Nothing installed", "No key",
"Nothing matches that" — and only the first is governed by the rule. Counting
render sites put the number at 107 and looked like failure; counting
explanatory *strings* put it at 37 and was the truth. A metric that punishes
status lines would have pushed the next phase to delete the wrong things.

## Phase 54 — Depth

The second of the three complaints: *"every single feature feels incomplete."*
Asked which parts, the answer was all four — library screens, chat surface,
editors, setup and settings.

That reads like a mood. It is one measurable pattern: **the server is
consistently one notch deeper than the client.** The endpoint exists, the DTO
field exists, the capability is wired end to end — and the UI reaches only the
first level of it. Five of those, all hit in a first session, four needing no
server work at all.

### What was built

- **A roleplay row does more than open.** Search across title, cast and last
  line; sort by recency, title or length; and a per-row menu with rename,
  *start another like this*, and delete. `DELETE /scenes/:id` had existed since
  phase 2 with no caller anywhere in the client. The copy is not "duplicate":
  copying the story is not what anyone wants, copying the setup is, so
  `POST /scenes/:id/like` clones the row and its cast and no messages. It
  copies by reading `pragma_table_info('scenes')` rather than naming columns,
  because a phase that adds a scene setting should not have to remember to add
  it here too.
- **A persona is a thing you can edit.** Server CRUD has been complete since
  phase 8; `useUpdatePersona` was exported and called by nothing, so
  `description` — the field that actually reaches the prompt — could be written
  by an importer and by no human. A sheet over scene setup: name, description,
  default, delete.
- **Lorebook bindings, all four scopes.** Only one place in the app created a
  binding, and it hard-coded `scope: "scene"`. A book bound globally or carried
  by a character was visible everywhere and removable nowhere — `LoreSheet`
  declines to detach those with a comment saying they are "attached somewhere
  else". This is the somewhere else.
- **Two lore-entry fields.** `insertionRole`, consumed by the prompt builder
  since phase 21 with zero client hits, and `automationId`, which triggers
  could already fire on and no screen could set.
- **Presets you can make and remove**, and a preset a connection profile can be
  given. `is_default` was written once at install and had no route to move it.

### The guard

`test/reachable-fields.test.ts`, the field-level analogue of
`test/reachable.test.ts`: every field on every `*Request` type in
`shared/types.ts` must be named somewhere in `client/`, with a `DELIBERATE` map
carrying a reason per exception and a staleness check so an excuse cannot
outlive the field it excuses.

**On its first run it found 8 orphans, and five of them were the same field.**
`presetId` appeared in five request types — a preset could be imported, edited
and exported, and attached to nothing. That is the shape of this whole phase in
one number: not five scattered oversights but one missing control, counted five
times.

### Deliberately deferred

- **Palette commands for library management.** `CommandPalette` is rendered in
  exactly one place, `ChatScreen`, so `new-roleplay` / `rename-roleplay` /
  `delete-roleplay` would have been three commands reachable only from inside a
  roleplay. The plan called for them; putting them there would have been worse
  than not having them. Either the palette becomes app-wide or these stay out.
- **Three tier-2 fields** are in `DELIBERATE` for phase 55:
  `UpdateLorebookRequest.recursionDepth`, `UpdateCharacterRequest.depthPromptRole`
  and `UpdateCharacterRequest.characterVersion`.

### Surprises

**The manage affordance shipped invisible on the device the app is built for.**
The first version faded the row's "…" in on hover, matching the message log.
There is no hover on a phone, so the only route to rename or delete was a
long-press nobody is ever told about — a control you cannot see is not a
control. It is now always visible, 44px, and brightens rather than appears.

**The entry editor drew two new fields and saved neither.** `insertionRole` and
`automationId` got their controls, typechecked clean, and the full suite stayed
green — the editor's `onSave` builds an explicit payload of twenty-odd fields
and the two new ones simply were not in it. Nothing in the type system objects,
because `UpdateLoreEntryRequest` is a `Partial`: an omitted field is a legal
request. Only driving it in a browser and reading the row back caught it, which
is the same lesson phase 47 wrote down about typography and the same reason the
verification step is a real browser rather than a test.

**`scene_members` does not have the columns you would guess.** The cast copy
was written from memory and had to be corrected against `0006_group_scenes.sql`:
`created_at` is `NOT NULL` and `joined_after_message_id` must *not* be carried,
since a member of a fresh scene joined at the start by definition.

## Amendment — the design authority was wrong about its audience

Not a phase. A correction to the documents phases 47 and 49–53 were built
against, recorded here because six phases of work came out of one sentence
nobody wrote on purpose.

### What it said

`docs/design/DESIGN.md`, §Progressive disclosure:

> *"UI density is the single most common complaint about the incumbent and the
> main thing this product is reacting against. The default view of every screen
> is clean. Depth sits behind `ADVANCED ▾`. When in doubt, hide it."*

`SPEC.md` §22 carried the matching clause: *"Don't build a dense settings
surface. The top complaint about the category leader. Progressive disclosure,
always."*

### Why it was wrong

**It was generated, not briefed.** The design bundle ships `.dc.html` artboards
— it is the output of a design session, and `HANDOFF.md`'s precedence table
makes the design doc binding on layout and appearance. So a claim invented in
one session became authority in every session after it. Nobody asked for it.

**And it mistook the complaint.** Shown five screenshots of a real SillyTavern
install, the reader's verdict was *"our app is clean, but I don't want or need
clean. YOU put that on the project. not me. this app is for power users."* That
install runs **139 chats, 23 personas, 18 ordered prompt blocks, 7 group
members**, at font scale 0.98 with two side panels open. Its problem is not
that it shows too much. It is that what it shows is unordered — which is why it
needs a search box over its settings, and which categories fix and hiding does
not.

### The conflation

**Terse is not sparse.** Phase 53 deleted 85 explanatory strings because they
were asked for and they were cringe, and that was right. Nothing in it asked
for low information density, and I supplied that anyway. The incumbent is
simultaneously the least chatty thing on screen and the most dense: no
explanatory prose anywhere, and a token count on every prompt block, `#46 ·
27.3s · 868t` on every message, `1-50 .. 139` on every list. Terse *and* dense
was always available. Onsen shipped terse and airy.

### What replaced it

`DESIGN.md` §Density and `SPEC.md` §16 §Density, six rules: a screen shows
everything it governs; numbers render untapped; controls live in the row; rows
scale with the input device (44px touch, 28–32px pointer); whitespace only
separates what would otherwise be confused; the reading surface is the
exception and the reader owns it. §22 now reads *"don't build a disorganised
settings surface"* — density is fine, hunting is not.

The superseded sentence is quoted in place rather than deleted, so the reversal
is legible to whoever reads the doc next.

### What stays

Phase 53's register was responsive to what was actually said and is untouched:
no uppercase, no tracking, sentence case, explanations gone. The incumbent's
own themes agree on all four. The red = live / blue = author hues and Spectral
for prose were never the objection either. This amendment is about spatial and
informational density, and nothing else.

## Phase 55 — Density

The first phase built under the amended doctrine, and it mostly consists of
switching on things that were already there.

### What was built

- **The reader owns the reading surface.** Scale, measure and leading are three
  server-side settings (`reading_scale`, `reading_measure`, `reading_leading`,
  through the same `getSetting`/`setSetting` path phase 52's layout uses),
  applied to `documentElement` by `useReadingVariables` so a change lands on the
  frame it is made rather than on the next reload. A live sample sits under the
  sliders — the design's own instruction to explain by showing, which is why
  there is no sentence next to them saying what "line spacing" means.
  `--onsen-prose-scale` had been a hardcoded `1` for ten phases and was deferred
  out of three of them.
- **Denser defaults.** Prose 17px → 15.5px, measure 620px → 720px, leading 1.64
  → 1.5. The handoff's figures are still reachable near the top of each range;
  they are no longer the only option.
- **Every message shows what it cost.** `#4 · 20ms · ~126t · 10/s` in the
  gutter, untapped. The tilde marks a count from the estimator rather than the
  provider.
- **Rows scale with the input device.** `.row` is 12px under a thumb and 6px
  under `@media (pointer: fine)`, and the list rows that hand-rolled their
  padding were swept onto the class. A scene row measures 95px on a phone and
  83px on a desktop.
- **The persona list became a screen** at `/personas`, with search and a count.
  Phase 54 put it in a sheet; at thirteen personas the sheet showed two.
- **`test/density.test.ts`**: every prose token multiplies by the scale, the
  three properties are set at runtime rather than frozen, a pointer query
  exists, and no list row hand-rolls padding over the touch budget.

### Surprises

**The stats were never missing — they were being thrown away.** The server has
measured TTFT, computed tokens/sec and run `UPDATE messages SET
generation_meta` since phase 4. `MessageRow` never declared the column,
`MessageDto` never carried it, and every message read is a `SELECT *` — so the
record has been arriving in the row object for fifty phases with nothing to
receive it. Wiring it up was a type, a mapper line and a render; no new
measurement at all. The spec's own instruction to put these "behind a tap" is
most of why nobody noticed.

**A vendor pseudo-element voided a whole rule.** The range sliders came out
browser-default blue — wrong in a warm theme, and wrong in this palette, where
blue means the author's voice. `accent-color` fixed the fill and left the track
the UA's white, so the track got styled explicitly — and combining
`::-webkit-slider-runnable-track` with `::-moz-range-track` in one selector list
made Chromium drop the entire rule, leaving thumbs floating on nothing. Split
into two rules. A screenshot caught it; nothing else would have.

**My own guard caught my own file.** Moving the persona editor into `screens/`
brought its sheet-era `py-[14px]` with it, and `density.test.ts` failed on the
commit that introduced it. That is the guard working on the first day it
existed.

**The count readout was in the wrong place first.** Putting `3 of 5` at the end
of the sort row squeezed it against "Longest" on a phone, where it read as part
of the button. It belongs on the title row, which is where the incumbent puts
it too.

### Deliberately deferred

- **The prompt manager** — phase 56. Reorder, enable/disable, per-block tokens
  and the data-model decision about user-authored blocks.
- **Persona avatar, position and locking**, and the rest of `docs/GAPS.md`.

## Phase 56 — The prompt manager

`GAPS.md` called this the flagship gap. Researching it found the same defect the
last three phases were named after, older than any of them.

### The join that was never made

- `presets.prompt_order` was created in **migration 0001**, phase 1.
- The pure builder has honoured `ctx.preset.blockOrder` since **phase 3**.
- `server/generation/context.ts` returned `blockOrder: null` — a literal —
  between them, for **fifty-five phases**.

Both ends looked right in isolation. `grep -rn prompt_order server/ client/
shared/` found nothing but a preset-import test. No test asserted that what a
preset stores is what the prompt does, which is exactly the assertion that would
have caught it on day one, so `test/prompt-blocks.test.ts` makes that its whole
subject: every case runs a real row through `resolvePreset` into `buildPrompt`
and reads the assembled output.

Two other things were already there: `PromptBlock.tokens` has carried per-block
costs to the inspector all along, and the SillyTavern importer already parsed a
preset's `prompts` array into a full `StBlock` shape.

### What was built

- **A preset owns its order.** `prompt_order` now holds the whole thing —
  built-ins and hand-written blocks together, each with an enabled flag. Null
  still means §3's default, so no existing preset needed backfilling.
- **A block is a thing you can write.** `preset_blocks`: label, role, text, on
  by default, ordered by `custom:<ulid>` among the built-ins. Drafted like any
  other block, so macros resolve in them and they cost out in the inspector.
  Before this, a block could only enter the app by importing a SillyTavern
  preset — the options API is get, select and reset, with no create or edit.
- **Importing a preset reproduces its prompt.** Its `prompts` land as that
  preset's blocks honouring their enabled flags, rather than as an option group
  selected per roleplay. That was a defensible reading of §13.5 and it made
  every import a menu nobody had switched on.
- **The manager**, in the preset editor: one row per block, a dot for on/off, a
  cost for the ones that are yours, up/down, and the editor inline. Reorder is
  two buttons — there is no drag anywhere in this client to match, drag is poor
  under a thumb, and a library is a dependency for what an arrow does.

### Surprises

**The guard caught a bug in the guard's own subject.** An order whose entries
were all disabled filtered down to `[]`, and `orderedBlockIds` treated
`length === 0` the same as "never arranged" — so it fell through to the default
and put every disabled block back into the prompt. Switching everything off
turned everything on. The check is now `configured === null` only, since
`parsePromptOrder` already returns null for an empty stored order.

**A bare `new Database()` silently binds nothing.** The first version of the
test used `new Database(":memory:")` and every migration failed on
`schema_migrations.name` NOT NULL — with a valid string in hand. `openDatabase`
passes bun:sqlite's `strict: true`, which is what makes `$name` parameters bind
by name; without it the same call is accepted and binds nothing. Tests that
exercise a real path have to open the database the real way.

**The browser drive read a stale message, again.** The inspector check reported
the custom block missing. It was in the prompt: the drive waited a fixed twelve
seconds and then took the newest message *carrying a generation record*, which
was still the previous turn's. Phase 55 hit the identical trap. A drive that
waits on a clock rather than on the id it is looking for will keep doing this.

### Deliberately deferred

- **`injection_position` on imported blocks.** A SillyTavern block asking to sit
  at a depth arrives in the prefix. The parser keeps `atDepth` and `depth`, so
  the information is not lost — but placing it correctly is depth-injection
  work, and guessing would be worse than the honest gap.
- **Per-scene overrides of the order.** The order is the preset's; a roleplay
  that wants a different one changes preset.

## Phase 57 — The turn

Asked for more per-message actions — *exclude from prompts, view swipe history,
branch, copy, edit* — and more ways to format a post.

### Four of the five already existed

`edit`, `branch`, `hide` and `copy` were turn-scoped commands in
`client/lib/commands.ts`, alongside eleven others: fifteen in all. `hide`
genuinely worked; the builder has dropped hidden messages at
`server/prompt/history.ts:125` throughout.

They were unreachable. `MessageBlock` rendered three, faded in on hover, and
`ChatScreen` passed them **only when `isDesktop`**. On a phone the other twelve
were reachable by a long-press nobody is told about — the defect phase 54
removed from the roleplay list, one level down, and now forbidden outright by
§16 §Density rule 3.

Only swipe history was genuinely missing a route: no `versions` command, and
the carousel reachable by a swipe or by tapping a counter that only appears once
siblings exist.

### What was built

- **An action row on every turn, every width.** Reroll, versions (with
  siblings), branch, edit, copy, hide, and `…` for the rest. 32px touch / 24px
  pointer. Every button runs through `runCommand`, the same path the palette
  takes, so the row and the sheet cannot drift apart.
- **`versions` is a command**, so swipe history is in the palette and on the
  turn rather than only under a gesture.
- **Shape, per side.** `LayoutDto` gains `avatarShape` and a `TurnStyle` each
  for `reader` and `author`: bubble or flat, avatar or not. Instrument ships
  bubbles for your turns and flat prose for the story, which is the case one
  global switch could never express.
- **A hidden turn looks hidden** — dimmed, with its dot hollow. It still
  renders, which is the point; the state has to be legible.
- **`test/density.test.ts`** gains two: no turn-scoped command is stranded from
  `runCommand`, and the action row is not gated on a breakpoint.

### Surprises

**A width probe cannot detect a missing glyph in a monospace font.** The branch
glyph came out as noise, so the candidates were measured by comparing rendered
widths against the notdef box — which reports *everything* as missing, because
in a mono font every glyph has the same advance. Re-done by drawing each to a
canvas and comparing pixels: all of them render, and `⑂` was simply illegible at
12px through a fallback face. It became `↳`.

**A text search said `hide` was broken when it was not.** Checking whether a
hidden turn had left the prompt by searching the assembled text for its opening
words returned true — because the same sentence was also in the *guides* block.
`PromptDebugInfo.historyIncluded` carries message ids and answers the question
exactly; the loose match answered a different one. Third time in three phases
that a substring probe has produced a false reading.

**The guard read its own explanation as the defect.** The new assertion forbids
`isDesktop` in `MessageBlock`, and the file's comment explaining the phase-57
fix contains that word. Comments are stripped first now, as
`reachable-fields.test.ts` already does — otherwise the rule could not be
written about in the file it governs.

**An avatar that 404s is an empty disc.** Characters here have no picture and
`MessageDto` does not carry `hasAvatar`, so the first version showed blank
circles. The initial is now always rendered with the image on top: a missing
picture reveals the letter underneath.

### Deliberately deferred

- **The reader's avatar** is an initial. `personas.avatar_path` exists and
  nothing reads or writes it (`GAPS.md` §3); wiring it is that row's work.

## Phase 58 — The dead-column sweep

Four phases running had each turned up storage nothing reads, and each one was
older than the last:

| Phase | Found | Dead since |
| --- | --- | --- |
| 54 | `presets.is_default` written once at install, no route to move it | install |
| 55 | `messages.generation_meta` written every turn, on no DTO | phase 4 |
| 56 | `presets.prompt_order` never read *or* written | migration 0001 |
| 57 | `personas.avatar_path` still unread | phase 7 |

Every one was found by accident, while working on something next to it. This
phase measures the whole schema instead — 58 tables, 587 columns, read out of a
migrated database rather than parsed from the migration text, so what is checked
is what actually exists.

### The two shapes

- **Unmentioned**: the column name appears nowhere outside its own migration.
  Nothing can read it, because nothing knows it is there. This is
  `prompt_order`.
- **Write-only**: it is written, and never named in a read — no `row.x`, no
  field on a row type, no explicit `SELECT`. This is `generation_meta`, which
  the first check cannot see, because the column *is* mentioned, in the `UPDATE`
  that writes it.

### What it found on its first run

**One: `scenes.import_source`.** Written since phase 44 beside `import_hash`,
which *is* read — it is the dedupe key that makes re-running a SillyTavern
import safe. The pair looked alive from outside because half of it was. The
other half, the name of the file a roleplay came from, reached nothing.

Surfaced rather than excused: an imported roleplay's setup screen now says which
file it came from. The re-run flow phase 44 was built for — import, fix the
missing cards, import again — is exactly when "which file is this one" gets
asked.

### Honest limits, stated in the test

It matches on column **name**, not `table.column`, because that is what a text
search can do without lying: `avatar_path` is on `characters` and on `personas`,
and the characters' use makes the personas' look alive. So it under-reports on
shared names. That is the right direction to be wrong in — a guard that cried
wolf on a live column would be switched off within a week, and one that misses
some still catches the `prompt_order` class, which is the expensive one.

### Surprises

**The looser check found nothing and the stricter one found the bug.** The
unmentioned sweep came back clean across all 587 columns, which was tempting to
read as "the schema is fine". It only means distinctive dead names are gone; the
write-only check, added second and harder to write, is the one that earned the
phase. Both were verified by breaking them: reverting `import_source` to its
found state, and adding a column mentioned nowhere.

**`personas.avatar_path` is not caught**, and it is the one already known to be
dead. `characters.avatar_path` is read constantly and the names are identical.
It is recorded here rather than papered over with a `DELIBERATE` entry, which
would have implied the guard saw it.

## Phase 59 — The library at scale

Phase 54 gave the roleplay list search and sort, on the client, and left a note
saying exactly when that would stop being right:

> *"`useScenes` already fetches the whole list and this screen already renders
> all of it, so a server filter without pagination would buy a round trip and
> change nothing. If a library ever gets big enough to hurt, the fix is
> pagination, and that is the change that should move this."*

The install this replaces runs 139 roleplays. This is that change.

### What was built

- **Tags and a folder on a roleplay**, shaped exactly like the character
  library's (`0023`): `tags` is a JSON array queried with `json_each`, and a
  folder is a label rather than a tree. Two libraries that file things the same
  way, rather than two ideas of what a folder is.
- **A favourite on both lists.** `is_favourite` on `scenes` *and* `characters`,
  each with a partial index. A star that worked on one list and not the other
  would have been the half-measure this project keeps catching in itself.
- **Server-side filtering and paging.** `listScenesFiltered` narrows by query,
  tag, folder and favourite, sorts three ways, and returns `total` (what matches)
  alongside `all` (what exists). The screen reads `50 of 60` and grows by fifty
  rather than flipping pages.
- **Tags normalised on write** — trimmed, de-duplicated, empties dropped — so
  the filter's vocabulary and the stored value cannot drift apart. A folder of
  blank space is no folder rather than a folder named nothing.

### Decisions

**`limit`/`offset`, not a cursor.** The incumbent's readout is `1-50 .. 139`, a
page model people already read; and the ordering key is `updated_at`, which
moves as roleplays are used — which is exactly the case where a cursor silently
skips rows.

**One response shape, always.** `GET /scenes` returns `{ scenes, total, all }`
whether or not it was filtered. An endpoint that answers with an array when
unfiltered and an object when not is a bug waiting for the caller who forgot.
Seven callers wanted the whole list for pickers, so `useScenes()` stayed the
array-shaped hook and now unwraps a large page; `useSceneList` is the new one.

**Search is by title only.** The client version also matched the cast and the
last line, which live on the DTO rather than the row — reproducing that in SQL
means joining three tables to answer a question a name usually answers. Recorded
here rather than quietly dropped.

### Surprises

**Changing the list's shape broke eight tests, and all eight were right to
break.** Three in `scenes-api` and five in `migrate-api`, every one of them
reading `GET /scenes` as a bare array. That is the contract genuinely changing,
and the tests caught it at the boundary rather than in a browser.

**A careless replace edited the card round-trip.** Adding `isFavourite` to the
character DTO matched `tags: parseArray(row.tags)` twice — once in `toCharacterDto`
and once in `toNormalisedCard`, which is the lossless card format and must never
gain an app-local flag. Caught by the typecheck, since `NormalisedCard` does not
have the field. `HANDOFF.md`'s rule about lossy card handling has a compile
error standing behind it, which is the reason it held.

**The star collided with the timestamp.** Two absolutely-positioned controls at
the same corner, and the row's clamp had been sized for one. They are one
cluster now. Only the screenshot showed it; the drive reported everything
working.

### Deferred, and now its own row

**Windowing the message log.** `activePath` still walks the whole tree, and the
incumbent ships *# Msg. to Load = 100*. The log is already virtualised, so this
is bytes on the wire rather than render cost — a different problem from the list,
and it gets its own `GAPS.md` row rather than being folded into a claim that
paging is done.

---

## Phase 60 — The invariants, guarded

Raised by the user rather than by the build order: *"i think we are almost ready
to ditch handoff.md and other old guidance completely."*

Half right. The document was two things wearing one name. Half of it was
bootstrap instructions for an app that did not exist — read §0, §1, §2 and §17,
confirm the stack, propose the migrations and wait for review, then build phase
1 and stop — and that half has been spent since roughly phase 2. The other half
is ten invariants that are still the reason the architecture holds, and deleting
them because the scaffolding around them went stale would have thrown away the
only part worth keeping.

So it was cut down rather than retired, and the interesting question turned out
to be a different one: **which of the ten were actually being enforced?**

### What was found

Six had a test standing behind them and nobody had ever said which. Four had
nothing at all:

| Rule | Held by, before this phase |
| --- | --- |
| 6. The client never calls an inference backend | reading the diff |
| 7. No native modules | reading the diff |
| 8. No browser storage APIs | reading the diff, and two code comments |
| 9. Extensions never see provider credentials | reading the diff |

Every one of them is a structural question a text sweep can answer, which is
what makes their absence notable rather than excusable. They were unguarded
because nobody had asked, not because asking was hard.

### What was built

- **`test/invariants.test.ts`**, in two halves. The second half measures the
  four: no installed package has an install hook or a `binding.gyp` and nothing
  in the *runtime* dependency closure is a native binary; no client source names
  `localStorage`, `sessionStorage`, `indexedDB` or `document.cookie`; every
  `fetch` in client source targets this app's own `/api`; and the script
  runtime, pack installer and webhook sender reach no key store, with no pack
  kind that could be a provider.
- **The first half reads the document back.** Every numbered non-negotiable in
  `HANDOFF.md` must carry a `Guarded by` line, and every test file it names must
  exist. A rule added to that list without a guard fails the suite — which is
  the actual repair, because the failure mode being fixed is not "rule 7 is
  unguarded" but "nobody noticed rule 7 was unguarded for sixty phases".
- **`HANDOFF.md` rewritten**: 191 lines to 243, but a different 243. Gone are
  the phase-1 starting instructions and the note about the migration review that
  never happened (`PHASES.md` phase 20 and SPEC §20 both carry that record).
  Added are a guards table naming all fourteen, the two rules for writing one
  (never cry wolf; strip comments first), the `openDatabase` lesson from phase
  56, the browser-verification protocol, and — under precedence — the phase 55
  reversal, stated as a rule: when the authority is the problem, rewrite the
  authority.

### Surprises

**Two of the first drafts of the guard were wrong in the same direction, and
both would have cried wolf.** The first asserted that no client source names
`apiKey` — but the settings screen holds a provider's key because the reader
types it there, and handling a credential on its way to *this app's own server*
is the feature. The second forbade the extension surfaces from importing
`db/queries/connections.ts` — but a preset is a legitimate pack artifact, and
presets live in that module beside the provider rows. Both were caught by
running the guard against a correct tree, which is the only way this class of
mistake ever gets caught: a guard is falsifiable only in the direction of a
false alarm, and a false alarm on a live usage is how a guard gets switched off.
`dead-columns` learned this two phases ago and wrote it down; this phase learned
it again anyway, twice, in one file.

**There genuinely are `.node` binaries under `node_modules`.** Eight of them —
Rolldown's Linux bindings, Tailwind's oxide, lightningcss. The naive check would
have failed on a tree that has never violated the rule, because prebuilt is not
a compile step and every one of those is a build-time devDependency. What the
rule protects is `bun server/index.ts` on somebody else's machine, so the check
walks the transitive closure of `dependencies` — ten packages, zero binaries —
and the distinction is written into the test rather than left for the next
person to rediscover at 2am.

**The parser read every rule as unguarded.** `[\s\S]*?` up to a `\s*$` lookahead
under the `m` flag matches at the end of the *first line*, so every body was the
empty string and every rule looked unguarded — a guard failing loudly for a
reason that had nothing to do with its subject. Split on the numbering instead.

**Every assertion was negative-tested.** localStorage added to a client file, an
absolute `fetch` to `api.openai.com`, an `apiKey` in the script runtime, a
`Guarded by` line deleted, a fake package with a `node-gyp` postinstall, a
`probe.node` dropped into hono — six deliberate breaks, six failures, tree
restored. A guard nobody has watched fail is a guard nobody has tested.

---

## Phase 61 — The persona

The largest coherent block left in `GAPS.md`, and the pattern it turned up is
the one this project keeps finding in itself. Five rows; **three of them were
things the app already stored and could not reach**, one had been done for six
phases without the row being re-run, and one was genuinely new.

### What was found before anything was built

| Row | What was actually there |
| --- | --- |
| Persona avatar | `personas.avatar_path` *and* `authors.avatar_path`, on the schema since migration 0005, never written, never served |
| Position in the prompt | already reorderable in the prefix since phase 56's prompt manager; only depth injection was missing |
| Lock to a chat | `scenes.persona_id` already *is* the chat lock |
| Lock to a character | genuinely missing |
| Searchable list | shipped in phase 55; the row was six phases stale |

And two more found while looking:

- **`findDefaultPersona` was exported and called by nothing.** Since phase 7.
  Marking a persona default rendered a label beside its name and changed no
  behaviour anywhere: every roleplay opened with no persona at all until
  somebody picked one from scene setup.
- **`characters.is_favourite` had no route.** Phase 59 added the column, a
  partial index and the DTO field, and its own record in this file claims: *"A
  star that worked on one list and not the other would have been the
  half-measure this project keeps catching in itself."* That is exactly what
  shipped. `dead-columns` did not catch it because `is_favourite` is on two
  tables and `scenes.is_favourite` is read constantly.

### What was built

- **A picture for a persona and an author**, end to end. `mountAvatar` serves,
  sets and clears one, written once for both because the column, the directory
  and the lifetime are identical; the upload is named with a fresh ULID so a
  replacement changes the URL and no cache has to be told anything, and the
  old file is unlinked only *after* the new one is written.
- **The reader's turns draw it.** Phase 57 shipped the avatar with a note
  saying the reader's side would show an initial "until `personas.avatar_path`
  is wired" and did not pretend otherwise. This is that wire.
- **`personas.depth`.** Null keeps the persona block in the prefix, where the
  preset's order puts it; a number injects it that many turns from the end,
  which is the placement `assembleTimeline` already gives lore entries and
  depth prompts. Four lines in `blocks.ts` and one in the context builder,
  because the machinery was general.
- **Which persona a roleplay opens as**, decided when the cast is first picked:
  the character's lock, then the default, and never over a persona already
  chosen. It belongs at cast time rather than at `POST /scenes` because a scene
  is created empty and the character that carries a lock is not known yet.
- **The star on a card**, with a favourites filter behind phase 59's index. It
  files rather than edits: no version snapshot, the exemption bulk tag and
  folder moves already take, so starring a hundred cards leaves the card
  history alone.

### Surprises

**No `scenes.persona_locked` column, and that is the finding.** The obvious
parity move was to mirror SillyTavern's two locks. But a scene already stores
its own `persona_id` and nothing overrides it, so the chat lock exists by
construction — and a "follow the default" mode would have been a flag written
by a switch and read by nothing, which is the exact defect phase 58 built a
guard against. The row is closed with the argument rather than with a column.

**The `dead-columns` blind spot has now hidden three real defects.** Both
`avatar_path` columns and `characters.is_favourite`, all found by `GAPS.md` or
by hand rather than by the sweep, because the check matches a column *name* and
a busy table's use masks a quiet one's. It was measured this phase: 58 tables
carry 264 distinct column names, 58 of those names are on more than one table,
and 38 are on two or three — 89 (table, column) pairs where one table's read
hides another's. That is the design input for the attribution guard, and it is
recorded rather than half-built: every cheap version of it either cries wolf on
a live column or needs a per-pair allowlist nobody will maintain.

**A guard that fails on a correct tree is a bug in the guard, twice more.** The
character PATCH resolves `personaId` from a ULID, so the route needed
`findPersona` — and the first version of the phase-60 credential guard would
have flagged the settings screen for naming `apiKey`. Same lesson, one phase
apart: the tree is the test's test.

**The persona lock landed on the wrong tab and the browser said so.** Inserted
next to the tag editor, which reads as adjacent in the source and is on the
*advanced* tab — three clicks from where somebody sets a character up. The
drive script found it by looking for a `<select>` that was not there. It is on
the card tab now, under the name.

**A third control clipped the folder filter at 390px.** The favourites button
joined a row built for two, and "Any folder" became "Any folde". The row wraps
now and the selects have a floor. Only the screenshot showed it; every count
the drive printed was correct.

---

## Phase 62 — The window, and the two silences

Two rows off the top of `GAPS.md`. One went as planned. The other was written
backwards, and finding that out was the phase.

### The window

Phase 59 paged the roleplay list and left a note saying the message log was a
different problem — the log is already virtualised, so this was never render
cost. It was a four-hundred-turn roleplay sending four hundred turns of prose,
their segments, their annotations and their media on every open.

- **`activePath(db, sceneId, limit)`.** Depth is already counted from the leaf
  in that recursive CTE, so `WHERE ancestry.depth < $limit` is exactly the tail.
  `activePathLength` counts without loading, because a reader looking at the
  newest hundred of four hundred has to be told the other three hundred exist,
  and counting them by fetching them is the thing being avoided.
- **The window is a reading preference**, beside scale, measure and leading —
  the same kind of decision, and the incumbent's *# Msg. to Load* with the same
  default of 100. Bounded at 20: a window of one turn is not a log.
- **"25 earlier turns"** at the top of the log, growing the limit rather than
  paging with a cursor. The server always answers with the newest N, so there
  is nothing to merge and the order cannot come out wrong — the shape phase 59
  settled on for the list.
- **The author is never windowed.** Every caller that builds a prompt passes no
  limit and walks the whole path. `test/history-window.test.ts` asserts it
  directly, because a window that reached the prompt builder would silently
  truncate every long roleplay's memory and nothing on screen would say so.

### The two silences

`GAPS.md` said: *"`isActive` is benching — out of rotation and out of the
prompt. ST's mute keeps a member present but silent."* Half of that was a claim
about this codebase, and it was wrong. `buildPromptContext` built its cast from
**every** member, so a benched character still appeared under "Also in this
scene" with their compact definition. Out of rotation, firmly in the prompt.

That is a mute. Onsen has had one since phase 7 under the other name, and has
never had a bench at all — benching a character kept paying for their
definition on every turn.

So migration 0046 does not add a feature so much as name what is there:

```sql
UPDATE scene_members SET is_muted = 1, is_active = 1 WHERE is_active = 0;
```

Everything currently benched becomes muted, which preserves exactly what every
existing roleplay does today, and `is_active = 0` is given the meaning its
label always claimed. An explicit spotlight still reaches a muted character,
because asking one to speak is a direction rather than an accident.

### Surprises

**The evidence rule caught a row I wrote myself.** `GAPS.md` requires a command
that proves each row; this one had a description instead, and the description
was inverted. Sixteen lines of probe — build a two-hander, bench one, read the
prompt — settled it in a minute. The rule's value is not that it is rigorous, it
is that it is *cheap enough to actually run*.

**Nothing in 1,300 tests asserted what benching does to a prompt.** The
behaviour changed in this phase and the suite stayed green. That is a coverage
hole exactly the shape of the defect: the tests knew a benched member is not
chosen to speak, and nothing knew whether the author could still see them.

**The turn ordinals were wrong for one drive and only the screenshot said so.**
`#17` in the gutter of the forty-first turn of forty-five, because
`renderMessage` numbers by index within the window. The gutter's whole job is to
be the number you quote at somebody, and every count the drive printed was
correct while the thing on screen was not.

**A muted member vanished from the deck.** The first fix filtered `inPlay` once
and used it for both the chips and the beat gate — so muting somebody removed
them from the phone's cast display entirely, which is indistinguishable from
benching them. Two sets now: `present` draws, `inPlay` decides.

---

## Phase 63 — The two automatic retries

Auto-swipe and auto-continue: a turn came back wrong, so ask for another one
without being asked. The interesting part was the prerequisite nobody had
written down.

### The thing that was missing

**No adapter reported why a completion stopped.** `TokenChunk` carried text,
reasoning and tool calls, and every provider's `finish_reason` was parsed past
without being read. So there was nothing for auto-continue to fire on, and the
tempting substitute — "the text does not end in punctuation, so it was probably
cut off" — would have been a guess wearing a fact's clothes, continuing turns
that had finished and leaving cut-off ones alone.

`TokenChunk.finishReason` is new: `stop | length | tool_calls | content_filter
| other`, normalised in each adapter because providers disagree (OpenAI's
`length` is Anthropic's `max_tokens`, which arrives on `message_delta` rather
than on the text frames). An unknown value becomes `other` rather than passing
through, and an adapter never invents one — a provider that says nothing leaves
it unset, and auto-continue does not fire.

### What was built

- **Auto-continue** runs the `continue` op on the turn that was cut off.
- **Auto-swipe** starts a sibling of a turn shorter than a floor. The rejected
  turn stays in the tree: a swipe is not a delete, and silently discarding a
  generation the reader paid for is the worse half of automation.
- **Neither is a second inference path.** Both call an op that already existed.
  `maybeRetry` decides *whether* to ask for another turn and never *how* one is
  produced, which is what keeps HANDOFF's "there is one path" true.
- **The budget travels with the chain**, carried into the follow-up's start
  options rather than counted per scene: two devices reading one roleplay are
  two chains, and a per-scene counter would have one spend the other's.
- **Both ship off**, as preset settings beside the samplers — the cap that
  triggers auto-continue is `max_response_tokens`, on the same row.
- **A cut-off turn says so** on its stats line: `#2 · 2ms · ~14t · 57/s · cut
  off`. It explains a sentence that stops mid-word, and where the setting is off
  it is the thing that says it would have helped.

### Surprises

**Five of the nine tests would have passed with the feature switched off.**
They are the "does not fire" cases — off by default, no finish reason, over
budget — and they are worth having, but they prove nothing about the feature
working. Only four require it. Disabling `maybeRetry` and re-running was the
check that separated them, and it is the same discipline phase 60 wrote down:
a guard nobody has watched fail is a guard nobody has tested.

**The conformance guard was the right home for the new contract.** A finish
reason an adapter dropped would leave a preset's setting quietly doing nothing,
and no generation test would see it — the failure is per-provider and invisible
from above, which is exactly the shape `adapter-tools-conformance` exists for.
It now asserts both halves: `length` is reported when the provider says so, and
*not* reported when it does not.

**The stub provider had to learn to say why it stopped.** Every drive script
since phase 40 has used a stand-in that streams a fixed beat and ends. Driving
this phase meant a stub that reports a cap, recognises the continue op's own
prompt, and answers differently the second time — which is the first time the
stand-in has had to model provider *behaviour* rather than provider *shape*.

---

## Phase 64 — The examples, and the system run

The two prompt-assembly policies left in `GAPS.md`, and the first of them
needed structure before it needed a setting.

### The examples had no parts

A card separates its example dialogue with `<START>`, and this builder stored
and sent the whole thing as one string. So "drop an example when the budget
tightens" — the incumbent's *gradual push-out* — was not a policy that could be
expressed here at all: there was only ever one thing to drop, and dropping it
would take every example with it.

`splitExamples` breaks the string on the separator, loosely enough for what
cards actually contain — lower case, extra whitespace, a leading separator, a
doubled one; every card library in the wild has all four. Each example becomes
its own block, costed and listed on its own, which is what makes the rest
possible.

### One trim order, not two

The first version of push-out was a separate pass with its own rule: measure
the whole history, drop examples from the end while it overflows. It was wrong
twice over. Measured against the *whole* history it fired all-or-nothing — once
a scene is bigger than the window every example goes at once, which is not
"gradual" by any reading. And dropping from the end was a rationale I invented
("the first example sets the voice") rather than one the behaviour supported.

The right model was simpler and was already in the file: the examples are the
oldest things in the transcript, so they join the same oldest-first queue ahead
of the first turn. A short scene keeps all of them; a long one loses them one
at a time; only once they are gone does the scene start being trimmed. There is
one trim order, and the policy decides whether the examples are in it.

### What was built

- **`example_eviction`** — keep, gradual, never. `keep` is the default because
  any other value changes what every prompt on that preset looks like.
- **`squash_system`** — merge consecutive system turns. After the alternation
  pass, not before: that pass has already turned system entries into user ones
  where a provider demands it, and merging first would join along a boundary
  that no longer exists. A history message keeps its own turn, so
  `historyIncluded` stays honest.
- **A pushed-out example is reported as an eviction** with its text and its
  cost, for the reason §3 insists on the list at all: "the character forgot" is
  almost always "the model never saw it".

### Surprises

**The drive found zero examples in every prompt, and the code was right.** This
install's preset had `example_dialogue` switched *off* in the block order — left
by a phase 56 drive, saved in the database, invisible from the code. Ten minutes
went into a bug that was a stale fixture. It is also a small argument for the
prompt manager: the setting was doing exactly what it said, on a preset nobody
had looked at since.

**The inspector cannot see the squash, and that is correct.** `PromptInspectorDto`
carries `debug` and no message array, because the inspector's subject is the
assembled prompt rather than the wire format. Verifying squash meant a stub that
logs the role sequence of what actually arrives — which found
`system,system,user,system×9` becoming `system,system,user,assistant,system`,
and confirmed the leading pair correctly *not* merging: one of them is a system
message from the history, and those keep their own turn.

**Three of fourteen tests fail with push-out disabled; one fails with squash
disabled.** Checked by disabling each and re-running, as phases 60 and 63 did.
The rest are the shape assertions and the "leaves it alone" cases, which are
worth having and prove nothing on their own.

## Phase 65 — Quick replies

The top of `GAPS.md`'s queue: the incumbent's Quick Reply is a button the
reader defines — a label and a prompt — pinned to the composer. Onsen already
had the engine it needs in the nudge path, so this was storage plus a row of
buttons rather than a feature with a shape to invent.

### A saved nudge, not a new op

A nudge is already exactly what a macro button does: a one-shot instruction for
the next turn, never persisted as a message. Quick replies ride that path.
Firing one calls the same `generation.start({ ...nextTurn(), nudge: prompt })`
the nudge op uses, so there is no second inference path — the thing §5 rules
out and the thing this phase did not build.

The storage is a global `quick_replies` table: `ulid, label, prompt,
sort_order`, plus timestamps. Global rather than per-scene, the way the
incumbent's Quick Reply sets are — a reply worth writing down is worth having
in every roleplay. Order is the reader's, via `sort_order`, the same discipline
`preset_blocks` and `regex_scripts` use, and moving a reply swaps it with its
neighbour in one transaction rather than renumbering the whole row.

### The surface

A horizontally scrolling row of chips above the composer, always visible even
while the ops drawer is open — its whole point is one tap, and a button that
hides when the keyboard does is a button that never fires. With none written
the row is a single "Quick replies" chip that opens the management sheet, which
is the empty state offering the thing it is empty of.

The sheet writes, edits, reorders and removes replies in place — a quick reply
is two fields, so the form lives inside the sheet rather than a sheet on a
sheet.

### What was built

- Migration 0049: the `quick_replies` table and its order index.
- `server/db/queries/quick-replies.ts` and `server/routes/quick-replies.ts`:
  list, create, edit, delete, and a move endpoint that swaps `sort_order`.
- `client/components/QuickReplies.tsx`: the composer row and the sheet, wired
  into `ChatScreen` through a new `Composer` prop.
- `test/quick-replies.test.ts`: round-trip, ordering, move semantics, and the
  validation that refuses empty labels and prompts.

### What was deferred

Per-scene quick replies, and anything beyond a label and a prompt. The
incumbent's Quick Reply buttons can also run scripts; §21 already says no to a
scripting language, and Onsen's nudge is the whole of what a macro button does
here.

### Surprises

**The setup wizard does not render — and has not for some time.** `SetupScreen`
mounts `ModelPicker`, which calls a react-query hook, but `App` only wraps the
authenticated shell in `QueryClientProvider`; the wizard and the login screen
sit outside it. A first run in a browser lands on "No QueryClient set" and a
blank page. The API is fine — the test harness and this phase both set up
through it — so nothing had caught the browser-only break. Worked around here
by completing setup over the API, then driving the rest in a real browser. It
is a one-line fix in `App.tsx` and should be its own commit when picked up.

**The theme picker is behind the Reading category.** Switching theme "through
the app's own picker" is four taps: Settings → Reading → the theme's name →
wait for the reload. The drive script had to click the category first; the
theme buttons are not on the page until it is open.

**Firing a quick reply proves the nudge on the wire.** The stub logs every
message it is sent, and the fired prompt appears verbatim — which is the whole
claim "storage plus a row of buttons" rests on, checked rather than assumed.

## Phase 66 — The identity, restored

The first of the four surface passes (`docs/SURFACE-PASS.md`), and the one the
others are un-judgeable without: the app's own design system says "sharp
corners, 1px hairlines, no shadows", and the shipped default had been a rounded,
shadowed, greenish theme since phase 45.

### What the wrong default actually was

Phase 45's commit message is honest about the cause: "the app read flat, and
nothing about it could be customised." So depth became a theme value and the
default became `Bottle` — radius 9px, two drop shadows, on a green ground.
Rounded corners plus shadows plus a neutral tint is the generic-SaaS recipe,
which is the look the user was calling slop.

But "read flat" was never about the sharp corners. It was the surfaces being
two lightness points apart — page `#14120f`, raised `#16130f` — which phase 49
fixed by raising the steps, *after* the default had already moved. The flat
identity never needed to go; it needed the surfaces to step.

### What was built

- **Default theme → `Ledger`**: flat, warm (`#14120f` ground), hairline, no
  shadows, with phase 49's raised surfaces. The rounded themes stay shipped and
  pickable by hand.
- **`Ledger` names its dark palette explicitly.** A theme that names no colours
  falls through to `tokens.css`, which flips to light under
  `prefers-color-scheme: light` — and a fresh drive showed exactly that, on the
  very first check. The `base` field is stored but nothing wires it to
  `data-theme`, so it cannot stop the flip. The default must be deterministic,
  so `Ledger` carries the warm dark palette itself instead of inheriting it.
- **A guard in `test/themes.test.ts`** pins the default flat *and* dark: radius
  0, no shadows, ground `#14120f`.

### Surprises

**The `base` field is a promise the renderer does not keep.** `dark` vs `light`
is stored, round-tripped, and shown — and changes nothing. A theme renders dark
or light only through the colours it names. The shipped light themes happen to
work because they name light colours; `Ledger` needed its palette spelled out
for the same reason. Either wire `base` to the document root or delete the
field. Recorded in `SPEC.md` §16 Themes, left for a later phase.

**"Reads flat" had been answered with the wrong fix, and it stuck.** The
criticism was real; the diagnosis was wrong. That is the shape of the whole
surface pass, and it is why the guard now asserts the *identity* rather than
trusting a future phase to keep it.

**Verified in a browser** at 390×844 and 1440×900, reading the computed custom
properties rather than a screenshot: radius `0px`, no shadow, ground `#14120f`
on both widths, on a fresh install.

## Phase 67 — The sidebar

The second surface pass. The desktop rail's whole justification — from the
design's own `4a` — is that on a desktop, switching scenes should be free where
on a phone it is a screen change. The shipped sidebar had not earned that: a
10px mono kicker where a wordmark should be, five bare text rows, and a recent
list of title plus "N replies" — 232px of dead grey.

### A real row, not a bare title

The recent row now carries what the design's own scenes list always carried:
the title, the newest line of prose (`lastLine`), the cast's initials, and the
message count. Two scenes with the same title were otherwise indistinguishable
in the one place that exists to tell them apart. Cast initials are up to three,
with a `+n` surplus — the same rule the scenes list uses.

### The sidebar is a live map

The writing indicator reads the global generation store, so the scene
generating right now wears a red dot and a red `writing` in place of its count,
wherever the reader is. The design handoff called for a "still writing" strip
on any screen that is not the generating scene; the sidebar is the natural
place for the desktop half of that, and it was already holding the store.

### What was built

- A Spectral wordmark — the app's name set as prose, the same allowance phase
  47 made for a group heading.
- Nav rows with counts and an active state that is three signals, not one: red
  label, `bg-inset`, and the 2px red left bar.
- The recent list upgraded to real rows, density-correct via `.row`.
- `test/sidebar.test.ts` pins the substance: the excerpt and cast are rendered,
  the generating scene is marked, and the rows go through `.row`.

### Surprises

**Glyphs were dropped on purpose.** The plan's first draft gave each nav
destination a typographic glyph. On the page it read as more cipher, not less —
the five words are short and distinct, and a column of half-remembered marks
was exactly the "AI slop" texture the pass exists to remove. The structure came
from the wordmark and the richer rows instead, which is the real hierarchy.

**The wordmark had no string of its own.** `strings.nav.appName` ("Onsen") is
the app name, provisional like every other noun, and it doubles as the
wordmark; no new vocabulary was invented for a mark that will be renamed with
everything else.

**Verified in a browser** at 1440×900: the wordmark resolves to Spectral, the
nav carries counts, the recent rows show title, excerpt, cast initials and
count, and firing a reply mid-stream turns the row red with `writing` in place
of the count.

## Phase 68 — The prompt on the surface

The third surface pass, and the one the design handoff calls "the screen that
wins over a dissatisfied SillyTavern user" — except the shipped inspector only
looked *back* at a prompt behind a message you had already paid for. There was
no way to see the prompt before sending it.

### A forward inspector

`POST /api/scenes/:id/preview` assembles the *next* turn's prompt exactly the
way a generation would — `resolveRoute` for the provider, `capabilitiesFor` for
the shape, the same pure builder — and returns only the debug record. Nothing
is generated, nothing is written. The status bar's token readout becomes the
doorway: the one number a reader acts on is how much of the window the next
turn will take, so tapping it shows the whole prompt behind that number — block
order, per-block cost, evictions, lore verdicts, the budget arithmetic.

The client posts the composer's cue (`characterId`, `scope`) so the preview is
*this* turn — the cued speaker, one voice or the room — and renders the result
in the same `InspectorSheet` the backward inspector already used, which is what
kept the sheet from needing a second implementation.

### What was built

- `PromptPreviewDto` (`{ debug }`), and `InspectorSheet` narrowed to read
  exactly that, so both directions share the one renderer.
- `test/prompt-preview.test.ts`: the prompt assembles without writing, a cued
  character reaches the spotlight, a one-member beat degrades to a spotlight,
  and a scene with no connection is refused rather than invented.

### What was deferred

The composer draft is not part of the preview. The preview answers "what will
the model see" from the tree as it stands; the reader's unsent line is one user
message and the least interesting thing in the block list. Folding it in would
mean a synthetic message row and a `{{pick}}` anchor that differs from the real
turn, for little gain.

### Surprises

**Capabilities, not an adapter.** The preview needs the provider's shape but
never its network, so it calls `capabilitiesFor(kind, model)` with the route's
`supportsPrefill` override — the same object the adapter would carry — and never
touches the key or the base URL. A preview that required constructing an
adapter would have been pulling a credential it had no use for.

**The token readout was already the right affordance.** The design's `4a` had a
`PROMPT · 29,940 TOK` chip in the header; the status bar already showed the
gauge. Making the gauge the button — the number you act on is the number you
tap — avoided inventing a second control and follows §16 §Density rule 2: a
number behind a tap is a number nobody reads, so the number *is* the tap.

**Verified in a browser** at 390×844 and 1440×900: tapping the readout opens
the sheet with the budget arithmetic and the block list — Spotlight, History,
Guides, the prompt options — costed and in order, before anything was sent.

## Phase 69 — The numbers become doorways

The fourth surface pass, and the smallest — which is fitting: the whole pass was
about numbers that a reader could act on, and this is the last one that was a
dead read-only line.

### The gutter was a number nobody could act on

`#46 · 1.2s · 868t · 41/s` sat in every message's gutter, carrying the exact
answer to "why did this turn read wrong" — and it did nothing. The answer is
behind it: the prompt that produced the turn, block by block, costed and with
its evictions. §16 §Density rule 2 says a number behind a tap is a number
nobody reads; the corollary this phase closes is that a number with a whole
prompt behind it should *be* the tap. The gutter is now a button, and it opens
the prompt behind the turn — the same sheet the palette's "inspect" command
opens, so the two routes cannot disagree.

### What was built

- `MessageBlock.Stats` renders as a button when an `onInspect` is wired, with
  the model still on hover and the inspector's own label as its accessible
  name. `ChatScreen` wires every turn to the inspector.
- `test/gutter.test.ts` pins both halves: the stats are a doorway, and every
  turn passes the inspector in.

### What was deferred

**Settings as a table, edited in the pane.** The Workbench artboard wanted the
thirty-one settings rows to become a table with in-pane editing instead of rows
that open sheets. That is a rewrite of the settings screen's editing model and
deserves its own phase, not a tail on a navigation pass.

**The sheet-depth guard turned out to be a no-op.** The plan proposed "a sheet
never opens another sheet"; reading the tree, none does — the command palette
and the sheets are siblings that close each other before the next opens. A
guard against a nesting that does not exist would be measuring nothing, so it
was dropped rather than shipped as theatre.

**Verified in a browser** at 390×844: a generated turn's gutter is a button,
and tapping it opens the inspector sheet with that turn's prompt.

## Phase 70 — The type scale, raised for real

"Everything is small" was the report, and it was correct. The design's type
table was drawn for a phone at arm's length — mono captions down to 7px — and
phase 49 raised it one step while admitting the app was already being used at
130% browser zoom. One step was not a fix.

### The three layers of small

The chrome size lived in three places, which is why phase 49's one-step raise
did not take:

1. **The tokens** — `--onsen-text-*` driving `.section-label`, `.btn`,
   `.group-heading`, `.field`, the prose. Labels at 10.5px, buttons 11px,
   prose 15.5px — *below the design's own 17px spec*.
2. **Two hardcoded sizes** — `.meta` at 10.5px and `.screen-kicker` at 11.5px,
   set literally rather than from tokens.
3. **~200 inline `text-[9px…11.5px]` arbitrary classes**, scattered across 44
   files, which no token change could reach.

### What was built

- Prose returns to the design's own 17px (17.5px desktop); excerpt 14px, field
  15.5px, explain 13.5px.
- The chrome ramp goes up with it: attribution 13px, section labels 12px,
  group headings 13.5px, buttons 12.5px, token counts 11px.
- The ~200 inline classes are swept up to a new floor of 11px.
- `test/typography.test.ts`'s floor moves from 9px to 11px, so the scale
  cannot quietly sink back.

### Surprises

**Prose was below the design's own spec.** The handoff says 17px mobile and
17.5px desktop; the app shipped 15.5px and 16px. The material — the one thing
the reader reads for hours — was the thing that had been shrunk below its own
authority, before any chrome was considered.

**Phase 49 had said so, in its own file.** `tokens.css` carried the sentence:
*"they were small enough that the app was being used at 130% browser zoom,
which is a report that the default is wrong, not that the reader is unusual."*
The diagnosis was right and the dosage was one step. A floor is not a scale.

**Verified in a browser** at 390×844 and 1440×900, reading the computed
custom properties: prose 17px, section labels 12px, buttons 12.5px, attribution
13px, on both widths.

## Phase 71 — Settings expand in place

The desktop navigation pass, prompted by one concrete example: a background
task row in Settings opened a bottom sheet, which is a phone shape stretched
across a desktop. The Workbench direction said it outright — "editing opens in
the pane, not in a stack of sheets" — and §16 §Density rule 3 says controls
live in the row. The ops list was the clearest case, and the shape for the
rest.

### One component, two paths

`OpEditor`'s body became `OpFields`, shared by the phone's sheet and the
desktop's inline expansion. That is the load-bearing part: the defect this
codebase actually has is two editors drifting apart, and a single component is
the only thing that prevents it. The row's click branches on `isDesktop` —
expand in place with the chevron flipping to `▾`, or open the sheet where there
is no room for the expansion.

### What was built

- `OpFields` extracted, `OpEditor` becomes a sheet wrapper around it.
- The routing list's rows expand inline on a desktop; the phone keeps the sheet.
- `test/settings-inline.test.ts` pins the single-component contract and the
  width branch.

### What was deferred

The same pattern applies to the remaining settings editors — providers,
profiles, presets — and they are the same class of change. Providers and
profiles are rows with a handful of fields and should expand the same way; the
preset editor is large enough that a full-width pane or a dedicated surface is
a better fit than an accordion. Left for the next pass rather than half-built
into this one.

**Verified in a browser** at 1440×900 (a task row expands inline, zero dialogs,
role buttons and template textarea present) and 390×844 (the same tap opens the
sheet).

## Phase 72 — Providers and profiles expand in place

The same pattern phase 71 gave the background tasks, carried to the models
section. A provider or profile row is a handful of fields — name, address,
model, key, routing — and on a desktop it was still opening a bottom sheet.

### One component each, two paths each

`ProviderEditor` and `ProfileEditor` each split into a sheet wrapper and a
`ProviderFields` / `ProfileFields` body, shared by the phone's sheet and the
desktop's inline expansion — the same contract `OpFields` established, and the
same reason: two editors drifting apart is the defect, and one component is
what prevents it.

The create-new flow moves inline too: on a desktop the add button is replaced
by the form, in place, rather than a sheet over the list. The phone keeps every
sheet.

### Surprises

**The profile state was a snapshot while the provider state was an id.** The
two editors had drifted *before* any UI drifted: `editingProviderId` is an id,
`editingProfile` is a captured `ConnectionProfileDto`. The inline row had to
compare `editingProfile?.id` and pass the list row, not the snapshot — which is
also the better object, because the list row refreshes after a save while a
snapshot does not.

**Verified in a browser** at 1440×900 (provider row expands inline, zero
dialogs; the new-provider form appears in place of the add button) and 390×844
(the same tap opens the sheet).

## Phase 73 — The preset editor gets a pane

The last of the three settings editors. The preset editor was the one that did
not fit the accordion: samplers, the prompt manager, reasoning, retries, the
example policy. On a desktop it is now a 480px pane beside the settings list —
the same shape the chat screen's inspector takes — while the phone keeps the
sheet.

### One body, two frames

`PresetFields` is extracted from `PresetEditor` exactly the way `OpFields`,
`ProviderFields` and `ProfileFields` were: the pane and the sheet render the
same component, so they cannot drift. The pane resolves the preset from the
live list rather than the captured snapshot, for the same reason the profile
row did in phase 72 — the list refreshes after a save, a snapshot does not.

**Verified in a browser** at 1440×900 (the preset opens in an `aside` beside
the list, zero dialogs, samplers and the prompt manager present) and 390×844
(the same tap opens the sheet).

## Phase 74 — The setup wizard renders again

Found during phase 65 and finally repaired. `SetupScreen` mounts `ModelPicker`,
which calls a react-query hook, but `App` only wrapped the authenticated shell
in `QueryClientProvider` — the wizard and the login screen sat outside it. A
real first run in a browser landed on "No QueryClient set" and a blank page.
No test caught it, because the setup *API* the harness uses works without the
screen.

The provider now wraps all three branches: setup, login and the shell.
`test/setup-screen.test.ts` pins it by counting the three providers, so a
future branch cannot slip outside again.

**Verified in a browser** at 390×844: a fresh install renders the wizard, the
form completes, and `/api/bootstrap` reports `setupCompleted: true,
authenticated: true`.

## Phase 75 — A theme's `base` flag does something

Found during phase 66: a theme's `dark` vs `light` was stored, round-tripped,
shown — and changed nothing. A theme only rendered dark or light through the
colours it happened to name, so a tokenless dark theme followed the OS light
preference. The flag was a promise the renderer did not keep.

### Three small wires, one end

`base` now flows the whole way: `themeCss` emits it as `color-scheme`, the
bootstrap carries it (`themeBase`), and `App` sets it as `data-theme` on the
document before any branch renders — so the login screen's fall-through tokens
and native controls are right. The `:root[data-theme=...]` selectors that had
sat in `tokens.css` since phase 45 with nothing ever setting them are finally
driven.

`test/themes.test.ts` asserts the stylesheet carries the base, and
`test/setup-screen.test.ts` asserts the client applies it.

**Verified in a browser** on a light-OS context: the default dark theme sets
`data-theme="dark"` and renders `#14120f`; switching to Bone sets
`data-theme="light"` and renders `#fafafa`.

## Phase 76 — The dead-export sweep

The last of the process debt, and the first guard in this repo to find a
*new* bug on its first run. Phase 60 counted 21 exported functions in
`server/db/queries/` referenced nowhere outside their own file and fixed two;
this measures it instead of counting it.

### A guard in the dead-columns shape

`test/dead-exports.test.ts` sweeps the query files, matches each export's name
against comment-stripped source, and fails on a name that appears only in its
own file. A `DELIBERATE` map holds the deliberate ones, with the same staleness
check. The first run re-found the same 21 phase 60 had.

### The audit

- **Two deleted**: `findDefaultPreset` (a second, unused copy of the default
  preset answer that `presetIdFor` already gives inline) and
  `dossierBookBindings` (dead).
- **Seventeen lost their `export`**: internal helpers — DTO mappers, a keyword
  reader, slug and template helpers — used only inside their own file. An
  `export` on a private helper is the same lie as a dead column: it says
  "public API" while nothing calls it.
- **One wired**: `recordActivations`, the write half of §10's timed effects.
  `timedStateFor` read `lore_timed_effects` and *nothing ever inserted into
  it*, so sticky, cooldown and delay could never arm. The generation service
  now records the fired lore entries against the turn that landed, and
  `test/timed-effects.test.ts` pins it.

### Surprises

**The guard missed `findDefaultPreset` until it stripped comments.** The name
sat in a comment in the test's own header — the exact trap HANDOFF warns about
for banned-name greps, running in reverse: the explanation read as a caller.
The sweep now runs on comment-stripped source.

**The sweep found a feature that had never worked.** Timed effects shipped with
the full read side and no write side, and nothing had noticed because the read
side simply reported "never fired". The same shape as `findDefaultPersona`
(phase 61): a capability the app had already paid for, unreachable.

## Phase 77 — Auto background

The top of the capability queue. `scenes.background_path` has had a way to
*upload* into it since phase 41 and nothing that generates one — the GAPS §7
row stood as `partial` on exactly that.

### Draw, then file where an upload would go

`POST /api/scenes/:id/background/generate` builds a prompt from what the scene
is — its title, its framing, its latest line — or takes the reader's own words,
and asks the configured picture service through a new `MediaRunner.drawBackground`.
The bytes land in `dataDir/backgrounds/` and `scenes.background_path` points at
them, so `hasBackground` and the VN stage light up without a second serving
path. The client gets a `Generate` button beside the upload in scene setup.

`drawBackground` returns the raw image rather than a `media_assets` row: a
background is a scene property, not a message illustration, and the two storage
shapes are deliberately not merged.

**Verified in a browser** at 390×844 against a stub A1111 service: the button
draws, `hasBackground` flips true, and the file serves as `image/png`.

## Phase 78 — Display-only chat translation

The decision was display-only, and the build follows it exactly: the stored
text and the prompt keep the language the author writes in, and a translation
is a viewing layer stored beside the message — the same shape §14's
`display_only` regex stage takes, but a model call rather than a pattern.

### A row beside the message, never in it

`scenes.translate_to` names the target language; `message_translations` holds
one rendering per message per language. The DTO for the log carries
`translation`, and the message block renders `translation ?? content`, while the
editor and the prompt both keep reading `content`. The stored text is the
author's original, so nothing downstream can drift: swipes, edits and the
prompt are untouched by what the reader sees.

The translation itself is a side call — a `translate` op with a template,
routable to a cheap model like any other — fired by a turn's *Translate*
command in the palette.

### What was built

- Migration 0050: `scenes.translate_to` and `message_translations`.
- `server/translation/translate.ts`: the prompt and the side-call run.
- The DTO path carries `translation` from one query for the whole path.
- A *Translate* command, a scene-setup language field, and the log rendering.
- `test/translation.test.ts` pins the invariant: the stored text and the
  prompt-side content are unchanged, the DTO carries the rendering.

### What was deferred

Beats are translated as a whole turn; their per-segment view keeps the
original. Auto-translating the newest turn after generation is a follow-up —
v1 is on demand, which is what the incumbent's translate extension does too.

**Verified in a browser** at 390×844: a translated turn renders in the target
language while the stored text stays original.

## Phase 79 — ComfyUI, and generated portraits

Two halves of the same "make pictures" thread, both answered with the existing
image path rather than a new one.

### A workflow adapter for ComfyCloud

ComfyUI's API is workflow-based, nothing like the OpenAI image shape. A new
`comfyui` media kind submits the reader's own workflow — pasted into the
service's settings, with `{{prompt}}` in the positive text node — polls the job,
and downloads the output. The seed is rolled on every draw, which is what makes
two generated portraits differ. The signed download URL is fetched *without*
the API key, so a credential never reaches the storage hop.

### Generate portrait, in the editor

The character editor showed a portrait with no way to make one — a card's
picture came only from import. A *Generate portrait* button now draws from the
card's name, description and personality and files it where an imported card's
portrait goes, so the library and the log pick it up with no second path.
`characters.avatar_path` gained an update as **filing, not editing**: it changes
no prose, so it takes the same no-version-snapshot exemption a star or a
persona lock takes.

### Surprises

**The ComfyCloud API key arrived in the clear, and it must not ship.** It is
validated against `GET /api/user` and the user will store it in Settings →
Pictures & voices, where the app encrypts it like every other credential. No
key is committed, and the adapter reads it the way every other service does —
decrypted at call time, never serialised back to the client.

**Verified in a browser** at 390×844 against a stub A1111 service: *Generate
portrait* flips `hasAvatar` true and the file serves as `image/png`.

## Phase 80 — The top bar

The one thing SillyTavern puts at the top and this app scattered: the wordmark,
the destinations, and the thing a reader reaches for from anywhere — which
scene is writing right now.

### One bar, every screen, every width

A global `TopBar` carries the wordmark (the one serif moment), the five
destinations with a red active state, and a red writing indicator that jumps to
the scene generating now. It sits above every screen; the screens shed their
own safe-area padding to it. On a desktop the rail shrinks to the `RECENT` list
it always existed for, and the mobile tab bar is deleted — the same five things
now live in exactly one place instead of two.

The cross-screen `WritingElsewhere` strip is replaced by the bar's indicator;
same global store, one surface instead of two.

### What was built

- `TopBar.tsx`: wordmark, nav, writing indicator; safe-area top.
- `Sidebar.tsx` shrank to the recent list; `TabBar.tsx` and
  `WritingElsewhere.tsx` deleted.
- `test/topbar.test.ts` pins that the nav moved and the rail shrank.

### Surprises

**A full page load loses the writing indicator — client navigation does not.**
The generation store is in-memory by design (no browser storage), so a hard
reload resets it. The browser check had to click the bar's `Settings` rather
than `page.goto`, which is also what a real reader does — the app navigates in
place.

**Verified in a browser** at 1440×900 and 390×844: the wordmark and five
destinations sit in the bar on both widths, the rail is recent-only, and the
writing indicator appears on another screen mid-stream.

## Phase 81 — Editor fields, unified and surfaced

A short pass before the editors become panes. The character and author editors
had each grown their own label-plus-cost field component — the two-
implementations defect, in miniature — and the character editor's card tab was
a flat wall of six identical textareas on the bare page.

- **One `EditorField`** replaces both, with an optional tone for the two fields
  whose colour means something (OOC voice blue, boundaries red).
- **The editor body sits on a raised `.surface`**, the same panel settings
  uses, instead of directly on the page.
- **The card fields are grouped** — *Who they are* and *Scene* — so the wall of
  boxes has hierarchy.
- **The card total moves up** into the header, beside the name, not only the
  footer.

This is the foundation the right-sidebar editors reuse: the pane renders the
same `EditorField`s the screen does.

**Verified in a browser** at 1440×900: the surface, both group headings and the
header total render.

## Phase 82 — Mid-scene editing

The right sidebar the content editors were missing. On a desktop, editing a
cast member swaps the chat's right pane for their card — the fields a reader
actually changes mid-scene — so a correction never leaves the log. On a phone
there is no pane, so the same *Edit card* action opens the full editor.

The pane renders the same `EditorField`s the screen does, which is the
load-bearing part: it is the same single-component contract the settings
editors took in phases 71–73, and the same reason — a pane and a screen that
drift into two editors is the defect this codebase keeps having.

The cast member sheet gains *Edit card* between mute/bench and view card. The
full editor, with its tabs, sprites and greetings, stays a screen; *Open full
editor* reaches it.

**Verified in a browser** at 1440×900: right-clicking a cast card, choosing
*Edit card*, and the pane opens with the name field and *Open full editor*.

## Phase 83 — The reader, editable in place

The inspector gains a third tab, *You*. The scene's persona — who the author is
told the reader is — is editable without leaving the log: name, description,
picture and position, with the same prefix-versus-depth control the persona
screen carries. When the scene has no persona yet, the pane lists the personas
to pick one, rather than sending the reader to setup.

The pane renders the same `EditorField`s and the same `AvatarField` as the
screen, so the two cannot drift — the same contract the cast pane took a phase
earlier.

**Verified in a browser** at 1440×900: the *You* tab opens the persona's name,
description and position controls in the pane.

## Phase 84 — The lore, editable in place

The last of the content editors to become a pane. The inspector gains a *Lore*
tab: pick a book, pick an entry, and edit its title, keys and content without
leaving the log — the three fields a reader actually touches mid-scene. The
full lorebook editor (bindings, timed effects, the activation test) stays a
screen, and *Open full editor* is not offered here because the pane is the quick
path, not a replacement.

The pane renders the same `EditorField`s and the same `useUpdateLoreEntry` the
screen does, so the two cannot drift — the contract every pane in phases 71–84
took.

**Verified in a browser** at 1440×900: the *Lore* tab lists the books with
their entry counts; opening a book lists its entries.

## Phase 85 — The config rail, collapsible

The desktop shell takes its workbench shape. The left rail, which had shrunk to
a recent-scenes list after the destinations moved to the top bar, becomes the
configuration: the prompt (the default preset), the profiles (which model
answers), the persona, and Settings — the things a power user reaches for
mid-session and the Settings screen had buried — with the recent scenes and the
new roleplay below.

Both rails are collapsible. The state lives in a small in-memory store, like the
generation store — chrome, not data, so it does not belong on the server.

The rail sections are surfaces and links for now; making the prompt manager and
the profiles editable *in* the rail is the next slice, and the right rail going
global on every screen is the one after.

**Verified in a browser** at 1440×900: the left rail lists config then recent,
collapses to a strip and back, and the right rail shows its four tabs.

## Phase 86 — The prompt, edited in the rail

The left rail's prompt section stops being a link and becomes the editor: the
default preset's row expands in place to the prompt manager — the ordered
blocks, with their enable toggles and move controls — so the setting a power
user reaches for most edits without leaving the chat. The rail widens from
232px to 340px to hold it.

Profiles and the persona are the next sections to get the same treatment, and
the right rail's global reach — present on every desktop screen, not only the
chat — is the slice after that.

**Verified in a browser** at 1440×900: expanding the preset in the left rail
lists the prompt blocks with their controls, and the right rail's four tabs
remain.

## Phase 87 — The global right rail

The right rail stops being the chat's and becomes the shell's. It is on every
desktop page unless collapsed, and it is where the entities live: **Cast**
(characters), **Author**, **Lore**, and **You** (the persona), each a list you
open into an editor in place — the same `EditorField`s and the same mutations
the screens use. While a roleplay is open a fifth **Scene** tab carries its
context, cast and persona, fed in by the chat screen through a slot in the
in-memory UI store.

The division of labour is now the workbench's: the left rail is the
configuration (the prompt, the profiles, settings), the right rail is the
people and the world.

**Verified in a browser** at 1440×900: the rail's tabs appear on the scenes
list with no scene open, and a *Scene* tab joins them inside a roleplay.

## Phase 88 — The redesign foundation

The mockup's visual identity, laid down first so the structural rebuild that
follows re-skins on top of it. Two changes:

- **Fonts.** Prose moves from Spectral to Source Serif 4, and the labels and
  buttons move from mono to IBM Plex Sans — numbers and state stay mono. The
  fetch script now pulls all three, bundled locally as before.
- **A `Midnight` theme.** The mockup's cool dark ground — `#0e0f11` page,
  `#14161a` panels, hairlines, no shadows — becomes the default. The warm
  `Ledger` and the rounded themes stay, pickable by hand.

**Verified in a browser** at 1440×900: the computed ground is `#0e0f11`, the
prose resolves to Source Serif 4, and a section label resolves to IBM Plex
Sans.

## Phase 89 — The left icon rail

The mockup's left side replaces the config sidebar the workbench built. A 46px
rail of five icons — Prompt, Preset, Lore, Guides, Settings — and a panel
beside it carrying the chosen section:

- **Prompt** shows the window being assembled: the next turn's prompt, block by
  block, with a segmented budget bar and what the window could not carry. It
  reuses the inspector's debug record, fetched by `POST /scenes/:id/preview`.
- **Preset** carries the three samplers the mockup leads with (temperature,
  min-p, repetition penalty), plus a preset selector and a link to the full
  editor.
- **Lore** shows what fired, **Guides** what is injected.

Three of the four are scene-scoped, so the rail reads the scene from the route
rather than a slot — simpler than the right rail's slot, because nothing here
needs unsaved client state. Outside a roleplay they explain themselves and
wait. The recent-scenes list and the new-roleplay button stay on the scenes
screen, where they always were.

**Verified in a browser** at 1440×900: the icon rail renders, and each section
fills the panel — Prompt with a real 445-token assembly, Preset with working
sliders, Lore and Guides with their empty states.

## Phase 90 — The right panel's three tabs

The mockup's right side replaces the workbench's five tabs with *In this
scene / Characters / Authors*:

- **In this scene** is the cast — the One voice/Whole room scope, cue, bench,
  the writing indicator — fed in by the chat screen as before, plus a footer
  with the reader (edited inline) and the author (edited in its own tab, with
  its token cost).
- **Characters** is the library with the inline editor, **Authors** the authors
  with theirs.

Lore moved to the left rail's Lore section, and the persona moved into the
scene pane's footer — the reader is part of the scene, not a separate tab. The
guides/memory/summaries management, which the old Context tab held, now opens
as a sheet from the readout row. The nested inspector tabs and their component
are gone.

**Verified in a browser** at 1440×900: the three tabs render, the scene pane
carries the cast and the reader/author footer, Characters lists the library,
and the persona editor opens from the footer.

## Phase 91 — The desktop header

The mockup's top bar replaces the navigation strip on desktop. The five
destinations moved into the two rails — wordmark to the roleplays, characters
and authors to the right rail, lore and settings to the left — so the header is
free to be the scene's identity and the reading surface's controls:

- a mono `onsen` wordmark;
- the open scene's title and turn count, amber while it is writing;
- the model chip — a green dot, the profile's name and model;
- prose size as the two A's, the reading surface's own serif;
- the Dark/Light base switch, mapped onto the two flat builtin themes;
- the two panel toggles, mirroring the rail glyphs.

The phone keeps the navigation top bar; the split is the width. The wordmark
uses the app's one tracking token rather than a local one, so the "one tracking
value" guard still holds.

**Verified in a browser** at 1440×900 (header with the scene, model, prose,
base and toggles) and at 390×844 (navigation top bar unchanged).

## Phase 92 — The composer and the turn gutter

The last piece of the redesign: the composer's Direct row and a send button that
names who will reply.

- The desktop ops row gains the mockup's `Direct:` label, and the steer note
  sits inline beside it — `Steering: keep the freight a secret · clear` — rather
  than on its own strip. The strip stays on the phone, where there is no row.
- The send button, with room, is the mockup's blue pill: `Send / then Sister
  Bell replies`, naming the speaker instead of showing initials. The phone keeps
  the compact initials + arrow.
- The turn gutter now spells `turn N` rather than `#N`.

**Verified in a browser** at 1440×900: the Direct row renders with the ops and
the steer note, and the send button names the next speaker.

## Phase 93 — The app mark

The wordmark gains a mark. The logo is a stylised silhouette of a woman in a
bikini, generated with the NanoGPT image API (`recraft-v4`, flat vector) and
flattened to one amber shape on a transparent ground — `client/public/logo.png`,
58×128. It stands beside the mono `onsen` on both widths, and the launcher
icons (`onsen-256/512`, the maskable, the apple touch) are redrawn from it on
the `Midnight` ground, replacing the serif `O`.

**Verified in a browser** at 1440×900 and 390×844: the mark renders beside the
wordmark on both, and the icon files serve.

## Phase 94 — Branding

The mark becomes the reader's, not the build's. A *Branding* category in
Settings shows the logo at the size it is read, and lets the reader replace it
with an upload, put the built-in back, or turn it off beside the wordmark. The
uploaded file lives in `brandingDir` like every other user file and serves from
`/branding/logo`; the built-in stays a static `/logo.png`. The show/hide is an
`app_settings` row, read by the shell's `Logo` so a toggle takes effect
everywhere at once.

**Verified in a browser** at 1440×900: the section renders with the full-size
mark, the toggle hides and restores the header mark, and the endpoints
round-trip an upload, a reset and a rejection of non-images.

## Phase 95 — The left rail grows teeth

The four sections stop being read-only listings and become the tools the
mockup drew them as:

- **Prompt** carries each block's provenance (source · placement · role), the
  lore trace, the unresolved outlets and macros, and a raw view of the whole
  assembled prompt; the budget legend names its blocks and the free share as a
  percentage of the window.
- **Preset** gains the scene's ban list: add a phrase, remove one, accept the
  analyser's proposals, and ask it to suggest from the scene.
- **Guides** can rebuild or flush one guide, or all of them.

**Verified in a browser** at 1440×900: the Prompt panel shows provenance under
every block and the 99%-free legend, the Preset panel lists the scene's bans
with the add/suggest affordances, and the Guides panel offers rebuild/flush.

## Phase 96 — Preset, Lore and Guides grow again

- **Preset** holds the prompt chunks: the full `PromptManager` — add, remove,
  reorder, switch on or off, edit label and content — so the preset that owns
  them manages them in the rail, not behind a navigation.
- **Lore** replaces the bare "nothing fired" with a real empty state that
  distinguishes "no lorebooks yet" from "no match", and a button to the
  lorebooks.
- **Guides** swaps in the full `GuidesBody` — write a missing kind, edit,
  rebuild, flush — and adds a per-scene order: up/down arrows on each guide
  write `scenes.guide_order`, which the prompt builder honours, so ordering is
  weighting.

The guide order is a migration (0051): a JSON array of kinds on the scene,
null for the default order.

**Verified in a browser** at 1440×900: the Preset tab lists every prompt block
with its controls, the Lore tab offers the lorebooks, and the Guides tab shows
all six kinds with write, reorder and rebuild.

## Phase 97 — The right rail gets the same pass

- **Characters** gains search, a new-card button (which opens the card for
  editing straight away) and an *in this scene* grouping that marks the cast of
  the open roleplay in amber.
- **Authors** gains search, a new-author button and an *in use* mark on the
  author the open roleplay runs with.
- The author editor samples the aside voice in the exact blue treatment the log
  shows it in, so the voice is configured against something seen.
- The inline card editor fits the 352px rail (it was still carrying its old
  420px pane width and overflowing).

**Verified in a browser** at 1440×900: the Characters tab shows the in-scene
mark, and the Authors tab shows the empty state and the new button.

## Phase 98 — Editors state their share, authors are switchable

- The card editor and the author editor end in a footer: `Card N tok · X% of
  context`, the card's cost as a share of the open scene's window — the same
  arithmetic the prompt panel shows, so the two agree.
- The Authors tab's *Use* button sets an author on the open roleplay, closing
  what the *in use* mark only reported.

**Verified in a browser**: the authors tab shows the Use affordance and the in-use
mark, and the editors render the share-of-window footer.

## Phase 99 — The turn surface and the composer

- The turn's story actions — reroll, branch, edit — say their names in words
  rather than proofreading glyphs; the utilities (copy, hide, more) stay
  compact glyphs.
- A streaming turn ends in an amber cursor, the live state's own colour.
- Reasoning is labelled `Model reasoning · N chars · not sent back`, so a
  collapsed strip says what it is rather than just "Thought".
- The composer states the draft's rough token cost as it is typed, and its
  placeholder invites a turn or none — the mockup's line.

**Verified in a browser**: the composer shows `~6 tok` under a typed draft, the
placeholder and the named send button, and the tests pin the rest.

## Phase 100 — Prompt and lore edit without a roleplay

The Prompt tab and the Lore tab no longer need a scene open:

- **Prompt** shows the prompt blocks — add, remove, reorder, switch on or off,
  edit label and content — whenever no roleplay is open, and the assembled
  window when one is. The blocks moved here from the Preset tab, which now
  carries the samplers and the ban list.
- **Lore** always shows the lorebooks — pick a book, pick an entry, edit its
  title, keys and content in place. The fired/missed verdicts sit above the
  books only while a roleplay is open.

**Verified in a browser** on the roleplays list: the Prompt tab lists every
prompt block with its controls, and the Lore tab shows the books.

## Phase 101 — Bigger rail icons, model beside the input

The left rail's glyphs grow to 20px, and the model chip moves from the header
down beside the composer — the model that answers belongs where the answer is
written, not at the top of the screen. The header keeps the wordmark, the
scene, prose size, the base and the toggles.

## Phase 102 — ComfyUI model selection

A saved ComfyUI service lists the checkpoints its endpoint offers
(`GET /media/services/:id/models`, which decrypts the key and reads
`object_info/CheckpointLoaderSimple`), the reader picks one from a dropdown in
the service editor, and the adapter writes it into the workflow's checkpoint
loader — so a model is a choice, not something baked into the pasted workflow.

**Verified in a browser** at 1440×900: the rail glyphs compute to 20px, the
header no longer carries the model, and the composer shows `Stub · stub-small`.

## Phase 103 — Auto-background (ported), the settings slice

The first SillyTavern extension to come across. AutoBackground detects a
location change after each AI reply and draws a background; this slice ships
the schema and the setup screen — a per-scene switch, a cooldown, a minimum
message count, and the reader's own detection prompt — ready for the detection
runner, which is the next slice.

## Phase 104 — Auto-background, the runner

The detection now runs. After a turn, when the scene's switch is on, a
`background_detect` side call reads the last reply and answers YES/NO; a YES
draws and files a background through the picture service. It is fire-and-forget
— an image service must never delay a reply — and it respects the cooldown and
the minimum message count. The generation service carries the hook; the media
runner does the drawing, wired in `app.ts`.

**Verified** by the round-trip test (settings persist through the scene) and the
registry test (the detection is a registered side call).

## Phase 105 — Preset management, first class

The Preset tab is now a manager. New, Import (SillyTavern), Save (Onsen and
SillyTavern), Make-default and Delete all sit in the rail beside the sampler
sliders, and a preset can name the model it answers with — a
`connection_profile_id` on the preset, shown as a model dropdown, so "this
preset" carries the whole answer. The scene still wins when it names a profile.

**Verified in a browser** at 1440×900: the Preset tab shows the manager buttons
and the model dropdown, and the round-trip test pins the model persisting.

## Phase 106 — The full preset editor leaves Settings

The Preset tab's *Full editor* now expands the whole `PresetFields` in the rail
rather than navigating away, and on a desktop the Settings screen drops its
Generation category — the rail is the one surface for presets. The phone keeps
the sheet, because it has no rail.

## Phase 107 — Preset import/export parity

`frequency_penalty` and `presence_penalty` join the sampler set — mapped rather
than reported as unmapped — and a preset carries the ops' utility prompts
(impersonation, continue nudge, new-chat, group nudge) as a JSON column,
imported, editable in the full editor, and round-tripped whole in the
SillyTavern export. A Celia-style preset now comes back out the way it went in.

## Phase 108 — The backdrop

One picture behind the whole app, under the sidebars and the chat: a scene's
own background when it has one, else the library's default, else a built-in
anime onsen. The chrome surfaces go translucent (`data-background` flips the
tokens to `color-mix`), the opacity is the reader's, and a Backgrounds section
in Settings generates, picks and deletes from the library. The built-in was
generated with the image API — a high-end anime onsen, no characters.

## Phase 109 — Extensions install from a URL

The extension framework is the pack system; now a repository installs by URL.
`POST /packs/install-url` clones the repo, reads the pack layout and installs
it transactionally, and the Packs section gains an *Install from a URL* box —
the SillyTavern-shaped flow: publish a repository, paste its URL.

## Phase 110 — The extension code API

An extension is now data plus code. A `server.ts` in a repository exports
`register(ctx)`; `ctx.task` declares a side-call task — a prompt with
`{{transcript}}` and `{{lastMessage}}`, a stage, samplers, and an optional
`apply(reply, { db, sceneId })` that runs in the extension after the model
answers. Installing by URL loads the module, persists the extension and its
tasks, and startup reloads every installed extension so the callbacks exist
again. Post-generation tasks run after each turn.

## Phase 111 — The backdrop library as a screen

Backgrounds became a top-bar destination: a full-screen grid with real
thumbnails, search, tag and folder filters, and sort, plus an editor for the
name, the prompt, the tags and the folder. Authors gained tags and folders too,
so every entity now manages the same way. The opacity and generate moved onto
the screen; the Settings section is superseded.

## Phase 112 — Characters, fully manageable from the rail

The rail's character list shows each card's picture as a thumbnail, and the
pane can change the picture (upload or clear), import a card (PNG, CharX or
JSON, opening it for editing) and export one (PNG or JSON). The avatar upload
route joins the persona/author pattern.

## Phase 113 — The extension uninstall lifecycle

Uninstalling a pack that carried code now uninstalls the code too. Before this
phase, `DELETE /packs/:id` removed the pack's data rows and left four things
behind: the copied code directory, the `extensions` row, the extension's `tasks`
rows, and its live `apply` callbacks in the running process — the callbacks kept
firing until the next restart rebuilt the registry. `removePackExtension`
undoes all four, in that order: unregister the callbacks first, delete the rows
in one transaction, then remove the directory (guarded to the extensions root,
so a `dir` that has drifted out of it is left as an orphan rather than deleted).
The remove-preview now lists the extension beside the data rows, and the
uninstall sheet names it, so a reader sees the code going too.

**Verified** by the round-trip test: install a repository with `server.ts`,
assert the code directory, the rows and the callback exist, then `DELETE` the
pack and assert all four are gone — including the callback in the *current*
process, not merely after a restart.

## Phase 114 — The composer prices drafts like the server does

The composer's live draft cost counted four characters per token while the
server's fallback estimator counted at 3.6 — so the number a reader saw while
typing was about ten percent lower than the inspector reported for the same
text a second later. The ratio now lives once, as `CHARS_PER_TOKEN` in
`shared/types.ts`, and both the composer and the estimator import it, so the
two numbers cannot drift apart again. The composer also matches the estimator's
`Math.ceil`, where it previously rounded.

**Verified** by the turn-surface guard, which now pins that the composer and the
tokenizer both use the shared constant and that the old hardcoded `/ 4` is gone.

## Phase 115 — The last three unreachable fields

Three request fields the server accepted and no screen could set, held in
`reachable-fields`' `DELIBERATE` map since phase 55, are now closed, leaving
that map empty. A lorebook's `recursionDepth` — the cap on how many levels of
recursive activation its entries may trigger — gains a number field beside the
scan depth and token budget. A character's depth note gains its
`depthPromptRole`, a three-way choice of how the note is sent (system, you, or
the author), reusing the lore editor's role labels. And a card's
`characterVersion` is shown read-only in the advanced tab, so the provenance of
a variant is legible without being editable — it round-trips through import and
export, which is the thing a read-only field exists to say.

**Verified** by `test/reachable-fields.test.ts`: the `DELIBERATE` map is empty,
so the sweep over every `*Request` field and the client source now holds with
nothing excused.

## Phase 116 — The backdrop editor on a phone

The backdrop library's editor was a fixed 420px pane with no phone shape: it is
a top-bar destination on both widths, but on a 390px screen the pane was wider
than the window. The field body now renders in a bottom sheet on a phone and in
the pane on a desktop — the same one-body-two-containers pattern the settings
editors use — and the screen header wraps instead of running off the edge, with
the generate input shrinking rather than pushing the opacity slider out of
reach.

**Verified** by the backgrounds guard, which pins that the screen picks by
`useIsDesktop`, renders both the `<aside>` and the `<Sheet>`, and wraps its
header.

## Phase 117 — One tag editor everywhere

Tagging had three implementations: chips in the character editor, chips in the
roleplay organise sheet, and a comma-separated string in the backdrop editor —
so a reader who learned "tap × to remove" in one library hit a raw comma list
in the next. The shared `TagEditor` is now the one chip editor for all three,
with a caller-supplied normaliser so the character library keeps its lowercase
behaviour while the other two preserve what is typed. The backdrop editor's
comma string is gone.

**Verified** by a new `test/tags.test.ts`, which pins that the three surfaces
all render `<TagEditor>` and that the component is chips rather than a
comma-parse.

## Phase 118 — The backdrop editor saves behind one button

The backdrop editor's fields used to save silently on blur — no save button, no
feedback, no way to see whether an edit landed, and a navigate-away could drop
the change. The four fields now track a dirty state and save together behind
one button, disabled until something changed, with a brief "Saved" confirmation
afterwards. Tags, which had briefly saved immediately in the previous phase,
now join the same single-save flow as the name, prompt and folder.

**Verified** by the backgrounds guard, which pins the `disabled={!dirty}` gate,
the "Saved" state, and that the old per-field blur-save is gone.

## Phase 119 — Relative time, one place

Two small consistency fixes. The roleplay list's `relativeTime` was the one
user-facing string living outside `strings.ts` — "just now" and the `m/h/d ago`
forms — which is exactly the thing that file exists to prevent. It now reads
from a `time` section there. And the router's header said the app "has two
routes" when it has thirteen; it now describes the closed route set it actually
owns.

## Phase 120 — The top bar's overflow

Six destinations did not fit a 390px bar, and the bar scrolled them with no
affordance — so Backdrops and Settings sat off the edge, the two least-used but
most-needed destinations. The last two now live behind a pinned "more" button
on a phone and join the visible row once there is room, and the button carries
the red underline when the open destination is one it hides. A destination is
now never more than two taps away, and nothing is silently clipped.

**Verified** by the topbar guard, which pins the primary/overflow split and the
"more" affordance.

## Phase 121 — The outbound API's honest boundary

§19 documented four model targets, three history-reconciliation modes and a
text endpoint, when only `scene/<slug>`, its forced-speaker form, and the
`last_message` mode were built. The two unbuilt targets — `author/<slug>` and
`passthrough/<profile>` — already refused cleanly and were never advertised in
`/v1/models`, so the code was honest and the spec was not. §19 now marks each
target and mode as built or specified-but-not-built, with the reasons, so the
boundary is a decision rather than an omission. A guard pins that the unbuilt
targets refuse in OpenAI's error shape and never appear in the model list.

## Phase 122 — The backdrop manager is one screen

Phase 111 moved backdrops to a top-bar screen but left the Settings section
behind, so the library had two homes — and the Settings one, frozen at phase
108, lacked the name, tag, folder and search the screen gained. The Settings
category is gone, the now-dead `BackgroundsSection` component is deleted, and
the screen is the single surface for generating, picking, naming, tagging and
deleting backdrops.

**Verified** by the backgrounds guard, which pins that the screen carries the
library hooks and that Settings no longer references the old section.

## Phase 123 — The lore page

The lorebook list and the editor were two routes — browse books on one screen,
leave to edit on another. SillyTavern keeps world info on a single surface, and
the request was to do the same. The two screens are now one `LoreScreen`: on a
desktop the books are a 280px rail beside the editor, with the book's settings,
bindings and the open entry all on one pane (the dense "everything visible"
reading); on a phone the list and the editor swap in place rather than
navigating. The `/lorebooks/:id` deep link still works, and a change of book in
that link follows the new book rather than showing the first.

**Verified** by a new `test/lore-screen.test.ts` pinning that the list and the
editor are one component, both routes render it, and the old two screens are
gone. Full suite green.

## Phase 124 — The lore entry list searches and sorts

The entry list inside a book gained a search box and four sort orders, the
default being SillyTavern's priority order — constant entries first, then
active, then disabled, insertion order breaking ties — with "order", "title"
and "recent" as the others. Constant entries now carry the amber live marker in
their row, the same state the writing indicator uses, because a rule that is
always on is "now". Searches match the title, the keys and the content.

**Verified** by `test/lore-screen.test.ts`, which pins the search state, the
sorter and the constant marker.

## Phase 125 — The steer gains depth, interval and role

The steer was one string injected at depth 0 on every turn. SillyTavern's
Author's Note carries position, depth, frequency and role; the steer now carries
depth, interval and role (position is depth's zero versus a positive depth,
which is the placement the lore entries and depth prompts already use).
Migration 0058 adds the three columns to `scenes`, the steer op honours them in
the prompt builder, and the composer's steer form grows the three controls
beside the text. Clearing the note leaves the knobs for the next one, which is
the remember-last-values behaviour the author-note users expect.

**Verified** by two new steer tests — depth and role reach the built prompt
exactly, and an interval of two skips the turns that are not due — plus the
migration and reachable-fields guards.

## Phase 126 — Lore entry parity, server side

Five SillyTavern world-info fields arrive, stored by migration 0059 and honoured
by the activation engine: `ignoreBudget` (survives the book's token budget),
`useProbability` (switch the probability roll off so a match always fires),
`groupOverride` (win an inclusion group outright), `delayUntilRecursion` (only
eligible once recursion reaches a round), and a character filter that matches by
tag and can exclude rather than include. The SillyTavern import/export and the
pack format round-trip all six columns — the ST character filter persists as its
one object (`isExclude` / `names` / `tags`), and Onsen's recursion level moves
to its own `onsen` namespace instead of riding on `delayUntilRecursion`.

**Verified** by five new activation cases and the existing SillyTavern interop
and pack round-trip tests, all green.

## Phase 127 — Lore entry parity, editor

The entry editor now reaches the five fields phase 126 wired: a
roll-probability toggle and an ignore-budget toggle beside the probability and
scan-depth numbers, a delay-until-recursion number beside the message delay, an
always-wins-group toggle inside the inclusion group, and — on the character
filter — a tag editor (the shared TagEditor) plus an exclude switch, so the
filter can match by tag and can flip to "everyone but these".

**Verified** by a new lore-screen case pinning that all six controls render.

## Phase 128 — Scene stats, and swipe-delete

Two smalls. A scene now rolls up as a stats readout — messages, your turns
versus the cast's, total words, and who has carried the conversation by speaker
— behind a "Stats" chip in the chat header, fed by `GET /scenes/:id/stats`
(counting visible messages only). And the versions sheet can delete a sibling,
not only jump to it, so a swipe that was a dead end can be removed rather than
left in the carousel forever.

**Verified** by a new stats endpoint test and a turn-surface guard pinning the
delete affordance and the stats sheet.

## Phase 129 — The prompt panel's top, cleaned

The prompt sidebar's header read a bare `used / budget` with no unit, and the
budget bar carried a wrapping legend of every block label — a second copy of the
block list right below it. The top now states the window in one line (used,
budget, and the free percent), and the budget bar is the stripe alone; the
labels live in the block list, where each already sits beside its dot, its cost
and its provenance.

**Verified** by a leftrail case pinning the summary line and the absence of the
old legend.

## Phase 130 — The chat surface, three touches

A nudge is now recorded on the reply it produced — stored in the message's
generation meta, never as a message of its own — and rendered collapsed on that
turn, the same treatment as reasoning, so a direction reads as an annotation on
what it made rather than as a line the reader said in the scene. The turn
actions return to glyphs (the words already live in the palette and the
long-press sheet, which is their one home). And a leading `/` in the composer
opens the palette with the rest of the line as its query, so the main input is
also the command entry.

**Verified** by a guided-ops case (the nudge lands in the reply's meta and not
in the log), and turn-surface cases pinning the glyphs, the collapsed direction
strip and the slash-to-palette path.

## Phase 131 — Lorebooks toggle, and the rail reaches the full editor

A lorebook had no on/off switch — it was "active" only by being bound, so the
only way to silence a whole book was to unbind it and lose the binding.
Migration 0060 adds `lorebooks.enabled`, a mute switch: a disabled book
contributes nothing to any scene but keeps every binding for when it is flipped
back. The switch sits on the sidebar's book list and on the library rail, both
reading the same column. And because the full `LoreScreen` was unreachable from
the desktop shell — the rail's Lore section was a lighter in-place editor — the
section now leads with an *Open the full editor* button that lands on the main
page.

**Verified** by a lore-api case (the toggle round-trips, rejects non-booleans,
and a muted book contributes nothing yet keeps its binding), and structural
cases pinning the mute switch and the open-editor affordance.

## Phase 132 — Move and copy lore entries

An entry can move to another lorebook or be copied into one, from a picker in
the entry editor. Move clears timed state the way an edit does; copy writes a
byte-for-byte fresh entry, dropping only the author-memory provenance. Both
refuse the same book or a missing one.

## Phase 133 — Duplicate a lore entry

An entry duplicates within its book — all fields intact, a fresh ULID — from a
button beside move and copy.

## Phase 134 — Generation-trigger filter

An entry can fire only on certain generation types — normal, reroll, rewrite or
continue; empty means every type. Migration 0061 stores the list, the generation
service names its type (a reroll is a sibling of an earlier turn; a rewrite is
expand/correct; continue is the continue op), and the engine skips an entry
whose list does not name the current type, reporting "not for this turn".

## Phase 135 — Card-field matching

An entry's keys can also scan the present cast's description, personality, depth
note, scenario and creator notes, and the persona's description — the fields
SillyTavern calls matchCharacterDescription and so on. Migration 0062 stores the
list; the engine appends the chosen fields to the scan window; export writes
both the Onsen array and ST's `extensions.match_*` booleans, and import reads
either.

## Phase 136 — Title auto-fill

An entry with no title takes the first key as its title — SillyTavern's
addMemo — so a book full of keyed entries is never a book full of "Untitled
entry".

## Phase 137 — The bundled local embedding model

The data bank's embeddings now work with no API and no external service,
exactly the way SillyTavern's do. `all-MiniLM-L6-v2` ships as an ONNX model run
in-process as pure WASM through `onnxruntime-web` — no native binary, so the
app's "no native modules" rule holds (the only install hook in the closure,
protobufjs's, is a harmless version check and is allowlisted). The model and
vocabulary download once, on first use, into the data directory, and inference
stays local after that. The embeddings source becomes a three-way choice in
Settings — bundled model (default), a configured endpoint, or keywords — and
the store falls back to keyword retrieval when the model cannot load rather
than failing a recall.

**Verified** by the tokenizer and pooling unit tests, the invariant guard
(confirming the runtime closure stays native-free), and a live run: identical
texts embed to cosine 1.0, unrelated ones to 0.36.

## Phase 138 — Vectorized lore entries

The last SillyTavern lorebook gap. An entry can now be marked vectorized, so it
is retrieved by semantic similarity to the transcript rather than by keywords —
the same tri-state ST's editor offers (constant / normal / vectorized). The
entry's content is embedded on save and cached (migration 0064); the generation
service embeds the transcript only when a vectorized entry is in play, and the
engine fires the entry when the cosine clears the threshold. Round-tripped
through ST's `extensions.vectorized`, and surfaced as a toggle in the entry
editor beside constant.

**Verified** by an activation case (similarity fires it, a dissimilar query does
not, and a missing vector is reported as such) and the existing ST round-trip.

## Phase 139 — The embedded character book

A SillyTavern card's `character_book` — the world-info book embedded in the
card itself — used to survive import only as `raw_card` bytes, never as usable
lore. It now imports as a real, bindable lorebook attached to the character: the
book's entries land in the lorebook system, the book is bound to the card, and
the character's card shows the bound book with a link into the lore editor. On
export the current bound book is re-embedded over the preserved one, so edits
made in the lore editor travel back into the card.

**Verified** by a characters-api case (import extracts and binds, export
re-embeds) and a structural guard pinning the card's Lore section.

## Phase 140 — Per-character presets

A character can pin the preset it answers with — which, in Onsen, also names a
model, since a preset carries a connection profile. Resolution runs after the
turn director has picked the spotlight: the scene's own preset, then the
spotlight character's pin, then the profile's, then the default. Migration 0065
adds the column; the card editor gains a preset selector beside the persona
lock; the PATCH route resolves the preset ULID the way the persona lock does.

**Verified** by a dedicated resolution test (scene beats character, character
beats default) and a characters-api round-trip of the pin and its clearing.

## Phase 141 — Per-character regex scripts

The server has stored character-scoped scripts since phase 33; the card editor
just could not reach them. The card's advanced tab now has a Scripts section:
the scripts scoped to this card, each with an enable toggle and a delete, and a
one-tap add that creates a character-scoped script and opens the existing
`ScriptEditor` for it — the same sheet the Settings screen uses, so the two
surfaces cannot drift.

## Phase 142 — Greeting modes and a saved portrait prompt

A card's openings can now open on the first (the old behaviour), cycle through
them, or pick one at random — migration 0066 adds the mode and the cycle
cursor, and `seedGreeting` honours them, the rest landing as root siblings
either way so every opening stays one swipe away. The card also carries a saved
portrait prompt that overrides the auto-assembled one when the reader draws a
portrait.

**Verified** by two new greeting cases (cycle advances, random picks any) and a
structural guard pinning the greeting selector and the portrait-prompt field.

## Phase 143 — Extension management

An extension repo can now declare a `settings` array in its `pack.json` (or a
bare `extension.json`) — a declarative schema of string / number / boolean /
select fields with defaults. The host renders the form and stores the values,
so an extension never ships UI code. Migration 0067 adds `enabled`,
`description`, `settings` and `settings_schema` to `extensions`; installing from
URL reads the manifest, seeds the defaults, and hands them to
`register(ctx, settings)`. Settings → Packs gains an Extensions list with an
enable switch, a schema-driven settings sheet, and uninstall; toggling or saving
reloads the extension's tasks in place, no restart. Disabled extensions
contribute no tasks and run no callbacks.

**Verified** by three cases — install reads the manifest and its defaults,
writing settings reloads `register` with the new values, and disabling
unregisters the tasks while deleting removes the extension — plus the full
suite (1482 pass).

## Phase 144 — Built-in extensions

Extensions whose code ships in the host now seed themselves at boot: migration
0068 adds `built_in`, and `server/extensions/builtins.ts` registers the two
bundled ones — Proofread (a settings schema: thoroughness and whether to return
corrected text) and Lore Scout. A built-in has no copied directory, is seeded
disabled so it never surprises a user, and cannot be uninstalled (the manager
hides the remove button and the route refuses). Reload is now authoritative:
a disabled extension's tasks leave the ops list and an enabled one's are
re-persisted, so the manager and the ops list can never disagree.

**Verified** by two cases — boot seeds the built-ins disabled with their
schemas, and enabling one registers its tasks while deletion is refused — plus
the full suite (1484 pass).

## Phase 145 — Extension prompt injections and gated tasks

The extension code API grows two capabilities that turn it from a task runner
into a real surface: `ctx.inject` registers a prompt block the host renders at
build time (placed before/after the prompt, or in-chat at a depth), and
`task.shouldRun` gates a task on scene state, so an extension can fire every N
messages instead of every turn. Injections are collected into
`PromptContext.extensionBlocks` and flow through eviction and the inspector like
any other block.

**Verified** by two cases — a gated task keeps its `shouldRun` and decides per
turn, and an injection renders into the prompt blocks at its placement.

## Phase 146 — Extension state and the Summarize port

Migration 0069 adds `extension_state`, a per-scene key/value store. Extensions
reach it through `ctx.state` (pre-bound to their name), the `{{state:<key>}}`
task macro, and an injection's `render` — so an extension carries no host
imports and survives being copied to its own directory. On that surface the
SillyTavern Summarize extension is ported: one running summary, rebuilt when a
message or word interval elapses (`shouldRun`), written by `apply`, and injected
through a configurable template at a configurable position.

**Verified** by the shipped-extension cases in phase 147.

## Phase 147 — Shipped extensions install as external

Extensions that ship in the repo now install once through the ordinary path
(`installShippedExtensions`, wired before the reload in `server/index.ts`): a
real copied directory, a removable row, no `built_in` flag. The Summarize
extension is the first. An `app_settings` flag makes the install one-shot, so
uninstalling it sticks instead of coming back on the next boot.

The manifest also declares what it takes over: `disables: ["summarise"]` on the
Summarize extension suppresses the native rolling summariser — its auto-trigger,
its manual run, and the injection of existing native summaries — while the
extension is enabled, and hands them back the moment it is disabled or removed.
The mapping is host-owned (`server/extensions/suppress.ts`), so a manifest can
only turn off a feature the host has agreed can be taken over. While suppressed,
the summaries panel says so — "Summaries are handled by the Summarize
extension" — instead of showing native rows and buttons that would no longer
act.

**Verified** by two cases — the shipped Summarize installs as an external
extension exactly once, and its summary injects through the template while its
task gates on the interval — plus a suppression case (enabled suppresses the
native summarizer, disabled hands it back) and the full suite (1489 pass).

## Phase 148 — Extension actions

`ctx.action` registers an on-demand button, surfaced by the host near the
input — a wide-screen entry in the Direct row and a phone entry in the ops
drawer. Pressing one runs the prompt against the scene through the same
side-call path a task uses, hands the answer to `apply`, and shows the result
in the sheet. The Summarize extension gains a manual "Summarize now" that works
even while updates are paused.

**Verified** by two cases — a declared action is listed, and the shipped
Summarize offers its manual action — plus the full suite (1491 pass).

## Phase 149 — The chat screen, taken apart and re-dressed

Two passes, one phase. First, the 1,815-line `ChatScreen` monolith is extracted
into `client/screens/chat/` — `attribution` (pure helpers), `StatsSheet`,
`ScenePane` (the desktop right rail), `MessageLog` (log, virtualization, the
streaming tail), `ChatSheets` (all ~13 overlays), and `useCommandKeys` (⌘K,
j/k, accelerators and the palette state) — leaving the screen a coordinator of
state and handlers. Seven structural guards read the file as text, so each
extraction re-pointed its guard in the same commit.

Then the composer gets a design pass: `→ CONTINUE` and `⋯ TOOLS` ops (the
header shrinks to just Setup, with Marks/Stats folded into the tools sheet),
quick replies fold away once the draft is non-empty, the send button becomes a
fixed icon, and who-replies-next plus the `⌘↵ SEND · ⌘K CAST` hints move to a
bottom footer opposite the model. Ops switch from lettered proofreading keys to
lucide linework icons, with the words in tooltips.

**Verified** by `test/turn-surface.test.ts` (tools/continue in the grid, the
header shorn of stats/checkpoints, the ops are ReactNode lucide glyphs with
tooltips, the send button is a fixed icon and the hints live in the footer) and
the full suite (1494 pass).

## Phase 150 — Extension scope: chat vs global

The extension API grows a scope distinction. `ctx.globalState` is app-wide
key/value storage (migration 0070) that survives scene deletion, where `ctx.state`
dies with its scene; task prompts read it with `{{globalState:<key>}}`.
`ctx.action({ scope: "global", run })` is a pure-code action — no scene, no
model — surfaced in the extension manager beside the extension list, while the
composer's actions sheet shows only chat-scoped actions. And a real bug closes:
`unregisterExtensionModule` now drops an extension's injections and actions too,
not just its tasks, so an uninstall stops every callback in the running process.

**Verified** by two cases — global state is app-wide and a global action runs
with no scene, and uninstalling removes injections and actions — plus the full
suite (1496 pass).

## Phase 151 — Extension lifecycle

`ctx.lifecycle({ onStartup, onEnable, onDisable, onUninstall })` runs at the
right moments: startup once per process after the first load, the toggles, and
uninstall before the directory is removed. Hooks are fire-and-forget and can
never break a reload or an uninstall.

**Verified** by one case — all four hooks run once, at their moment — plus the
full suite.

## Phase 152 — Extension events

`ctx.on(event, handler)` subscribes to the same in-process events the outbound
webhooks forward (`message.created`, `generation.complete`, `beat.parsed`,
`tracker.updated`, `lore.activated`). Dispatched from the one `emitWebhook`
site, fire-and-forget, and unsubscribed on uninstall.

**Verified** by one case — a handler receives a dispatched event.

## Phase 153 — Extension host services

`ctx.settings` gives typed access to the stored settings (`str`/`num`/`bool`), so
an author never hand-rolls coercion, and `ctx.log` is a name-tagged logger.

**Verified** by one case — `ctx.settings.num` reads the schema default.

## Phase 154 — Extension tasks are post-generation only

The `pre_generation` and `sidecar` stages on `ctx.task` were declared but never
run; the type now says the one thing that is true: an extension task runs after
each turn, and a manual run is an action.

**Verified** by the suite (1498 pass).

## Phase 155 — Self-responses

The turn director's "never twice consecutively" rule can now be relaxed per
scene. Migration 0071 adds `allow_self_responses`; when on, a character may
answer its own turn. This matters for the strategies that *choose* — a mention
of the character who just spoke now elects them, and the classifier is offered
them again — while round robin keeps its alternation contract. Surfaced in
Scene Setup as a three-way "Allowed / Never" toggle.

**Verified** by three director cases (mention respects the rule by default,
allowing it lets a mentioned speaker repeat, round robin still alternates) and a
scene round-trip, plus the full suite (1502 pass).

## Phase 156 — Data bank file ingestion

The data bank takes files, not just pasted text. A `.txt`, `.md` or `.pdf`
upload is extracted — PDFs via `unpdf`, a pure-JS parser with no native module
or WASM — then chunked and embedded through the ordinary ingest path, titled by
its filename. The upload button sits in Scene Setup's data-bank sheet beside
the text field, and the scene scoping follows the same switch.

**Verified** by three cases — txt/markdown read and unknown types refused, a
minimal PDF's text is extracted, and an upload ingests titled by filename —
plus the full suite (1508 pass).

## Phase 157 — Describing an empty scene

The unwritten scene's empty state is now a question, not a note. The reader
describes the scene in a sentence or two, and the model sets it up in one
place — a title, a framing scenario, and a narrator opening the scene lands on
— so the three agree. The opening is written as a narrator turn, leaving the
composer below untouched ("or just write your turn" is never taken away).

**Verified** by two cases — the premise becomes the title, scenario and
narrator opening, and a non-string premise is refused before anything runs —
plus the full suite (1510 pass).

## Phase 158 — The accessibility pass

Four findings from a six-angle audit, all of the same kind: a rule the app
states about itself that the code does not keep.

**Ink now clears WCAG AA in all nine palettes.** `--onsen-color-text-dim`
measured 3.47:1 on the dark ground and 2.97:1 inside an inset panel, against
AA's 4.5:1 — and it is not decoration: `.meta`, `.token-count` and
`.screen-kicker` wear it, so token counts, timestamps and every screen's kicker
sat under the floor at 11–12.5px nearly everywhere. `shared/contrast.ts` holds
the maths (the character editor will want the same answer at the moment a
reader picks a colour), and `test/surfaces.test.ts` measures every tier against
every ground in the three `tokens.css` blocks and all eight builtin themes,
with `FOLLOWS` applied. Two assertions, because the floor alone has a cheap
wrong answer: the ramp has to stay ordered and separated too, so flattening it
into one grey does not pass. `color-text-placeholder` now follows
`color-text-dim` rather than sitting a step below the floor.

**Both modals keep focus and give it back.** `Sheet` — 56 usages across 32
files plus every `useConfirm()` question — had no focus code at all and a
comment claiming it did; `CommandPalette` had the same holes plus an Escape on
its search box and the app's only suppressed focus ring. One hook,
`client/lib/modal.ts`, for both: focus in on open without stealing from an
`autoFocus`ed field, Tab and Shift+Tab trapped, Escape closing the topmost
modal only, focus back on whatever opened it.

**Nineteen controls were under the 44px floor on touch.** `.btn`, `.field` and
`.row` carried it; everything else counted its own padding and reached it by
accident — the whole turn-action row at 32px, every screen's back arrow at
34px, a card row's favourite star at 24px square, both status-bar handles at
18px. One class, `.tap`, with the same polarity `.row` and `.turn-actions`
already use: the floor is the default and a fine pointer relaxes it.

**The phone's Settings category row admits it scrolls.** Twelve categories in
354px, four visible, eight past the edge with nothing saying so. `Scroller`
fades whichever edge still has content past it.

**Verified** by three new guards (`modal-focus`, the ink measurement, the touch
floor) plus a Chromium drive at 1600×950 and 390×844 with `hasTouch`:
Tab/Shift+Tab/Escape through nested sheets with focus landing where it should,
every control at or above the floor on touch and unchanged under a pointer, and
the category row's fade appearing at the edge that has more. Full suite 1538
pass.

### Surprises

**The audit's own numbers were wrong three times, and each time the
measurement disagreed in the app's favour.** The contrast finding named one
token in one file; it was seven tiers across nine palettes, because every theme
spells out its own ramp. The touch finding named two components; a drive found
nineteen controls across eleven files, and the two it named were not among
them. And the ink figure the audit was arguing against came from
`docs/design/DESIGN.md`, which states that pair as "~4.6:1" — the handoff
averaged the channels without undoing the sRGB transfer curve, which overstates
a dark colour by a third. Every theme inherited a ramp built on that line.

**`CastStrip` is dead code.** The touch-target finding pointed at its scope row
as "the turn-control row"; the component is imported by `ChatScreen` and
rendered nowhere — the redesign replaced it with `Deck` and `CastRail` and left
the import. The import is gone; the file is left for a decision rather than
deleted on the way past.

**Two focus bugs only a browser could find, both in the fix rather than the
original.** The trigger has to be read during the first *render*: read in an
effect, React's development double-invoke captures the modal's own dialog on
the second pass, so the restore aims at a node that no longer exists — and it
misbehaves in development only. And the restore has to wait a frame, because
the cleanup runs mid-commit while the modal's DOM is still mounted: asking "has
anyone else taken focus" there has no answer, and answering it eagerly took
focus straight back off the rename field that Manage → Rename had just opened.

## Phase 159 — The server-hardening pass

The other half of the same audit. Five findings, and the thread through them is
that the app already knew how to do each one correctly somewhere else.

**Two helpers named `text()` meant two different things.** Twenty route files
wrote their own `badRequest`, sixteen their own `notFound`, eight an identical
JSON-body reader — all harmless duplication. The `text()` copies were not: two
of them trimmed and rejected `""`, five sliced and accepted it, so a webhook
named `"   "` was valid where a connection profile of the same name was not,
and nothing at a call site said which was in scope. Both behaviours are wanted
— a name must not be blank, a regex script's `replacement` is emptied on
purpose — so they are `requiredText` and `optionalText` in
`server/lib/routes.ts` now. Net −200 lines. `IMPROVEMENTS.md` item 5 closed in
passing: re-measuring its "21 of 310 dead exports" found 3 of 323, now 0 of
320, held by `test/dead-exports.test.ts`.

**Four writes could land halfway.** Three "clear the old default, set the new"
pairs against tables with a `WHERE is_default = 1` partial unique index — a
throw between the statements left *zero* rows default — and `persistCard`,
which inserted a character, its sprites, its embedded lorebook and the binding
with no transaction, on the shared path for single import, folder import and
the whole SillyTavern migration. Both fixes were already in the repo:
`setDefaultPreset`'s one-statement `CASE`, and `packs/install.ts`'s deferred
file writer for the `await` that a synchronous `bun:sqlite` transaction cannot
contain.

**Session revocation existed, worked, and had no caller.**
`bumpSessionGeneration` was referenced nowhere while the token verifier had
always rejected a mismatched generation, so the only way to invalidate a leaked
30-day cookie was complete, wired up and unreachable. `POST /auth/password` is
the caller, and pairs the change with the revocation: the moment you want to
change the password is the moment you want everything else signed out. The
caller is re-issued at the new generation, because a password change that signs
you out would be correct and useless.

**A regex script could end the process.** Scripts arrive in installed packs and
run synchronously on the generation path, and nothing interrupts a
`String.replace` — no timer, no abort signal. `patternProblem` now refuses a
group that repeats around a group that already repeats, the shape behind
almost every catastrophic backtrack, plus an input cap and a wall-clock budget
between scripts for the chains that are merely slow.

**And the data bank's file ingest had no size cap at all**, while reading the
bytes whole and handing them to a PDF parser. It has one, and the four upload
paths that answered 400 or 413 by which was written first now agree on 413.

**Verified** by `test/atomicity.test.ts` (checked both ways: with the fixes
reverted, three of its six fail), the password-change cases in
`test/auth.test.ts` proving the *old* cookie stops working while the caller's
keeps working, the ReDoS cases in `test/regex-scripts.test.ts`, and a Chromium
drive of the password sheet at 1600×950. Full suite 1553 pass.

### Surprises

**The dead-export count had fixed itself and nobody noticed.** Eighteen of the
nineteen functions phase 60 flagged had been reached by a later phase; the item
sat in a plan for a hundred phases describing a problem that had mostly gone
away. The three that remained were both shapes of it — one never called at all,
two used internally with only their `export` wrong.

**No malformed card can make the lorebook import throw.** `entryFrom` coerces
every field a card can carry, which is good, and means a rollback test built on
a malformed card would prove nothing at all. The atomicity tests install a
SQLite trigger that refuses the write instead, so the failure is certain and
the boundary under test is the transaction rather than any particular input.

**Pack install does not validate script patterns** — they are stored and
checked only when they run. That is why the backtracking guard had to go in
`patternProblem`, which both paths call, rather than at the point a script is
saved: an imported pack never passes through that point. Existing risky scripts
are refused per script in the run trace rather than crashing the turn, so an
install that carries one loses that script and nothing else.

## Phase 160 — Two half-wired features

Both are the shape `docs/GAPS.md` names in its own "how to read this": the
storage, the query and the DTO all present, and nothing in the UI reaching
them. Neither needed a schema change.

**A custom theme could change every accent except the live one.**
`ThemeSection` exposed twelve of the stylesheet's thirty-seven colour tokens,
and seven of the missing twenty-five followed nothing — `color-amber` among
them, which has been the app's live/now accent since the colour roles were
settled. Seven new rows close all thirty-seven, because `FOLLOWS` derives
nineteen tokens from another when a theme does not name one. The groups are now
`tokens.css`'s groups, and the hues are labelled by the role each holds rather
than by where it happens to appear: red and blue still said "live · now" and
"the author", which is what they meant before the roles were settled.

**Reordering a script or a trigger meant deleting and recreating it in the
order you wanted.** Both have persisted a `run_order` since they were built,
both read it to break ties when several fire on the same stage or event, and
nothing could write it after the insert. Up and down arrows on the Automation
rows, and a `POST /:id/move` behind each — server-side because two rows change
and a half-applied reorder is silent, which is the answer phase 65 already
reached for quick replies. The swap is per partition: within the stage for a
script, within the event for a trigger, because that is the only set
`run_order` is ever compared against.

**Verified** by a coverage guard that walks the `FOLLOWS` chains rather than
counting rows, reorder cases in both directions and across partitions, and a
Chromium drive at 1600×950 — all seven theme groups rendering with their
swatches, and three scripts moved up and down by their arrows. Full suite 1562
pass.

### Surprises

**The browser found a bug the tests had agreed with.** The first swap reversed
the pair's numbers only when moving up, so "down" wrote each row its own
existing value and moved nothing — silently, with a 200 and a correct-looking
list in the response. The tests missed it because the "up" case was tested
against a middle row and the "down" case against two rows that were alone on
their own stages, where nothing is supposed to move. Both directions are
asserted from a row with somewhere to go now.

**`QUICK_REPLY_DIRECTIONS` was the third list to want the same two words.** It
is `MOVE_DIRECTIONS` now, with the phase-65 names kept as aliases — the same
consolidation the `text()` helpers needed one phase earlier, caught before it
became a third copy rather than after.

## Phase 161 — Emphasis in the reading surface

Roleplay prose is written in asterisks — every model emits them, every card is
full of them — and `Prose` set the model's output as one text node, so a
paragraph of `*she looked up*` was a paragraph of punctuation.

`client/lib/emphasis.ts` is two marks and nothing else: not markdown, no links,
no headings, no HTML. A markdown library would have meant auditing what it
renders and keeping `dangerouslySetInnerHTML` out of the app anyway — it
appears zero times across `client/`, and a test now holds it there over the
whole tree rather than over the two files that render prose.

Three properties, each a test. **Nothing is lost**: an unmatched `*` is
punctuation again, and the round-trip case rebuilds the input from its spans so
that has a yes-or-no answer. **Nothing is rewritten**: spans over the same
string, because segment offsets address canonical text including its markup and
a recast splice stays correct only while that holds. **Arithmetic is not
italics**: CommonMark's whitespace rule, which is the difference between
`2 * 3 * 4` and `2 <em>3</em> 4`.

The streaming tail runs it too — that is the half that would have drifted,
since formatting appearing only on completion would reflow the paragraph under
the reader's eye.

**Verified** by twelve cases and a Chromium drive on a real stored turn. Full
suite 1574 pass.

## Phase 162 — A colour per character

Who is speaking was carried by their name and the turn's spine, both in the
same ink every other turn uses, so five characters in a scene were five
identical grey columns. The colour is on the card rather than the scene — the
same person should look the same in every roleplay they are in — and null,
which is every existing card, changes nothing.

It marks the name, the spine, and a beat's part labels, which are a beat's
attribution. Never the prose: body text sits at an ink colour phase 158 holds
to 4.5:1 and a picked colour has no such guarantee. Identity loses to anything
meaning *this instant* — a live spine stays amber, a selected one blue.

Refused rather than coerced at both ends, and validated on the way *in* as
strictly as on the way out, because the value arrives in a downloaded card and
lands in a `style` attribute. It survives export and re-import under
`extensions.onsen.colour`; the mention-keyword pair that already did that
became one `withOnsenFields` rather than a second copy.

The editor measures contrast as the colour is picked, against the ground the
app is painted on right now — read off live computed styles, so a custom theme
is measured too. It warns rather than refuses: the floor is the app's promise
about its own ink, and this is somebody's character.

**Verified** in Chromium: `#d98f6a` on the name and spine, `#1b1f25` raising
"1.16:1 against the page". Full suite 1578 pass.

## Phase 163 — The state a turn was written under

`NEXT.md` has carried "Blocks (tracker cards under a reply)" since the
phase-108 queue. It closes natively: a tracker row has been anchored to the
message that produced it since phase 31, so the card renders structured state
**the app itself wrote** — nothing parsed out of a reply, nothing to sanitise,
no model markup reaching the DOM.

The panel above the composer answers "what is the scene holding now";
`GET /scenes/:id/trackers/history` answers "what was true then" from the same
rows. Collapsed by default, because a long scene with one open under every turn
is a wall of state with prose between it. One renderer shared with the panel,
so the two cannot disagree about a field while the reader is looking at both.

**Verified** in Chromium against seeded rows. Full suite 1579 pass.

## Phase 164 — Asking for the emphasis that now renders

The renderer went first and alone, which was the right order: every model
already writes `*like this*` unprompted, so the reading surface had to stop
showing asterisks before there was any point asking for more of them. This is
the other half — a `prose_formatting` group for a model that has been told not
to, or one that needs reminding.

Its default says nothing at all. The renderer already changed how every
existing scene reads; a group arriving switched *on* would change how every one
of them is written, which is not a formatting preference's business.

`prose_structure`'s `flowing` option ended "no formatting scaffolding", written
before anything rendered formatting. Once it does, that clause reads as "no
italics" and contradicts the group above it. Narrowed to what it always meant:
no headings, no scene slugs, no stage directions.

**Verified** in Chromium through the scene-setup sheet: three options, the
default costing nothing, choosing italics replacing it rather than adding to it.
Full suite 1580 pass.

### Surprises

**The plan's `any_of` pair failed the app's own §22 test**, which asserts that
no shipped group arrives entirely switched off. The idiom for a group whose
default is silence was already here twice — `reasoning_depth`'s "None" and
`content`'s "As the story goes", both named options with an empty fragment — so
the group became a `one_of` ladder with a silent default. Same behaviour for an
unconfigured scene, and it does not look broken on a first run.

**Shipping that draft exposed an insert-only seeder.** The group went in as
`any_of`, became `one_of`, and every install that had already seeded it kept
the old cardinality — a single-choice group that went on holding two answers.
Insert-and-skip is deliberate for the *words*, and `test/options.test.ts` states
that contract outright ("an edited built-in survives re-seeding"), so only
`cardinality` is reconciled: nothing in the app can change it, and leaving it
stale is a correctness bug rather than a preference kept. The other half is
named and left: an option the code stops shipping stays in the database,
selectable, forever, and removing it would take a reader's edited words with it.

## Phase 165 — A scene that reads as one manuscript

The fourth named layout, and the first that removes the turn as an object.
Instrument, Quiet and Broadsheet differ in what chrome a turn carries;
all three still draw one — a name row, a spine, a row of glyphs. Document
drops the boundary, so a scene reads the way the thing it is a record of would
be printed.

It is still a preset over the same switches rather than a fourth chat screen.
The whole of it is one new attribution style: `runin`, the printer's run-in
head, where the speaker's name opens their own paragraph. Everything that
follows — no name row, no spine, no card, the controls out of flow — is derived
from that one value rather than switched separately, because §16's guardrail is
against a matrix of toggles and "the name is inside the paragraph" already
implies all four.

`runin` goes through `Prose`, which is what distinguishes it from Broadsheet's
`inline`. `inline` sets a whole message as one unformatted paragraph beside the
director's reason; run-in keeps the paragraph split and the emphasis tokenizer,
and only opens the first paragraph with the name. An em space rather than
Broadsheet's middle dot: the dot separates two pieces of chrome, and this is a
name running into prose.

**Verified** in Chromium at 1600×950 and 390×844, in both themes through the
app's own picker, on a four-turn scene with two coloured speakers: continuous
prose with real paragraphs and rendered emphasis, each name in its own colour,
no rails, no horizontal scroll, and Instrument and Broadsheet unchanged beside
it. Guard: `test/document-mode.test.ts`, 16 tests.

### Surprises

**Broadsheet has shipped its turn actions unreachable since phase 52.** Its
`<header>` carries the name, the glyphs and the stats, and `inline` hid the
whole element — so the six per-turn controls and the token counts were gone,
reachable only by a long-press. That is the exact defect phase 57 removed from
the stacked row, re-introduced five phases later by a layout nobody drove with
a keyboard. Document needed the same row in the same place, so one mechanism
fixes both: the chrome leaves flow rather than being hidden, positioned over
the turn and revealed by hover, by keyboard focus, or by the turn being
selected — which is what a tap already does.

**The theme draws the turn boundary too.** `.turn` takes `--onsen-card-bg` and
`--onsen-shadow-card`, so in the light theme Document was four white cards down
a mode whose premise is that there are no cards. A card *is* a turn boundary; it
just happens to be the theme's rather than the preset's, and the preset is what
was asked for. Suppressed for `runin` only — Broadsheet is a bounded turn with a
rail and the card belongs to that reading — which is why the `data-flow`
attribute carries *which* out-of-flow style it is rather than a bare flag.

**Two positions were wrong before one was right, and only a browser said so.**
Anchored top-right the cluster sat squarely over the first line and hid four
words of it; at 390px it is the full column width — six glyphs at the 44px floor
plus the stats — so on the turn you had just tapped it hid a line and a half.
Bottom-right fixed the pointer case, because a last line is ragged. The thumb
case needed the turn to make room: the cluster stays positioned and stays in the
accessibility tree, and `padding-bottom` on the selected turn grows it by the
cluster's height. The shift is caused by the reader's own tap, on the turn they
tapped, and nothing above it moves.

**A latent bug in the preference, found by adding a third value.**
`layout_attribution` was read back with a two-way ternary — anything but
`inline` came back as `stacked` — so a third value would have been accepted by
the PATCH, written to the settings row, and read back as something else. Read
and write now share one list.

**Document's selection had to be quieter.** The stacked selection draws a blue
edge with a −20px margin and +18px padding, which is a fine thing to happen to a
block and a bad thing to happen to a paragraph you are reading: the text shifts
sideways by 20px. Document selects with a ground and nothing else.

## Phase 166 — Eight things the app decided for you

The reading surface has been the reader's since phase 55 — four numbers with
bounds, published as custom properties. What was still the app's were the
discrete behaviours around it: what Return does, whether a streaming turn drags
the log to the bottom, whether an unsent sentence survives closing the
roleplay. Each was a reasonable default with no way past it.

Eight of them now have one, and **every default is what the app already did**,
so a fresh install behaves exactly as it did before. A settings group that
changes behaviour by existing is a settings group nobody asked for.

`ReaderDto` is its own type rather than four more fields on `ReadingDto`. That
one is the type system: continuous values with bounds, all four clamped by
`clampReading`. These are discrete, and sharing the type would have made
`clampReading` mean two different things. Both follow the same rule on the way
in — fall back per field rather than reject the lot, because a settings screen
is the worst place to be strict and one typo should not cost a reader the other
seven values.

**What Return does** is three choices, not two, and none of them can reach a
phone. `Composer.tsx` has carried a comment since phase 45 explaining that a
software keyboard cannot report a held shift, so its return key has to stay a
newline; this is the first time that comment has had a choice to be right
about. `modEnter` takes either modifier rather than sniffing the platform.

**⌘/Ctrl+B and +I** are worth having only because phase 161 made those marks
render. `client/lib/marks.ts` is its own module because the interesting part is
string arithmetic with no DOM in it, which means it can be tested — and the
round trip is the property that matters: everything it writes,
`client/lib/emphasis.ts` has to read back as the emphasis that was asked for.

**The unsent turn** is a column on `scenes`, not a key in the settings table: a
key per scene would outlive every scene it named, with nothing to notice.
`saveDraft` is its own statement rather than a field on `updateScene`, and
deliberately does not touch `updated_at` — a keystroke in the composer is not
activity in the roleplay, and the newest-first list should follow the story
rather than the cursor.

**Verified** in Chromium at 1600×950 and 390×844: ⌘+B wrapping the selection
and unwrapping on a second press, ⌘+I after it; Return inserting a newline in
both non-default modes and sending in the default one; the clock appearing with
the turn's other numbers; three differently-shaped plates lining up as one row
of cells in grid mode and stacking at their own sizes in list mode; a draft
typed, the scene left, and the draft back in the composer on return. At 390px:
all eight controls reachable, nothing under the tap floor, no horizontal
scroll. Guards: `test/marks.test.ts`, `test/reader.test.ts`.

### Surprises

**A boolean read the obvious way can never be turned off.** Comparing a stored
setting to `"1"` makes an absent row and an explicit `false` the same thing —
which is harmless for a default-off switch and fatal for a default-on one:
following a streaming turn is on by default, so `=== "1"` would have made
turning it off a no-op that re-read as on. Every flag asks `=== null` first.

**Auto-scroll had to be split into two effects, not gated in one.** The single
effect fired on both a new message and each streaming chunk. Gating the whole
thing meant a log that stopped moving when a message *landed*, which reads as a
broken log rather than as a setting. A new turn scrolls either way; only the
streaming tail is the reader's to refuse.

**`Segmented` was declared inside its parent component.** `LayoutSection` had
it as a nested function, so every render produced a new component type and
React unmounted and remounted the whole row rather than updating it. Harmless
while it had one caller; lifted to module scope rather than copied when the
reader controls became the second.

**The motion override can only add reduction.** Two ways in — the machine
asking through `prefers-reduced-motion`, and the reader asking here for this
app only — reaching one set of suppression rules. There is no `data-motion`
value that *removes* reduction, so a reader who has asked their OS for less
motion gets it whatever this app is set to. The alternative, a three-way that
could override the system downward, would be an app deciding it knows better
than an accessibility setting.

**The grid does not become a grid for one picture.** A single attachment
cropped to a square cell is the "64px thumbnail blown up to the prose measure"
mistake in the other direction. `auto-fill` rather than `auto-fit`, too: cells
stay the same size whether a turn drew two or seven, where `auto-fit` would
stretch two of them across the whole column.

## Phase 167 — The app had no way to say anything

Measured, not guessed: there was **not one** `aria-live` region or
`role="status"` anywhere in `client/`. Every async outcome surfaced as inline
text in whichever component happened to own the request.

That works for a rejected field and fails completely for everything else. A
background task that finished, an export that was written, a preference that
did not save — none of those have a field to sit under, so several of them said
nothing at all, and not one of them was ever announced to a screen reader. It
is a feature gap and an accessibility gap at the same time, and the incumbent's
"Notifications: Top Center" is the visible half of the thing Onsen needed the
whole of.

One primitive, not a per-caller variant — the lesson `Scroller` and
`useModalFocus` both came out of. A store beside `client/state/ui.ts`, one
region mounted at the shell, and a position preference. Anything transient
posts there; a genuinely inline error — this field is wrong, this pattern will
not compile — stays next to the thing it is about.

Three callers to start, chosen because two were in the wrong place and one said
nothing:

- The autopilot's stop reason and a failed caption were two props threaded from
  `ChatScreen`'s state down into `MessageLog`, rendered at the bottom of the
  log where nothing announced them and the next turn scrolled them away. Both
  are the app reporting that a background task ended. Gone, with their props.
- A pack export ran `anchor.click()` and said nothing. A browser download
  leaves no mark on the page, so a pack that built and a click that was
  swallowed looked identical.
- A failed preference PATCH said nothing either, and that one is worse: one
  mutation sits behind forty controls, and the render reads the cached value —
  so a failure left the button showing the old answer, which is
  indistinguishable from a button that does not work.

**Verified** in Chromium at 1600×950 and 390×844 by failing the preferences
PATCH at the network layer and clicking a switch: the failure announced in the
assertive region, still there after the success window elapsed, dismissed by
one click, and the same again from each of the three positions. Both regions
present and empty before anything is posted; an empty region passes clicks
through; focus stays on the control the reader clicked. Guard:
`test/notices.test.ts`, 19 tests, including the sweep that proves this is still
the only live region in the client. Full suite 1643 pass.

### Surprises

**One region cannot serve both tones.** A live region's politeness is read when
the region is *created*, not when its contents change, so a single region
flipping `aria-live` between polite and assertive announces at whichever
politeness it happened to mount with. Two regions, each fixed, both always
mounted — because a region that appears at the moment it has something to say
is a region assistive technology has not been watching, and the first notice is
silently lost.

**A fixed container is an invisible sheet over the app.** The region spans the
top of the window, so without `pointer-events-none` on the stack and back on
for each strip, every click in that band would have landed on nothing. Checked
with `elementFromPoint` rather than by reasoning about it.

**12px put the notice on the wordmark.** A failure has no deadline — an error
that removed itself before it was read is an error that never happened — so a
persistent one sat on the header's text-size controls until it was dismissed.
52px clears the desktop header and the phone's top bar both.

**The de-duplication is not a nicety.** Two identical notices are a retry, a
double-click, or two components reporting one failure; they are never two
facts. Reading the same sentence twice is the best-known failure mode of an
unfiltered live region, so a repeat refreshes the deadline instead of stacking.

## Phase 168 — Your whole setup as one file

Packs carry content — characters, lorebooks, presets, authors, options, regex,
triggers, the banlist. Themes export on their own. What travelled nowhere was
the shape of the app: the layout, the reading surface, the reader's controls,
which theme is on. There was no "my whole setup as one file", which is exactly
what is wanted when moving machines.

It sits beside those two exporters rather than inside either. A pack is
content; a theme is a palette. This is neither — it is every decision the
reader has made about how the app behaves and none about what is in it.

`GET /system/settings/export` and `POST /system/settings/import`, versioned
behind an `onsen-settings` marker. The theme travels **by name**, not by value:
a theme is already portable on its own, and inlining one here would mean an
import of *settings* silently adding a palette to your list. A name the
importing install does not have is reported as skipped rather than guessed at.

The refactor is the interesting part. The PATCH handler's per-group logic came
out into `applyLayout` / `applyReading` / `applyReader` / `applyChime`, and the
import path calls those rather than growing validation of its own. Not tidying:
a second copy of "how a layout patch is applied" is a second answer to what
`preset: quiet` plus `readouts: true` means, and a file arriving from another
machine is exactly where the two would drift unnoticed. A hostile file now gets
precisely the validation a hostile request body does — `clampReading` pins a
slider, `readReader` falls back per field, the layout's switches are checked
against their own unions — and nothing can be written that the settings screen
could not have produced.

The report says what was applied and what was skipped rather than answering
200-and-silence: an import that quietly did four of five things is the
silent-partial failure §18 is written against.

**Verified** in Chromium: a distinctive setup exported as
`onsen-settings.json`, wiped, re-imported, and everything back including the
layout preset and the active theme. Then a truncated file, a theme file and a
version-99 file, each refused with its own reason and nothing applied. The
outcomes come through phase 167's notice region, which is what it is for.
Guard: `test/settings-transfer.test.ts`, 15 tests. Full suite 1658 pass.

### Surprises

**A theme file is also a JSON object with a name**, which is why the marker
exists. Without it, importing the wrong file would have applied nothing and
reported success — the quietest possible failure, and one a reader would have
no way to notice.

**A file from a newer build is refused, not partly applied.** The instinct is
to take what you recognise and ignore the rest, but a newer file's extra
groups are not merely unknown fields: one of them may be a whole group this
build would silently drop, and the reader would have no way to know what did
not arrive.

**Four groups and a theme, and every one of them can be absent.** A file
carrying only `reading` is a legitimate file, so "applied" and "skipped" are
both lists rather than a boolean — and a theme this install does not have lands
in `skipped` beside a group that simply was not in the file, because from the
reader's side those are the same fact: it did not come back.

## Phase 169 — The card against the preset

Three decisions the builder made for the reader with no way past them.

**Whose framing frames the turn.** The `system_prompt` block has always been
the preset's. A character's own was folded into `spotlight_character`
instead — and only in single-character mode, so with an author configured it
went nowhere at all. Silently: the card has the field, a reader fills it in,
and nothing says it is being dropped. `preferCharacterPrompt` promotes the
spotlight's own system prompt into the block, replacing the preset's, in either
mode. Replacing rather than appending, because two framings in one block are
two framings arguing — the thing §3.5 is written against — and the reader who
turned this on did so because the card's is the one they want.

**Whether a card's post-history instructions are used at all.** Not a
"prefer": there was never anything on the preset side to prefer them over. The
preset's own final instruction is the separate `jailbreak` block, so the real
decision — and the one a reader running somebody else's card actually makes —
is whether the card's reach the model.

**A third automatic retry.** `maybeRetry` has rerolled on length since phase 63
and on nothing else. The incumbent also rerolls on a blacklisted word, and
§13.6's list already exists with proposals excluded — a suggestion nobody
accepted must not silently cost a generation. Off by default, sharing the
`auto_swipe_attempts` budget rather than getting its own, because two
independent budgets is two ways for a scene to spend money in a loop.

The reason lands on the **rejected** turn, which survives as a sibling — so a
reader who swipes back to it is told why the app moved on instead of finding a
turn that was quietly passed over. A reroll with no stated reason is the
arbitrary dice roll §8 and §13.6 are both written against.

**Verified** in Chromium against the real builder through the real preview
route, with a card framing and a preset framing both set and an author
configured: at the defaults the system prompt is the preset's and the card's
post-history is used, exactly as before; with the first flag on, the block
becomes the card's and names the card as its source; with the second off, the
`post_history` block is absent and the preset's `jailbreak` is untouched. The
reroll itself is driven through a scripted adapter in `test/retries.test.ts` —
exactly one reroll, the rejected turn surviving as a sibling, the phrase named
in its meta. Guards: `test/precedence.test.ts` (15), seven more in
`test/retries.test.ts`. Full suite 1682 pass.

### Surprises

**`PromptPreset.postHistoryInstructions` was a dead field.** Hardcoded `null`
at both of its call sites in `server/generation/context.ts`, so the
`?? ctx.preset.postHistoryInstructions` fallback in the `post_history` block
could never fire. Removed rather than wired: the preset's final instruction is
already its own block, and a field asserting an unreachable fallback is worse
than no field. A dead *export* the sweep in `test/dead-exports.test.ts` would
have caught; a dead interface member it cannot see.

**The preset editor was unreachable at desktop width.** `PresetFields` carries
the context size, the automatic retries, example eviction, squashed system
turns, the prefill, the ops' prompts and reasoning — and its only trigger is
the Settings `generation` category, which `SettingsScreen` drops on a desktop
outright, precisely to leave the left rail's Preset tab as the one surface.
But that panel reimplemented only the samplers, while its own comment claimed
since phase 106 that "the rail is the editor, not a teaser that hides the rest
behind a button". Seven sections were reachable only by narrowing the window.

Found because the two new switches would have shipped into the same dead end.
The rail now renders `PresetFields`, which *deleted* code: its duplicated
sampler grid, its export pair and its default/delete buttons were all
`PresetFields`' own, reimplemented. `test/leftrail.test.ts` asserted the
reimplementation part by part — and a list of parts is exactly how the gap
survived, since every named part was present and the ones nobody named were
not. It now asserts the whole editor.

**The two triggers had to be ordered, not combined.** Length is a string
length; the phrase check reads the ban list out of the database. Cheap first —
and a turn that is both too short and uses a banned phrase is rerolled for
being short, which is the more basic complaint, and the one already legible
from the turn and the token count beside it. So only the ban reason is
recorded: *which phrase* is the part nothing else on screen can tell you.

## Phase 170 — Vanish mode

The first of four structural UI ideas, not settings parity with SillyTavern —
this batch started from the reader's own examples: separate the rails from the
chat so they're customizable, and let the chat live under the chrome so a menu
overlays it rather than replacing it. Four candidates came out of that
conversation; all four were picked. This is the smallest, built first to prove
nothing else in the batch depends on it.

One key (`z`, unmodified, ignored while a field has focus) drops both rails
and the header/top bar down to bare log; the same key, or an always-present
restore handle, brings them back. The composer stays — vanish removes
navigation and settings chrome, not the ability to act, so a mid-scene
correction never requires breaking out of the mode first.

In memory only, like the rest of `useUiStore`: a reading posture, not a
preference, and resetting on reload is the same behaviour the rails' own
open/closed state already has.

**Verified** in Chromium at 1600×950 and 390×844, in both themes: `z` removes
exactly the app's own chrome (measured by counting `<header>` elements before
and after — 7 → 6 on desktop, 7 → 6 on phone — rather than trusting a
screenshot), the composer stays reachable and typing a literal "z" into it is
not eaten, the restore handle brings everything back, and the key works again
afterward. Guard: `test/vanish.test.ts`. Full suite 1691 pass.

### Surprises

**Selecting the whole store from `Shell` closed a render loop that had never
existed.** `ChatScreen` writes `sceneInspector` into `useUiStore` on *every*
render of its own, by a deliberately dependency-less layout effect — its own
comment says "refreshed every render." That was always safe only because
nothing between `Shell` and `ChatScreen` subscribed to the store: `LeftRail`
and `RightRail` do, but they're `ChatScreen`'s siblings, not its ancestors, so
their re-renders never reached back down into it. Adding
`const { vanished, toggleVanished } = useUiStore()` to `Shell` — an actual
ancestor of `ChatScreen` — subscribed it to *every* field, `sceneInspector`
included, and closed the loop: `Shell` re-renders on the write → `ChatScreen`
re-renders as its descendant → the effect fires again → writes the store again
→ `Shell` re-renders again. React's own "Maximum update depth exceeded" is
what that turns into, and it only showed up once the browser drive actually
opened a scene — nothing in the type system or the existing test suite could
have caught it. Fixed with per-field selectors (`useUiStore((s) => s.vanished)`
and the same for the setter) instead of the whole-store destructure the rest
of this file's components use safely only because none of them sit above a
component that writes back into it.

**`.tap` alone made the restore handle nearly unusable with a mouse.** That
class exists for a *row* of controls that can afford to shrink under a fine
pointer — `@media (pointer: fine)` relaxes its floor to nothing, on the theory
that a dense row of controls under a mouse can spend the saved space on
something else. A single isolated floating button has no row to spend it on:
measured in a browser, `.tap` by itself rendered it a 6px × 24px sliver rather
than a square. An explicit 44px fixed it; screenshots alone would not have
caught this either — the button was there, just barely there.

## Phase 171 — Settings lives over the chat, not instead of it

The second of four structural UI ideas from the same conversation as vanish
mode. `Routed()` was a flat switch: navigating to Settings — or Characters, or
a lorebook, or scene setup — fully unmounted whatever was showing. Nothing
about that was inherent. The rails and header already stay mounted across
every navigation; only the routed content itself was ever torn down.

Two screens are the base a reader actually lives in: the scene list and an
open scene. Everything else is a destination you visit *from* one of those and
mean to come back to. `useShellRoute()` (`client/lib/router.ts`) renders that
split without touching `Route` itself — parsing, `pathFor`, every existing
`navigate()` call site are untouched, because only *rendering* changes. The
base renders unconditionally; whatever is not one of the two base names
layers on top of it via a new `RouteOverlay`, which reuses `Sheet`'s own
keyboard obligations (`useModalFocus`: focus in, Tab trapped, Escape closing
only the topmost, focus back on close) at content-area size rather than
`Sheet`'s bottom-anchored, full-viewport shape.

It fills exactly the box `<Routed/>` normally occupies — `absolute inset-0`
against the shell's own wrapper, not `fixed inset-0` — so the rails and header
stay visible and reachable at every edge the whole time an overlay is open.
Back/forward composes for free: `navigate()` still does a plain `pushState`,
so Back from a character editor lands on the characters list, Back again
lands on the base scene, an ordinary browsable stack with nothing rewritten.

**Verified** in Chromium at 1600×950 and 390×844, in both themes: a composer
draft and scroll position survive opening and closing Settings; navigating
between two different overlay routes (Settings → Characters) swaps the one
overlay rather than stacking a second; Escape returns to the correct base;
a fresh deep-link straight to `/settings` falls back to the scene list
underneath rather than crashing; every other overlay screen (Authors, a
character editor, scene setup, lorebooks, backdrops, personas) measured its
own height correctly against its container rather than the viewport. Guard:
`test/overlay.test.ts`. Full suite 1703 pass.

### Surprises

**This app's surface tokens are deliberately translucent, and that became a
real bug the instant two screens stacked.** `--onsen-color-bg` and its
siblings let the shared `<Background/>` artwork bleed through every screen —
by design, and harmless while only one screen was ever in the paint order.
Stacked on top of a *second*, fully rendered screen instead of just that
artwork, the same translucency made the base screen's own text legible behind
an overlay that looked, from the source, like it should have been opaque.
Found by looking at a screenshot, not by reading the CSS. Fixed by hiding the
base screen (`hidden`, the same convention `MessageBlock.tsx` already uses for
a still-mounted element that should not paint) rather than by hunting for an
opaque override — the fix holds for every theme, translucent or not, without
needing to know which.

**Selecting the whole store from `Shell` had already taught this lesson once,
this phase.** No new instance of it here, but the `RouteOverlay` component
itself takes no store subscription at all — `onClose` is a plain closure over
`base`, passed down rather than read from a hook inside the overlay — precisely
because phase 170 had just shown what an ancestor-of-`ChatScreen` subscribing
to shared state can close into a loop.

**A pre-existing ~38px scroll allowance surfaced on two screens** (the
character editor, scene setup) once they were measured against their real
container instead of assumed. Not a visible defect — no content is cut off,
it is 38px of harmless extra scroll room at the very end of an already-long
form — and it predates this batch: these screens' own internal sizing is
unchanged, only what wraps them is different. Left as found rather than
chased, since fixing it would mean auditing internal height chains in two
screens this batch never needed to touch.

## Phase 172 — The branch map

The third of four structural UI ideas. The message tree has been real since
the schema's first version — `parent_id`, `scenes.active_leaf_id` — and
nothing before this showed it as one. A swipe carousel answers "what else did
this turn say"; a checkpoint list answers "what did I bookmark." Neither
answers "what does the whole shape of this roleplay look like," which is what
a branch or an old detour actually wants: a map, not another list.

`GET /scenes/:sceneId/tree` (`server/db/queries/history.ts`'s `sceneTree`)
reads every message the scene has, not just the active path — the map's whole
point is showing branches a reader swiped away from — as a flat, deliberately
thin `TreeNodeDto` list: no content, no segments, no media, so this stays
cheap regardless of how long a scene has run, the same reasoning phase 62 gave
the windowed log. `activePath()` and `listCheckpoints()` already existed and
answer exactly the two questions the map needs (what's current, what's
marked); this is their first caller outside the log itself.

`client/components/BranchMap.tsx` draws it hand-rolled, per this session's own
house style: no graph library, a plain SVG line and a positioned button
already do the job. A node earns a dot only for a real reason — it is a root,
has siblings (a fork), is a checkpoint, is a dead end, or is the scene's
current leaf — and every run of ordinary single-parent, single-child messages
between two such points collapses to one line carrying a turn count, so a
long unbranched stretch draws as one segment rather than one dot per message.
Clicking any node calls the same `PUT /scenes/:id/leaf` that swipe, rewind,
and checkpoint restore already share, landing exactly on the node clicked
rather than descending into whatever a branch went on to say — a dot on this
map is a specific point, the same contract a checkpoint restore already
keeps.

Reachable three ways, as the plan asked: the palette (`branch-map`, scoped to
an open scene), the `⋯ Tools` sheet beside Checkpoints and Stats, and a direct
`Map` handle on the status bar. One click from any of them opens the same
sheet.

On a phone the diagram is the same SVG, not a simplified one — most scenes
collapse to only a handful of significant points regardless of how long they
run, so the common case fits without scrolling, and the rest scrolls
horizontally inside the sheet rather than shrinking to illegibility.

**Verified** in Chromium at 1600×950 and 390×844, in both themes, on a scene
with a real fork and a named checkpoint: the fork, the checkpoint, and the
current leaf each render as visually distinct dots (a checkpoint's amber ring
independent of any speaker-colour fill, the active leaf a filled ring with its
own `aria-label`); the collapsed run between them shows a turn-count badge
that does not collide with either row's own label; clicking a past node moves
the active leaf and the log reflects it on return; all three entry points
open the same sheet; no console errors. Guard: `test/branchmap.test.ts`
(18 tests). Full suite 1721 pass.

### Surprises

**The first badge placement collided with the very labels it sat between.**
The turn-count label started life as plain text in the same column as the
row labels, sized for a full sentence ("12 turns") in a gutter only 26px
wide — nowhere near enough room, and the first screenshot showed it plainly
overlapping the branch point's own description above it. Fixed by shrinking
it to a compact `×N` badge on its own background, centred on the vertical
midpoint between the two rows it joins — the one location neither row's own
label band ever reaches — with the full sentence kept as a hover title rather
than dropped. Caught by looking at the actual render, not by re-reading the
layout math, which had looked fine on paper both times.

## Phase 173 — The rail dock: any panel, either side

The last of four structural UI ideas. `LeftRail.tsx` and `RightRail.tsx` were
two bespoke components with hardcoded panel lists — `prompt/preset/lore/
guides` on the left at 326px, `scene/characters/authors` on the right at
352px — and nothing about that was inherent. Six of the seven panels were
already pure functions of a scene id, self-explaining with no roleplay open;
the seventh, the scene's own Context/Cast/You panes, was already a slot
`ChatScreen` fills. They were portable the whole time and only their file
said otherwise.

So the panels moved out to `client/components/DockPanels.tsx` — verbatim,
not rewritten, because a panel being movable does not change what it draws —
behind one `PANEL_META` registry of icon, label, header label and component.
Each rail keeps its own chrome and loses its list, reading `useDock().left`
or `.right` instead: which panels, in what order, at what width. A panel
named in neither list is hidden and reachable again from the editor that hid
it. A side with nothing on it renders no rail at all rather than a hollow
icon column.

`DockDto` is a preference like any other (`shared/types.ts`, validated by
`readDock` on the way out of the database as well as in; stored and served by
`server/routes/system.ts` beside the layout and the reading surface, and
carried in a settings file). The default is today's exact arrangement, so
nothing moves until a reader moves it. `client/lib/breakpoint.ts`'s two
auto-collapse bands now derive from the stored widths as base-plus-delta,
which is exactly 1452/1126 at the shipped widths: a rail made wider needs
that many more px of window, and nothing changes for anyone who never
touches a width.

### The doctrine tension, named rather than avoided

§16's own rule is that "a matrix of toggles in place of a default is the
incumbent's answer... the default is what the app is." This *is* a matrix of
toggles, deliberately, and it was picked with that on the table. What keeps
it from being the thing the rule is written against: it is an opt-in editor
reached once from Settings, not a screen full of switches everyone sees; the
default arrangement is undisturbed by its own existence; and one button puts
everything back. The same shape `LAYOUT_PRESETS` uses — a name is a mode, and
the switches under it stay editable for whoever wants them. Reordering is
↑/↓, never drag, on `PromptManager`'s own stated grounds.

**Verified** in Chromium at 1600×950 and 390×844, both themes. The check
that mattered most was the first one: with no editor opened, both rails are
pixel-identical to before the batch (left 381 = 54 + 326 + 1, right 352).
Then: Characters moved right→left and appeared there and nowhere else; Lore
hidden and gone from both; Characters reordered up a place inside the left;
the left panel narrowed to 280px and the rail measured 335; all of it still
true after a cold page load, which is what proves it is server-side. Emptying
the right side entirely removed the rail element rather than leaving a
column. The Scene slot docked with no roleplay open says "Open a roleplay to
see its cast here." and fills with the scene's panes when one is. The
collapse bands still fire correctly — both rails open at 1500px, the right
one shut at 1400px, the phone layout below 1144px. Reset restored 381/352.
No console errors. Guards: `test/dock.test.ts` (29 tests, with `readDock` and
`autoCollapseBands` called rather than read as text), plus
`test/leftrail.test.ts` and `test/rightrail.test.ts` re-pointed at the file
that now owns each half. Full suite 1750 pass.

### Surprises

**Every failing test was the same fact, and the fix was to re-point them
rather than weaken them.** Moving the panel bodies broke 21 assertions
across three files that read them out of the rail files. The temptation is
to delete the ones that no longer fit; what they were actually pinning — the
sidebar cannot come back, the prompt panel is the window and not a link, the
right rail does not grow a fourth hardcoded tab — is all still true and
still worth pinning, so each assertion moved to the file that now owns the
thing, and the two "four sections / three tabs" shape tests now assert
against `DOCK_DEFAULTS`. They gained a reason to be true instead of losing
one.

**The voice guard caught an explanation I had no business adding.** The dock
section shipped with a hint under its button — "Move a panel to the other
rail, hide it, or reorder it." — and `test/voice.test.ts` failed on its
explanatory-string ceiling, 46 against a cap of 45. The right answer was not
to raise the cap: by §20's own rule an explanation earns its place only if
its absence would cause a mistake that cannot be undone, and this one sat
under a button that names what it opens, in front of an editor where every
move is reversible. Deleted, and the duplicated section label above it went
with it.

**A panel keeps the edge padding of the side it was authored for.** The left
rail pads its panel body 14px; the right rail does not, because its own
panels manage their own. Dock Characters to the left and its search row sits
inside that gutter instead of flush to the rail edge. Cosmetic, only
reachable by customising, and fixing it properly means auditing six panels'
internal padding — left as found and named here rather than quietly shipped.


## Phase 174 — A sheet is a dialog on a desktop

Not planned. It came from someone using phase 172's branch map on a desktop
and saying so: *"the popups that come from the bottom? Awful on desktop. I
hate them."* `Sheet` — the app's one modal primitive, 56 usages across 32
files plus every `useConfirm()` question — shipped bottom-anchored at every
width. A bottom sheet is the right gesture where a thumb is doing the
reaching, and a phone shape stretched across a 1600px screen, sliding up
from the edge furthest from where a mouse-and-keyboard reader is looking, is
not.

Fixed in `Sheet` itself rather than per caller, which is why Checkpoints,
Stats, the versions list, every confirmation and the new dock editor are all
fixed by it too. On a desktop it renders top-anchored and horizontally
centred with a plain square border and no radius — which is what
`CommandPalette`, the app's other modal, already does, so this is the second
caller of an existing treatment rather than a third treatment. The phone
keeps the bottom sheet, its rounded top corners and its safe-area
allowance.

**Verified** in Chromium by measuring the dialog rather than trusting the
screenshot: at 1600×950 it sits at top 64, centred (left 440 of a 720 column
in a 1600 viewport), square (radius 0), bordered on all four sides, and as
tall as its content (138px for the branch map, 213px for Checkpoints). At
390×844 it is unchanged — top 608, flush to the bottom edge, full width,
16px top corners, one top border. Guard: three cases in
`test/dock.test.ts`.

### Surprises

**Two real bugs, both found by measuring and neither visible in the first
screenshot.** The desktop dialog ran the full height of the window: a row
flex stretches its children on the cross axis by default, so the dialog was
886px tall and glued to the bottom edge — the exact complaint, in a
different way. `items-start` fixed it. And its top border was missing:
React writes a style key whose value is `undefined` as an empty string,
which *removes* that longhand, so pairing `border` with `borderTop:
undefined` expanded the shorthand and then cleared the top edge. The dialog
had three borders and an open top, at 1px, in a dim theme — invisible until
`getComputedStyle` said `borderTopWidth: 0px`. Fixed by spreading a
per-branch object so the key is absent rather than undefined.

## Phase 175 — Story Config

`NEXT.md` has carried this since the phase-108 queue: "Story Config dropdowns
(genre, POV, friction, pace → scene prompt options) are still not built."
Reading it against the code first, rather than building from the sentence,
changed what the work was. Point of view has shipped since §13.5's first pass.
And the machinery around it — seeding, per-scene selection with `one_of`
enforced in SQL on write, the inspector's labelled block with its token cost,
the cost readout on the row, the option sheet — generalises to any group in
`BUILTIN_GROUPS`. So the gap was three sets of *words*, and words are the one
thing `server/options/builtin.ts` exists to hold.

Genre, Pace and Friction, each `one_of`, each placed beside Point of view so
the four read as one block of story decisions ahead of the craft ones. No
component, no route, no DTO field, no migration: a group added to the registry
appears in scene setup and in the prompt on its own, and `server/index.ts`
seeds at boot, so an existing install picks them up on its next start.

**Every one leads with a named option whose fragment is empty** — the idiom
`reasoning_depth`'s "None", `content`'s "As the story goes" and
`prose_formatting`'s "As the author writes" already use three times over.
§22's rule that a group arriving entirely switched off looks broken on a first
run is the stated reason, and `test/options.test.ts` enforces it. The stronger
reason is the one that decided the wording: every scene in every install
predates these groups, and a genre arriving switched *on* would quietly
rewrite how all of them are written. An empty fragment is dropped in
`server/generation/context.ts` before a block is built, so a scene nobody has
configured reads exactly as it did.

Pace is deliberately not folded into Length. Length is how much to write in
one turn; pace is how fast the story moves through it. They come apart in both
directions — a slow burn in short turns, a chase in long ones — and one
control could have said neither.

**Verified** in Chromium at 1600×950 and 390×844, in both themes: Genre, Pace
and Friction appear as rows under "How it writes" beside Point of view, each
reading "Let the scene decide" with a 0-token cost; choosing *Noir* puts one
`Genre: Noir` block at depth 0 / system in the prompt inspector and the
fragment in the assembled prompt; a scene that has never been configured
carries no block from any of the three; and reset puts it all back. Also
booted against the pre-existing `data/onsen.db` to confirm the upgrade path.
Guards: five new tests in `test/options.test.ts`, including the re-seed case.
Full suite 1761 pass.

### Surprises

**The seeder wrote `sort_order` on insert and never again, which made
placement a per-install accident.** `seedBuiltins` is insert-and-skip by key
for words — an edited built-in has to survive a re-seed, which is a contract
its own tests state — but it already reconciled `cardinality`, on the argument
that structure is not words and stale structure is a correctness bug. Group
order is structure by exactly that argument: nothing in the app reorders
groups. Without extending the reconcile, shipping these three *between*
existing groups would have given a fresh install the registry's order and an
upgraded install its own historical one, with two groups claiming the same
index and the tie broken by row id. One more column in the same
`is_builtin = 1` update, and a test that stands in for an older install by
deleting the three groups and packing the survivors into the indices they
would have held.

**The spec's own §13.5 table was a phase behind before this started.** It
listed seven groups; `prose_formatting` had shipped in phase 164 and never
reached it. Fixed in passing, which is the tracker reconciliation from the
commit before this one arriving at its own conclusion: the table drifted
because nothing forces a phase to update the document that describes what it
just shipped.

## Phase 176 — The other modal that was still a bottom sheet

Phase 174 turned a sheet into a dialog on a desktop, and the way that landed
is the whole content of this phase: it fixed `Sheet.tsx`, which fixed all 56
usages at once, and it looked complete. It was not. The off-script channel —
`OocChannel.tsx`, design `2a` — had hand-rolled the entire overlay for itself
long before: its own covering layer, its own backdrop button, its own bottom
anchor, its own rounded top, its own `role="dialog"`. So one window in the app
kept rising from the bottom edge of a 1600px screen after every other sheet
had stopped, and the fix that was reported as app-wide had missed it.

The report came from use, the same way 174's did: *"the 'off script' chat
window still has the awful bottom dock thing in desktop. scour the app for
others and fix them."*

**The fix is a shell, not a second copy of the branch.** `SheetShell` now owns
what a modal over the dimmed scene *is* — the desktop/phone branch, the
backdrop, the dialog element with its border, radius, ground and safe-area
allowance, and `useModalFocus`. `Sheet` is a header and a scroll composed
inside it; `OocChannel` composes its own interior, which is the part a plain
`Sheet` could never have held: a scrolling exchange with a composer and a hint
pinned underneath. A single-file fix was what let this hide, so the fix is
arranged so the next modal with an unusual interior composes the shape instead
of copying it.

The channel gains two things by coming through the shell. It had no focus trap
at all, despite claiming `aria-modal="true"`: Tab walked out of it into the log
behind. And its Escape was a bare `window` listener, so a confirmation opened
over the channel closed both on one press — the exact bug phase 158 wrote
`useModalFocus`'s stacking to fix, still live in the one file that had not
adopted it.

**Verified** in Chromium at 1600×950 and 390×844, both themes, by measuring
the box rather than looking at it. Desktop: top at 64px, 189px tall against a
950px window, 720px wide (the prose measure), `border-radius: 0`, all four
borders 1px in blue — and it grows to 239px as a bubble lands, so it is
hugging its content rather than sitting at a fixed height. Phone: bottom at
844 of 844, 16px top radius, a 2px blue top border and no others — unchanged,
which is the point. A question typed in the channel still posts and still
appears inline in the log; Escape still closes it. Full suite 1771 pass.

### Surprises

**The command palette had the same defect, invisibly.** It was already
top-anchored, so it looked fine — but its container was a row flex without
`items-start`, which stretches a child on the cross axis, and its panel's
`max-h-[70vh]` was therefore acting as a *fixed* height. Filtered down to one
command it still measured 665px of a 950px window, nearly all of it empty; on
a search matching nothing, the same. Now 165px and 143px. This is the identical
bug 174 found in `Sheet` and fixed there only, which is the phase's theme
twice over.

**The guard that would have caught this is a sweep, not an assertion.** A test
naming `OocChannel.tsx` would only have existed if somebody had already
thought of `OocChannel.tsx` — and nobody did, for two phases. So
`test/sheet-dialog.test.ts` now reads every `.tsx` in `client/components` and
asserts that the list of files anchoring anything to the bottom of the window
is exactly `["Sheet.tsx"]`, the same for the rounded top corner, and that a
full-screen overlay is one of exactly three files. It fails on the *next* file
to copy the shape, which is the one nobody will write a test for.

**It failed on a comment first.** The sweep matches source as text, so the
doc comment explaining what `OocChannel` used to contain — which quoted the
classes — read as a use. The comment is written around the guard now and says
so, because the alternative is a guard that cannot tell a mention from a use.

## Phase 177 — Off script belongs beside the log, not over it

The third shape this one window has taken in four phases, and the sequence is
the lesson. It shipped as a bottom sheet at every width. Phase 174 fixed
`Sheet` app-wide and this channel — having hand-rolled its own overlay — kept
the bottom dock anyway. Phase 176 brought it through the shared shell, so it
became a centred dialog. The report on that was that a dialog was not what was
wanted either: *"the off-script chat should live in a side rail on desktop."*

Which is right, and reading it makes the earlier two attempts look like the
same mistake twice. The off-script exchange is a conversation held *while*
reading — asking the author what it meant, without leaving the scene. A modal
is the one shape that cannot do that, because a modal's whole job is to be the
only thing you can attend to. Both previous fixes improved *where the modal
sat*. Neither asked whether it should be one.

**So it is a dock panel now**, the eighth, and phase 173's rail dock rework had
already made that possible without knowing it: nothing in either rail
special-cases `ooc`, so it can be moved to the other side, reordered, or
hidden like any other panel.

Three pieces, and only the first is about off script:

- **`PanelMeta.fills`.** Every other panel is a column the rail scrolls for it.
  This one pins a composer under a scrolling log, so a rail-level scroll
  container would carry the composer off the bottom edge. `fills` tells the
  rail to hand over the space and stay out of the way — no scroll wrapper, no
  gutter.
- **`OocExchange`**, split from `OocChannel`. The exchange is the part that has
  never changed through any of this; what kept changing was the chrome around
  it. The rail hosts the exchange directly, the phone's sheet wraps the same
  component, so the two ways in cannot drift.
- **A second slot**, `oocPanel`, beside `sceneInspector`. The exchange needs
  the scene's live messages and the answer currently streaming, which only
  `ChatScreen` has, so the rail reads a node the chat screen fills — exactly
  the arrangement `scene` has used since phase 87.

**One way in that always works.** `openOoc` selects the panel in whichever rail
hosts it and opens that rail; everywhere there is no rail to use — a phone,
vanish mode, or a reader who hid the panel from both sides — it falls back to
the sheet. A way in that stops working because of a preference is not a way in.

**Verified** by measuring, in Chromium at 1600×950 and 390×844, both themes,
across eight arrangements: shipped default (right rail, composer on screen at
847–893 of 950, still on screen after asking); the 260px width floor (composer
227px, wraps under the log with Send beneath it); docked to the left rail
instead; hidden from both rails (sheet); vanish mode (no rails at all, sheet);
light theme; and a phone (sheet, bottom at 844 of 844, 16px top radius, one
2px top border). A question asked in the rail posts and appears inline in the
log. No page errors in any pass. 1791 tests, typecheck clean.

### Surprises

**A new panel could not reach anyone who had ever touched the dock.** The rail
rendered three tabs against a `DOCK_DEFAULTS` naming four, because hiding was
an *absence* — a panel named on neither side — and a stored preference
therefore could not tell "the reader hid this" from "this did not exist yet".
Every install that had ever saved a dock arrangement had a stored pair of lists
that did not name `ooc`, so the new panel was indistinguishable from one that
had been hidden on purpose.

`DockDto` gains an explicit `hidden` list. A panel in none of the three lists
is new to this reader and lands where the defaults put it; a panel in `hidden`
stays hidden forever. It also matches the editor, which has offered Left /
Right / Hidden as three equal choices since phase 173 — Hidden was always a
decision, and now it is recorded. The cost is paid once: a reader who hid a
panel before there was anywhere to write it down gets it back, and hiding it
again sticks.

This is the same class of bug as phase 175's `selectedOptions`, found the same
way — by booting against the real `data/onsen.db` rather than by reasoning. The
tests passed and the browser showed three tabs.

**A guard claiming "one way in" passed while three existed.** `test/ooc-rail.
test.ts` first asserted the two entry points it knew about, the palette command
and the inline "open channel" link, and went green. The composer's own Off
script op — the way almost everyone actually opens it — was still wired
straight to the sheet in `useOps.tsx`. So the rail was built, shipped in the
default, rendered its tab, and clicking the op raised the bottom sheet.

Naming call sites could not have caught it, because the one that was wrong was
the one nobody thought to name. Counting them can: the whole client may contain
exactly one `setOocOpen(true)`, and it is the fallback inside `openOoc`. That
is the second sweep-instead-of-assertion guard in two phases, for the same
reason both times.

**The right rail's tab row could never have held four tabs.** Three fit 352px;
a fourth overflowed, and the dock editor has let a reader put all eight panels
on one side since phase 173 — so this was already broken for an arrangement the
app permitted. The row scrolls sideways now, and the selected tab scrolls
itself into view, which matters because `openOoc` selects a tab *for* the
reader: at a narrow width they would otherwise press a button and see nothing
move.

**Measuring found the geometry; only the screenshot found the colour.** Every
box was right while the rail panel sat on the rail's own ground rather than the
blue one — and the file's own doc comment states the rule it was breaking
("everything in it is the author speaking as itself"). The blue is painted by
`OocExchange` now, so whichever chrome hosts it, the rule holds.

## Phase 178 — Character groups

A recurring cast is a thing worth naming. The reader who plays the same five
characters across a dozen roleplays was re-picking them every time — five taps
through a character picker, then the lorebook in setup. The app had folders for
the library and tags for the roleplays, and nothing that said "these go
together."

**A group is a roster plus a setting.** `character_groups` holds a name and an
optional lorebook; `character_group_members` holds the ordered membership. Two
tables rather than a JSON column because membership is what both the editor and
the roleplay-starter walk, so it earns a table.

Three pieces:

- **The schema** (migration 0075). A group survives a character being deleted —
  membership cascades off, the roster itself stays. The lorebook reference is
  `SET NULL` for the same reason: losing a book should not lose the roster.
- **The endpoints** (`server/routes/groups.ts`). List, create, rename, set the
  lorebook, add and remove members — and `start`, which turns the roster into a
  scene in one request: insert the scene under the group's name, add the cast
  in display order, seed the first member's greeting, and bind the lorebook at
  scene scope. The whole point of the feature is that last route.
- **The sheet** (`client/components/GroupsSheet.tsx`), opened from the Cast
  library header. The list is the organisation half; each row's Start button is
  the quick-creation half. The editor renames, picks a lorebook, and adds or
  removes members through a searchable library picker.

**Start goes to the chat, not the setup.** The scene opens on the first member's
greeting — a whole roleplay is already there to read — so the reader lands in
it, and setup is one tap away if they want it.

**Verified** by the group API tests — create, rename, membership, the lorebook
round-trip, and the start route producing a scene whose cast order matches the
roster and whose lorebook is bound at scene scope. The empty-roster start is
refused rather than making a scene that cannot open. 1795 tests, typecheck
clean.

### Surprises

**The voice guard caught the feature explaining itself.** The first draft put a
"Start turns the roster into a roleplay…" hint at the bottom of the list, and
`test/voice.test.ts` — which caps explanatory strings at 45 and demands each
earn its place — failed. The hint was the wrong fix for the ambiguity it was
answering: the row already shows the member count and the lorebook, and the
button says Start. The hint is gone; the sheet is no worse for it.

**`SceneDto` already carried everything `start` needed.** The cast, the title,
the greeting — no new mapper, just `insertScene` + `addSceneMember` +
`seedGreeting` + `bind`, all of which the cast-picker route already composed for
a scene that exists. The new work was a roster the picker could reuse.

## Phase 179 — Models is a rail activity

*Numbered 178 while it was being built; `matt` landed character groups as 178
on main first, so this took the next number. Nothing about the work changed —
worth a line only because the phase references inside the code say 179 and the
commit that wrote them said 178.*

The report: *"managing/changing/editing providers needs to happen easier/faster.
it should be a sidebar activity. while were in there editing, check for ways to
improve this too."*

Providers lived in one place — Settings, which is a full-screen overlay. So
pointing a roleplay at a different model meant leaving what you were reading,
finding the Models category, expanding a row, and scrolling. Three verbs in
that sentence, so the panel does three things: the scene's own selection
switched in one click, provider and profile rows expanded in place, and adding
or removing either.

`models` is the ninth dock panel and sits on the **left** rail next to
`preset` — they answer the same question from opposite ends, which model and
how it is sampled, and the left rail is where this app keeps machinery. It also
scales: the left rail is a vertical icon column, while the right rail's tab row
already overflowed at four in phase 177.

Unlike `scene` and `ooc` it needs no slot. Everything in it is server state the
panel can fetch for itself, so it is a plain function of the scene id like the
other six.

**Settings keeps its Models category.** A phone has no rails, so removing it
would strand every phone reader — and the point of the extraction below is that
having two doors costs nothing.

### What "check for ways to improve this" turned up

Three real defects, all found by measuring rather than reading:

**Save was below the fold.** The provider form is 606px tall, and in a 950px
window its bottom sat at 998px — the commit button had to be scrolled to,
before a 326px rail made it narrower and taller. One sticky `ActionRow`, shared
by both forms. Measured after: at the rail's 260px floor the form is 726px and
Save sits at 889–933 of 950. A form whose Save has to be hunted for is a form
people abandon half-filled.

**Save saved half the form.** Name, address, model and key waited for the
submit; the prefill choice and the instruct template wrote to the server the
instant they were clicked. So "Save" meant *some* of this, and closing without
saving had already stored part of the edit. Both are form state now and go with
the submit.

**A provider could not be tested until it was saved.** `Test` needed a row id,
so adding one was a loop: save, reopen, test, fix, save again — and the reader
found out whether the key worked only after committing it. The server's test is
now a `probeProvider` helper behind two doors, `POST /providers/:id/test` and
`POST /providers/test`, the second taking the values from the form with a
stored key standing in for one left blank. That is exactly the shape
`POST /providers/models` has used for unsaved credentials since §16, so it
introduces no new exposure: a key crossing transiently for one call, never
stored. Verified in the browser that testing an unsaved provider reports the
failure *and* leaves the provider count at 1.

**And the switcher now says which model.** The sheet it replaces listed profile
*names* only, with no mark on the one in force — while the question being
answered is "which model". Each row carries provider · model, the one in use
takes a filled dot and is disabled, because a click that does nothing should
not look like a click that does something.

### The extraction

`ProviderFields` and `ProfileFields` moved to `client/components/
ConnectionFields.tsx`. A credential form is the last thing that should exist
twice, and they now have three hosts: the settings screen's inline expansion,
its phone sheet, and the rail panel's rows. The same move `Segmented` made in
phase 166, for the same reason. `SettingsScreen.tsx` went from 2471 lines to
1981.

**Verified** in Chromium at 1600×950 and 390×844, both themes. Models is the
fifth glyph in the left rail; the panel lists profiles with the active one
marked; clicking another switched the scene's `connectionProfileId` (checked
through the API, before and after) and the composer's own chip followed;
expanding a provider put Save on screen at every width including the 260px
floor; testing an unsaved provider returned a failure without creating it;
Settings' Models category still renders both lists with the sticky row and the
Test button; a phone has no left rail and reaches all of it through Settings.
No page errors. 1805 tests, typecheck clean.

### Surprises

**The extraction left ten dead imports behind.** Moving 489 lines out took
seven query hooks (`useCreateProvider`, `useUpdateProvider`, `useTestProvider`,
`useCreateProfile`, `useUpdateProfile`, `useDeleteProvider`, `useDeleteProfile`)
and three components (`ModelPicker`, `InstructPicker`, `useConfirm`) plus
`PROVIDER_KINDS` with them — and every import stayed, typechecking cleanly
because an unused import is not an error. Caught by writing the guard, not by
the compiler. `test/models-panel.test.ts` now asserts their absence by name.

**The first version of that guard was wrong.** It swept for `name="apiKey"` and
asserted exactly two files could hold one. Three did, and the two extra were
both legitimate: media services and the embeddings provider each have their own
key field. A key field is not the thing that may only exist once — *writing a
chat provider* is, so the sweep counts `useCreateProvider`/`useUpdateProvider`
instead and expects exactly one file. Worth recording because the sweep-rather-
than-name lesson from phases 176 and 177 held, and the first swing at it still
picked the wrong needle.

## Phase 180 — Known endpoints, a way back, and a model per roleplay

Three asks in one report, and the thread joining them is that each named
something the app made you do the long way round.

### Known endpoints

*"lets create some preset urls and stuff for various providers, minimum is
deepseek, claude, openai, nanogpt, z.ai, but thats the minimum. BARE
minimum."*

`shared/providers.ts` holds seventeen, in two groups — twelve hosted
(Anthropic, OpenAI, DeepSeek, NanoGPT, Z.AI, OpenRouter, Google Gemini, xAI,
Mistral, Groq, Together, Fireworks) and five on your own machine (Ollama, LM
Studio, KoboldCpp, llama.cpp, Text generation web UI). Picking one fills the
name, address, kind and, where the ids are known for certain, the model.

**Every address was checked against the provider's own documentation rather
than recalled.** A base URL that is nearly right fails at the first generation
with a 404 and reads as a broken app, which is precisely what a preset exists
to prevent. The one chosen per provider is the one whose path this app's
adapters append to — `/chat/completions`, `/messages`, `/completions` — so
Anthropic's is `https://api.anthropic.com/v1` and not the bare host. `models`
is populated only where current documentation gives the ids (Anthropic's three,
DeepSeek's two) and deliberately left empty everywhere else, because the form's
Fetch button asks the endpoint what it actually serves and a stale guessed
model id is worse than an empty field. Z.AI carries the one note in the
catalogue: a coding plan is served from a different path.

A preset fills the form and stops. Every field stays editable, Test still runs
before anything is saved (phase 179), and no preset carries a key — a guard
greps the serialised catalogue to keep it that way.

### A way back to the roleplay

*"can we also have a more clear link back to the roleplay in the top nav
bar?"*

Two defects under that. The header's scene chip **navigated to the roleplay
list**, so the only thing in the nav bar naming the open roleplay was the one
thing that took you away from it. And it read `route.name === "chat"`, so
opening Settings — an overlay over a still-mounted base since phase 171 —
emptied the header of the roleplay it was reading, leaving nothing pointing
back at all.

Two buttons now: the wordmark opens the list, the scene chip returns to the
roleplay. While an overlay is up the chip takes a left chevron and the
interactive blue, because then it is a way back rather than a label.

### A model per roleplay

*"i want to be able to change the model for the current roleplay in the
sidebar, not jsut see what it is."*

Phase 179's panel switched *profiles*, which is not the same thing: changing
the model that way needs one profile per model. `scenes.model` is a per-scene
override (migration `0076`), and `resolveRoute`'s chain becomes **scene, then
profile, then provider** — narrowest wins, each step a deliberate narrowing by
somebody. Null is the ordinary state and means "whatever the profile says", so
every existing roleplay reads exactly as it did.

The panel's picker reuses `ModelPicker`, so the list comes from the provider's
own API rather than a typed guess, names where the current value came from
("From the profile · …"), and offers one button back to the profile's choice.
Empty or whitespace clears the override rather than storing blank — one state
for "no override", not three.

**Verified** in Chromium at 1600×950 and 390×844, both themes. The chip reads
`· The Last Inn` in a roleplay and `‹ The Last Inn` with Settings open, and
clicking it returns to the scene URL. Picking DeepSeek, Z.AI and Anthropic
filled name, address, kind and model correctly, showed Z.AI's note, and created
nothing. Typing a model persisted to `scene.model`, left the sibling roleplay
at null, left the shared profile untouched, and moved the composer's chip to
`Default · claude-haiku-4-5`; clearing put the profile's model back and the
clear button away. 1834 tests across 131 files, typecheck clean, no page
errors.

### Surprises

**The base route was a `useRef`, and that stopped being right the moment
anything else asked.** `useShellRoute` kept "the last base route seen" in a
ref, which was the same thing while `Shell` was its only caller and is not the
same thing with three: a ref is per component instance, so each caller
remembers only the base routes it was itself mounted for. Driving a cold load
straight to `/settings` caught it — the header had mounted on an overlay route
and answered "no roleplay" while `Shell` had a chat mounted behind it. It is
module state now, so every caller agrees.

**Both rails had the same bug, and it was worse.** They scoped to
`useRoute()`, so opening Settings told *every docked panel* there was no
roleplay: the Models panel's "This roleplay" went blank, the prompt panel
stopped previewing, and all of it came back on close. The rails sit outside
the overlay and should see what is behind it. This had been live since phase
171 and nothing had noticed, because until phase 179 no rail panel showed
anything a reader would miss while Settings was open.

**The composer's model chip would have lied.** It built its label from the
profile's model, which was the right answer until a roleplay could choose its
own — after that the chip would name one model while the turn ran another. A
status readout that disagrees with the turn is worse than none, so it resolves
the same two steps the server does.

**The first guard for the catalogue was almost a lie of its own.** An earlier
version asserted the presets carry no key by checking a couple of field names;
it now serialises the whole catalogue and greps it, which is the version that
would actually catch somebody pasting a working key into a "starting point".

## Phase 181 — A provider per roleplay, and the sweep that should have come with it

*"should be able to change roleplays provider too -_- that seemed obvious to
me"*

It was obvious, and phase 180 built the model override without its sibling. A
roleplay could already reach a different provider — but only by switching to a
connection *profile* that pointed at one, so pointing it at a provider you had
no profile for meant making a profile first: bookkeeping in service of a
two-click change.

`scenes.provider_id` (migration `0077`) is the override, and the panel's "This
roleplay" gains a provider select above the model box. `ON DELETE SET NULL`
rather than cascade: removing a provider must hand its roleplays back to their
profile, not remove them.

**The chain grew a skip, and the skip is the interesting part.** Resolution was
scene → profile → provider for the model. A roleplay that overrides the
*provider* must not inherit the profile's model, because a model id belongs to
whoever serves it — carrying `claude-3-5-sonnet` across to a local llama
because the profile happened to name it would fail the turn with a model nobody
chose. So the profile's model is skipped when the provider was overridden, and
choosing a provider clears any stale scene model in the same PATCH.

`resolveRoute` also stopped joining the profile to its provider, because that
join hardcoded the thing a scene can now override. The profile still supplies
the preset and its own model; which provider serves the turn is a separate
question now.

**Background tasks follow the roleplay only when they have no profile of their
own.** An op with its own profile is a deliberate routing choice (§7), and
dragging the scene's provider onto it would quietly undo that; an op with none
is running "wherever this roleplay runs", which is exactly what the overrides
mean.

### The sweep

Asked whether anything else had the same problems, and there were two classes,
each with one more instance — plus a better fix than patching instances.

**Readouts that re-derive what will run.** The composer's chip had been
corrected twice already (phase 180, then again here when naming the *profile*
became wrong even though the model was right). A sweep found the status bar and
the roleplay list doing the same re-derivation. Three clients each
reimplementing `resolveRoute` is three chances to disagree with the turn, so
the server resolves it once into **`SceneDto.runsOn`** and all three read that.
It is deliberately a second implementation of the chain — `resolveRoute`
decrypts a key and throws on every unroutable state, neither of which a list of
roleplays wants — so a test walks five combinations and asserts the two agree
rather than trusting a comment.

**Scoping to the current route where the base route is meant.** Phase 180 fixed
the header and both rails; the sweep found `Background.tsx` doing it too, so a
roleplay's artwork dropped the moment any overlay opened and came back on
close. Visible rather than theoretical — `App.tsx` keeps the background mounted
precisely because the overlay is translucent enough for the base to show
through. `TopBar` also reads the current route and is *correct* to: it is
naming the screen you are on, which is a different question.

**Verified** in Chromium at 1600×950, both themes, against a provider
deliberately given no profile — the case switching profiles could not reach.
Moving the roleplay to it set `provider_id`, cleared the stale model, re-seeded
the box to the new provider's own default, and left the sibling roleplay
untouched; the prompt preview still resolved (200, prompt built, and one
provider-capability block correctly absent for the new provider); handing it
back restored everything. All four readouts agreed at every step — select,
model box, source line ("From the provider" when overridden, "From the profile"
when not) and composer chip (`Local llama · local-default` versus
`Anthropic · claude-3-5-sonnet-20241022`). Deleting the provider while a
roleplay pointed at it nulled the column rather than leaving a dangling id, and
the roleplay still resolved on its profile. The background check was rerun with
a real scene background after the first probe proved nothing — the scene had
none, so the default and the scene's own were indistinguishable. 1843 tests
across 131 files, typecheck clean, no page errors.

### Surprises

**The first background probe proved nothing and looked like it passed.** It
compared the layer's `src` with and without an overlay and got the same answer
both times — because the scene had no background of its own, so both readings
were the app default. A green result from a test that cannot fail is worse than
a red one. Re-run after uploading a real background, the src stays
`/api/scenes/…/background` across the overlay, which is the actual claim.

**`ON DELETE SET NULL` is only true if foreign keys are on.** SQLite enforces
them per connection, and this app sets `PRAGMA foreign_keys = ON` at open
(`server/db/index.ts`) — but a migration that says `ON DELETE SET NULL` reads
as a guarantee whether or not anything switches it on. The test asserts the
*column* is null after a delete, not merely that the DTO's ulid lookup missed;
those look identical through the API and are not the same thing.

## Phase 182 — Test what the turn actually does

The report was one sentence and an error cut off mid-word: *"deepseek is
failing even tho i am using a valid api. Failed — HTTP 400:
`{"error":{"message":"The supported API model n`"* — and then, when the first
guess landed on the preset's prefilled model id, a correction: *"these were
grabbed from the 'fetch' tho?"*

That correction is what turned a plausible fix into the right one. The model
**was** fetched from the provider's own API and **was** valid. The Test button
never sent it.

### The one cause, with three faces

`ProviderEditor` had a `modelRequest()` built for `POST /providers/models` —
asking a provider what it serves, a question that cannot name a model, so the
request correctly carries none. Test reused it verbatim. Every test therefore
posted `model: ""`, and DeepSeek answered the only way it can: a 400 listing
the models it *does* serve. The reader read that as their key being rejected,
with the model they had just fetched sitting in the box above.

Pulling that thread found two more of the same kind, both shipped by the two
phases just before this one:

- **The Test button built its own Anthropic path.** It used `/messages`; the
  adapter appends `v1/messages`. Phase 180's preset shipped
  `https://api.anthropic.com/v1` to match the test — so Test passed and every
  real turn 404'd at `…/v1/v1/messages`. Confirmed against the live API:
  `POST https://api.anthropic.com/v1/messages` → 401 (endpoint real, no key),
  `POST https://api.anthropic.com/v1/v1/messages` → 404.
- **The text-completion probe sent no model either**, while `text.ts` sends
  `model: config.model`. A third way the test differed from the turn.

The common shape is worth naming because it is the same one phase 181 found in
the status readouts: **a check that asks a different question than the real
thing can pass while the app is broken.** There it was three client readouts
re-deriving `resolveRoute`; here it is a Test button re-deriving the request.
Both fixes are the same move — one owner, and everybody reads it.

### What changed

`server/adapters/errors.ts` is new and owns four things that existed in three
or four near-identical copies: `providerErrorMessage` (pull the sentence out of
whatever envelope arrived — nested `error.message`, a flat `error` string, a
top-level `message` or `detail`, or the raw body if it is not JSON at all),
`readErrorBody`, `chatPathFor` and `joinUrl`. The three adapters lost their
private copies; `connections.ts` gained the shared ones.

Test now names a model on every kind, and refuses locally when there is none —
a turn with no model throws `no_model` before any adapter is reached, so a test
without one is testing something that cannot happen, and saying so ourselves
beats relaying a provider's confusion about a field we omitted.

The result is a wrapping, scrolling, selectable panel rather than a `truncate`d
span beside the button. The old shape clipped at 200 characters *and* showed
the JSON envelope, so the two failures compounded: the useful half of the
sentence was exactly what got cut.

And **no preset names a model any more**. The first version shipped ids for the
two providers whose documentation seemed clearest and DeepSeek's were already
wrong. Fetch asks the provider what it serves right now, which cannot go stale.
The asymmetry is the argument: a blank model is a small, obvious, one-click
gap; a wrong one is invisible until a turn fails, naming something the reader
never typed.

**Verified** in Chromium at 1600×950 and 390×844, both themes, against a
stand-in provider that records the URL and body it was asked. With a model the
probe resolves `/v1/chat/completions` carrying `{"model":"deepseek-chat",…}`
and Anthropic resolves `/v1/messages` — not `/v1/v1/messages`. With no model it
refuses in 0ms without a round trip. A 556-character provider error arrives
whole, envelope stripped, and renders with `scrollWidth === clientWidth` at
both sizes (no horizontal clipping); the phone caps at 180px and scrolls
(scrollH 234). Picking the DeepSeek preset over a typed `deepseek-flash`
cleared it and filled `https://api.deepseek.com/v1`; picking Anthropic filled
`https://api.anthropic.com`.

### Surprises

**The bug was in the two phases immediately before it.** Phase 179 gave Test a
second door (test before saving) by reusing the model-list request, and phase
180 shipped an Anthropic address that agreed with the *test's* wrong path
instead of the adapter's. Both were driven in a browser and both looked right,
because the thing that verified them was the thing that was wrong.

**A guard that names a function pins nothing about what it sends.** The phase
179 test asserted `test.mutate(modelRequest()` — perfectly true throughout, and
the whole bug was inside `modelRequest()`. Renaming the call site to
`testRequest()` was the only reason it failed at all. It now asserts the
request *contains a model*, and that the model-list request does not — pinned
in `client/lib/queries.ts` at the type level, where it is actually true, rather
than by proximity in a component.

**A sweep that reads prose as code fails on its own explanation.** The new
"never build these paths by hand" guard tripped on the comment in
`connections.ts` explaining which path it used to build wrongly. Second time
this project has hit it (the first was `test/sheet-dialog.test.ts` on a doc
comment quoting Tailwind classes). Fixed the same way both times — make the
assertion mean what it says, with a `codeOf()` that strips comments first, not
by deleting the comment.

## Phase 183 — Add and remove cast from the right rail

A roleplay's roster had exactly one place to be changed: scene setup, a screen
you navigate away to. Reading the cast rail in the right rail, noticing someone
is missing, and being able to do nothing about it there was the gap.

The Characters panel was already the right place and half the answer. It lists
the library split into two — "in this scene" and the rest — but the split was
display only: tapping a row opened the card editor, and the only buttons on the
whole panel were create and import. So the panel *named* who was in the scene
and could not change it.

**The split now acts.** Someone in the scene carries a Remove, everyone else an
Add — one tap, straight to the cast endpoints that already existed (`PUT` /
`DELETE /scenes/:id/cast/:characterId`), which scene setup had been the only
caller of. No new endpoint, no new state: the panel just stopped being a
read-only view of a list it was already showing.

Two deliberate shapes:

- **Remove is not confirmed and not destructive.** Removing a member keeps
  every line they have written — it is a roster edit, not a deletion — and the
  route is one tap away from undone (Add puts them straight back). The setup
  screen's own remove is unconfirmed for the same reason, and the rail matches
  it rather than inventing a second opinion.
- **No add/remove outside a roleplay.** The split only exists while a scene is
  open; with none, the panel is the plain library it has always been, and there
  is no roster to edit.

The row needed a second action, so the card row's one big `<button>` became a
row with the open button and the add/remove button beside it — the same shape
the Authors panel's "use" button already has.

**Verified** by the right-rail guard, extended with one assertion rather than a
new file: the panel wires both cast hooks and names both actions. Typecheck
clean.

A second surface in the same phase: the cast rail's member sheet (opened by
right-clicking a card) gains "Remove from cast", so removing someone does not
require leaving the roster view. The sheet already had mute/bench/edit/view;
remove was the one roster action it lacked.

## Phase 184 — Turn mastheads

The log had stopped separating its turns. What was left — a 3px spine on the
left, a 26px gap, a name — is three things that all read as *inside* the turn,
so on the default Midnight theme (the flat original: no card, no shadow, no
radius) two consecutive turns read as one undifferentiated stream of prose.
Worse, the author's portrait had shipped off by default on both sides, and at
26px when on — a thumbnail a reader could miss entirely. "Character profiles
don't seem to appear" was both: off by default, tiny when on.

Three changes, and the ground they all sit on:

- **A masthead per turn.** The stacked header becomes a masthead: a
  portrait-sized avatar (40px), the name in the character's colour, and a
  hairline rule under the row. The rule is the boundary the flat theme lost in
  phase 50, when the spine replaced it — restored now, so every theme has a
  visible divider rather than only the "cards" ones.
- **The author's portrait is on by default** in Instrument, the shipped preset.
  A cast member is a person, and the masthead is where that shows. The reader's
  turns keep their bubble and no portrait, so the log still reads as one voice
  interrupted rather than two columns of chat.
- **A grounded turn on every theme.** The flat depth no longer names
  `card-bg: transparent`; it inherits `tokens.css`'s new default,
  `var(--onsen-color-bg-raised)`, with a real padding. So even a theme that
  says nothing about depth gets a panel per turn — sharp and shadowless, but
  with a body. Themes that already name card tokens keep their deeper look.

Document and Broadsheet are deliberately untouched. Document's whole premise is
that there are no turn boundaries, so its `background: none` override still
holds; Broadsheet keeps its byline, where the name opens the paragraph rather
than sitting above it. The masthead belongs to the stacked reading surface,
which is the default.

### Surprises

**The "Document is Quiet's switches" invariant caught a scope slip.** Setting
Quiet's author portrait on would have dragged Document along with it — the type
and its guard both state that Document is Quiet with the attribution moved into
the paragraph — and Document cannot show a portrait anyway, its header is
hidden. The fix was to change only Instrument, the preset the complaint was
actually about, and leave Quiet as the unadorned reading layout it names.
