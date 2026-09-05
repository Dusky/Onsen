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
| Reorder prompt blocks | **partial** | `blockOrder` consumed `server/prompt/index.ts:49`, typed `types.ts:434`; `grep -rn blockOrder client/` → 0 | close — the flagship gap |
| Enable/disable a block | **missing** | `grep -rniE 'blockEnabled\|enabledBlocks\|disabledBlocks'` → 0 | close, with the reorder UI |
| User-authored prompt blocks | **missing** | no concept in `PromptBlockId`; the install has 5 (`USER Consent`, `Output RULES`, `Prefill only and only for gemini`, `<DATA_history>`, `</history>`) | close — needs a data model decision |
| Per-block token count | **partial** | `GuideDto` caches one (`shared/types.ts:1396`); no per-block figure in the manager, because there is no manager | close with the UI |
| Prompt inspector | **have** | `client/components/Inspector.tsx`, `InspectorSheet.tsx` | — |
| Seed | **have** | 74 hits across shared/server/client | — |
| Reasoning config | **have** | `ReasoningConfigDto` `shared/types.ts:196` | — |
| Tool calling on any provider | **have** | phase 48; `test/adapter-tools-conformance.test.ts` | — |
| Example-message eviction policy | **missing** | ST offers *Gradual push-out / never / always*; no equivalent in `server/prompt/` | close — cheap, and it changes every long scene |
| Squash consecutive system messages | **missing** | `grep -rni squash` → 0 | close — one flag, affects coherence |
| Web search | **missing** | `grep -rniE 'webSearch\|web_search'` → 0 | judgement call — backend-dependent |

## 2. Library at scale

The screenshot's chat list is `1-50 .. 139` with tags, folders and favourites.
Onsen's equivalent got search and sort in phase 54 and nothing else, and its
own source comment predicted this: *"if a library ever gets big enough to hurt,
the fix is pagination."*

| Capability | Onsen | Evidence | Verdict |
| --- | --- | --- | --- |
| Search chats | **have** | phase 54, `client/screens/ScenesScreen.tsx` | — |
| Sort chats | **have** | phase 54 — recency / title / length | — |
| Tag a chat | **missing** | `tags` is on `CharacterDto` only (`shared/types.ts:1955`) | close |
| Folder a chat | **missing** | `folder` likewise (`shared/types.ts:1962`) | close |
| Favourite anything | **missing** | `grep -rni favorite` → 0 | close — cheapest of the three |
| `n of m` readout on a list | **have** (phase 55) | `strings.showing`; the scenes list reads `3 of 5` when filtered, `5` when not | — |
| Pagination / windowing | **missing** | no `LIMIT` for list reads in `server/db/queries/history.ts`; ST ships *# Msg. to Load = 100* | close — 139 is the number that makes it real |
| Character tags / folders / search | **have** | `CharacterFilterQuery`, server-side since phase 26 | — |
| Character grid view | **have** | phase 26 | — |

## 3. Persona

Phase 54 made personas editable. The install shows how much further it goes.

| Capability | Onsen | Evidence | Verdict |
| --- | --- | --- | --- |
| Create / edit / delete | **have** | phase 54 | — |
| Description reaches the prompt | **have** | phase 54; `personaBlock()` `server/prompt/blocks.ts:149` | — |
| Persona avatar | **partial** | `personas.avatar_path` exists in `0005_authors.sql`; nothing reads or writes it | close — schema is already there |
| Position in the prompt | **missing** | ST offers *In Story String / Prompt Manager*; `personaBlock` is fixed | close with the prompt manager |
| Lock a persona to a chat | **partial** | `scenes.persona_id` sets it per scene; no lock, no auto-lock | close |
| Lock a persona to a character | **missing** | no per-character default anywhere | close |
| Searchable / paginated list | **missing** | phase 54 shipped a `Sheet` with a flat list — wrong shape at 23 | close; §16 density rule 3 says this was a sheet that should have been a screen |
| Usage stats | **missing** | — | low priority |
| Backup / restore | **partial** | packs cover export/import broadly (`server/routes/packs.ts`) | verify, probably fine |

## 4. Group

Onsen's author model is a different and better architecture here, so most rows
are `have` or `rejected` rather than gaps.

| Capability | Onsen | Evidence | Verdict |
| --- | --- | --- | --- |
| Reply strategy | **have** | 4 strategies incl. a model classifier (`TurnStrategy`, `shared/types.ts:2179`) — stronger than ST's *Natural order* | — |
| Reorder members | **have** | `SceneMemberDto.displayOrder` | — |
| Bench a member | **have** | `SceneMemberDto.isActive` | — |
| **Mute** a member | **missing** | `isActive` is benching — out of rotation *and* out of the prompt. ST's mute keeps a member present but silent | close — they are not the same state |
| Allow self-responses | **missing** | — | judgement call under the author model |
| Auto mode, n turns | **have** | autopilot + `autopilotMaxTurns` (`shared/types.ts:1056`) | — |
| Group generation handling | **rejected** | §22: *"Don't add an independent-agent group mode… causes speaker-selection lotteries, characters speaking for each other, and merged personalities."* ST's own "swap/join character cards" is the thing being rejected | — |

## 5. Message surface

Every message in the screenshot carries `#46 · 27.3s · 868t` in its gutter.

| Capability | Onsen | Evidence | Verdict |
| --- | --- | --- | --- |
| Per-message id / elapsed / tokens / model | **have** (phase 55) | `MessageDto.generation` carries the record; `MessageBlock` renders `#4 · 20ms · ~126t · 10/s` in the gutter, untapped. Model on hover. Was: measured since phase 4, on no DTO | — |
| Timestamps | **have** | `createdAt` throughout | — |
| Swipe counter | **have** | 54 hits for `siblings` | — |
| Swipe / reroll / edit / branch / continue | **have** | ops registry `server/tasks/registry.ts:102-108` | — |
| Auto-swipe | **missing** | reroll automatically on short or blocked output | close — cheap given the ops path exists |
| Auto-continue | **missing** | continue automatically on a length-capped finish | close, same |
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
| Quick Reply | **partial** | ops are fixed buttons; no user-defined macro button |
| Chat Translation | **missing** | no translation path |
| Auto Background | **partial** | per-scene backgrounds exist (`SceneDto.hasBackground`); nothing generates one |
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

**Phase 56 is the prompt manager**: reorder, enable/disable, per-block token
counts, and the data-model decision about user-authored blocks (the install
carries five: `USER Consent`, `Output RULES`, `Prefill only and only for
gemini`, `<DATA_history>`, `</history>`). The largest single item here, and the
one that most changes what the app is for.

Then, in rough order of how early a session hits them: scene tags / folders /
favourites with windowing; the persona list becoming a screen with search, plus
position, avatar and locking; mute-vs-bench; auto-swipe and auto-continue;
example-message eviction and squash.
