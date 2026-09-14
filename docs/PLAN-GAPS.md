# Plan — remaining SillyBunny-derived gaps

Global search shipped (phase 211). Two gaps remain, both genuinely multi-phase
builds. These are phase-ready specs, not placeholders.

## 1. Conversation mode

A messaging-client rendering of a scene, as a per-scene toggle. The prose
surface (manuscript, `MessageBlock`) stays the default; conversation mode is
the casual alternative — the same tree, the same history, a different skin.

### What it is

- Messages render as left/right bubbles (reader right, the cast left, each
  character keeping their colour), with a light timestamp per bubble, the same
  shape `OocChannel`'s `Bubble` already draws.
- The composer stays pinned at the bottom, messaging-shaped (send on Enter,
  Shift+Enter for newline).
- On a scene with `conversation` mode on, the log uses this rendering; the
  rails and header are unchanged.

### Where it lives

- `scenes.conversation_mode` column + migration + `SceneDto.conversationMode`.
- A `ConversationLog` component beside `MessageLog`, or a render-mode branch
  inside `MessageBlock` keyed off the scene flag. Prefer the latter if the
  diff stays small; `MessageBlock` already branches heavily on `layout`.

### Scope decisions to make first

- Do timestamps use the message `created_at`, and do they show for every
  message or only across a gap in time?
- Does the reader's own persona bubble show an avatar/name, and does the cast
  keep its character colours?
- Does conversation mode change the *prompt* (SillyBunny ships a distinct
  system prompt for it), or only the *rendering*? Recommend rendering-only for
  the first phase; a conversation prompt is a separate, riskier change.

## 2. Agents as discoverable templates

Onsen has the machinery — passes (revision), guides, trackers, summaries, and
extension post-generation tasks — but it is presented as "Background tasks",
not as "agents", and there are no bundled templates a reader picks from.

### What it is

- Rename/reframe the Settings → Background tasks surface as **Agents**, grouped
  by stage: *before the turn*, *alongside the turn*, *after the turn* — the
  same pre/sidecar/post framing SillyBunny uses, mapped onto the ops Onsen
  already has (classifier and nudge are "before", guides/trackers/summaries/
  passes are "after", and extensions can be any stage).
- Each agent card shows its description, its routing (profile), and its
  enable/auto-trigger state — the `OpFields` editor re-presented, not rewritten.
- Add a small set of **bundled agent templates** as extensions (the existing
  extension system already supports pre/sidecar/post stages): a prose polisher,
  a choice marker (what the reader can do next), and a tracker — so a new
  reader sees agents working out of the box.

### Scope decisions to make first

- Templates are extensions (reuse `server/extensions`), or a new first-class
  "agent" table? Extensions are the honest answer: they already run
  pre/sidecar/post and the manager exists.
- Where the surface lives: Settings → Agents (renamed from Background tasks),
  and a rail panel? Recommend Settings-first, rail only if asked.

## Ordering

Both are independent. Conversation mode is the more user-visible win and the
more self-contained (one column + one render branch); agents is mostly a
rename + three bundled extensions. Start with conversation mode if you want a
visible product change first, or agents if you want the smaller diff.
