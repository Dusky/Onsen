# Second-pass review — Onsen, phase ~196

The first review (phase 188, `docs/UX-REVIEW.md`) was static: it never ran a
generation, never opened most screens, never tested first run, never exercised
the tree operations, and six of its findings had to be withdrawn. This pass
ran the generation loop end to end against the real `data/onsen.db` (two live
providers: `nanogpt` at nano-gpt.com, `DeepSeek` at api.deepseek.com), drove a
browser against every route, ran a fresh install from an empty database,
synthesised a 400-turn scene, and measured the error and cancel paths with a
mock provider that fails mid-stream.

Everything mutated during review was restored from a snapshot taken first
(`/tmp/onsen.db.bak`); the running install is byte-for-byte the original.

The single most useful result is the first finding, which is exactly the shape
the first review kept missing: **a feature wired to a value that never reaches
the code path the user actually hits, with a green test suite over it.**

---

## Tier 1 — the one that makes a shipped feature silently dead

### 1. The response cap is never sent to OpenAI-compatible or text-completion providers, so `max_response_tokens` is ignored and auto-continue can never fire on them

**What breaks.** The reader sets a maximum reply length (or leaves the default
1024). The prompt builder *reserves* that many tokens — trimming the prompt to
leave room — but the provider is never asked to stop there. Turns run to the
provider's own default cap or natural stop, so responses can be arbitrarily
long while the prompt was needlessly shortened. And **auto-continue**, the
retry that is *defined* (SPEC §13.6) as "the turn was cut off by the response
cap, so carry on", fires only on a reported `length` finish — which these
providers almost never report, because they were never told about the user's
cap.

**Evidence.**

- `server/adapters/openai.ts:214-231` — the request body is `model`, `messages`,
  `stream: true`, `tools`, and samplers. No `max_tokens`.
- `server/adapters/text.ts:141-151` — same, no `max_tokens`/`n_predict`/
  `max_length`.
- `server/adapters/anthropic.ts:346-351` — the one adapter that *does* send it
  (`max_tokens: prompt.debug.reservedForResponse`), and only because Anthropic
  requires it.
- `server/generation/service.ts:2034` — auto-continue branches on
  `generation.meta.finishReason === "length"`; nothing else.
- **Measured, not inferred:** set `max_response_tokens = 24` on the Default
  preset and generated on `nanogpt` (openai_compatible). The turn came back
  **126 completion tokens with `finishReason: "stop"`** — the 24-token cap was
  never applied, so no `length` event, so no auto-continue.
- The test suite only asserts `max_tokens` for Anthropic
  (`test/adapter-anthropic.test.ts:207-213`). Nothing asserts it for the
  OpenAI-compatible adapter, which is why this shipped.

**Severity.** High, defect. Not a judgement call: SPEC §13.6 says the cap that
triggers auto-continue *is* `max_response_tokens`; the prompt builder already
reserves it (`server/prompt/index.ts:179`), so the intent to cap is in the
code — it just never reaches the wire. The fix is a few lines per adapter
(`max_tokens: prompt.debug.reservedForResponse`, `n_predict` for text) with a
floor, plus one test.

**Why it's not already intended.** Nothing in `docs/SPEC.md` §4 or §13
sanctions omitting the cap for chat-shaped providers; `max_tokens` is
universally accepted by every OpenAI-compatible server the adapter claims to
support (OpenAI, OpenRouter, Ollama, llama.cpp, KoboldCpp, TabbyAPI, LM Studio).
Phase 63's own commit message describes auto-continue firing "when the turn was
cut off by the response cap" — a cap that, for two of the three provider kinds,
is never applied.

---

## Tier 2 — the cancel / error seam

### 2. "Stop" commits the partial turn to the story, and nothing says so

**What breaks.** The reader stops a turn that is going wrong; a mid-sentence
fragment ("The Warden drank from his cup. Set it down with") becomes the
scene's newest story turn and the active leaf, with no indication that this
happened.

**Evidence.** Reproduced against the real provider: start a generation, cancel
after the first token, and the 47-character partial lands as a `spotlight`
message and becomes `active_leaf_id`
(`server/generation/service.ts` `finish()` → `land()` → `appendMessage`, which
unconditionally moves the leaf). The control is labelled just "Stop"
(`client/screens/chat/MessageLog.tsx:281-285`, `strings.chat.stop`). There is no
"kept" notice and no "undo".

**Severity.** Medium, judgement call. Keeping the partial is deliberate — SPEC
§5.6 "aborts and persists partial output", and the service comment defends it
("partial output is still the user's text"). What is missing is the *communication*:
a button that says "Stop" does not tell the reader the fragment will be written
into the story, and a mid-sentence fragment is rarely the outcome they want. A
label like "Stop and keep" — or a one-tap undo/delete on the landed fragment —
would close the gap without changing the contract.

**Why it's not already intended.** The keep is intended; the silent landing as
the *active* turn is not defended anywhere. Contrast the ban-list retry, which
goes out of its way to *record why* a turn was passed over
(`service.ts` `maybeRetry`), on the same principle — a reader should not find a
turn that was silently changed. Here the reader finds a turn that was silently
*added*.

### 3. A mid-stream error drops the partial text, and the client hides the reason

**What breaks.** When the provider dies mid-stream, the text the reader watched
arrive is discarded (not landed), and the error strip shows only "The
generation failed." — the useful detail is computed, sent, and then thrown away
by the client.

**Evidence.** A mock provider streaming three chunks then failing produced an
SSE `error` event carrying `message: "The generation failed."` **and**
`detail: "The socket connection was closed unexpectedly."`
(`server/generation/service.ts` `fail()`/`describeFailure`). The client's
`settle()` passes only `event.message ?? null` (`client/lib/generation.ts:144-147`),
and `MessageLog.tsx` renders only `active.error`. Reproduced: the browser shows
the generic sentence, never the detail.

**Severity.** Low-medium, defect. Two small things: pass `detail` through
`settle` and show it under the message, and note the asymmetry with cancel
(which keeps the partial, #2) — a reader sees text vanish on error and appear
on cancel, with no explanation of either.

**Why it's not already intended.** `describeFailure` computes `detail` precisely
so it can reach the reader; the SSE event carries it. The client dropping it is
an accident of the `settle` signature, not a decision.

---

## Tier 3 — the outbound OpenAI-compatible surface

### 4. Streaming errors and cancellations are reported as `finish_reason: "length"`

**What breaks.** A bot or terminal using `/v1/chat/completions?stream=true` sees
a clean-looking completion that just stops, when the generation actually failed
(or was cancelled). The non-streaming path returns a 502 with the error
envelope; the streaming path does not distinguish "done" from "failed" at all.

**Evidence.** `server/routes/openai.ts:443` —
`send(chunk({}, event.type === "done" ? "stop" : "length"))`, followed by
`[DONE]`. Both `error` and `cancelled` map to `length`. Separately,
`recordRequest` is told the request succeeded *before* the stream runs
(`finish(200, warning)` at `server/routes/openai.ts:332`), so a streaming
request that later errors is logged as HTTP 200.

**Severity.** Low (the surface is off by default and per-scene, per SPEC §19).
Defect — the two paths of the same endpoint disagree about what a failure
looks like.

**Why it's not already intended.** The non-streaming half returns
`{ error: … }` with 502 on failure (`server/routes/openai.ts:345-352`); the
streaming half has no error channel at all. SPEC §19's whole point is that the
two surfaces run the *same* pipeline.

### 5. Every avatar-less character message fires a 404 avatar request

**What breaks.** Nothing user-visible — the initial letter renders through the
failed image — but the chat screen issues a 404 for
`/api/characters/:id/avatar` for every message spoken by a character with no
portrait, every time the log renders.

**Evidence.** `client/components/MessageBlock.tsx:604-613` builds the avatar URL
from `message.characterId !== null` alone; `MessageDto` has no `hasAvatar` field
(`shared/types.ts`, the `hasAvatar` fields are on `SceneMemberDto`/`CharacterDto`
etc., not on the message), so the component cannot know to skip. Every other
avatar caller guards with `hasAvatar` (`CastRail.tsx:181`, `CastStrip.tsx:123`,
`DockPanels.tsx:924`, `CharacterEditorScreen.tsx:316`). Reproduced: a chat visit
logs `http 404 …/avatar`.

**Severity.** Low, defect (cleanliness). Fixing means carrying `hasAvatar` on
the message DTO (or a speaker map) and skipping the `backgroundImage`.

**Why it's not already intended.** The component's own comment says it "falls
back to an initial rather than to a broken image" — the intent is graceful
fallback, which a 404 request is not; it is the *absence* of a request that the
other six call sites already achieve.

---

## The pattern, again

Finding 1 is the fourth instance of the sentence phase 193 named, in its purest
form: **a feature whose trigger is wired to a value that never reaches the code
path the user actually hits, with a green test suite over it.**

- 182 — Test button hit a different URL than a turn.
- 189 — count measured a different set than the log.
- 195 — contrast guard read `builtin.ts` while the app read the `themes` table.
- **here** — auto-continue reads `max_response_tokens` off the preset, but the
  OpenAI/text adapters never send it, so the trigger never fires on them. The
  tests passed because the only adapter that is *required* to send `max_tokens`
  (Anthropic) is the only one tested for it.

The fix shape is the same as 189/195: make one server-resolved answer that
everyone reads — here, send the builder's own `reservedForResponse` as the cap,
and add a conformance test that every adapter sends it.

---

## What I checked and found nothing (a result, not padding)

- **Settings export/import round-trip.** Export spreads `preferences()`; import
  applies the same `apply*` functions the PATCH uses. No divergence.
- **Migration vs fresh-install.** Fresh install (`ONSEN_DATA_DIR=/tmp`) ran all
  79 migrations cleanly; theme seeder reconciles builtin palettes on boot
  (phase 195) and the option-group seeder reconciles structure
  (cardinality/sort_order). No remaining insert-and-skip seeder found.
- **`runsOn` (scene list) vs `resolveRoute` (generation).** Consistent, and
  cross-checked by `test/providers-presets.test.ts`.
- **First run.** Setup wizard *requires* a connection (the "no providers" state
  is not reachable through it — that is a deliberate gate, not a gap). Demo seed
  is idempotent: 3 characters, one scene with an opening line, one guide
  document. The "no connection" path (a scene whose profile is null) surfaces
  the `no_connection` error with a "Set profile" button.
- **OOC channel + the phase 189 fix, exercised for real.** Rewind to the root,
  ask an OOC question: the answer lands as `ooc` (not counted in `turnCount`),
  `lastLine` still reads the story, and `strandedStory` reports
  `{turns: 5, leafId}` with the "Back to the story" affordance rendered.
- **Large scene.** 400-turn scene: `GET /scenes/:id` 6.8ms full, 5.6ms windowed,
  tree 3.9ms. Virtualisation engages past 200 messages; expanding the reading
  window preserved scroll position; the "N earlier turns" indicator and
  "400 turns" header both present.
- **Screens.** Characters, character editor, authors, author editor, personas,
  lorebooks, backgrounds, and Settings — including Automation (regex scripts +
  triggers), Connections out (API keys + webhooks), Packs & updates,
  Background tasks, Pictures & voices — all render with no console errors.
- **Viewports.** 320px, tablet, 1600px: no horizontal overflow. Browser zoom
  150% and 200%: no overflow. `prefers-reduced-motion` honoured via
  `data-motion` + the CSS media query.
- **Import/upload edge states.** Malformed preset/character/lore files and
  5MB oversized uploads are refused with clear 400/413 messages.
- **Command palette** opens on ⌘K and lists the commands.

## What I did not get to

- **Beats and group scenes.** I exercised spotlight turns only; never ran a
  beat generation, "One voice / The room", recast, or split-beat as a live
  interaction.
- **Autopilot** end to end (the loop, its stop conditions).
- **Tool calling** against a real tool-capable provider (the assistant, §25).
- **Trackers, summaries, lore activation** firing as automatic background
  passes (I observed guides auto-generating; not the other three).
- **Swipe / reroll / branch / edit-in-place / checkpoint restore as touch
  gestures** — I exercised the underlying tree semantics at the API level
  (`appendMessage`, `setActiveLeaf`, `deleteMessage`, `descendToLeaf`) but not
  the gesture layer.
- **VN stage/sprites, quick replies, vanish mode, document/reading modes** in
  depth (opened, not exercised).
- **Text selection/copy and actual screen-reader traversal** (only accessible
  *names* were checked, same as the first review).
- **OS dark/light switching** — the theme is DB-driven rather than OS-driven by
  design, so the OS toggle is a no-op; I did not verify the `themeBase`
  fallback on a theme-less install.
- **Server-down / storage-full / two-tab concurrent edits** at the UI level —
  the SSE divergence logic reads correct and is well-tested; I did not drive
  two live tabs against it.
