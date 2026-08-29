# Group Roleplay Frontend — Build Spec

A self-hosted, mobile-first AI roleplay chat application. Group scenes are the
primary use case, not an afterthought. The user acts as a director who nudges the
plot rather than writing every turn.

**Version 2.** Revised after surveying SillyTavern, SillyBunny, Lumiverse,
RisuAI, Agnai, Backyard AI, and the hosted apps. Sections marked were
added because an existing frontend does this and the first draft didn't.

---

## 0. Guiding principles

Read these before making any design decision. When in doubt, they win over
convenience.

1. **The scene is the primitive, not the character.** A scene owns an author, a
   cast, a shared history, and a turn director. A character is a card that
   participates in scenes.
2. **The AI is a co-author, not a character.** The default mental model is a
   single writing partner with their own personality who puppets every non-user
   character — like a GM running a table, not three independent bots. The author
   is the identity in the system prompt; characters are roles the author plays.
   This is the product's defining bet. Do not add a competing "every character is
   an independent agent" mode; that architecture is the source of most group
   brokenness in every other frontend.
3. **History is a tree, not a list.** Regenerate, edit, and swipe are constant
   operations. Never model chat as an array.
4. **A turn is either a spotlight or a beat.** A *spotlight* voices exactly one
   cast member. A *beat* is one generation in which the author writes several
   characters interacting — the thing a novelist does, and the thing the author
   model makes safe. Both are legitimate; the user picks per turn, or sets a
   scene default. What is never legitimate is asking several independent agents
   to share a turn. See §3.5.
5. **The author never writes the user's character.** This is a hard rule,
   asserted in the system prompt and re-asserted in a near-turn nudge, not a
   polite request. Every preset that does this well treats it as the single
   most important constraint, because the failure is immediately immersion-
   breaking and models drift toward it constantly.
6. **Keep the prompt prefix stable.** The author + cast block should not change
   between turns. Swapping the system prompt per speaker destroys prompt caching
   on llama.cpp, vLLM, and hosted providers. This is a direct performance benefit
   of the author model — protect it.
7. **The server owns generation.** The client never talks to an inference
   backend directly. Mobile clients get suspended and lose connections; the
   server must survive that.
8. **Guided generation is core, not an extension.** Director tools are
   first-class verbs in the domain model.
9. **Prompt assembly is the product.** Most engineering effort belongs in
   deciding what text enters the context window and in what order. Treat it as
   the most important module in the codebase.
10. **Nothing ephemeral is persisted into history.** Director notes, guides,
    trackers, and injections are assembled at generation time and never written
    into the message log.
11. **Every op can use a different model.** Cheap local model for bookkeeping,
    expensive model for prose. Model routing is per-operation, not global.
12. **Memory is visible and editable, never magic.** Automatic memory is
    unreliable everywhere it has been tried — vector retrieval is hit-or-miss for
    narrative continuity, summaries hallucinate. Show the user what was recalled
    and why, and let them fix it. Never market it as "infinite memory."
13. **Progressive disclosure.** The single most common complaint about
    SillyTavern is UI density. Default view stays clean; depth lives behind
    profiles and an advanced toggle. This matters double on a phone.
14. **Prompt options are structured data, not prose the user edits.** The best
    preset suites are libraries of toggleable blocks with mutually-exclusive
    groups. Model that natively (§13.5) rather than shipping one giant editable
    system prompt.

---

## 1. Stack

| Layer | Choice |
| --- | --- |
| Runtime | Bun |
| HTTP framework | Hono |
| Database | SQLite via `bun:sqlite`, WAL mode, `busy_timeout` set |
| Migrations | Plain numbered SQL files applied at boot |
| Streaming | SSE (Server-Sent Events) |
| Frontend | React + TypeScript SPA, Vite |
| Styling | Tailwind |
| State | TanStack Query for server state, Zustand for UI state |
| Vectors | Undecided — see §24. sqlite-vec loads under `bun:sqlite` with no compile step but is a native extension; a JSON flat index is the pure-JS fallback |
| Deploy | Single Bun process serving API + static build |

Constraints:

- No native modules. `bun install` must work with no compile step. This
  constrains the vector store choice — verify before committing to sqlite-vec.
- The frontend build is served by the same origin as the API. No CORS.
- `bun build --compile` must produce a working single-file executable with the
  frontend embedded. Verify this stays true as dependencies are added.

---

## 2. Data model

Use integer primary keys internally, expose ULIDs externally. All timestamps
stored as Unix milliseconds.

### Author

The AI's own identity — the writing partner who puppets the cast. Reusable
across scenes, persistent, with its own personality. This is the entity in the
system prompt; characters are roles it plays.

```
id, name, avatar_path, created_at, updated_at
personality        -- who the partner is as a collaborator
writing_style      -- prose style, tense, POV, paragraph length
directing_style    -- pacing habits, how much it escalates, how it handles silence
ooc_voice          -- how it talks to the user out of character
boundaries         -- content it steers toward or away from
memory_enabled     -- opt-in cross-scene memory (see §11)
is_default
```

An author is optional. With none set, the scene falls back to single-character
mode.

### Persona

Who the *user* is. Multiple personas, selectable per scene, each optionally
bound to its own lorebook. *[gap: per-persona lorebook]*

```
id, name, avatar_path, description, lorebook_id, is_default
```

### Character

The reusable definition of a role the author voices.

```
id, name, avatar_path, created_at, updated_at
description        -- always in prompt
personality        -- always in prompt
scenario           -- scene framing, may be overridden per-scene
first_message      -- greeting
alternate_greetings -- string[]  (multiple openings per card)
group_greetings    -- string[]  (openings used only in group scenes)
example_dialogue   -- parsed into structured example turns
voice_notes        -- speech tics, vocabulary, rhythm; injected only when spotlighted
depth_prompt       -- text injected at a fixed depth whenever this character is
                      present; from CCv2 extensions.depth_prompt
depth_prompt_depth, depth_prompt_role
system_prompt      -- optional per-character override
post_history_instructions
creator_notes, tags, creator, character_version
expression_pack_id -- nullable
raw_card           -- the complete original card JSON, preserved verbatim
extensions         -- JSON blob
```

`raw_card` is not optional. Lossy card parsing is the most common migration
failure in this ecosystem — RisuAI and Agnai both silently drop advanced
lorebook fields on import. Store the original and re-emit from it on export.

### Scene

```
id, title, created_at, updated_at
scenario_override  -- nullable, overrides character scenario
author_id          -- nullable; null = single-character mode
persona_id
preset_id
connection_profile_id
director_note      -- persistent steer, nullable
turn_strategy      -- enum: manual | round_robin | mention | classifier
autopilot_enabled, autopilot_max_turns
ooc_enabled, ooc_interval
vn_mode_enabled    -- visual novel staging
active_leaf_id     -- pointer into the message tree
```

### SceneMember

```
scene_id, character_id, display_order, is_active
overrides          -- JSON, per-scene tweaks to the card
first_seen_message_id  -- presence tracking: what this character witnessed
```

### Message (tree node)

```
id, scene_id
parent_id          -- nullable, null = root
kind               -- enum: spotlight | beat | user | system | narrator | ooc
author_type        -- enum: user | character | system | narrator | ooc
character_id       -- nullable; set for spotlight turns
content            -- canonical raw text as generated
reasoning          -- extracted thinking block, hidden from prose
expression         -- classified or author-declared emotion label
created_at, edited_at
is_hidden          -- excluded from prompt but visible in UI
token_count        -- cached, invalidated on edit
generation_meta    -- JSON: model, provider, samplers, TTFT, tokens/sec
```

### MessageSegment

A beat is one generation containing several speakers. The raw text stays
canonical on the message; segments are the parsed view used for rendering,
per-character editing, and expression attribution.

```
id, message_id, ordinal
speaker_type       -- character | narration
character_id       -- nullable
content
expression         -- nullable
char_start, char_end   -- offsets into the parent message content
```

A spotlight message has exactly one segment. A beat has several. Re-parsing is
idempotent: edit the canonical content and segments are rebuilt; edit a segment
and the canonical content is spliced at its offsets.

Siblings under the same parent are swipes. `active_leaf_id` on the scene defines
the current path; walking parents from the leaf to the root yields the active
history.

### Tree operations

Settled while building phase 2. All of them preserve what they move away from:
only an explicit delete removes a node.

- **Swipe, rewind, branch and checkpoint restore are one operation** — moving
  `active_leaf_id`. Nothing is copied and nothing is truncated. Appending to a
  message that is not the current leaf is not an error; it forks there, and that
  is what branching is.
- **Swiping descends; rewinding does not.** Landing on a sibling follows the
  most recent child down to a leaf, so swiping away from a version and back
  again restores that version's own continuation rather than truncating it.
  Rewinding and restoring a checkpoint stop exactly on the chosen message, so
  the next turn forks at that point — which is what a checkpoint is for.
- **Alternate greetings are root siblings**, `parent_id IS NULL`. Sibling
  queries must therefore treat a null parent as a group, not as "no siblings".
- **Deleting takes the subtree.** If the active leaf was inside it, the pointer
  moves to the surviving branch below the parent; deleting the last root leaves
  the scene empty rather than dangling. Checkpoints bookmarking a deleted
  message go with it.
- **Editing content invalidates `token_count` and stamps `edited_at`.** Hiding a
  message, or rewriting it with identical text, does neither: `is_hidden` is a
  prompt concern, and an unchanged edit is not an edit.

### Checkpoint

Named save-points, distinct from branches. A branch forks the timeline; a
checkpoint is a bookmark you can return to and optionally fork from later.

```
id, scene_id, message_id, name, created_at
```

### Lorebook / LoreEntry

See §10 for the full activation model.

```
Lorebook:
  id, name, description, scan_depth, token_budget, recursive_scanning
  owner_author_id    -- nullable; set for author memory (§11)
LoreEntry:
  id, lorebook_id, keys (string[]), secondary_keys (string[]), content
  selective_logic    -- enum: and_any | and_all | not_any | not_all
  use_regex          -- keys are regex rather than literals
  insertion_order, insertion_position, insertion_depth, insertion_role
  outlet_name        -- nullable; content addressable as {{outlet::Name}}
  is_constant, case_sensitive, match_whole_words, enabled
  probability        -- 0-100 trigger chance
  scan_depth_override
  inclusion_group, group_weight, group_prioritize, group_scoring
  character_filter   -- character ids/tags this entry applies to
  recursion_level, non_recursable, prevent_further_recursion
  delay, sticky, cooldown   -- timed effects, in messages
  automation_id      -- fires a named action on activation
```

### TimedEffectState

```
scene_id, entry_uid, kind (sticky|cooldown|delay), hash, start_msg, end_msg
```

Branches inherit parent state. Editing an entry mid-effect clears its effect.

### Document / DocumentChunk

The data bank: reference material distinct from lorebooks. Retrieved by
similarity, not keywords.

```
Document: id, scope (global|scene|character), scope_id, name, slug, source, added_at
DocumentChunk: id, document_id, ordinal, content, embedding (blob), token_count
```

Users can force a document into context with `#slug` in a message.

### Summary

```
id, scene_id, covers_from_message_id, covers_to_message_id, content,
edited_by_user, created_at
```

### MemoryEntity / MemoryRelation

Optional narrative memory (§11). Off by default.

```
MemoryEntity:
  id, author_id, scene_id, kind (person|place|object|event|fact)
  name, content, salience (0.0-1.0), last_seen_message_id
  user_edited      -- if true, background extraction must not overwrite
MemoryRelation:
  id, from_entity_id, to_entity_id, kind, content, salience
```

### Preset

```
id, name
sampler_settings   -- JSON, see §13
prompt_order       -- ordered array of prompt block descriptors
system_prompt, jailbreak, prefill
context_size, max_response_tokens
reasoning_config   -- extract/hide/reinject rules
```

### ConnectionProfile

A named bundle of provider + model + templates + preset, switchable in one tap.
This is the abstraction that makes per-operation model routing usable.

```
id, name, provider_id, model, preset_id, instruct_template_id, context_template_id
```

### Provider

```
id, name, kind, base_url, api_key_encrypted, model, capabilities (JSON), enabled
```

### ExpressionPack / Expression

```
ExpressionPack: id, name, character_id
Expression: id, pack_id, label, image_path, variant_index
```

### Generation

```
id, scene_id, target_message_id, status, buffer, offset, started_at, finished_at, error
```

### RegexScript

```
id, name, pattern, replacement, flags, enabled
apply_to           -- user_input | ai_output | display_only | prompt
scope              -- global | character | scene
scope_id, run_order
```

---

## 3. Prompt builder

The most important module. Isolate it completely from HTTP and from the
database — it takes a plain input object and returns a normalized message array.
It must be trivially unit-testable and have no I/O.

### Interface

```ts
interface PromptContext {
  scene: Scene;
  cast: Character[];
  spotlight: Character;        // whose turn this is
  author: Author | null;
  persona: Persona;
  history: Message[];          // active path, root -> leaf
  lore: LoreEntry[];           // already matched and resolved
  documents: DocumentChunk[];  // already retrieved
  summaries: Summary[];
  memory: MemoryEntity[];
  trackers: TrackerState[];
  guides: Guide[];
  preset: Preset;
  directorNote?: string;
  nudge?: string;
  capabilities: ProviderCapabilities;
  budget: number;
}

interface BuiltPrompt {
  system?: string;
  messages: NormalizedMessage[];
  prefill?: string;
  rawText?: string;            // text-completion mode
  outlets: Record<string, string>;
  debug: PromptDebugInfo;      // every block, source, token cost, what was evicted
}

function buildPrompt(ctx: PromptContext): BuiltPrompt;
```

`PromptDebugInfo` is not optional, and it must record **what was trimmed**, not
just what was included. "The character forgot" is almost always "the model never
saw it," and the inspector is the only way a user can discover that.

### Purity and injected inputs

Settled while building phase 3. The interface above omits four fields the
implementation needs, all of them there to keep the module pure — same context
in, same prompt out:

- **`tokenizer: Tokenizer`** — `{ id, isEstimate, count }`. Passed in rather than
  imported, per the handoff. `isEstimate` reaches the inspector, because an
  estimate a user trusts and overflows on is worse than no number.
- **`now: number`** — resolves `{{time}}` and `{{date}}`. A `Date.now()` inside
  the builder would make the same context produce different prompts.
- **`seed: number`** — resolves `{{random}}` and `{{roll}}`.
- **`idleDuration?: number`** and **`oocDue?: boolean`** — inputs to
  `{{idle_duration}}` and the OOC invitation block.

A test reads the source of every file under `/prompt` and fails on an import
from `/db`, `/routes` or `/middleware`, and on `Date.now`, `new Date()`,
`Math.random`, `fetch`, `process.env` or `bun:sqlite`.

### Macro resolution rules

- **`{{pick}}` is anchored to the turn, not the seed.** It hashes the last
  message's id, so rebuilding a turn picks the same option while `{{random}}`
  varies per generation. Anchoring it to the seed would let every swipe silently
  rewrite the prompt's fixed choices, and take prompt caching with it.
- **Unknown macros are left in the text and reported.** §18 requires visible
  degradation: a suite carrying state in `{{setvar}}` leaks the literal text, and
  the inspector names it. Deleting it silently would hide the failure.
- **An unresolved outlet collapses to nothing and is reported.** Unlike an
  unknown macro, an empty slot is a normal state rather than a misconfiguration.
- **Outlet contents are resolved in their own pass first.** Substitution is a
  single scan, so an outlet spliced in unresolved would carry its own macros into
  the prompt verbatim.
- **Outlet text nothing referenced costs nothing.** Being filled is not enough;
  a placeholder has to have consumed it.

### Invented text is always a block

Where a provider's rules force text the user did not write — currently only the
filler turn a strict-alternation provider needs when a scene opens on a greeting
— it is recorded as a block with its own id and token cost. Nothing reaches the
model without appearing in the inspector.

### Two rendering modes

**Author mode (default).** There is one POV — the author's.

- System prompt establishes the author: personality, writing style, directing
  style, OOC voice.
- Cast block follows: full definition of the spotlighted character (including
  voice notes), compact definitions of everyone else.
- Every non-user message in history is an `assistant` turn, prefixed with the
  speaker's name. User messages are `user` turns, labeled with the persona name.
- Spotlight instruction appended at depth 0: voice only this character.
- No alternation gymnastics, no per-speaker re-render, and the prefix stays
  stable so prompt caching works.

**Single-character mode.** No author; one character. Standard card-in-system-
prompt rendering with strict alternation where the provider requires it.

Implement both as pure functions behind one interface:
`renderHistory(history, mode, spotlight, author, capabilities)`.

### 3.5 Beats — multiple characters in one turn

A **beat** is a single generation in which the author writes several characters
interacting: dialogue, reactions, an argument that plays out across three lines
without the user pressing anything between them. This is what makes a scene feel
alive rather than turn-based, and it is only safe because of the author model.
One author writing an exchange is a novelist writing a scene. Three independent
agents sharing a turn is the failure mode every other frontend has.

No mainstream frontend does this natively. SillyTavern group chat is strictly
sequential — one card generates per call, and even "join character cards" merges
definitions while still drafting a single speaker. The community's workaround is
to build a narrator/GM card that writes everyone and mute the rest of the group,
which is your architecture arrived at from the other direction.

**Requesting a beat.** The composer offers scope alongside the send action:

- *Spotlight* — one named character.
- *Beat* — the author writes the next exchange, with a bound: N exchanges, or
  "until X happens," or "let it run."
- *Auto* — the turn director decides; a beat when several characters are
  plausibly reacting, a spotlight when one is.

**Prompt shape for a beat.** The stable prefix does not change. What changes is
the instruction at depth 0:

- Full definitions for every character participating, not just one.
- Named participants and an explicit exchange bound.
- Equal-initiative rule: every named character acts or speaks; do not funnel all
  attention onto one.
- Do not end the beat by asking the user a question. This is the single most
  common way group scenes stall.
- Speaker-label format specified exactly, so parsing is reliable.
- The user-lock, restated.

**Output format and parsing.** Require a strict speaker label per block —
`**Name:**` at the start of a line, with unlabeled prose treated as narration.
Parse into `MessageSegment` rows. Parsing must degrade gracefully: if labels are
missing or malformed, store the whole thing as one narration segment and flag
the message rather than losing text. Never discard content because it didn't
parse.

**Interaction with the rest of the system:**

- *Swipe* rerolls the whole beat. Rerolling one character's line inside a beat
  is **Recast** (below), not a swipe.
- *Recast segment* regenerates a single segment in place, holding the rest of the
  beat fixed and passing it as context. This is the per-character correction
  affordance.
- *Split beat* converts segments into separate messages when the user wants
  independent branching from a mid-beat point.
- Expressions are attributed per segment, so VN staging updates through a beat.
- History rendering emits a beat as one `assistant` turn — its natural shape.
- Presence and knowledge scoping apply per participant within the beat.

**Failure modes and required mitigations.** Every one of these is a known,
observed failure with multi-character generation:

| Failure | Mitigation |
| --- | --- |
| Voices converge; everyone sounds the same | Full `voice_notes` for each participant; a per-character planning pass in hidden reasoning; the voice-validation post-pass (§7.5) |
| Characters know things they didn't witness | Knowledge scoping stated per participant in the beat instruction (§6) |
| The author writes the user's character | User-lock in system prompt plus depth-0 restatement |
| One character dominates | Equal-initiative rule; optionally name a required speaker order |
| Beat stalls — characters re-affirm without advancing | Exchange bound; an anti-echo rule; "advance the situation by the end of the beat" |
| Beat ends by prompting the user | Explicit prohibition, restated at depth 0 |
| Labels malformed, parsing fails | Graceful degradation to one narration segment, message flagged |

### Character distinctness

One author voicing everyone risks homogenized voices. All of these are required:

- Spotlight instruction naming the character explicitly, placed last.
- Full card for the spotlighted character, compact cards for the rest.
- `voice_notes` injected only when that character is spotlighted.
- `depth_prompt` for every present character, at its configured depth.
- Optional per-character sampler overrides (temperature especially).

### Assembly order

Default order, overridable per preset:

1. System prompt (preset)
2. Author identity — personality, writing style, directing style
3. Spotlighted character definition, including voice notes
4. Cast block — compact definitions of other members
5. Persona description
6. Scenario
7. Constant lore entries
8. Example dialogue
9. Rolling summaries (oldest history, condensed)
10. Chat history (trimmed to fit)
11. Retrieved document chunks
12. Recalled memory entities
13. Keyword-matched lore, at configured insertion depths and roles
14. Persistent guides
15. Tracker state block
16. Per-character depth prompts
17. Author's note / persistent director note, at configured depth
18. Post-history instructions
19. One-shot nudge, at depth 0
20. OOC invitation, when due
21. Spotlight instruction
22. Jailbreak / final system instruction
23. Prefill

Any block may declare an `outlet_name` instead of a position, in which case it
is injected wherever `{{outlet::Name}}` appears in the preset. This decouples
*what* is active from *where* it lands.

### Budget allocation

Reserve for response tokens, then fill in priority order. Everything except
history has a fixed or capped cost. History absorbs the remainder and is trimmed
oldest-first — but trimmed messages should be covered by a summary before they
fall out (§11). Never trim a partial message. If the budget cannot fit the fixed
blocks, fail loudly.

Token counting: use a real tokenizer per provider family where available; fall
back to a character-ratio estimate with a safety margin, and **label estimates as
estimates in the UI**. Cache counts on the message row.

### Macros

Resolved late, after assembly, before dispatch:

`{{char}}`, `{{user}}`, `{{persona}}`, `{{author}}`, `{{scenario}}`, `{{cast}}`,
`{{time}}`, `{{date}}`, `{{random:a,b,c}}`, `{{pick:a,b,c}}` (stable per
message), `{{roll:d20}}`, `{{tracker:name}}`, `{{guide:name}}`,
`{{outlet::Name}}`, `{{lastMessage}}`, `{{idle_duration}}`

---

## 4. Provider adapters

One internal message format. Adapters translate outward. Each provider declares
capabilities and the prompt builder branches on them.

```ts
interface ProviderCapabilities {
  separateSystemRole: boolean;
  supportsPrefill: boolean;
  requiresStrictAlternation: boolean;
  mode: 'chat' | 'text';
  needsInstructTemplate: boolean;
  supportedSamplers: SamplerName[];
  samplerOrder: SamplerName[] | null;
  maxContext: number;
  supportsLogitBias: boolean;
  supportsStopSequences: boolean;
  supportsGrammar: boolean;
  emitsReasoning: boolean;
  supportsPromptCaching: boolean;
  tokenizer: TokenizerId | null;
}
```

Note: prefill and extended thinking are mutually exclusive on Anthropic. The
capability flags must express that, not just list both.

### Required adapters for v1

- **OpenAI-compatible** — OpenAI, OpenRouter, most local OpenAI shims.
- **Anthropic** — separate system param, strict alternation, prefill.
- **Text completion** — llama.cpp server, KoboldCpp, TabbyAPI.

### Instruct templates

For text-completion mode, ship named templates (ChatML, Llama 3, Mistral,
Alpaca, Vicuna, Metharme) as data, not code. Each defines system/user/assistant
wrappers, BOS handling, and stop sequences. Users must be able to add custom
ones.

### Adapter contract

```ts
interface Adapter {
  capabilities: ProviderCapabilities;
  generate(prompt: BuiltPrompt, settings: SamplerSettings, signal: AbortSignal):
    AsyncIterable<TokenChunk>;
  countTokens?(text: string): number;
  listModels?(): Promise<ModelInfo[]>;
}
```

Aborting the client request **must** propagate the `AbortSignal` upstream so
local inference actually stops. Verify explicitly against llama.cpp — a leaked
generation pins a GPU.

---

## 5. Generation service and resumable streaming

Mobile browsers suspend backgrounded tabs and drop connections on network
handoff. Design for it.

1. Client `POST /api/scenes/:id/generate` with a target. Returns
   `{ generationId }` immediately.
2. Server builds the prompt, calls the adapter, appends tokens to an in-memory
   buffer keyed by `generationId`, persisting periodically.
3. Client opens `GET /api/generations/:id/stream?offset=N` (SSE). Server replays
   from `offset`, then continues live.
4. On disconnect the server keeps generating. On reconnect the client resumes
   from its last offset with no loss.
5. On completion the server writes the message node and emits a terminal event.
6. `POST /api/generations/:id/cancel` aborts and persists partial output.

Keep finished generations for a short TTL. Heartbeat every 15s to stop proxies
closing idle streams.

**Multi-device head sync.** The same scene may be open on a phone and a
desktop. Broadcast active-leaf changes and generation events over a per-scene
channel so both clients converge. Last-write-wins on the leaf pointer, with the
losing client showing a "chat moved" prompt rather than silently diverging.

**Background UX.** Floating generation indicator when the user navigates
away from a generating scene; optional completion chime (unlock audio on first
user gesture for autoplay policy); per-message TTFT and tokens/sec in the
generation metadata panel.

---

## 6. Turn director

Decides who speaks next in a group scene.

- **manual** — user taps a character to speak.
- **round_robin** — cycle through active members in display order.
- **mention** — activate when a name or configured keyword appears in the last
  message; fall back to round robin.
- **classifier** — a cheap call to a small model asking which cast member would
  most plausibly respond next, given the last few messages and the cast list.

The classifier strategy is a headline feature. "Let an AI decide who speaks
next" has been an open, repeatedly-requested gap in SillyTavern for years
(issues #21, #224, discussion #3466); the existing alternative is a
talkativeness dice roll plus whole-word name matching, which users find
arbitrary. Route it to a fast local model via its own connection profile, and
show the decision and its reason in the UI so it never feels random.

Rules for every strategy:

- Never let the same character speak twice consecutively unless requested.
- Respect an explicit user target over the strategy.
- Expose the decision in the UI.

### Presence tracking

Characters should not react to events they weren't present for. Track
`first_seen_message_id` per member and optionally an exit point; when rendering
history for a spotlighted character, mark or omit messages outside their
presence window. In author mode the author sees everything, so the spotlight
instruction carries the constraint: "Ana was not present for the argument in the
kitchen and does not know about it."

This also gives you private knowledge — a cast member can hold an agenda the
author tracks but doesn't reveal. Store it as a scene-scoped tracker field.

### Autopilot

After a reply completes, optionally continue generating turns automatically up
to `autopilot_max_turns`, stopping when: the cap is reached, the user sends a
message or taps stop, a character addresses the user's persona directly, or an
error occurs. Give it a prominent, always-reachable stop control.

---

## 7. Guided generation (director tools)

First-class operations, modeled on the Guided Generations extension for
SillyTavern (`Samueras/GuidedGenerations-Extension`, GPL-3.0 — read for
reference, do not copy code). All ephemeral instructions inject at depth 0 and
are never persisted as messages.

In author mode, phrase injections as address to the author ("slow the pacing
down here") rather than terse system commands.

### Generation ops

| Op | Behavior |
| --- | --- |
| **Nudge** (Guided Response) | One-shot instruction for the next generation. May target a specific cast member. |
| **Guided Swipe** | Reroll the last AI message with new guidance. Only when the last message is from the AI. |
| **Steer** | Persistent director note on the scene, applied until cleared. |
| **Continue** | Extend the last message. Requires prefill or text mode; disable where unsupported. |
| **Expand** | Regenerate the target longer and more detailed, as a sibling. |
| **Corrections** | Rewrite the last AI message with targeted instructions, preserving what worked. |
| **Swipe** | Plain regenerate as a new sibling. Rerolls a whole beat. |
| **Recast segment** | Regenerate one character's segment inside a beat, holding the rest fixed. The per-character correction affordance. |
| **Split beat** | Convert a beat's segments into separate messages, for independent branching. |
| **Extend beat** | Continue an existing beat with another exchange rather than starting a new turn. |
| **Impersonate (1st / 2nd / 3rd person)** | Expand a brief user outline into a full in-character message from the chosen perspective. Three separate ops with independently overridable prompts. Result lands in the composer, never auto-sends. |
| **Interject** | Insert narration or system text without a character speaking. |
| **Summarize** | Condense a history range into a summary node (§11). |

### Utility ops

| Op | Behavior |
| --- | --- |
| **Simple Send** | Post the user's message without triggering a reply. Essential for stacking messages. |
| **Spellchecker** | Polish the user's input, returning it to the composer. |
| **Edit Intros** | Rewrite a scene's opening message; aware of alternate and group greetings. |
| **Input Recovery** | Restore previously cleared composer input from a client-side ring buffer. |

### Per-op configuration

Every op carries its own configuration row:

```
op_id, enabled, connection_profile_id, prompt_template,
injection_role, auto_trigger, button_visible, run_order
```

- **`connection_profile_id`** — the op runs against this profile, then control
  returns to the scene's normal profile. Cheap local model for bookkeeping,
  expensive model for prose. The generation service must switch per-call.
- **`prompt_template`** — fully user-overridable, `{{input}}` plus the macro set.
- **`injection_role`** — `system`, `assistant`, or `user`. Which works best
  varies by model; configurable per op, not globally.
- **`auto_trigger`** — run automatically after each reply.
- **`button_visible`** — control which ops appear in the UI.

### Background tasks

Generalize the above into a named background-task primitive: a stored prompt
with a trigger condition, a stage (pre-generation / sidecar / post-generation),
its own connection profile, and a defined output destination (a guide, a
tracker, a memory write, a composer fill, a new message). Summarization,
tracker refresh, memory extraction, the turn classifier, and expression
classification are all instances of this one mechanism. Build it once.

Background tasks run off the main generation path and **must never block or fail
a user-facing generation.**

### 7.5 Post-generation pipeline

An ordered set of passes that run *after* a message is generated and can revise
it. Modeled on the ReCast extension, whose rationale is sound: a model cannot go
back once it has committed to a response, but a second model reading the finished
text can catch what the first one got wrong.

Each pass is a background task with its own connection profile, prompt, and a
declared effect (replace the message, annotate it, or flag it). Passes run in
order; any pass may be skipped or disabled. The original text is always retained
so the user can see and revert what a pass changed.

Ship these:

| Pass | Purpose |
| --- | --- |
| **Voice validation** | Check each character acted and spoke in-character. The flagship pass for this product — it is the direct fix for voice bleed inside beats, and it can name which segment drifted. Runs per segment, cheap model. |
| **User-lock check** | Detect the author writing the user's character. Flag and offer a regeneration rather than silently rewriting. |
| **Prose refinement** | Improve vocabulary and rhythm, strip banned constructions. Strong model; off by default because it costs a second full generation. |
| **Slop scan** | Match against the ban list (§13.6) and flag or rewrite offending phrases. |

Auto-run per scene or manual per message. Show pass results as a small
annotation on the message, not a modal.

---

## 8. Persistent guides and trackers

Two flavors of maintained scene state. Support both — they fail differently.

### Persistent guides (free-text)

Generated once by a background task, injected every turn until flushed.
Free-form prose, hand-editable. More robust than structured output because there
is no parse step to fail. This is the default.

| Guide | Purpose |
| --- | --- |
| **Situational** | Current scene context, from recent history or a focus hint. |
| **Thinking** | Characters' internal thoughts, not visible as dialogue. |
| **Clothes** | What each character is currently wearing. |
| **State** | Physical positions, posture, injuries, who is where. |
| **Rules** | In-world rules the story must respect. |
| **Custom** | Free-form user-defined injection. |

Management actions, all required: **Edit**, **Show** (with token cost),
**Flush** (one or all), **Auto-trigger** (per-guide; defaults on for Thinking,
Clothes, State).

Guides are scene-scoped and versioned per message, so rewinding rewinds them.

### Trackers (structured)

For users who want strict state and a visual panel.

- JSON schema, prompt template, refresh interval.
- Refresh requests JSON only. Parse strictly; on failure keep previous state and
  log. **A tracker failure must never block generation.**
- Versioned per message.
- Directly editable, with per-field pinning so refreshes don't overwrite.
- Rendered as a collapsible panel above the composer.

Ship default trackers: **Scene** (location, time of day, who is present),
**Characters** (per-member mood, position, notable state, private knowledge).

---

## 9. Character cards

- Import **PNG with embedded tEXt chunk**, spec V2 and V3, plus raw JSON and
  **CharX** (ZIP with card JSON + assets + embedded lorebooks + expression
  images). Implement PNG chunk parsing directly.
- V3 cards write the payload into both `ccv3` and `chara` chunks; read either,
  and on export emit both for back-compat.
- **Parse CCv3 lorebook decorators**: `@@depth N`, `@@instruct_depth`,
  `@@activate_after_emotion`, `@@ignore_on_max_context`, and fallback chains
  (`@@@`). Strip decorators from content before prompt insertion. Unsupported
  decorators fall through the chain rather than erroring.
- `use_regex` on keys switches keyword matching to regex.
- **Preserve `raw_card` verbatim.** Import must not be lossy. The fields most
  commonly dropped by other importers, and which you must handle:
  `alternate_greetings`, `character_book`, `creator_notes`,
  `post_history_instructions`, `extensions.depth_prompt`.
- Export back to PNG V3 and CharX.
- Bulk import from a folder; import from a Chub URL.
- Card editor covering every field, with a per-field token-cost readout.
- **Cache parsed cards.** Re-parsing PNG metadata is a known performance sink
  with large libraries, especially on mobile. Parse once into SQLite and
  invalidate on file change.

### Library at scale

SillyTavern's own tracker describes managing hundreds or thousands of cards as a
significant unsolved problem, rooted in manual and inconsistent tagging. You have
SQLite; you can simply do better.

- Full-text search across name, description, personality, and creator notes.
- Real tags with autocomplete and a controlled vocabulary, plus folders.
- Saved filters ("my sci-fi cast", "unused in six months").
- **Bulk operations** — tag, untag, move, delete, or add-to-scene across a
  multi-selection.
- **Version history per character** — snapshots on save, with diff and restore.
  You already have a tree for messages; characters deserve the same.
- **Derive** — duplicate a card as a variant with a link back to its parent, for
  alternate-universe versions of the same character.
- Instant scene assignment: a character-picker that adds several cast members at
  once, since the author drives generation and adding a character is cheap.
- **AI-assisted tagging** as a background task — read the card, propose tags from
  the existing vocabulary. This is the exact request in SillyTavern's issue
  tracker and nobody has shipped it well.

### AI-assisted authoring

Each of these is a background task with its own connection profile, producing a
structured record rather than free text. Enforce the output schema server-side
rather than trusting the model to emit valid XML — malformed structured output
is the top complaint about the extensions that do this today.

| Task | Produces |
| --- | --- |
| **Create character** | A full card from a short description, optionally reading the current scene for context. |
| **Revise character** | Targeted edits to named fields, preserving the rest. |
| **Extract character** | A card built from how a character has actually behaved in an existing scene — the most useful version of this, and the one that needs your history. |
| **Suggest voice notes** | Speech tics and rhythm derived from a card or from that character's existing dialogue. |
| **Suggest lore entries** | New lorebook entries from scene context (see §10). |
| **Revise lore entry** | Update an existing entry against what has happened since. |

### Character dossiers

For characters who emerge during play rather than being authored up front — the
innkeeper who turned out to matter. A dossier is a lightweight card generated by
a background task when a character recurs, structured as:

- Role, and where they are usually found
- Voice — how they speak
- **Canon lock** — facts established in play that must not be contradicted
- **Tiered knowledge** — what is public, what is private, what is buried
- Current standing with the user's persona

Dossiers are injected by relevance (recent mention, or keyword) rather than
always, and can be promoted to full characters when they earn it.

---

## 10. Lorebooks / world info

### Activation

- Keyword matching over the last `scan_depth` messages, with per-entry override.
- Primary plus secondary keys with `and_any` / `and_all` / `not_any` / `not_all`.
- `match_whole_words`, `case_sensitive`, `use_regex`.
- `probability` for random activation.
- `is_constant` entries always inject.
- **Character filter** — scope an entry to specific characters or tags.
  Essential when a group shares one lorebook and cast members should hold
  different knowledge.
- Similarity-based activation as an alternative to keywords, using the same
  embedding index as documents (§11).

### Timed effects

Measured in messages, scoped to the scene, inherited by branches, and forcibly
cleared when the entry is edited.

- **Sticky N** — stays active for N messages after triggering, bypassing
  probability until expiry.
- **Cooldown N** — cannot re-activate for N messages after activation. Chains
  naturally after sticky expires.
- **Delay N** — cannot activate until the scene has at least N messages.

Persist as `TimedEffectState` rows keyed by scene and entry. Note the known
SillyTavern limitation to avoid: delay measured only from the start of the whole
chat is not useful in long scenes — measure from scene start *and* offer
measurement from branch point.

### Inclusion groups

When entries share a group label, only one is inserted. Selection by:

- **Weight** (default 100) — weighted random.
- **Prioritize** — highest insertion order wins deterministically.
- **Group scoring** — most key matches wins.

This is the primitive for random events and mutually-exclusive lore.

### Insertion

- Positions: before/after character definitions, before/after example messages,
  before history, at depth N with a role (system/user/assistant), top/bottom of
  author's note, or **outlet** (named, placed by `{{outlet::Name}}`).
- `insertion_order` controls priority within a position.
- Per-lorebook token budget; lowest-priority entries drop when exceeded.

### Recursion

- Injected entries can trigger further entries, with a configurable cap.
- **Recursion levels** — entries grouped by level, matched only after
  lower levels are exhausted.
- Per-entry `non_recursable` and `prevent_further_recursion` flags.

### Automation IDs

An entry may name an action fired on activation (a background task, a tracker
refresh, a regex script). This is the hook that lets lore drive behavior, not
just text.

### Interop

Import/export SillyTavern world-info JSON. Round-trip unknown fields.

---

## 11. Memory

Three layers, increasing in cost and decreasing in reliability. Ship them in
this order. Be honest with the user about all three.

### Layer 1 — Rolling summarization

The highest-leverage memory feature and the one to build first.

- Triggered every N messages **or** N words, whichever comes first.
- Runs as a background task with its own connection profile — a cheap model is
  fine here.
- Produces a `Summary` row covering a message range. Summaries stack: older
  summaries can be re-summarized when they themselves grow past a budget.
- Injected at a configurable position and depth.
- **Fully editable.** The user can rewrite any summary, and edits are marked so
  regeneration doesn't clobber them.
- Coordinate with the budget allocator: history should not be trimmed until the
  range it covers has been summarized.
- **Injection threshold** — only inject summaries covering messages older than N,
  so recent history isn't described and shown at once.
- **Raw eviction** — optionally drop raw messages once summarized and past the
  threshold, always keeping the last user message.
- **Cache stability** — updating the summary block on every turn invalidates the
  provider's prompt cache. Offer a freeze option that only moves the injection
  point every N turns, trading a little staleness for a large cost saving.

### Layer 2 — Document RAG / data bank

Reference material, distinct from lorebooks: uploaded files, pasted notes, web
pages. Chunked, embedded, retrieved by similarity.

- Scope global, per-scene, or per-character.
- Retrieval knobs: score threshold, number of chunks, how many recent messages
  form the query.
- Chunk size configured in **tokens**, not characters — a persistent source of
  confusion in SillyTavern.
- `#slug` in a user message force-includes that document.
- Show retrieved chunks and their scores in the prompt inspector.

### Layer 3 — Narrative memory (optional, off by default)

Entity- and relationship-aware memory, modeled on Lumiverse's Memory Cortex.
Only build this after 1 and 2 are solid.

- A background task extracts entities (people, places, objects, events, facts)
  and relations from recent history, using a small model at low temperature.
- Each carries a **salience** score derived from emotional weight, narrative
  significance, and information density. High salience resists decay; low
  salience ages out.
- Retrieval blends semantic similarity with salience, not similarity alone.
- **User edits are sticky** — an entity marked `user_edited` is never
  overwritten by extraction.
- Full retrieval trace in the inspector: what was recalled, its score, why.
- Runs entirely off the main generation thread.

### Author memory (optional)

Off by default, enabled per author via `memory_enabled`. Implemented as a
lorebook with `owner_author_id` set, so it reuses keyword activation, budgeting,
and the editor.

- The author writes entries via a background task, prompted at scene end or on
  request ("remember this").
- Covers shared history across scenes: unresolved threads, what the user tends
  to enjoy, recurring characters.
- Every entry visible and editable, with provenance showing the author wrote it.
- Hard token cap, separate budget, one-click wipe.

Keep it strictly opt-in. An author that silently accumulates notes about the
user is a different product with different expectations.

### What not to claim

Do not describe any of this as "infinite memory." Vector retrieval is
unreliable for narrative continuity — it surfaces relevant fragments but cannot
maintain a coherent picture of how a story developed. Summaries lose detail and
occasionally hallucinate. Manually curated lore remains the most reliable and
most laborious option. The product's honest pitch is that memory is visible,
inspectable, and editable, not that it is solved.

---

## 12. Expressions and visual novel mode

Every mature frontend has this, and it matters more for a group product than a
single-character one — seeing who is on stage is how a reader tracks a scene.

### Expression classification

- SillyTavern classifies with a local ONNX model (`distilbert-base-uncased-go-
  emotions-onnx`) producing the 28 GoEmotions labels.
- **You have a cheaper option:** in author mode the author already knows who is
  emoting and how. Have it declare the expression inline in a tagged block
  (`<expr>ana:worried</expr>`), parse and strip it, and store it on the message.
  Zero extra inference, better accuracy than a text classifier.
- Fall back to a classifier background task when the author omits the tag or
  when running in single-character mode.

### Sprite packs

- Per-character `ExpressionPack` with labeled images; support numeric variants
  (`joy-1`) and named costume overrides.
- Support the 28 GoEmotions labels as the canonical set; allow custom labels.
- Import expression images from CharX bundles.
- Graceful fallback: unknown label → neutral → avatar.

### Visual novel mode

- Multi-sprite staging with the cast positioned across the viewport, spotlighted
  character emphasized, and inactive members dimmed.
- Scene background image, settable per scene.
- On mobile: sprites occupy the upper portion, chat scrolls below. Must degrade
  to normal chat with a toggle, and must not hurt scroll performance.

---

## 13. Sampler and reasoning settings

### Ship modern defaults, not 2023 defaults

High repetition penalty plus low temperature actively degrades current models.
Default preset:

| Setting | Default |
| --- | --- |
| Temperature | 1.0 |
| Min-P | 0.05 |
| Repetition penalty | 1.0 (off) |
| DRY multiplier / base / allowed length | 0.8 / 1.75 / 2 |
| DRY sequence breakers | `\n`, `:`, `"`, `*` |
| XTC threshold / probability | 0.1 / 0.5 |
| Top-P, Top-K | disabled |

**DRY** penalizes tokens that would extend a previously-seen sequence — the
modern anti-repetition tool, far better than rep-pen for roleplay. **XTC**
removes the most-likely tokens while keeping at least one viable choice above a
threshold, which raises creativity. Note SillyTavern ships DRY off (multiplier
0); the values above are the sampler author's recommendation and what community
presets actually use.

Sampler **order** matters and differs per backend. Expose it only in advanced
settings, and warn on reorder.

Support grammars / constrained decoding where the backend offers it.

### 13.5 Prompt option groups

The best preset suites are not one long system prompt. They are libraries of
small toggleable blocks, with certain groups mutually exclusive — pick one POV,
one prose structure, one length rule, one reasoning depth. Celia carries roughly
thirty-five state variables to coordinate this; it works, but it is prompt
engineering standing in for a data model.

Model it natively instead. An **option group** is a named set of blocks with a
cardinality (`one_of` or `any_of`), each block compiling to a prompt fragment
placed at a declared position and depth.

```
OptionGroup: id, name, cardinality, description
Option: id, group_id, name, fragment, position, depth, role, sort_order
SceneOptions: scene_id, option_id
```

Ship these groups:

| Group | Cardinality | Options |
| --- | --- | --- |
| **POV** | one_of | first, second, third limited, third omniscient |
| **Prose structure** | one_of | flowing prose, screenplay, web-novel chapter, minimal |
| **Length** | one_of | a hard word range, adaptive, scene-driven adaptive |
| **Reasoning depth** | one_of | none, brief plan, full per-character planning |
| **Content rating** | one_of | project-defined |
| **Mode** | one_of | immersive prose, chat/messaging, tabletop, visual novel, co-writing |
| **Prose discipline** | any_of | the anti-pattern rules below |

Every option is visible in the prompt inspector as a labeled block with a token
cost, which is strictly better than a wall of toggles whose effect you can't see.
Ship a sensible default configuration rather than shipping everything off — a
preset that arrives entirely disabled is a bad first run.

### 13.6 Anti-slop

Every serious preset suite carries a banned-construction list, because models
converge on the same handful of tics. Make it structured rather than prose.

- A **ban list** of phrases and constructions, stored as data, enforced through
  the prompt and — where the provider supports it — through logit bias.
- Ship a starter list covering the well-known offenders: "not X, but Y"
  constructions, "the air hung heavy," scene-cutting transitions like
  "meanwhile, elsewhere," and reflexive pathetic fallacy.
- **Auto-analyze** as a background task: read the last N messages, find the
  phrases this scene keeps reaching for, propose them as bans. Recurrence is
  measurable, so measure it rather than guessing.
- Per-scene and global lists, importable and exportable.
- An **anti-echo rule** as a separate option: do not reuse phrasing or structure
  from the previous turn.

Anti-slop is a prose-discipline option group member, a sampler concern (DRY),
and a post-pass (§7.5). Use all three; they catch different things.

### Reasoning blocks

- Parse reasoning blocks out of the response into `Message.reasoning`, hidden
  from prose by default and rendered as a collapsible section.
- **Do not feed reasoning back into multi-turn context by default** — most
  providers advise against it. Make re-injection of the last N blocks an opt-in
  with configurable prefix/suffix.
- Community roleplay presets use an "analysis block" pattern (a short structured
  think-step before prose) specifically to fight repetition. Ship one as an
  optional preset.

### Prefill

Prefill — seeding the start of the assistant turn — is a core technique for
enforcing format and character consistency, particularly on Anthropic models.
Treat it as a capability flag, and note it is incompatible with extended
thinking on Anthropic.

---

## 14. Regex and automation

Users build the long tail of features themselves. If you give them nothing, they
will hit walls you never anticipated. Minimum viable substrate:

### Regex scripts

- Find/replace with named capture groups and macro resolution in the
  replacement.
- Apply stages: user input, AI output, display only, or prompt-time.
- Scope: global, per-character, per-scene.
- Ordered execution, individually toggleable, with a test panel.
- Common uses: trimming incomplete trailing sentences, stripping unwanted
  formatting, styling names, extracting custom tagged blocks.

### Event triggers

Named actions bound to events: scene start, before generation, after generation,
on user message, on lore entry activation (via `automation_id`). An action can
run a background task, refresh a guide or tracker, or fire a regex pass.

A full scripting language is explicitly out of scope for v1. Regex plus event
triggers covers most of what SillyTavern users write STscript for.

---

## 15. Extensibility

Most extensions in other frontends exist to work around a missing feature. This
spec absorbs those features natively, which shrinks what an extension system
needs to do — and code execution is the expensive, irreversible part. So
extensibility is tiered, and only the third tier runs code.

### Tier 1 — configuration

Already specified elsewhere, and collectively this is what most people want
extensions for:

- Background tasks (§7) — a stored prompt, trigger, connection profile, and
  output destination. A "stepped thinking" or "auto-tracker" extension is a
  background task.
- Post-generation passes (§7.5).
- Prompt option groups and ban lists (§13.5, §13.6).
- Persistent guides and trackers (§8).
- Regex scripts and event triggers (§14).
- Lorebook entries with automation IDs (§10).

All of it is data. All of it exports as JSON and imports from a file or URL.

### Tier 2 — packs

A shareable archive bundling tier-1 artifacts with content:

```
pack.json          -- manifest: name, version, author, description, host_api_range
/characters/       -- cards
/lorebooks/
/presets/
/authors/          -- author personas
/tasks/            -- background tasks and post-passes
/options/          -- prompt option groups
/regex/
/banlists/
/assets/           -- avatars, sprites, backgrounds
```

Installing a pack imports records; nothing executes. Installation is
transactional, previewable (show what will be added or overwritten), and
reversible — record which pack owns which rows so uninstall is exact.

This is how a full "engine" suite should ship here. The comparable suites in
other ecosystems need an extension mainly because there is no declarative way to
express their configuration. There is one here.

### Tier 3 — code extensions

Deferred. Only justified for capability that cannot be expressed as data:

- A new provider adapter.
- An external service integration (TTS, image generation, a game engine).
- A UI surface that no existing slot accommodates.

**Do not design this API speculatively.** Wait until there is a concrete
extension that tiers 1 and 2 genuinely cannot express. An extension API published
early gets frozen in the wrong shape, and compatibility promises are hard to
withdraw.

When it is built, these constraints are not negotiable:

- **Server extensions run in a Bun Worker** with permission-gated RPC. No
  ambient filesystem access. Network restricted to a domain allowlist declared
  in the manifest and approved at install.
- **Extensions never see provider credentials.** They request generation through
  the generation service by connection-profile name. Keys stay server-side. This
  is the difference between an extension that can misbehave and one that can
  exfiltrate the user's API keys.
- **Permissions are declared and granted individually**: `read:scenes`,
  `write:messages`, `read:characters`, `write:characters`, `read:lore`,
  `write:lore`, `generate`, `storage`, `network:<domain>`, `ui:<slot>`.
  Privileged permissions require explicit confirmation with a plain-language
  explanation of what is being granted.
- **Chat-screen UI is declarative.** Extensions describe their surface as JSON
  and the host renders it with its own components. Named slots: message action
  (in the long-press sheet), composer button, message annotation, scene-setup
  section, settings page. Arbitrary DOM injection is how other frontends' UIs
  became cluttered, and on a 390px screen it is fatal.
- **Full-page panels may use an iframe** with a postMessage bridge, since they
  own their whole viewport and can't break the chat layout.
- **Failure is isolated.** Every extension call has a timeout. A crashed, hung,
  or slow extension never blocks or fails a user-facing generation — the same
  rule that governs background tasks.
- **Versioned host API.** The manifest declares a compatible range; refuse to
  load outside it rather than failing mysteriously.
- Installing a code extension means running third-party code. Say so plainly at
  install time.

### The out-of-process escape hatch

Before reaching for tier 3, prefer integration that runs outside the app
entirely. Two mechanisms cover a surprising amount:

- **The outbound OpenAI-compatible API** (§19) lets external programs drive
  scenes as a client.
- **Outbound webhooks** — subscribe a URL to scene events (message created,
  generation complete, beat parsed, tracker updated, lore entry activated), with
  a signed payload. Combined with the existing REST API, this is enough to build
  a Discord bridge, a stream overlay, or custom automation without any code
  running inside the app.

Out-of-process integration is strictly safer than an in-process plugin and
requires no sandbox. Build webhooks early; they may remove the need for tier 3
entirely.

---

## 16. UI surfaces

Mobile-first. Design at 390px and scale up; desktop is the same components with
a persistent sidebar. Default view stays clean — depth behind an advanced
toggle.

### Chat screen

- Message list, virtualized, with avatars and speaker names.
- Optional VN sprite stage above the log.
- OOC messages in a distinct style, attributed to the author.
- Reasoning blocks collapsed by default.
- Sticky composer above the keyboard.
- **Director bar**: cast chips (tap to make that character speak next), autopilot
  toggle, steer indicator, active-guides indicator with token cost.
- **Op buttons** beside send, user-configurable: nudge, guided swipe,
  impersonate, guides menu, tools menu, simple send.
- Message gestures: swipe left to reroll, swipe right for the swipe carousel,
  long-press for the action sheet (edit, continue, expand, corrections, branch,
  checkpoint, hide, delete, copy).
- Swipe counter on messages with siblings.
- Streaming indicator naming the speaking character; prominent stop button.
- Per-message generation stats (model, TTFT, tokens/sec) behind a tap.

### Other screens

- **Scenes list** — recent first, cast avatars, last message preview.
- **Scene setup** — author, cast, persona, connection profile, preset, scenario
  override, turn strategy, lorebooks, guides, trackers, OOC, VN toggle.
- **Author editor** — personality, writing style, directing style, OOC voice,
  boundaries, memory toggle. Presented as a card.
- **Character library** — grid, search, tag filter, import (file, folder, URL).
- **Character editor** — all fields, voice notes, depth prompt, token costs,
  expression pack, avatar crop.
- **Lorebook editor** — entry list, key editor, timed effects, inclusion groups,
  character filter, and an activation test tool that shows what would fire
  against the current scene.
- **Data bank** — document list, scope, chunk preview, retrieval test.
- **Memory panel** — summaries (editable), entities and relations with salience,
  retrieval trace, wipe controls.
- **Preset editor** — samplers with modern defaults, drag-to-reorder prompt
  blocks, reasoning config.
- **Connection profiles** — provider, model, templates, test button, capability
  display.
- **Op settings** — per-op profile, prompt template, injection role,
  auto-trigger, visibility.
- **Prompt inspector** — the exact assembled prompt for the last generation,
  block by block, with token costs, **what was evicted**, retrieved chunks and
  scores, and which lore entries fired and why. Reachable from any message.

### Mobile web specifics

- `100dvh`, never `100vh`.
- `visualViewport` listeners to keep the composer above the iOS keyboard.
- `env(safe-area-inset-bottom)` padding on the composer.
- Touch gestures must not fight the scroll container — use a gesture library
  with direction locking.
- Web manifest plus a service worker caching the app shell only. No offline
  chat sync.
- No hover-dependent affordances anywhere.
- Virtualized lists everywhere; cached parsed cards; lazy sprite loading.

---

## 17. Auth and deployment

- Single-user password auth with a signed, long-lived session cookie. HTTP-only,
  SameSite=Lax.
- Setup wizard on first boot: password, first connection profile.
- API keys encrypted at rest. Never returned to the client — masked.
- Document the recommended deployment as behind Tailscale or a Cloudflare
  Tunnel, with the password as defense in depth.
- Rate-limit auth attempts.
- Dockerfile plus plain `bun run` instructions.
- Data directory configurable via env: SQLite DB, avatars, sprites, uploads,
  vector index.

---

## 18. Preset and suite interop

Users arrive with preset suites they already depend on. Importing them is how
this product gets used at all, and the format is not forgiving.

### What a SillyTavern chat-completion preset contains

Sampler fields plus a `prompts[]` array managed by the Prompt Manager. Each
entry has:

```
identifier          -- uuid, or a reserved marker name
name, role          -- system | user | assistant
content
system_prompt       -- bool
marker              -- bool; structural insert with no editable content
enabled             -- bool
injection_position  -- 0 = relative (Prompt Manager order), 1 = absolute in-chat
injection_depth
injection_order
forbid_overrides
```

Reserved marker identifiers include `main`, `jailbreak`, `chatHistory`,
`charDescription`, `personaDescription`, `scenario`, `dialogueExamples`,
`worldInfoBefore`, `worldInfoAfter`. Order in the array is order in context —
top is earliest, bottom is nearest the model's response.

### Import requirements

These are the things that break naive importers. Handle all of them:

- **Honor `enabled`.** Major suites ship with most blocks disabled by default;
  an importer that ignores the flag produces a prompt several times larger than
  intended.
- **Understand markers.** A suite may rename core markers to a placeholder and
  empty their content, deliberately overriding where card fields land. Import
  that as an override, not as content to inject — otherwise the character
  definition appears twice.
- **Preserve `injection_position`, `injection_depth`, `injection_order`.**
  Near-turn nudges at depth 0–1 behave completely differently from relative
  blocks, and suites depend on that distinction.
- **Implement the macro engine** — `{{setvar}}` / `{{getvar}}`, `{{roll}}`,
  conditionals — or degrade visibly. Suites carry state across blocks in
  variables; unresolved macros leak literal text into the prompt.
- **Detect chat-completion versus text-completion presets** and refuse the
  mismatch clearly. Context and instruct templates mean nothing in chat
  completion mode, and vice versa.
- **Import as option groups where possible.** A suite's mutually-exclusive
  blocks map onto §13.5. A best-effort mapping with an editable result beats a
  flat wall of toggles.
- **Report what was imported** — a summary of blocks, their positions, and
  anything not understood. Silent partial imports are the worst outcome.

### Interop with extension-dependent suites

Some suites are an extension plus a preset, where the preset alone is inert and
the extension expects a companion file with an exact name. Detect this and say
so at import rather than producing something that looks fine and behaves wrongly.
Where the extension's behavior is one of your native subsystems — memory tiers,
NPC dossiers, banned phrases, staged reasoning — offer to map it to the native
feature instead of trying to emulate the extension.

### Export

Export presets and scenes in your own format, and offer a lossy SillyTavern
chat-completion export with a clear list of what didn't survive. Don't pretend
round-tripping is clean when it isn't.

---

## 19. Outbound OpenAI-compatible API

The app exposes its own OpenAI-compatible endpoint so other clients — a
terminal, a bot, an editor plugin, another frontend — can use a configured scene
as if it were a model. The server runs the full pipeline (author, cast,
spotlight selection, lore, guides, trackers, summaries, memory) and returns the
character's reply. This turns the prompt builder into a service rather than a UI
feature.

### Endpoints

```
GET  /v1/models
POST /v1/chat/completions
POST /v1/completions        -- optional, text mode
```

Standard shapes, standard SSE streaming format (`data: {chunk}` with
`choices[0].delta.content`, terminated by `data: [DONE]`). Support `stream`,
`max_tokens`, `temperature`, and `stop`; ignore unsupported params rather than
erroring.

### Model naming

`/v1/models` enumerates addressable targets:

| Model ID | Behavior |
| --- | --- |
| `scene/<slug>` | Run that scene. Spotlight chosen by the scene's turn director. |
| `scene/<slug>/<character>` | Run that scene, forcing a specific speaker. |
| `author/<slug>` | Stateless: apply the author persona to whatever history the client sends. No scene, no stored state. |
| `passthrough/<profile>` | Raw proxy to a connection profile, no prompt assembly. |

### History reconciliation

The core impedance mismatch: chat completions is stateless and the client sends
full history; your app owns an authoritative history tree. Configurable per
scene, default first:

- **`last_message`** (default) — take only the final user message from the
  incoming array, ignore the rest, use stored history. Works with any client,
  keeps the tree canonical.
- **`sync`** — diff the incoming array against stored history; treat truncation
  as a rewind to that point, append anything new. Better with smart clients,
  more failure modes.
- **`stateless`** — the incoming array is the entire history. Apply author and
  cast, persist nothing. For bots and one-off calls; the only mode that works
  for `author/<slug>`.

### Double-assembly protection

Other roleplay frontends will build their own prompt before calling you —
character card, lorebook, jailbreak — producing a prompt with two conflicting
character definitions.

- Document clearly that clients should send a minimal or empty system prompt.
- Detect a system message that looks like an assembled character card (name
  headers, `{{char}}` residue, example-dialogue markers) and either strip it or
  return a warning header (`X-Roleplay-Warning: client-assembled-prompt`).
- Log the incoming system prompt in the prompt inspector so the conflict is
  visible rather than mysterious.

### Guided ops over the wire

External clients have no director bar. Expose the ops as inline commands parsed
out of the incoming user message:

```
((nudge: she's getting suspicious))     -- one-shot nudge
((steer: slow the pacing))              -- set director note
((clear steer))
((as: ana))                             -- force spotlight
((ooc: how much time has passed?))      -- OOC message to the author
((continue)) / ((swipe))
```

Commands are stripped from the message before it enters history. Use a
double-paren convention since single-slash prefixes collide with client-side
slash commands in most frontends.

### Auth and safety

- Bearer tokens, separate from the session cookie. Generate per-client keys with
  names and revocation, scoped to specific scenes where useful.
- The endpoint is machine-accessible, so rate-limit per key and log usage.
- Never expose upstream provider keys through `passthrough` responses.
- Off by default. Enable per-scene, explicitly.

### Interaction with the tree

Generations initiated over the API create normal message nodes and stream over
the same generation service, so a scene open in the web UI updates live via the
multi-device head sync (§5). This is the payoff: start a scene on your phone,
continue it from a terminal, and both stay in sync.

---

## 20. Build order

Each phase ends in a working, usable application.

**Foundation**
1. Bun + Hono server, SQLite schema, migrations, static SPA serving, auth,
   setup wizard.
2. History tree — store, active path, branching, swipe/edit/delete, checkpoints.
   API first, tested, before any UI.
3. Prompt builder — both rendering modes, budget allocation with eviction
   reporting, macros, debug output. Heavy unit tests. No provider yet.
4. First adapter + generation service — OpenAI-compatible, resumable SSE,
   cancellation, per-call profile override.
5. Minimum usable chat UI — single character, streaming, swipe, edit. **Ship
   this and use it daily.**

**Core product**
6. Character cards — lossless import/export, PNG V2/V3, CharX, CCv3 decorators,
   editor, parsed-card cache.
7. Author personas — entity, editor, author-mode rendering. The defining
   feature; do it before group complexity accumulates.
8. Group scenes — cast, spotlight, voice notes, depth prompts, presence
   tracking, turn director (manual + round robin).
9. **Beats** — multi-character turns, segment parsing, recast segment, split
   beat. The other headline differentiator; nobody does this natively.
10. **Classifier turn director**, including deciding beat versus spotlight.
11. Background-task primitive — the shared mechanism for every side call.
12. Core guided ops — nudge, guided swipe, steer, continue, expand, corrections,
    simple send, impersonate.
13. Per-op configuration and connection profiles.
14. **Post-generation pipeline** — voice validation first; it is the fix for the
    main risk beats introduce.
15. Persistent guides — all six, edit/show/flush, auto-trigger.
16. Rolling summarization with threshold, eviction, and cache freeze.
17. Modern sampler defaults, DRY/XTC, reasoning extraction, prefill.
18. **Prompt option groups** and the ban list.

**Depth**
19. Lorebooks — full activation model, timed effects, inclusion groups,
    character filters, recursion levels, outlets.
20. Remaining adapters — Anthropic, text completion with instruct templates.
21. OOC channel — parsing, rendering, user OOC replies.
22. Autopilot.
23. Prompt inspector, with eviction and activation traces.
24. **Character library at scale** — search, tags, bulk ops, versioning, derive.
25. **AI-assisted authoring** — create/revise/extract character, suggest lore,
    auto-tagging. All background tasks; cheap once the primitive exists.
26. **Preset import** — SillyTavern chat-completion presets, mapped onto option
    groups, with an import report.
27. Expressions — author-declared tags, sprite packs, VN mode.
28. Document RAG / data bank.
29. Structured trackers with the panel UI.
30. Character dossiers for emergent NPCs.
31. Regex scripts and event triggers.
32. **Packs** — export/import bundles, transactional install, ownership
    tracking for clean uninstall.
33. **Outbound webhooks** — signed event subscriptions.
34. Multi-device head sync, background indicators.
41. Outbound OpenAI-compatible API — `last_message` mode, scene models, inline
    ops, bearer keys. Depends on the head sync being in place.

**Later**
40. Narrative memory (entities, relations, salience) — only after summarization
    and RAG are proven.
41. Author memory.
40. Optional tabletop module — dice, skill checks, stat and inventory tracking
    as user-defined state schemas. Deterministic rolls happen server-side, never
    in the model.
41. TTS, image generation, captioning.
40. Chub import, community asset browsing.
41. Polish — mention strategy, group greetings, bulk import, PWA.

---

## 21. Explicit non-goals

Not in scope. Each can be added later without rewriting anything above.

- **A code-executing extension runtime.** Tiers 1 and 2 in §15 cover this
  without running third-party code. See that section for when tier 3 becomes
  justified and what it must look like.
- Multi-user accounts and shared-server play (Agnai's niche).
- A scripting language beyond regex + event triggers.
- Native mobile apps.
- Character marketplace.
- Real-time collaboration.

---

## 22. Deliberate anti-patterns

Things existing frontends do that this project should not.

- **Don't ship 2023 sampler defaults.** High rep-pen and low temperature damage
  modern models. See §13.
- **Don't add an independent-agent group mode.** It causes speaker-selection
  lotteries, characters speaking for each other, and merged personalities.
  SillyTavern's own docs warn that its "join character cards" mode produces
  "characters being confused about themselves, having merged personalities."
  The author model exists precisely to avoid this.
- **Don't swap the system prompt per speaker.** It breaks prompt caching for no
  benefit under the author model.
- **Don't build a dense settings surface.** The top complaint about the category
  leader. Progressive disclosure, always.
- **Don't feed chain-of-thought back multi-turn by default.**
- **Don't oversell memory.** See §11.
- **Don't parse character cards lossily.** Preserve `raw_card`.
- **Don't let background tasks block generation.** Every side call is
  best-effort.
- **Don't let a beat be several agents sharing a turn.** A beat is one author
  writing an exchange. The moment it becomes multiple independent generations
  stitched together, every group failure mode returns.
- **Don't ship a preset with everything switched off.** Major suites do this and
  a first run looks broken. Ship a working default configuration.
- **Don't roll dice in the model.** If the tabletop module happens, randomness is
  server-side and deterministic; the model narrates the result.
- **Don't trust models to emit valid structured output.** Every background task
  that produces a record validates server-side against a schema and retries or
  fails visibly. Malformed XML is the top complaint about the tools that do this
  today.
- **Don't measure chunk sizes in characters** while budgets are in tokens.

---

## 23. Testing requirements

- Prompt builder: full unit coverage — both rendering modes, budget trimming and
  eviction reporting, every macro, outlet resolution, capability branching.
- History tree: branch, swipe, edit-in-place, rewind, checkpoint restore.
- Lorebook activation: a fixture suite covering secondary-key logic, inclusion
  group selection under each mode, recursion levels, and each timed effect
  including branch inheritance and edit-clears-effect.
- Card import: round-trip fixtures for V2 PNG, V3 PNG, CharX, and a card with
  unknown extension fields — assert byte-level preservation of `raw_card`.
- Adapters: recorded fixtures, not live APIs. Abort propagation explicitly
  tested for the text-completion adapter.
- Beat parsing: fixture suite of multi-speaker outputs including malformed
  labels, unlabeled narration, a speaker not in the cast, and nested quotes.
  Assert graceful degradation and that no text is ever lost. Round-trip a
  segment edit back into canonical content and re-parse to the same segments.
- Preset import: fixtures for an all-disabled suite, a marker-override suite, and
  a text-completion master. Assert enabled flags, injection depths, and marker
  overrides are honored, and that the import report names what wasn't understood.
- Pack install: assert transactional rollback on a malformed pack, and that
  uninstall removes exactly what install added and nothing else.
- End-to-end: create scene, add author and two characters, generate a beat,
  recast one segment, swipe, branch, checkpoint, confirm active path.

---

## 24. Open decisions

- Tokenizer strategy: **architecture settled, choice still open.** The builder
  takes a `Tokenizer` — `{ id, isEstimate, count }` — so either answer plugs in.
  The shipped fallback estimates at 3.6 characters per token, which deliberately
  over-counts (an underestimate overflows the context; an overestimate costs a
  little headroom) and flags itself as an estimate all the way to the inspector.
  Whether to also bundle real per-family tokenizers is a size-versus-accuracy
  decision that can be made per adapter.
- Vector store: **investigated, not yet decided.** `sqlite-vec` 0.1.9 satisfies
  the literal constraint — its platform builds are `optionalDependencies`
  carrying a prebuilt `vec0.so`/`.dylib`/`.dll`, it declares no install scripts,
  so `bun install` runs with no compile step, and it loads and answers KNN
  queries under `bun:sqlite`. It is not, however, *pure Bun*: it is a native
  loadable extension, which means (a) the platform matrix is whatever upstream
  publishes, and (b) `bun build --compile` does not embed it — the standalone
  binary would have to carry the shared object as an embedded file asset and
  write it out before `loadExtension`. The alternative, a JSON flat index, is
  pure JS and trivially portable but linear in the number of chunks. Decide when
  phase 28 (document RAG) arrives, since nothing before it needs vectors.
- Can the author narrate scene description directly, or is a narrator
  pseudo-character needed? Author-narrates is simpler and probably right.
- Should timed-effect delay measure from scene start or from branch point?
  Offering both is cheap; pick a default.
- Does presence tracking need an explicit exit point per character, or is
  "present from first_seen onward" sufficient?
- Should beats be the default turn type, with spotlight as the exception? Group
  scenes probably want beats most of the time; single-character scenes never do.
- Does a beat swipe reroll the whole exchange, or should swipe be disabled on
  beats in favor of recast-per-segment?
- Should dossiers be a distinct entity, or just characters with a `provisional`
  flag? The latter is simpler and probably right.
- Do packs need dependency declarations (this pack expects that lorebook), or is
  a flat bundle enough? Flat is enough until it isn't.

Resolved: cross-scene author memory is optional, off by default, implemented as
an author-scoped lorebook (§11). Not part of the initial build.
