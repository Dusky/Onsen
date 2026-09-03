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
folder            -- loose grouping label, not a tree (§9)
parent_character_id -- set when this card is a derived variant (§9)
source_filename, source_hash  -- parsed-card cache and duplicate detection
raw_card           -- the complete original card JSON, preserved verbatim
raw_card_format    -- how it arrived: png_v2 | png_v3 | json | charx | native
extensions         -- JSON blob
```

Expressions do not hang off the character row: `expression_packs.character_id`
is the link, one pack per character (§12).

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
director_profile_id -- where the classifier runs; null = scene's own profile
director_note      -- persistent steer, nullable
turn_strategy      -- enum: manual | round_robin | mention | classifier
custom_guide_prompt -- the custom guide's own question (§8)
auto_passes        -- run the post-generation pipeline unasked (§7.5)
summarise, summarise_every_messages, summarise_every_words,
summarise_threshold, summarise_evict, summarise_freeze   -- §11's knobs
scenario_override
autopilot_enabled, autopilot_max_turns
ooc_enabled, ooc_interval
vn_mode_enabled    -- visual novel staging
background_path    -- the VN background, served from the data dir
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
parse_degraded     -- a beat whose speaker labels could not be read (§3.5)
passes_pending     -- the post-generation pipeline is still working (§7.5)
```

### MessageSegment

A beat is one generation containing several speakers. The raw text stays
canonical on the message; segments are the parsed view used for rendering,
per-character editing, and expression attribution.

```
id, message_id, ordinal
speaker_type       -- character | narration
character_id       -- nullable
speaker_label      -- the name as written; nullable
content
expression         -- nullable
char_start, char_end   -- offsets into the parent message content
```

A spotlight message has exactly one segment. A beat has several. Re-parsing is
idempotent: edit the canonical content and segments are rebuilt; edit a segment
and the canonical content is spliced at its offsets.

Settled while building phase 9:

- **`speaker_label` is stored** as well as `character_id`. A strictly labelled
  speaker who is not in the cast — a character written in, or one written out
  mid-scene — resolves to no id, and without the label their name is lost.
  Rendering the resolved name would also mean a character lookup per segment.
- **Rows exist for beats only.** A spotlight message's single segment is its own
  content, so storing it would be a copy to keep in step for no reader; the read
  path derives it, and callers still see one uniform shape.
- **The offsets cover the prose, not the label.** Replacing `[char_start,
  char_end)` is what recast does; keeping the label outside the range is what
  makes the splice re-parse to the same segmentation.

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
similarity, not keywords. Built as a flat index — vectors are JSON text on the
chunk, cosine runs in the process (§11).

```
Document: id, scene_id (null = global), title, created_at, updated_at
DocumentChunk: id, document_id, ordinal, text, vector (JSON, nullable), created_at
```

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
id, scene_id, parent_id, target_message_id, status, buffer, offset,
prompt_debug, started_at, finished_at, error
```

`prompt_debug` is the built prompt's debug record, written at build time so a
cancelled or failed generation is as inspectable as a finished one (§16).

### RegexScript

```
id, name, pattern, replacement, flags, enabled
apply_to           -- user_input | ai_output | display_only | prompt
scope              -- global | character | scene
character_id, scene_id, run_order
```

Built in phase 33. `scope_id` above was one polymorphic column; it is two typed,
foreign-keyed ones, because a `scope_id` naming a character in one row and a
scene in the next cannot carry a foreign key — and a deleted character would
leave a script scoped to nothing and still running.

### EventTrigger

```
id, name, enabled, run_order
event              -- scene_start | user_message | before_generation
                   -- | after_generation | lore_activation
action             -- guide | tracker | script
action_ref         -- a guide kind, a tracker kind, or a script id
automation_id      -- lore_activation only; §10's other end
scope              -- global | scene
scene_id
```

### Reconciled against migrations 0001–0026

Settled while building phase 31, the way phase 20 settled the schema against
§2. Two rules govern the sections above: they describe what *exists* where they
are filled in, and they describe the *target* where they are not. This block
records the gaps in both directions so a later reader is not misled either way.

**Tables that exist and are not drawn above.** They are real and load-bearing,
and §2 omits them only because their phases wrote the columns with the feature:

- `tasks` / `task_runs` — §7's op config and the run log.
- `option_groups` / `options` / `scene_options` — §13.5's prompt option system.
- `ban_phrases` — §13.6.
- `guides` — §8's persistent guides, versioned per message.
- `trackers` — §8's structured trackers, versioned per message.
- `message_annotations` — §7.5's pass findings.
- `instruct_templates` — §4's text-completion markers.
- `character_versions` — §9's snapshots; `saved_filters` — §9's filters.
- `embeddings_config` — §11's single-row embeddings provider.
- `app_settings` — the setup-wizard's single row.

**Entities above that are not built yet**, and are here as the target: MemoryEntity
/ MemoryRelation (§11 narrative memory, phase 38–39),
SceneMember `overrides` and `first_seen_message_id` (presence tracking),
Persona's `lorebook_id` (flagged `[gap]`), Provider's `capabilities` JSON (it is
computed from the adapter, not stored), and ConnectionProfile's
`context_template_id`.

**Divergences where reality is simpler than the sketch, deliberately:**

- **Document / DocumentChunk.** Built as `documents (id, ulid, scene_id null =
  global, title, timestamps)` and `document_chunks (id, document_id, ordinal,
  text, vector JSON, timestamps)` — no `scope/scope_id` (a global document
  *is* `scene_id IS NULL`), no `slug`, no `source`, and no `embedding` blob
  (the flat index stores vectors as JSON text, §11/phase 30).
- **Character.expression_pack_id is not a column.** The link runs the other
  way: `expression_packs.character_id` is unique, one pack per character.
- **Preset.prompt_order / system_prompt / jailbreak exist** as columns (§18's
  marker import writes them), even though the sketch lists them without comment.

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
- **`loreTrace?: ActivationTrace[]`** — settled while building phase 25. The
  full lore activation trace, computed by the I/O layer and handed in for the
  builder to copy into the debug output verbatim. It is an injected input for
  the same reason `now` is: the trace is seeded per generation, and a builder
  that recomputed it would be a second implementation that could disagree with
  the one that chose the lore.

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

### An unnamed persona

Settled while building phase 7. `PromptPersona.name` is nullable: a user who has
not said who they are is a real state, not a missing value, and it cannot be
papered over with a stand-in name. The user-lock is phrased in terms of that
name, so a placeholder like "You" turns the most important sentence in the
system prompt into "You belongs to the reader" and the depth-0 restatement into
"Do not write You's dialogue".

With no name, the lock is phrased around the reader instead, the persona block
is omitted entirely when there is also no description, `{{user}}` resolves to
"the reader", and the transcript labels the reader's turns "Reader" so the
document stays consistent.

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

**Settled while building phase 9.**

- **Who is in a beat: every active cast member.** Benched members are not, and a
  cast with fewer than two active members degrades to a spotlight rather than
  instructing the author to stage a conversation alone. Whoever the turn
  director picked *opens* the beat rather than being its only voice, so a cue is
  still meaningful in a beat — it chooses who starts.
- **A beat's participants each get a full definition, voice notes included.**
  Everyone else in the scene stays in the compact cast block. §3's rule that
  voice notes go to the spotlighted character alone generalises to "the
  characters this turn is writing", which is what it was protecting.
- **Spotlight, beat and recast share one near-turn instruction slot** rather than
  each adding a block to the assembly order. They are the same thing — the last
  word before the model writes — and a preset reordering the assembly should not
  have to know which of the three a given turn is. The inspector labels them
  apart.
- **Recast edits the beat; it does not fork it.** Correcting one character's
  part is a correction to that beat, and swiping is what makes a sibling. A
  recast therefore generates from the beat's own parent, with the beat itself
  supplied as context in the instruction.
- **Split beat branches rather than converts.** The new messages are a chain
  under the beat's *parent*, which makes them a sibling branch of it: the beat
  survives and can be swiped back to, exactly as every other tree operation
  preserves what it moves away from (§2).
- **Parsing accepts three label forms**, not one: `**Name:**` as specified,
  `**Name**:` because models put the colon outside the bold constantly, and a
  bare `Name:` *only* when the name is in the cast — without that restriction
  every line of dialogue containing a colon would start a segment. A strict bold
  label is authoritative even for a name the cast does not contain.

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

Note: prefill and extended thinking were mutually exclusive on Anthropic, and
this is now stronger than that — see phase 22 below. Either way the capability
flags must express it rather than just listing both.

### Required adapters for v1

- **OpenAI-compatible** — OpenAI, OpenRouter, most local OpenAI shims.
- **Anthropic** — separate system param, strict alternation, required
  `max_tokens`, and prefill only on models old enough to still take one.
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

### Settled while building phase 22

- **Capabilities are not always a constant.** Anthropic removed `temperature`,
  `top_p` and `top_k` from its 4.6 generation onward, and removed assistant
  prefill with them. Sending either to a current model is a 400, not a politely
  ignored field. So what that endpoint accepts depends on which model is behind
  it, `capabilitiesFor` takes an optional model, and on a current Claude §13's
  sampler list is empty — an editor showing nothing is the correct result, not a
  bug. This supersedes the older note above: prefill is not merely exclusive
  with thinking there, it is gone.
- **An unknown model takes the narrower contract.** A proxy's own naming, or a
  model released after this was written, is read as current. The two failure
  directions are not symmetric: sending a sampler a model rejects fails the
  whole generation, while not sending one costs a knob and still writes the
  turn. `providers.supports_prefill` is the operator's escape hatch.
- **`max_tokens` is required on Anthropic and there is no "unlimited".** The
  builder's own `reservedForResponse` is the honest number, because it is what
  the prompt was fitted around; a floor applies only to the side calls that
  reserve nothing. Asking for more than was reserved would overflow a window the
  builder already reported as fitting.
- **Instruct templates are rendered by the builder, not the adapter.** On a long
  scene the turn markers are hundreds of tokens. A wrapper applied after the
  budget was struck overflows the context window, and the symptom is a truncated
  prompt with a passing budget calculation.
- **The template is a property of the provider.** It describes the weights
  behind the endpoint, so every scene routed there wants the same answer. The
  six shipped templates live in code as data and are never seeded into the
  database — they are not the user's material and a copy would go stale the
  first time one is corrected. A user-authored template is the same shape,
  shares the id space, and cannot shadow a shipped id.
- **One template object serves both halves of a generation.** The template the
  builder renders with and the template whose stop sequences end the turn are
  the same object, or the model is stopped on markers it was never given.
- **Text-completion mode exists for prompt control, not for compatibility.**
  llama.cpp, KoboldCpp and TabbyAPI all speak `/chat/completions` too, but their
  chat endpoints apply an instruct template of their own from the GGUF metadata
  and silently reshape what §3 assembled. The cost of that control is that a
  wrong template is a wrong prompt with no error to show for it, which is why
  the editor ships with a live preview.

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

### Settled while building phase 36

- **The channel carries what changed, never what it changed to.** Every event is
  a notification and the client refetches, so a device that missed one and a
  device that got it make the same request — and there is no path where the
  channel and the database can disagree about what a scene says.
- **The signal for "this is a continuation" is the new head's parent, not the
  old head.** They are the same thing for an append and different for a rewind:
  rewinding also *starts* where the reader is. Treating that as a continuation
  was the first version, and it swallowed exactly the case the prompt exists
  for. A device showing the new head's parent is looking at the turn the new one
  continues, so it takes it silently; anything else has been moved off its
  branch and is told.
- **The losing client holds its view.** A prompt over a log that had already
  converged behind it is a worse lie than no prompt, and letting a background
  refetch change the scene under the reader is the silent divergence this rule
  exists to prevent. So the log keeps rendering what it was rendering until the
  reader takes the move.
- **The origin lives in `AsyncLocalStorage`.** A handler is async, so a
  module-level variable restored on return is restored at the first `await`, and
  every publish after that reads whichever request set it last. An origin that
  leaks between requests makes a client ignore an echo that was not its own —
  which is the one thing last-write-wins depends on.
- **Leaf moves are announced from the storage layer.** Three places move the
  head and only two of them have a route that knows it happened: a delete that
  takes the head with it moves the leaf as a consequence, not as a request.
- **A failed generation announces its end.** `fail` does not return through
  `finish`, so an indicator that only cleared on success would leave the other
  device showing "still writing" for a turn that stopped.
- **The chime is server-side, and only when the tab is hidden.** Server-side
  because there is no browser storage here, and because a preference held in one
  browser is the wrong shape for a feature whose premise is that the phone and
  the desktop are two views of one install. Hidden-only because on the scene the
  reader is watching, the prose arriving *is* the notification, and a sound over
  it would be the app talking during the story.
- **The chime is synthesised, not a file.** Two sine tones through WebAudio is a
  dozen lines and no asset to commit, serve and cache for a third of a second of
  sound.

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

### Turn director decisions are prose

Settled while building phase 8. §6 requires the decision to be exposed in the
UI, which makes the *reason* part of the director's return value rather than a
comment in the code: `{ characterId, source, reason }`, where `source`
distinguishes the user's pick from the director's and `reason` is written to be
read by a person. The design prints it verbatim under the cast strip. A reason
nobody can read is the arbitrary dice roll this is meant to replace.

Two consequences. A strategy that is not implemented yet falls back and **says
which fallback it took** ("Classifier not available — round robin") rather than
silently behaving like something else. And `manual` still returns a suggestion
when nothing has been cued — whoever has been quiet longest — because the
composer has to name who the send button will speak as before it is pressed.

### The classifier decides mid-flight

Settled while building phase 10.

- **The decision is an event on the generation stream**, not part of the
  response that starts it. The classifier is a model call; making `POST
  /generate` wait on one would put a second model's latency between pressing
  send and anything happening. So the generation starts, the director answers,
  and a `director` event carries `{ characterId, name, reason, source, scope }`
  before the first token of prose. Every strategy emits it, not only the
  classifier — §6 asks for the decision to be exposed, and that is not a
  classifier-specific requirement.
- **The composer says it does not know yet.** With the classifier and nothing
  cued, no cast card is highlighted and the send button carries a question mark
  rather than a name. Naming the round-robin fallback would be a guess shown as
  a fact, and wrong about as often as it is right.
- **"Never twice consecutively" is enforced by not offering them.** The
  character who spoke last is left out of the candidate list rather than asked
  about politely in the prompt. A rule a small model can decline to follow is
  not a rule.
- **A classifier failure never costs the turn.** No profile, an unreachable
  provider, a timeout, a reply naming nobody, a reply that is an apology — all
  of them return "no answer", and the pure director's fallback stands with a
  reason that says so. The alternative is a director that can stop a scene,
  which is worse than no director.
- **It is bounded twice**, by a timeout and by a reply-length cap, because the
  thing being asked for is three lines. A model that starts talking costs a
  moment, not a turn.
- **`auto` scope is the classifier's** (§3.5). The third scope option is offered
  only under the classifier strategy, because it means "ask the director" and no
  other director can answer. An explicit spotlight or beat is never put to the
  model — the user already decided.
- **`scenes.director_profile_id`** routes the call. Per-operation routing
  generally is phase 13; this is the one operation whose whole point is being
  routed differently, so it gets a column now.

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

Settled while building phase 24.

- **The loop lives on the server, in memory.** A phone suspending its tab must
  not stop the scene, and a client that vanishes mid-run must find it still
  going — the same ownership rule as generation (§0.7). It is not a row: a
  restart ends it, because a scene writing itself with nobody watching is a
  different and worse feature than the one the reader turned on.
- **A reply arms it; only its own turns are checked.** The reply the reader
  just received is an answer to something they said, and addressing them is
  what an answer does — checking it for that would stop the loop before its
  first turn. The addressed check reads only turns the loop wrote.
- **The addressed check is a side call** (`autopilot_check`), like the
  classifier and for the same reasons: cheap, routed per §7, and never able to
  fail the thing it serves. An unreadable or unreachable check reads as *not
  addressed*; the cap remains the bound either way.
- **The reader's ops yield, they do not collide.** Send, revise, recast, OOC
  and the stop endpoint all stop the loop and drain its in-flight turn before
  proceeding — so a send during autopilot is a stop, never a 409, and the
  partial turn keeps what it produced (§5.6).

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
| **Off script** | Ask the author something out of character. Both halves are kept as `ooc` messages; the answer must not advance the scene. |

### The out-of-character channel

The author is a collaborator, not a puppet. §2 gives it an `ooc_voice`; this is
where it uses one. Two directions, and they are not symmetric.

**The author stepping out.** When `scenes.ooc_enabled` is on and
`ooc_interval` messages have passed since the last aside, the prompt carries an
invitation to step out briefly at the end of the turn — a question, a check, a
flag — wrapped in a named marker. The aside is split out of the stream and
stored as its own `ooc` message rather than left in the prose, because a line of
authorial commentary in the middle of a scene is the single most common way a
roleplay turn is ruined. Declining the invitation is a good answer and the
instruction says so.

**The reader asking.** A question and its answer are both `ooc` messages,
distinguished by `author_type`; the answer must not advance the scene.

### Settled while building phase 23

- **The invitation names the marker.** "Mark it clearly" leaves the model to
  invent one, and an aside the parser cannot find is an aside printed into the
  scene. It asks for `((this))` — the same convention §19's inline commands use
  in the other direction — and says what goes inside and what does not.
- **Splitting is unconditional; the invitation is not.** A model that
  volunteers an aside unprompted must still not have it land in the prose. The
  parser also reads `[OOC: …]`, `[ooc]…[/ooc]` and `(OOC: …)`, which roleplay
  finetunes emit without being asked. The single-paren form is safe only
  because of the literal tag inside it.
- **An unterminated aside is prose, marker and all.** The opposite of §13's rule
  for an unclosed reasoning tag, and deliberately: `((` is a sequence fiction
  contains, and eating the rest of a turn on a stray double-paren is far worse
  than showing one.
- **An aside is a child of the turn it came from**, not a sibling. History is a
  tree (§1), and the aside belongs to that telling: rerolling the prose makes a
  sibling, the reader walks down a path the aside is not on, and it disappears
  exactly when it should.
- **An out-of-character turn skips the director, the post-generation pipeline,
  and aside-splitting.** Nobody in the cast is speaking; all three passes read
  the turn as prose; and the whole answer is already the aside.
- **Removing an aside closes the gap it left.** A small, deliberate violation of
  "never lose text": the alternative is a double space in the scene for every
  aside written. Spaces and tabs only — a newline is a paragraph break the
  author meant.
- **The channel is not a mode.** Notes arrive inline in the log; the sheet is
  where a note becomes a conversation, and is reachable from any aside and from
  the ops menu.

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

### Settled while building phase 13

- **An op is anything with a configuration row**, and two kinds share the table
  because they share the row: a *side call* runs off the main path on its own
  model and returns text; a *turn instruction* is a block inside a user-facing
  generation's prompt. Routing and a timeout only mean something for the first,
  and the row says which kind it is rather than leaving a caller to guess.
- **A template has two substitution passes, and the order matters.** The op's
  own variables — `{{input}}`, `{{original}}` — are filled by the caller,
  because only the caller knows what they mean. Everything else is the ordinary
  macro set, filled at assembly, so `{{char}}` inside a user's override resolves
  exactly as it does inside a preset. Filling must therefore leave unknown
  macros alone: one deleted in the first pass never reaches the engine that
  knows it.
- **The user-lock is not part of any template.** §0.5 makes it a hard constraint
  restated near the turn, and a template a user can edit is not where a
  non-negotiable belongs. The builder appends it after the template, where an
  override cannot drop it by accident.
- **The template is the only copy of an op's words.** The prompt builder reads
  it rather than holding a second copy for the un-overridden case — two copies
  of the same paragraph is how the built-in and the default drift apart.
- **Hidden is not off.** `button_visible` decides whether a button is shown;
  `enabled` decides whether the op runs at all. An op with no button still runs
  when something else asks for it, and the list says which ops hiding would even
  mean anything for.
- **`auto_trigger` is the one field from §7's row still missing.** It means "run
  automatically after each reply", and the only ops that want it are the
  post-generation passes (§7.5). It arrives with them; a switch that does
  nothing is worse than a short settings screen.
- **The last provider and the last profile cannot be deleted.** Deleting a
  profile leaves the scenes that used it saying they have no connection, which
  is recoverable; leaving the installation with nowhere at all to generate is
  not.

### Settled while building phase 12

- **Ephemeral means ephemeral.** A nudge reaches the model at depth 0 and is
  gone: it is not written to the tree, and the next turn does not carry it. A
  scene that fills up with the user's stage directions reads wrong on the next
  pass, and a nudge that silently persists is a steer nobody asked for. Steer is
  the only op with a column, because *persistent until cleared* is the whole
  difference between the two.
- **Expand, correct and continue are one endpoint and three instructions.** They
  share a shape — hand the model what it wrote, ask for something different —
  and share nothing else. "Longer" produces padding unless it is told what to
  spend the length on; "fix this" rewrites the parts that were already working
  unless it is told not to; "continue" starts again from the top unless it is
  told to begin mid-flow. Reading the three as one would blur all three.
- **Every revision is a sibling, and keeps the original's speaker.** Asking for
  a longer version and disliking it must cost a swipe and nothing else, and a
  correction that quietly changes who is speaking is not a correction.
- **Continue extends rather than replaces.** What lands is the whole turn,
  original and continuation, so the log reads as one piece of writing rather
  than a fragment sitting beside its own beginning.
- **Continue is gated on the provider, and says so.** No adapter that currently
  ships can accept a partial assistant turn, so the op is present, dark, and
  carries its reason. A fresh turn dressed as a continuation would be worse than
  saying no.
- **Guided swipe is reroll plus nudge**, not a mechanism of its own — which is
  what makes it obviously correct rather than a fourth thing to keep in step.
- **Impersonate is a background task, not a generation** (§7's primitive),
  because its result lands in the composer and never auto-sends. That is what
  makes it safe: it is the one place the author is asked to write the reader's
  character, and nothing it produces reaches the story without the user pressing
  send. The cost is that it does not stream token by token.

### Background tasks

Generalize the above into a named background-task primitive: a stored prompt
with a trigger condition, a stage (pre-generation / sidecar / post-generation),
its own connection profile, and a defined output destination (a guide, a
tracker, a memory write, a composer fill, a new message). Summarization,
tracker refresh, memory extraction, the turn classifier, and expression
classification are all instances of this one mechanism. Build it once.

Background tasks run off the main generation path and **must never block or fail
a user-facing generation.**

Settled while building phase 11.

- **A kind is code; a row is its configuration.** What a task asks for and what
  it does with the answer are not expressible as data, and pretending otherwise
  would be the extension system §15 puts in a much later tier. What is stored is
  §7's per-op row for a kind the code already knows about, and rows are created
  the first time a kind is asked for — so adding one is a change to a single
  list. Kinds are registered as they are built; seeding rows for tasks whose
  feature does not exist would be a settings screen full of switches that do
  nothing.
- **"Never fails a generation" means `run` does not throw.** Every way a side
  call can go wrong comes back as a named result the caller falls back from: no
  model to run on, an unreachable provider, a timeout, a cancelled turn, an
  answer that could not be read. They are named apart because "the model said
  no" and "the model was unreachable" are different problems and only one of
  them is worth changing a model over.
- **Because every failure is swallowed, every run is logged.** Otherwise the
  rule quietly becomes "side calls fail forever and nobody can tell". The log
  keeps what was sent, what came back and why it failed, bounded per kind. It is
  also where a caller records the runs it decided *not* to make: "there was only
  one turn this could be" is the answer when a director looks idle.
- **The fallback says why it is the fallback.** A caller that cannot tell "no
  answer" from "no answer because the model was unreachable" would present a
  broken director exactly like a working one, so the failure is named in the
  reason the user reads.
- **Two bounds, always: a timeout and a reply-length cap.** A task that ends
  cleanly on abort rather than throwing must still be reported as a timeout —
  otherwise giving up waiting looks exactly like the model saying nothing.
- **A concurrency cap**, because side calls are cheap individually and unbounded
  in aggregate: a four-pass pipeline over a beat's five segments is twenty
  requests from one turn, and a local model serves one at a time.
- **Routing order is: the caller's override, then the task's configured profile,
  then the scene's own.** §6's director profile is the first instance of it.

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

**Settled while building phase 14.**

- **The pipeline starts after the turn is announced, never before it.** §7 is
  absolute that a background task must not block a user-facing generation, and
  three extra model calls in front of every reply would be a worse product than
  no pipeline. The message lands, the passes run behind it, and
  `messages.passes_pending` is what tells a client to look again.
- **A pass that cannot be read says nothing.** An unreadable verdict is not a
  flag: a pipeline that shouts at the user because a small model rambled is
  worse than one that stays quiet. Every failure is recorded against the message
  and the next pass carries on.
- **`ok` is recorded, not only `flagged`.** "The voice pass ran and was happy"
  and "the voice pass never ran" are different things to know, and a pipeline
  whose silence is ambiguous is one nobody trusts. A clean verdict is drawn
  quieter, not omitted.
- **Voice validation reads a beat part by part**, and its annotation carries the
  segment ordinal. Naming *which line* stopped sounding like itself is the whole
  value; "the exchange felt off" is what a reader already knew.
- **Only prose refinement replaces, and it keeps the original.** The user-lock
  check flags by design — a pass that quietly rewrites a turn is a second author
  nobody hired, and the fix for the author taking over the reader's character is
  a regeneration the user asks for.
- **A refinement that changed nothing is recorded as `ok`, not as a revision.**
  A revision nobody can see, with a revert button on it, is noise.
- **Running a pass twice leaves one verdict per pass per part.** The history of
  *runs* is the task log's job (§7); the message carries the current finding.
- **The manual run is awaited; the automatic one is not.** A user who pressed a
  button is waiting, so the response carries the findings rather than making
  them poll for something they just asked for.

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

**Settled while building phase 15.**

- **A guide is a row per version, not a mutable row per scene.** "Versioned per
  message, so rewinding rewinds them" only works one way: each write is a new
  row anchored to the message it was written after, and the version in force is
  the newest whose anchor is on the active path. Two branches therefore carry
  their own guides without either knowing about the other, and rewinding is a
  read, not an undo.
- **A flush takes every version, not the one in force.** Deleting only the
  current row would resurrect an older one the moment the reader rewound, which
  is the opposite of what the button says.
- **Each guide is its own op**, on phase 11's primitive, rather than one op with
  a kind parameter. §8 makes auto-trigger a per-guide decision and names three
  that default on; per-op routing then falls out for free, so the cheap model
  can keep the clothes list while a better one keeps the thinking.
- **A refresh is shown the previous version.** A guide that forgot everything
  each time it ran would lose exactly the state it exists to carry — a coat
  taken off three turns ago has to stay off.
- **A hand-edit pins the version, and a refresh skips a pinned guide.** §8 makes
  guides editable; an edit the next automatic run overwrites is not an edit. A
  rebuild the user explicitly asks for by kind still leaves the pin alone —
  flushing is how you take it back.
- **An empty reply leaves the previous version standing.** The failure mode of a
  guide is a model that returns nothing, and replacing a good note with an empty
  one would make the feature worse than not having it.
- **Guides refresh after the passes, not before.** §7.5 may have rewritten the
  turn the guide is about to read.
- **The custom guide is the only one with no built-in question**, so its
  question is scene configuration and lives on the scene, not on the op. Without
  one it is skipped rather than asked something generic.
- **The panel lists all six kinds whether or not they have been written.** A
  guide you can only discover by first turning something on in settings is one
  nobody finds.

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

### Settled while building phase 32

- **A dossier is not an entity of its own, and not a provisional character.**
  §22 asked which and guessed the latter; the answer is in the sentence above.
  Injection *by relevance* is the whole point, and a cast member is injected
  *always* — that is what being in the cast means. A provisional character would
  either cost tokens on every turn or need a second injection rule bolted onto
  the cast.
- **Relevance injection already exists: it is §10.** So a dossier is two things
  at once. A row holding the five fields above, which is what the reader edits,
  and a lore entry keyed on the name, which is how it reaches a prompt. Keyword
  matching, scan depth, the token budget, sticky, the character filter and
  §16's activation test tool are all free, and none of them is written twice.
  SillyTavern arrives at the same place from the other direction: it has no
  dossier feature, and what its users do for an NPC who emerged is write a
  World Info entry in a chat-scoped lorebook.
- **The entry is derived, never edited.** Every write goes through one render
  step, so the entry cannot drift from the fields it came from. Same rule §8's
  guides follow.
- **The buried tier is never rendered into the prompt.** Buried means the author
  knows it and has not revealed it; injecting it every time the name is
  mentioned is exactly how a secret gets spoken aloud two turns later. It is
  kept, shown to the reader beside a preview of what the prompt *does* get, and
  travels only on promotion — a card is the author's own reference, and
  withholding it there would lose the only copy.
- **Recurrence is counted, not classified.** Who recurs in a transcript is a
  question about string frequency; a model call per turn would cost a request
  to get a worse answer nobody can debug. Names are counted in *separate
  messages*, because a name said three times in one line is one moment and a
  name said once in three turns is a character who keeps coming back. The model
  is asked one question — what this character is like — once a name has earned
  it.
- **A promoted dossier is disabled, not deleted.** The card now carries the same
  material and two copies in one prompt is the failure that avoids; the row
  stays as the record of where the character came from.
- **A book the app writes is shown but not detachable.** The per-scene Dossiers
  book appears in the lorebook list, so where those tokens go is visible, and
  offers no Detach: unhooking it would leave dossiers rendering into a book that
  reaches nothing, with nothing to say so.

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

### Settled while building phase 21

- **The activation model is a pure function, and everything else asks it.**
  Entries, a transcript window, the cast and the timed-effect state go in; what
  fires and why comes out. No database, no clock, no randomness of its own —
  the roll is passed in, seeded per generation, because the probability above
  has to be replayable. Six rules that each look simple alone and interact in
  ways nobody can hold in their head is the argument for building it this way.
- **Rule order is the behaviour.** What cannot fire at all is filtered first
  (disabled, delay, cooldown), then constants skip scanning, then secondary
  keys *qualify* a match rather than causing one, then the character filter,
  then sticky before probability — an entry that rolled well once should not
  have to keep rolling well for a duration it was already granted — and groups
  pick their winner last, from whatever survived. A group is settled once it
  picks: a loser must not come back through recursion and insert a second
  member of a group this section says inserts one.
- **Whole-word matching is the default.** The single most common complaint
  about world info is an entry keyed on "ash" firing on "washed". A key with no
  word characters at its edges falls back to substring, rather than silently
  never matching.
- **A book reaching a scene is a four-way union, computed once.** Global, bound
  to the scene, carried by a character in the cast, or carried by the persona —
  and a book bound several of those ways contributes its entries *once*.
  Counting it twice spends the token budget twice and lets a one-member group
  insert two. The client repeats the same union to decide what to show as
  attached, from one function, because a screen that disagrees with the prompt
  builder about what is attached is worse than no screen.
- **Timed effects are counted along the active path, not along the scene.**
  Sticky, cooldown and delay are durations measured in messages, and §1 says
  history is a tree. An effect anchored on a branch the user walked away from
  did not happen on this branch. `delay_from` therefore offers both: from scene
  start, and from the last branch point.
- **The activation test tool runs the real engine.** §16's "what would fire
  against the current scene" is one endpoint over the same activation a
  generation performs, seeded with a constant rather than per-generation so a
  probability entry does not flicker on every refresh. A test tool with its own
  second implementation is a tool that lies — which is precisely how
  `scenario_override` survived seventeen migrations unwired in phase 20.
- **Lore is a top-level destination, not a page inside a roleplay.** One book
  can be global, bound to a scene, and carried by a character at once, so there
  is no single owner to file it under. This is the design's fifth tab.

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

**Settled while building phase 16.**

- **Three of these knobs meet in one place, and the order they apply in is the
  behaviour.** The freeze runs first — it rounds the leaf *down* to a multiple
  of N, so the answer only moves every N turns. The threshold runs second,
  against that frozen position. Eviction runs last, on whatever the first two
  decided is injected. Applying them in any other order gives a freeze that does
  not actually freeze anything.
- **The freeze needs no stored state.** Rounding the path length down is a pure
  function of the scene and the active path, so the same prompt is computed the
  same way every time without a "last moved at" column to keep in step with
  branching.
- **A summary counts when the last message it covers is on the active path** —
  the same rule guides use, for the same reason. Rewinding past a range
  un-injects the summary of it, and a branch that never had those messages never
  had their summary.
- **The threshold's tail is never summarised, not merely never injected.**
  Summarising up to the leaf would spend a model call describing a turn the
  prompt is still showing in full, and will keep showing for another N messages.
- **Raw eviction always keeps the last user message**, whatever the ranges say.
  A turn whose history has dropped the thing being replied to has nothing to
  answer.
- **Evicted-because-summarised is reported like any other eviction**, with its
  token cost. §3 insists on the eviction list because "the character forgot" is
  almost always "the model never saw it", and one paragraph standing in for
  forty turns is the strongest case of that in the product.
- **An empty reply does not mark the range summarised.** Writing an empty
  summary would hide the messages behind a paragraph that says nothing, which is
  worse than not summarising at all.
- **A fold that comes back longer than its input is discarded.** Re-summarising
  exists to stop the block growing; replacing four summaries with something
  bigger makes the problem worse.
- **An edited summary is never folded away.** §11 marks edits so regeneration
  does not clobber them, and a fold is regeneration by another name. That can
  leave the block over its budget, which is the right way round — the user wrote
  it, so the user decides when it goes.
- **Both thresholds are per scene, and both are bounded.** How fast a story
  moves is a property of the story. A threshold of zero would summarise the turn
  that just happened and a freeze of a thousand would stop the injection point
  ever moving again; both look like a working feature until a long scene goes
  wrong.

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

**Settled while building phase 17.**

- **Reasoning arrives by two routes and both are handled.** A provider field
  (`reasoning_content`, `reasoning`) needs no parsing. Inline `<think>` tags are
  a *streaming* problem rather than a parsing one: a tag can be split across
  frames, so anything that could still turn out to be a tag is held back. A
  stray `<think>` shown to the reader for one frame and then retracted is the
  failure this design exists to prevent.
- **An unterminated block is reasoning, not prose.** A model that forgets its
  closing tag must not have its private planning printed into the scene.
- **Reasoning lives in its own column, and that is what makes the "do not feed
  it back" default free** rather than a rule somebody has to remember: the
  history renderer reads a message's content, so it cannot leak into a later
  prompt by accident. Re-injection has to be built deliberately, which is the
  right way round for a behaviour most providers advise against.
- **Off is zero blocks, not a separate flag.** One thing to read, and no way for
  a flag and a count to disagree.
- **Re-injected reasoning goes before the turn it produced**, because that is
  the order it happened in; after it, it reads as an afterword.
- **Reasoning does not count as the first token.** A time-to-first-token that
  measured planning the reader never sees would be a number about nothing.
- **Prefill is a property of the endpoint, not the wire format.** OpenAI rejects
  a trailing assistant message; most local servers speaking the same
  OpenAI-compatible shape accept one. So a provider carries a three-valued
  override, where null means "whatever the adapter says" — which is a different
  answer from "no". One switch moves both halves, since the builder already
  gates the prefill block on the capability the adapter reports.
- **One preset per generation.** Two things can carry a preset — a scene and the
  connection profile it routes through — and until this phase the samplers were
  read from one and the prompt from the other, so a preset attached to either
  drove half a generation. The rule is now the scene's preset if it has one,
  else the profile's, else the one marked default; and resolving to nothing
  falls back to the default *row* rather than to hardcoded constants, so an
  edited default preset actually reaches a scene that never chose one.
- **Sampler bounds are shared between the route and the editor**, so a value the
  form accepts is never one the server refuses.

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

### Settled while building phase 33

- **The engine is pure, and the test panel is the same engine.** §14 asks for a
  test panel. A panel running a different code path from the one that edits the
  reader's scene would be worse than no panel, because it would say a script is
  safe and then something else would run. So `/scripts/apply.ts` takes text,
  scripts and an environment and returns text and a trace, with no database and
  no clock, and `POST /api/scripts/test` runs exactly what a turn runs.

- **A replacement's macros are resolved before the replace, not after.** After
  would resolve a macro that landed inside matched text, which turns a script
  that quotes the model's own words into one that rewrites them. Resolving first
  also keeps `$1` and `$<name>` intact for the engine — and means a resolved
  value has its dollar signs escaped, or a character named `$1` would splice a
  capture group into the prose.

- **The macro set a replacement can reach is a subset of §3's.** Three of the
  four stages run where no prompt exists: a script rewriting the reader's
  message as they send it has no spotlight, no seed and no history. `{{char}}`,
  `{{user}}`, `{{cast}}`, `{{time}}`, `{{date}}` and `{{newline}}` mean something
  at every stage; everything else is left in the text verbatim and reported,
  which is §3's own rule for an unknown macro.

- **A character-scoped script follows the speaker, not the room.** It runs when
  that character is the one speaking. Scoping by presence would mean a script
  styling one character's dialogue reformatting everyone else's turns because
  she happens to be in the scene.

- **Display and prompt scripts load once per transcript.** Per message that is a
  query per turn on every open of a scene. This is why the display stage runs in
  `activePathDtos` and `messageDto` rather than in the DTO mapper.

- **Streaming is not scripted.** Deltas reach the client as they arrive, so a
  `display_only` script lands when the finished message is read back rather than
  mid-stream.

- **A trigger can refresh a guide or a tracker, or fire a regex script — not an
  arbitrary background task.** §14 names three action families. The third is not
  built, and the reason is in the task primitive's own signature: a task request
  carries a prompt "built by the caller, because only the caller knows what to
  ask". There is no generic way to ask an arbitrary op a question. The ops a
  trigger can run are the ones something already knows how to ask — which is the
  guides and the trackers, both of which *are* background tasks.

- **`lore_activation` fires after the turn its activation was part of.** An
  action is a side call, and stalling a turn on one before a token has streamed —
  to pay for an entry having matched — is the wrong trade. The effect lands on
  the next turn. `before_generation` is the opposite and is awaited, because a
  trigger bound there exists to change what the prompt says.

- **`scene_start` is the first thing written into a scene, not its creation.** A
  scene with no messages has nothing for a guide or a script to read, so firing
  at creation would fire at the one moment every action is guaranteed to do
  nothing.

- **A trigger fires its guide with `automatic: false`.** The trigger *is* the
  ask. Requiring the guide's own auto-trigger as well would mean switching a
  guide off the automatic path and then wondering why the trigger written to run
  it by hand did nothing.

- **A trigger's action is validated against the thing it names, at save time.**
  A trigger pointing at a guide kind that does not exist, or a script that has
  been deleted, is automation that silently never works — the same argument as
  validating a regex when it is written rather than on the turn that needed it.

- **Nothing a trigger does can break a turn.** Every action is wrapped, every
  outcome says what happened, and the message-side events are not awaited: by
  the time they run, the message is already in the tree.

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

### Settled while building phase 34

- **A collision is skipped, never overwritten.** Overwriting and exact
  uninstall are in tension: a row a pack replaced cannot be put back by a table
  that only records what it owns, and §23's test list asks for exactness. So a
  name already in use is reported in the preview and left alone. Updating a
  pack is uninstall then install, which is what the ownership record is for.
- **Ownership is by internal row id, not by name or ULID.** A character the
  reader renamed is still the one the pack brought, and one they wrote
  themselves that happens to share a name is not. An id also means the one thing
  `pack_rows` must be able to do — delete a row whose table it knows only as a
  string — needs no join.
- **Plan and install walk one list.** They did not at first, and the bug that
  found was a card arriving as a PNG being checked for collisions by its
  *filename*, so a pack carrying `Hollis.png` installed a second Hollis. Reading
  cards at plan time also means a malformed one is named before anything is
  written.
- **`/tasks/` is not built.** §15's tree lists it, and an op's configuration is
  not a row a pack can own: the registry is fixed and its rows are created at
  boot, so "install" would mean overwriting settings the reader chose and
  "uninstall" would have nothing to remove. `/triggers/` was added instead —
  §15's tree predates event triggers, and a regex script fired by a trigger and
  shipped without it is half a feature.
- **A packed regex script is global, and a packed trigger rebinds by name.**
  Character and scene scopes name rows that exist in the pack author's install
  and not in the reader's. A trigger carries its script's name beside the id and
  is rebound to the script the same pack brought; one that cannot be rebound
  fails the install rather than installing broken.
- **Children are not owned individually.** Lore entries and options cascade with
  their book and their group; recording each would delete twice.
- **A directory this host has never heard of is ignored, not refused.** A pack
  written for a later version would otherwise be a compatibility cliff.
- **Assets are written after the transaction commits.** A failed write leaves a
  character with no avatar, which falls back to the placeholder; rolling the
  database back over a missing picture would be the worse trade. Uninstall
  leaves avatar files: they are content-addressed, so another character may
  share one.
- **A dossier book is not offered for export.** It is written by the app and
  bound to one scene (§11), so packing it would ship a book that reaches
  nothing on the other side.

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

### Settled while building phase 35

- **A webhook can never affect a turn.** The safety argument above stops being
  true the moment a receiver that stopped answering can stall a generation. So
  emitting is never awaited, every failure is swallowed into the delivery log,
  the request carries a five-second timeout, and three attempts with a short
  fixed backoff is the end of it — a webhook is about something that just
  happened, and a delivery four minutes late is worse than none, because the
  receiver has already drawn the next turn.
- **The failure is recorded even though it is swallowed.** A receiver that
  started refusing requests otherwise looks exactly like a receiver nobody is
  sending to, which is the failure §18 forbids. Every attempt is logged with its
  status, its response code and what came back; twenty consecutive failures
  switch a subscription off with a reason, and switching it back on clears the
  count so one more failure does not disable it again.
- **The signature is Stripe's shape**, `t=<seconds>,v1=<hmac>` over
  `timestamp.body`, because that is the one every receiver already knows how to
  verify. The timestamp is inside the signed material rather than beside it: a
  signature over the body alone is replayable forever. `verifySignature` ships
  alongside the sender — a scheme whose only implementation is the sender is one
  nobody can be sure they have implemented correctly.
- **The signing key is generated, not asked for**, returned exactly once on the
  response that created it, and stored encrypted with the keyring that holds
  provider credentials. A key the UI could re-read is one that leaks through
  every screenshot of that screen. Rotation replaces rather than overlaps: one
  sender, one receiver, and a grace period would be machinery for a problem a
  single-user app does not have.
- **Redirects are not followed.** A redirect is the classic way a signed request
  ends up somewhere its sender did not choose.
- **Loopback and private addresses are allowed.** This is single-user
  self-hosted software and the most likely receiver is a bridge on the same
  machine; refusing `127.0.0.1` would block the main use case to prevent a
  request the operator asked for. Credentials in the URL are refused instead —
  that would put a second secret somewhere this app does not encrypt.
- **`generation.complete` fires for a cancelled or failed turn too.** A bridge
  that only heard about the ones that worked would sit waiting on the ones that
  did not, which is the state it most needs told about.

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
- Built-in updater for git-checkout deployments, in Settings: a status row
  (local facts only — a `GET` never touches the network), an explicit check
  that fetches, and an apply that runs `git pull --ff-only` followed by
  `bun install` and a client build. Refuses a dirty tracked tree — untracked
  files such as `data/` do not count — and reports a restart requirement that
  only replacing the process clears. Deployments without a checkout (Docker,
  the standalone executable) say so instead of appearing up to date.
- Data directory configurable via env: SQLite DB, avatars, sprites, uploads,
  vector index. The checkout the updater pulls from is configurable too
  (`ONSEN_REPO_DIR`, default the working directory).

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
19. **Desktop layout** — §16 and the design's `4a`: the same components
    unrolled into sidebar, capped prose column and cast rail, with the ops grid
    flattened and the guides panel becoming the rail's footer.
20. **Schema review** — read migrations 0001 onward end to end, against §2 and
    against what was actually built, before the depth phases start adding
    tables.

**Depth**
21. Lorebooks — full activation model, timed effects, inclusion groups,
    character filters, recursion levels, outlets.
22. Remaining adapters — Anthropic, text completion with instruct templates.
23. OOC channel — parsing, rendering, user OOC replies.
24. Autopilot.
25. Prompt inspector, with eviction and activation traces.
26. **Character library at scale** — search, tags, bulk ops, versioning, derive.
27. **AI-assisted authoring** — create/revise/extract character, suggest lore,
    auto-tagging. All background tasks; cheap once the primitive exists.
28. **Preset import** — SillyTavern chat-completion presets, mapped onto option
    groups, with an import report.
29. Expressions — author-declared tags, sprite packs, VN mode.
30. Document RAG / data bank.
31. Structured trackers with the panel UI.
32. Character dossiers for emergent NPCs.
33. Regex scripts and event triggers.
34. **Packs** — export/import bundles, transactional install, ownership
    tracking for clean uninstall.
35. **Outbound webhooks** — signed event subscriptions.
36. Multi-device head sync, background indicators.
37. Outbound OpenAI-compatible API — `last_message` mode, scene models, inline
    ops, bearer keys. Depends on the head sync being in place.

**Later**
38. Narrative memory (entities, relations, salience) — only after summarization
    and RAG are proven.
39. Author memory.
40. Optional tabletop module — dice, skill checks, stat and inventory tracking
    as user-defined state schemas. Deterministic rolls happen server-side, never
    in the model.
41. TTS, image generation, captioning.
42. Chub import, community asset browsing.
43. Polish — mention strategy, group greetings, bulk import, PWA.

Settled while building phase 15.

- **The desktop layout is phase 19, not a polish item.** The design is explicit
  that desktop is the same components unrolled rather than a second design, and
  that only stays true if the components are unrolled while there are few of
  them. Every screen built mobile-only after this point is one more to retrofit,
  so it goes at the end of the core product and before the depth phases, and
  everything from lorebooks onward is built for both widths from the start.
- **The schema review is phase 20, and it is overdue.** `HANDOFF.md` asks for
  the migrations to be reviewed before they are run; thirteen of them have been
  written and run without that ever happening, because waiting would have
  stopped every phase. The honest repair is a phase that reads them all against
  §2, taken before the depth phases add lorebooks, trackers and packs — the
  point past which a schema mistake stops being cheap.
- **The numbering past 34 was wrong**, and is corrected here: the tail repeated
  40 and 41 several times over. The count is 43 phases with the two above added.

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
- Presence tracking: **partly resolved.** The stored column is
  `joined_after_message_id` — the last message that had already happened when a
  character joined — rather than §2's `first_seen_message_id`. The first message
  a joining character witnesses does not exist yet at the moment they join, so
  storing the leaf under that name is off by one in the only place it is read.
  Joining is enough for the case that actually occurs (a character arriving
  mid-scene); an explicit exit point is still open, and is only worth adding
  when something needs a character to stop knowing things.
- A message says whether the passes are still reading it, and the client polls
  while any of them are (§7.5). It stops on its own and costs a request or two,
  but the honest mechanism is the per-scene channel §5 already anticipates for
  multi-device sync — the same channel would carry annotations as they land.
  Building it for this alone would be the wrong order.
- Impersonate does not stream: it returns a finished draft rather than filling
  the composer a word at a time. For a two-line turn that is right; for a long
  one the wait is silent. Streaming into the composer needs a generation whose
  target is the composer rather than the tree, which is a real seam and not
  worth cutting before the wait is observed to be a problem.
- Once a turn has finished, the director's reason survives only in the task log
  (§7) — the message itself records who spoke, not who chose them or why. Keeping
  it per message would need somewhere to show it; the prompt inspector (§20
  phase 23) is the natural place, and deciding before that exists would be
  guessing at the surface.
- Should beats be the default turn type, with spotlight as the exception? Group
  scenes probably want beats most of the time; single-character scenes never do.
  Phase 9 ships with spotlight as the default and the scope control offered only
  when two or more characters are in play, which is the reversible choice — the
  right answer is a matter of use, and `auto` (phase 10) may make it moot.
- Should a beat include the whole active cast when the cast is large? Five
  characters in full, plus the beat instruction, is a lot of prefix for one
  turn, and a beat with five voices is unlikely to give any of them much. A cap
  needs a rule for *who* to drop, and inventing one before the problem is
  observed seemed worse than shipping without it.
- Whose example dialogue goes in a beat? Currently the character who opens it,
  which is arbitrary; everyone's would be large, and nobody's loses the one
  block that most directly demonstrates a voice.
- ~~Should dossiers be a distinct entity, or just characters with a
  `provisional` flag?~~ Resolved in phase 32, and as neither: a row for the
  fields plus a §10 lore entry for the injection. See §11.
- ~~Do packs need dependency declarations (this pack expects that lorebook), or
  is a flat bundle enough?~~ Flat, decided in phase 34 — with one exception that
  is not a dependency system: a trigger names its script by name as well as by
  id and is rebound within the same pack, because a trigger pointing at nothing
  is automation that silently never works.

Resolved: cross-scene author memory is optional, off by default, implemented as
an author-scoped lorebook (§11). Not part of the initial build.

Resolved in phase 9: a beat swipe rerolls the whole exchange *and* recast fixes
one part — they are different things to want, and having both is what makes the
distinction legible. Disabling swipe on beats would have made the one blunt
correction unavailable when the whole exchange is wrong.
