# Third pass — the generation loop's unexercised half

The second review (`docs/UX-REVIEW-2.md`) shipped its five fixes (phases
196–200) and left a gap list: beats, autopilot, tool calling, the background
passes, and the tree interactions had never been exercised against a real
provider. This pass ran them all, live, against the same `data/onsen.db` and
the `nanogpt` provider. Everything mutated was restored from the snapshot.

The result is short because it is mostly "no defects". Each item is what the
second review's evidence bar required: run, observed, not read off source.

## Verified working

**Beats (`scope: "beat"`, SPEC §3.5).** A live beat generated three character
segments from `**Name:**` labels — Dusky, Elira Voss, The Warden — parsed with
`parseDegraded: false`, filed under the first speaker, and rendered as segments
in the DTO. The "Never lose text" and idempotent-splice contracts held.

**Autopilot (SPEC §6).** Enabled with `autopilotMaxTurns: 3`: a reply completed,
the loop armed, wrote three turns (each preceded by the addressed-check side
call), and stopped with reason `cap`. The turn counter, the `generationId`
ownership check, and the stop reason all behaved.

**Tree interactions.** Edit-in-place nulls `token_count` and sets `editedAt`;
reroll produces a sibling (`siblingCount` 1 → 2, `siblingIndex` 1); the
siblings endpoint lists both; rewind (`descend: false`) lands exactly on the
chosen point; checkpoint create/restore lands exactly on the bookmarked
message. No orphaned subtree, no leaf left dangling.

**Tool calling (the assistant, §25).** A live ask — "How many characters do I
have?" — emitted a `tool` event (`list_characters`), a `result` event, then the
correct answer streamed with the full fifteen-name list. Tool calling works on
a real OpenAI-compatible provider, which the first two passes never confirmed.

**Lore activation and summaries, by code path.** The lore trace is empty for a
scene with no bound lorebook (correct); `summariseEvict` is prompt-level
exclusion (`evictSummarized` → the builder's `evicted` list), never a database
delete — raw turns stay in the tree and the log. This is the safe reading of
"drop raw messages an injected summary covers" and is worth stating, since it is
the one place in §11 that *could* have been a data-loss bug and is not.

## What this pass did not reach

- The assistant's **write** tools (`update_character`, `create_scene`, …) — only
  a read tool was exercised.
- Trackers and summaries actually **firing** (trackers need enabling, summaries
  need a 20-turn threshold) — the runners were read, not triggered.
- VN stage/sprites, quick replies, vanish mode, document/reading modes.
- Text selection/copy and real screen-reader traversal.
- OS dark/light switching.
- Server-down mid-request, storage-full, and two-tab concurrent edits live.

No fixes were needed; no new phase was shipped.
