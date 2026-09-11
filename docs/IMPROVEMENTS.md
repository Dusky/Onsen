# App improvement plan

**Status:** items 1–7 done (phases 71–78). Self-responses, listed below as
conditional on a product conversation, in fact had that conversation and
shipped as phase 155 — this file went unedited across that phase, the same
way `NEXT.md` and `GAPS.md` did, so treat this doc as closed rather than
live. What's left of item 8 is: smooth streaming, only if it judders, and web
search, after a provider decision. The redesign (phases 88–99, `REDESIGN.md`)
superseded the shell work this plan assumed, so nothing here is a live gap.

Written at phase 71. Ordered by felt improvement per hour of work, which has
been the thread of every review since phase 65. Each item is its own phase —
its own commit, its own guard, verified in a browser at 390×844 with
`hasTouch: true` and 1440×900 in both themes through the app's own picker.

## 1. Providers and profiles expand in place

The background tasks already do this (phase 71). Providers and profiles are the
same class — a row with a handful of fields — and still open a bottom sheet on
a desktop.

- **Done looks like:** clicking a provider or profile row expands its fields
  into the row on desktop; the phone keeps the sheet. The create-new form
  appears inline at the top of the section rather than as a sheet.
- **Guard:** extend `test/settings-inline.test.ts` to assert the provider and
  profile bodies are one component each, used by both the sheet and the inline
  row.

## 2. The preset editor gets a pane

The preset editor is too large for an accordion — samplers, the prompt manager,
reasoning, retries, the example-eviction policy. On desktop it deserves a
full-width editing surface beside the list rather than a bottom sheet.

- **Done looks like:** on desktop, choosing a preset opens its editor in a
  pane beside the preset list; on the phone it stays a sheet.
- **Guard:** `reachable` already covers the routes; a structural test that the
  preset editor renders in a pane on desktop and a sheet on a phone.

## 3. Repair: the setup wizard is broken

Found during phase 65. `SetupScreen` mounts `ModelPicker`, which calls a
react-query hook, but `App` only wraps the authenticated shell in
`QueryClientProvider`. A real first run in a browser lands on a blank page
("No QueryClient set"). The API path works, which is why no test caught it.

- **Done looks like:** the wizard renders in a browser. The provider is made
  available to the setup screen (and the login screen, for symmetry).
- **Guard:** a test that renders `SetupScreen` through `createApp`/the harness
  and finds the form — or, failing a DOM test, a structural assertion that
  `SetupScreen` sits inside the provider.

## 4. Repair: a theme's `base` flag does nothing

Found during phase 66. `dark` vs `light` is stored and round-tripped, but
nothing sets `data-theme` on the document from it, so a theme renders dark or
light only through the colours it happens to name.

- **Done looks like:** the active theme's `base` sets `data-theme` on the
  document root, early enough that the login screen is correct. A tokenless
  dark theme renders dark on a light-OS machine.
- **Guard:** a test in `test/themes.test.ts` that a `base: "dark"` theme emits
  the dark base marker, and the client applies it.

## 5. Dead query exports, measured

Phase 60 found 21 of 310 exported functions in `server/db/queries/` referenced
nowhere outside their own file. Two were real bugs; 19 were never looked at,
and `findDefaultPreset` is flagged as behaviourally significant.

- **Done looks like:** a `test/dead-exports.test.ts` guard with a `DELIBERATE`
  map, in the shape `dead-columns` uses, plus an audit of the 19 — each one
  deleted or given a reason.
- **Guard:** the new test, plus the existing full suite proving nothing
  depended on what was deleted.

## 6. Auto background (GAPS §7)

Per-scene backgrounds exist (`SceneDto.hasBackground`) and nothing generates
one. The media services from phase 41 already draw pictures.

- **Done looks like:** a background task that reads the scene and asks the
  configured image service for a background, stored where `hasBackground`
  points, with a control to fire it from the scene.
- **Guard:** `reachable` for the endpoint; a media test that a scene with an
  image service produces a background asset.

## 7. Chat translation (GAPS §7) — decide first

No path exists. Display-only (a `display_only`-shaped layer, the prompt keeps
the original language) is almost certainly right.

- **Done looks like:** a decision recorded in SPEC, then a display-only
  translation path with a per-scene language choice.
- **Guard:** a test that the stored text and the prompt keep the original while
  the log shows the translation.

## 8. The conditional / low ones

- Smooth streaming — only if streaming judders; a render throttle in
  `client/lib/generation.ts`.
- Web search — needs a provider decision, not an implementation.
- ~~Self-responses — a conversation under the author model, not code.~~ Done,
  phase 155 (`scenes.allow_self_responses`, migration 0071).
- Usage stats, avatar shape/blur/shadow — low priority by their own rows.
