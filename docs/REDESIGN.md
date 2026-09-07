# The redesign

The user's mockup (`Onsen Redesign.dc.html`) is the target. It is a full visual
and structural redesign of the desktop shell, not an incremental pass. This
records the shape and the build order.

## The shape

- **Header** — a mono `onsen` wordmark, the current scene title + turn count, a
  model chip (green dot + name + `q5 · 32K · 41 t/s`), prose-size controls, a
  Dark/Light toggle, and the two panel toggles.
- **Left: an icon rail + a section panel.** A 46px rail — Σ Prompt, ⌇ Preset,
  ◇ Lore, ≡ Guides, ⋯ Settings — expands a 326px panel with the selected
  section: Prompt (the budget bar, the blocks, the evictions), Preset (samplers,
  how-it-writes, the ban list), Lore (what fired), Guides (injected now).
- **Right: In this scene / Characters / Authors.** The scene cast with
  One-voice/Whole-room; the character library with an inline editor; authors
  with an inline editor. Token counts and `% of context` everywhere, with a Save
  footer.
- **Composer** — `Direct:` chips (Nudge, Steer scene, Draft my turn, Autopilot),
  a steering indicator, and a Send button that names who will reply.
- **Turns** — avatar initials, `turn N · X tok · n of m`, hover actions,
  collapsible reasoning, OOC as a box, a streaming cursor.

## The build order

1. **Foundation** — fonts and palette. *(done, phase 88)*
2. **The left icon rail and its four sections** — Prompt, Preset, Lore, Guides.
3. **The right panel** — In this scene / Characters / Authors, with the inline
   editors.
4. **The header** — scene title, model chip, prose size, theme, toggles.
5. **The composer and the turns** — the Direct chips, the Send button, the turn
   gutter and reasoning.

Each phase re-skins on top of the previous, and each lands a guard so the shape
cannot quietly drift back.
