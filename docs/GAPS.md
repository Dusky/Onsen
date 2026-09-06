# Gaps — measured against a real SillyTavern install

What the incumbent does that Onsen does not, and what Onsen refuses to do on
purpose. Written after phase 54 from five screenshots of a working install:
user settings, extensions, persona management, the chat list with its prompt
manager, and group controls. That install runs **139 chats, 23 personas, 18
ordered prompt blocks, 7 group members**, at font scale 0.98 with two side
panels open.

## How to read this

**No row is asserted from a screenshot alone.** Every status was produced by a
command run against the tree, and the row carries it. A gap doc whose "missing"
rows are quietly wrong spends a phase building something that already exists —
which happened twice while writing it. *World Info Recommender* looked missing
until `server/tasks/registry.ts` turned out to carry `SUGGEST_LORE`; per-message
stats looked missing until a wider grep found the server already measuring,
computing and persisting them.

| Status | Means |
| --- | --- |
| `have` | reachable by a user, today |
| `partial` | exists, but not reachable, or only in one of several places it should be |
| `missing` | not built |
| `rejected` | deliberately not ported; the row cites §21 or §22 |

**`partial` is the interesting column.** Onsen's recurring defect — the one
phase 54 was named for — is a capability that exists server-side with no
control in the client. Any field listed in `test/reachable-fields.test.ts`'s
`DELIBERATE` map is `partial` here, never `have`.

**Posture: parity where it is real capability.** If the incumbent does
something Onsen cannot, and it is not a §21 non-goal or §22 anti-pattern, it is
a gap to close — including where closing it costs settings surface. §16's
density rules replaced the restraint doctrine that would previously have
argued against several of these.

---

## 1. Prompt assembly

The prompt manager is the densest thing in the screenshots: 18 blocks in a
user-set order, each with a drag handle, an enable toggle, an edit pencil, a
token count, and a type marker. Onsen's prompt builder is *better* — pure,
ordered, budgeted, inspectable — and almost none of it is reachable.

| Capability | Onsen | Evidence | Verdict |
| --- | --- | --- | --- |
| Reorder prompt blocks | **have** (phase 56) | The manager in `PresetEditor.tsx`, saved to `presets.prompt_order` — a column live since 0001 that nothing had ever written. Up/down, not drag | — |
| Enable/disable a block | **have** (phase 56) | Per-entry `enabled` in the saved order; the row dims and its dot hollows. Disabled blocks are filtered out before the builder sees them | — |
| User-authored prompt blocks | **have** (phase 56) | `preset_blocks` — owned by the preset, in its order, on by default. Ordered by `custom:<ulid>` alongside the built-ins | — |
| Per-block token count | **have** (phase 56) | `PresetBlockDto.tokenCount`, estimated server-side, shown per custom block. Built-ins stay uncosted here: their cost is per-scene, and the Inspector is where a real prompt's is read | — |
| Prompt inspector | **have** | `client/components/Inspector.tsx`, `InspectorSheet.tsx` | — |
| Seed | **have** | 74 hits across shared/server/client | — |
| Reasoning config | **have** | `ReasoningConfigDto` `shared/types.ts:196` | — |
| Tool calling on any provider | **have** | phase 48; `test/adapter-tools-conformance.test.ts` | — |
| Example-message eviction policy | **have** | phase 64; `presets.example_eviction` is keep / gradual / never. `splitExamples` (`server/prompt/blocks.ts:78`) breaks a card's examples on `<START>` so each is costed and evicted on its own, and under *gradual* they sit ahead of the scene in one oldest-first trim queue (`index.ts:232`) | — |
| Squash consecutive system messages | **have** | phase 64; `presets.squash_system`, applied after the alternation pass (`server/prompt/index.ts:449`). A history message keeps its own turn, so `historyIncluded` stays honest | — |
| Web search | **missing** | `grep -rniE 'webSearch\|web_search'` → 0 | judgement call — backend-dependent |

## 2. Library at scale

The screenshot's chat list is `1-50 .. 139` with tags, folders and favourites.
Onsen's equivalent got search and sort in phase 54 and nothing else, and its
own source comment predicted this: *"if a library ever gets big enough to hurt,
the fix is pagination."*

| Capability | Onsen | Evidence | Verdict |
| --- | --- | --- | --- |
| Search chats | **have** | phase 54, moved server-side in phase 59 | — |
| Sort chats | **have** | phase 54 — recency / title / length | — |
| Tag a chat | **have** (phase 59) | `scenes.tags`, a JSON array queried with `json_each` — the character library's shape, so both lists file things the same way. Normalised on write | — |
| Folder a chat | **have** (phase 59) | `scenes.folder`, a label rather than a tree, as `0023` settled for characters | — |
| Favourite anything | **have** (phase 59) | `is_favourite` on scenes *and* characters, with a partial index each. A star on one list only was the half-measure | — |
| `n of m` readout on a list | **have** (phase 55) | `strings.showing`; the scenes list reads `3 of 5` when filtered, `5` when not | — |
| Paging the roleplay list | **have** (phase 59) | `listScenesFiltered` pages with `LIMIT`/`OFFSET` and returns `total` and `all`; the screen reads `50 of 60` and grows by 50. Driven at 60 | — |
| Windowing the message log | **have** | phase 62; `activePath(db, sceneId, limit)` (`server/db/queries/history.ts:816`) takes the newest N by depth, `SceneWithHistoryDto.historyTotal` says how many are behind them, and the reading preference `window` is the incumbent's *# Msg. to Load* (default 100). Prompt building passes no limit and still walks the whole path | — |
| Character tags / folders / search | **have** | `CharacterFilterQuery`, server-side since phase 26 | — |
| Character grid view | **have** | phase 26 | — |

## 3. Persona

Phase 54 made personas editable. The install shows how much further it goes.

| Capability | Onsen | Evidence | Verdict |
| --- | --- | --- | --- |
| Create / edit / delete | **have** | phase 54 | — |
| Description reaches the prompt | **have** | phase 54; `personaBlock()` `server/prompt/blocks.ts:149` | — |
| Persona avatar | **have** | phase 61; `mountAvatar` in `server/routes/authors.ts:62` serves, sets and clears it for personas *and* authors, and the reader's turns draw it |  — |
| Position in the prompt | **have** | in the prefix, ordered by the preset's block list since phase 56; `personas.depth` injects it among the turns since phase 61 (`server/prompt/blocks.ts:570`) | — |
| Lock a persona to a chat | **have** | `scenes.persona_id` *is* the chat lock: a roleplay takes a persona when its cast is first picked and keeps it. Deliberately no follow-the-default mode — the flag would be storage nothing reads (HANDOFF, phase 58) | — |
| Lock a persona to a character | **have** | phase 61; `characters.persona_id`, applied in `adoptPersona` and beating the default | — |
| Searchable / paginated list | **have** | phase 55 made it a screen with a search box (`client/screens/PersonasScreen.tsx:196`); the row was stale by six phases | — |
| Usage stats | **missing** | — | low priority |
| Backup / restore | **partial** | packs cover export/import broadly (`server/routes/packs.ts`) | verify, probably fine |

## 4. Group

Onsen's author model is a different and better architecture here, so most rows
are `have` or `rejected` rather than gaps.

| Capability | Onsen | Evidence | Verdict |
| --- | --- | --- | --- |
| Reply strategy | **have** | 4 strategies incl. a model classifier (`TurnStrategy`, `shared/types.ts:2179`) — stronger than ST's *Natural order* | — |
| Reorder members | **have** | `SceneMemberDto.displayOrder` | — |
| Bench a member | **have** | phase 62. **The row above was wrong.** `isActive` was *not* benching: `buildPromptContext` built `cast` from every member, so a benched character still appeared under "Also in this scene" — out of rotation and firmly in the prompt, which is a mute. `is_active = 0` now means out of the prompt entirely (`server/generation/context.ts:465`) | — |
| **Mute** a member | **have** | phase 62; `scene_members.is_muted`, and migration 0046 turns every existing bench into one, because that is what it already was | — |
| Allow self-responses | **missing** | — | judgement call under the author model |
| Auto mode, n turns | **have** | autopilot + `autopilotMaxTurns` (`shared/types.ts:1056`) | — |
| Group generation handling | **rejected** | §22: *"Don't add an independent-agent group mode… causes speaker-selection lotteries, characters speaking for each other, and merged personalities."* ST's own "swap/join character cards" is the thing being rejected | — |

## 5. Message surface

Every message in the screenshot carries `#46 · 27.3s · 868t` in its gutter.

| Capability | Onsen | Evidence | Verdict |
| --- | --- | --- | --- |
| Per-message id / elapsed / tokens / model | **have** (phase 55) | `MessageDto.generation` carries the record; `MessageBlock` renders `#4 · 20ms · ~126t · 10/s` in the gutter, untapped. Model on hover. Was: measured since phase 4, on no DTO | — |
| Timestamps | **have** | `createdAt` throughout | — |
| Actions on every turn | **have** (phase 57) | An always-visible row of six plus `…`, on every width — was three, hover-only, `isDesktop`-gated, hiding twelve commands from every phone | — |
| Exclude a turn from the prompt | **have** (phase 57) | `hide` existed and worked (`server/prompt/history.ts:125`); it now has a control and the turn dims. Verified by `historyIncluded` in the inspector, not by a text match | — |
| Swipe history reachable | **have** (phase 57) | The `versions` command, and a `◂▸` button on any turn with siblings | — |
| Avatars in the log | **have** (phase 57) | `LayoutDto.reader/author.avatar` + `avatarShape`; character pictures from `/api/characters/:id/avatar`, initial underneath so a character without one shows a letter | — |
| Bubbles vs flat | **have** (phase 57) | `LayoutDto.reader/author.bubble`, per side. Radius and border come from the theme, so a flat theme gets a flat bubble | — |
| Swipe counter | **have** | 54 hits for `siblings` | — |
| Swipe / reroll / edit / branch / continue | **have** | ops registry `server/tasks/registry.ts:102-108` | — |
| Auto-swipe | **have** | phase 63; `presets.auto_swipe_min_chars` and `_attempts`, decided in `maybeRetry` (`server/generation/service.ts:1678`). The rejected turn stays as a sibling — a swipe is not a delete | — |
| Auto-continue | **have** | phase 63; fires only on a *reported* `length` finish. `TokenChunk.finishReason` is new, normalised across providers in each adapter (`openai.ts:328`, `anthropic.ts:458`, `text.ts:216`) and guarded by `adapter-tools-conformance` | — |
| Smooth streaming / streaming FPS | **missing** | no render throttle in `client/lib/generation.ts` | low priority; revisit if streaming judders |

## 6. Chrome and settings

| Capability | Onsen | Evidence | Verdict |
| --- | --- | --- | --- |
| Themes, import/export, custom CSS | **have** | `server/routes/themes.ts`, 18 hits for `customCss` | — |
| Settings search + categories | **have** | phase 43 — ten categories plus a filter. This is the answer to ST's sixty-controls-one-page problem, and §22 now says so | — |
| Font scale / prose size | **have** (phase 55) | Set from `reading_scale` through `useReadingVariables` (`client/lib/viewport.ts`); `test/density.test.ts` asserts every prose token multiplies by it | — |
| Chat width / measure | **have** (phase 55) | `reading_measure`, 520–1100px, default 720 (was a 620px constant). Line spacing too | — |
| Row density | **have** (phase 55) | `.row` is 12px touch / 6px under `@media (pointer: fine)`; the hand-rolled list rows swept onto it. Measured 95px phone / 83px desktop on the same scene row | — |
| Avatar shape, blur, shadow | **partial** | theme tokens carry radius/shadow; no direct control | low priority |
| MovingUI (drag panels) | **rejected** | not a §21 clause, but a desktop-only affordance at odds with a layout that is one set of components unrolled (§16 layout direction) | — |
| STscript | **rejected** | §21: *"A scripting language beyond regex + event triggers."* Onsen has both (`server/routes/scripts.ts`, `triggers.ts`) | — |
| Extras API | **rejected** | deprecated in the incumbent itself; §21 excludes a code-executing extension runtime | — |

## 7. Extensions

What the install has loaded, against Onsen's native equivalent. This section is
mostly good news and was the biggest source of wrong first guesses.

| Extension | Onsen | Evidence |
| --- | --- | --- |
| Character Expressions | **have** | 107 hits; expression packs |
| Image Generation / Captioning / TTS | **have** | phase 41 (`server/routes/media.ts`) |
| Summarize | **have** | `SUMMARISE`, `RESUMMARISE` (`registry.ts:113`) |
| Regex | **have** | `server/routes/scripts.ts`, 101 hits |
| Vector Storage | **have** | data bank, 122 hits for embedding/retrieval |
| Tracker | **have** | 172 hits; trackers are first-class |
| Guided Generations | **have** | the ops registry *is* this — `NUDGE`, `STEER`, `EXPAND`, `CORRECT`, `IMPERSONATE` |
| Character Creator | **have** | `CREATE_CHARACTER`, `EXTRACT_CHARACTER`, `REVISE_CHARACTER` |
| **World Info Recommender** | **have** | `SUGGEST_LORE` (`registry.ts:97`) — *this row is why the evidence rule exists* |
| LoreBook Creator | **have** | `REVISE_LORE`, `SUGGEST_LORE` |
| Quick Reply | **have** (phase 65) | `grep -rliE 'quick.?reply' server client shared --include='*.ts' --include='*.tsx' --include='*.sql'` → 9 files: the `quick_replies` table (migration 0049), CRUD (`server/routes/quick-replies.ts`), and the composer row + sheet (`client/components/QuickReplies.tsx`). Firing one runs the stored prompt through the nudge path |
| Chat Translation | **have** (phase 78) | `grep -rn 'translate' server/translation server/routes/generation.ts | head` — the `translate` op, the `message_translations` table (migration 0050), and the *Translate* command. Display-only: the stored text and the prompt keep the author's language |
| Auto Background | **have** (phase 77) | `grep -rn 'background/generate' server client` → the route in `scenes.ts`, `drawBackground` in `media/runner.ts`, and the `Generate` button in scene setup. It reads the scene (or the reader's prompt) and files the image where an upload would go |
| Moonlit Echoes Theme | **have** | full theme system, import/export, custom CSS |

## 8. Deliberately not ported

Each of these is a real capability of the incumbent that Onsen will not have,
with the clause that says so. They are here so nobody re-proposes them as gaps.

- **Independent-agent / card-swapping group mode** — §22. The author model
  exists to prevent exactly the failure this causes.
- **A scripting language** — §21. Regex plus event triggers is the ceiling.
- **A code-executing extension runtime** — §21; §15 tiers 1–2 cover the need.
- **Extras API** — deprecated upstream, and §21 above.
- **Multi-user / shared-server play** — §21.
- **Per-speaker system prompts** — §22; it destroys prompt caching for nothing.

---

## Progress

**Phase 55 (done)** closed the reading controls, row density and the
per-message stats — the three rows marked *(phase 55)* above. Each was
re-verified by re-running its evidence command, not by editing the row.

**Phase 56 (done)** built the prompt manager: reorder, enable/disable,
per-block costs, and blocks a person writes — owned by the preset, since
`Output RULES` is template text rather than a per-roleplay choice. The importer
now lands a SillyTavern preset's prompts as that preset's blocks, so importing
one reproduces its prompt instead of a menu nobody switched on.

**Phase 59 (done)** gave roleplays tags, a folder and a favourite, filtered and
paged on the server.

**Phase 61 (done)** closed the persona group. Three of its five rows were things
the app already stored and could not reach — both `avatar_path` columns, and a
default persona `findDefaultPersona` never applied — and a fourth had been
`have` since phase 55 without the row being re-run. It also finished phase 59's
star, which had shipped on `characters` as a column, an index and a DTO field
with no route to set it.

**Phase 62 (done)** windowed the message log and split mute from bench. The
second half is why the evidence rule exists: the row said mute was missing and
bench worked, and it was the other way round — what the app had was a mute
under the wrong name, and nothing took a character out of the prompt at all.

**Phase 63 (done)** built both automatic retries on top of the ops that already
existed, so neither is a second inference path. The prerequisite was one nobody
had noticed: no adapter reported *why* a completion stopped, so there was
nothing for auto-continue to fire on. It fires on a reported `length` and never
on a guess.

**Phase 64 (done)** built both prompt-assembly policies. The first needed
structure before it needed a setting: example dialogue was one undifferentiated
string, so "drop an example when the budget tightens" had only ever one thing
to drop.

**Phase 65 (done)** built quick replies: a label and a prompt the reader writes
once and fires from the composer with one tap. The nudge path already did the
work a macro button needs, so this is storage plus a row of buttons — the
`quick_replies` table, its CRUD, and the composer row and sheet. The row's
evidence command was re-run before building: the row was the one honest
`partial` — nothing had been guessed wrong, the feature simply did not exist.

**Phase 77 (done)** built auto background: a scene background can now be
generated, not only uploaded, filed exactly where an upload would go.

**Phase 78 (done)** built display-only chat translation: a scene names a
language and a turn's *Translate* command renders it, without touching the
stored text or the prompt.

Then, in rough order of how early a session hits them: smooth streaming; web
search.
