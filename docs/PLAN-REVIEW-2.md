# Plan — second-pass fixes

Ranked by (user impact) ÷ (effort to fix), following the house pattern: one
phase, one defect, a test that fails before and passes after, and a browser
verification where the defect is user-visible.

---

## Phase 1 — Send the response cap (the headline fix)  ✅ done

**The defect.** `max_response_tokens` is reserved by the prompt builder but
never sent to OpenAI-compatible or text-completion providers, so the cap is
ignored and auto-continue (which fires only on a reported `length`) can never
trigger on them.

**Shipped** in `docs/PHASES.md` phase 196. Both adapters send
`max_tokens: prompt.debug.reservedForResponse` when the builder reserved
something; three tests (the two per-adapter files plus a shared
`test/adapter-response-cap.test.ts` over `PROVIDER_KINDS`). 1937 tests pass,
typecheck clean, and verified live: `max_response_tokens = 24` came back 26
tokens with `finishReason: "length"` (was 126 / `"stop"`), and `auto_continue =
1` fired the continue chain — the first time on an OpenAI-compatible provider.

---

## Phase 2 — Say what "Stop" keeps  ✅ done

**The defect.** Cancel lands the partial turn as the scene's active message
with no indication; the button says only "Stop".

**Shipped** in `docs/PHASES.md` phase 197. `client/lib/generation.ts` `cancel()`
reads the cancel response's `buffer` and, when it is non-empty, posts a
"done" notice (`strings.chat.stoppedKept`) — the contract (§5.6) stays, and
now the reader is told what it did. A source-level test in
`test/notices.test.ts` asserts the wiring and that it fires only when something
was kept. Verified in the browser: cancel after the first token shows the
notice over a 133-character partial.

---

## Phase 3 — Show the real reason for a mid-stream error  ✅ done

**The defect.** The client drops the `detail` field of the SSE `error` event,
so the reader sees only "The generation failed." instead of "…socket connection
was closed unexpectedly."

**Shipped** in `docs/PHASES.md` phase 198. `client/state/generation.ts` stores
`errorDetail` beside `error`; `client/lib/generation.ts` passes
`event.detail ?? null` through `settle`; `MessageLog.tsx` renders it under the
summary when present. Verified in the browser against a mock provider that
fails mid-stream: the strip reads "The generation failed. / The socket
connection was closed unexpectedly…". 1938 tests, typecheck clean.

---

## Phase 4 — OpenAI surface: the cheap half, and document the rest  ✅ done

**The defect.** Streaming errors/cancellations are reported as
`finish_reason: "length"`, and `recordRequest` logs HTTP 200 before the stream
runs.

**Shipped** in `docs/PHASES.md` phase 199. The streaming request is now
recorded when the stream settles — error → 502, done/cancel → 200 — through an
`onSettled` callback into `streamCompletion`, instead of logging 200 up front.
The error/cancel → `length` mapping stays (OpenAI's stream has no error
channel, and a non-standard `finish_reason` would break SDKs), and is now
documented at the `streamCompletion` doc comment. New test in
`test/openai-api.test.ts` asserts a streaming failure records 502. 1939 tests,
typecheck clean.

---

## Phase 5 (polish) — Stop the avatar 404  ✅ done

**The defect.** Every avatar-less character message requests
`/api/characters/:id/avatar`, 404ing, because `MessageDto` has no `hasAvatar`.

**Shipped** in `docs/PHASES.md` phase 200. `MessageDto.hasAvatar` is resolved
in `toMessageDto` from a new `SpeakerLookup.hasAvatarById` (character turns
only; the reader/author pictures stay gated by their layout toggles), and
`MessageBlock`'s `Avatar` skips the `backgroundImage` request when false. Tests
in `test/greetings.test.ts` assert both directions (PNG card → true, JSON card
→ false). Verified in the browser: a chat with three avatar-less characters
issues zero `/avatar` requests. 1940 tests, typecheck clean.

---

## Order and rationale

All five phases are done (see `docs/PHASES.md` phases 196–200).
