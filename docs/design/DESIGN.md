# Handoff: Onsen — Group Roleplay Frontend

## Overview

A self-hosted, mobile-first web app for collaborative fiction. One user roleplays with a single AI **author** — a writing partner with its own personality — who plays a cast of characters the way a GM runs a table. The user mostly *directs* rather than writes: nudging the plot, choosing who speaks next, correcting a line, letting the scene run on autopilot for a few turns.

The interface's single job: **let someone steer a scene with a thumb.**

This bundle covers the chat screen (the product), eight supporting screens, and the desktop layout.

---

## ⚠️ Naming is provisional

**Every product noun in these files is a placeholder and will be renamed during production.** Do not treat any of the following as settled vocabulary:

`Roleplay` / `Scene` · `Author` · `Cast` / `Character` · `Persona` · `Guides` · `Lorebook` · `Steer` · `Nudge` · `Guided swipe` · `As me` / `Impersonate` · `Autopilot` · `OOC` / `Off script` · `Cued` / `Benched` / `In play` · `Reply` vs `Message` · `Ops`

Two consequences for implementation:

1. **Do not hardcode these strings in components.** Route every user-facing label through a single strings/i18n module (`strings.ts`, `en.json`, whatever the codebase already uses) so a rename is one file, not a hunt.
2. **Do not derive type names, DB columns, route paths, or CSS identifiers from them either** where you can avoid it. Where a domain name is genuinely needed in code, pick it from `SPEC.md` (the engineering source of truth), not from these mocks.

Also note the mock files contain a *mixed* vocabulary on purpose — the desktop file (`Onsen Desktop.dc.html`) uses the later, more roleplay-native wording ("with Kestrel", "4 in play", "replies"), while the two mobile files still carry earlier screenplay-flavoured wording ("Scene 14", "INT. RIDGE STATION — 03:40", "messages"). **The desktop wording is the more correct of the two, but neither is final.** Where they disagree, prefer desktop, and expect production to replace both.

---

## About the design files

The files in this bundle are **design references created in HTML** — prototypes showing intended look and behaviour. They are **not production code to copy**.

They are authored as "Design Components" (`.dc.html`), a streaming-preview format used in the design tool. They are all-inline-styles, single-file, and depend on a `support.js` runtime that is *not* part of the deliverable. Do not attempt to run, port, or extract this runtime.

**The task is to recreate these designs in the target codebase's existing environment** — React, Vue, Svelte, whatever is already there — using its established component patterns, styling approach, and libraries. If no environment exists yet, choose the framework appropriate for a self-hosted, installable (PWA) mobile-first web app and implement the designs there.

Read the HTML for exact values (hex, px, weights); do not lift its structure.

## Fidelity

**High-fidelity.** Colors, typography, spacing, and layout are final and intended to be matched precisely. Interaction behaviour is *specified in this document* but only *depicted* in the mocks — the prototypes are static frames, not working prototypes. Every state described under "Interactions & behaviour" needs to be built.

Imagery (character portraits, sprites, scene backgrounds, the VN stage) is represented by diagonal-stripe placeholders. Those are placeholders for user-supplied images, not a visual treatment to reproduce.

---

## The design system

Everything below follows from three rules. If a new screen is needed that isn't in this bundle, these rules should generate it.

### 1. Two voices, two typefaces

| Voice | Face | Used for |
| --- | --- | --- |
| **The user's material** | Spectral (serif) | Prose, character descriptions, titles, lorebook content, anything the user wrote or the author generated as story |
| **The app speaking** | IBM Plex Mono | Attribution, labels, token costs, state, buttons, director reasoning, all chrome |

This is the identity. The app never sets its own chrome in the serif, and never sets story content in the mono. The one deliberate exception is the **OOC voice**, which is the author speaking as itself — set in mono, but at a larger reading size (12.5–13px) rather than label size, and in the blue-pencil color. It reads as "a person typing at you", not "a UI label".

Archivo (sans) appears only in the annotation layer *around* the mocks on the design canvas. **It is not part of the product UI.** Do not use it.

> **Amended in production (phase 47).** A second exception now stands beside the
> OOC voice: the app's *explanations* — help lines under a field, empty states,
> error sentences — are set in Spectral at 13.5px. The argument is the one this
> section already makes for OOC: a sentence meant to be read is not a label
> meant to be scanned. Mono keeps labels, state, numbers and buttons. The rule
> is now **mono names, Spectral speaks**. See `SPEC.md` §16 for the four roles
> and `test/typography.test.ts` for what enforces them.
>
> This bundle drew nine screens. The app has many more, and the type table
> below has no entry for a heading over a *group* of fields — which is why the
> nine-screen `section-label` ended up doing that job 167 times. Phase 47 added
> that level; the table below is otherwise unchanged and still governs.

### 2. Two pencils

Editorial marking metaphor. Two accents, no others.

> **Amended in production (phase 50).** A third hue family joins the two
> pencils, in one place: the deck's readout row, where each subsystem states
> what it is holding. Guides keep the blue pencil; memory takes the green this
> document reserves for Settings; media takes a brass. The argument is the one
> below — *nothing else is coloured* was written for a screen showing one
> thing at a time, and four figures side by side in a single colour read as one
> figure. **Red is not among them**, which is what keeps the rule intact: red
> still means live, active, and now, and never means "a count". See `SPEC.md`
> §16 and `test/surfaces.test.ts`.

- **Red pencil `#c0503c`** — live, active, destructive, and "now": the cued speaker, the streaming indicator, STOP, FLUSH, autopilot, the active nav item, the primary send button, the rail down the log during generation.
- **Blue pencil `#5b7fa6`** — the author's own voice and injected state: OOC messages, the guides panel, the guides button, the OOC voice field in the author editor.

Nothing else is colored. Status dots that must read as "connected" use `#7fa65b` and appear only in Settings.

### 3. Everything is a page being marked up

Sharp corners (`border-radius: 0`) on essentially everything — inputs, buttons, cards, chips, panels. The only rounded elements in the entire system are:

- OOC bubbles: `3px 12px 12px 12px` (the asymmetric corner is the "tail")
- Bottom sheets: `16px 16px 0 0`
- The iOS home indicator: `2px`

Borders are 1px hairlines. Section separation is a hairline rule, not a card or a shadow. **There are no shadows anywhere in the UI.** (The drop shadows in the mocks are on the *phone frames*, part of the canvas presentation — not the product.)

---

## Design tokens

### Color — dark (default)

| Token | Hex | Use |
| --- | --- | --- |
| `bg` | `#14120f` | App background, input fields |
| `bg-sunken` | `#100e0b` | Desktop sidebar and cast rail |
| `bg-raised` | `#16130f` | Composer stack, footer bars, tab bar |
| `bg-inset` | `#1a1611` | Selected sidebar row |
| `rule` | `#221e18` | Hairline rules, dividers, card fills (striped) |
| `rule-strong` | `#2f2a22` | Input borders, button borders |
| `border-quiet` | `#2a251e` | Ops button borders |
| `text` | `#e8e2d6` | Prose, primary content |
| `text-bright` | `#f0e9dc` | Cued speaker name, emphasis |
| `text-label` | `#c9c1b1` | Mono attribution, active labels |
| `text-muted` | `#8b8477` | Secondary labels, inactive state |
| `text-dim` | `#6f6a5f` | Tertiary, placeholder, token counts |
| `text-prose-muted` | `#9a9284` | Preview/excerpt prose |
| `red` | `#c0503c` | Red pencil |
| `red-bg` | `#1e1712` | Red-tinted panel fill |
| `red-border` | `#4a3129` | Red-tinted border |
| `red-text` | `#d78872` | Red text on red-tinted fill |
| `blue` | `#5b7fa6` | Blue pencil |
| `blue-bg` | `#191d22` / `#171b20` | OOC bubble / guides sheet |
| `blue-border` | `#232a31` / `#2f3a45` | OOC bubble border / guides button border |
| `blue-text` | `#b9c3ce` | OOC body text |
| `blue-text-muted` | `#6f7d8c` | Guides secondary |
| `blue-prose` | `#cdd5de` | Guide content prose |
| `green` | `#7fa65b` | Connection OK dot (Settings only) |

Striped placeholder (portraits, sprites, cast cards):
`repeating-linear-gradient(45deg, #221e18 0 6px, #1c1913 6px 12px)`
Cued variant: `repeating-linear-gradient(45deg, #33231c 0 6px, #2b1e17 6px 12px)`

### Color — light

**Designed, not inverted.** Warm paper, not white. Ink is warm near-black, not `#000`.

| Token | Hex |
| --- | --- |
| `bg` | `#f4efe4` |
| `bg-raised` | `#efe9dc` |
| `bg-input` | `#fdfaf3` |
| `bg-card` | `#f7f3ea` |
| `rule` | `#e2dacb` |
| `rule-strong` | `#ddd4c3` |
| `rule-quiet` | `#cfc5b2` |
| `text` | `#1e1a15` |
| `text-label` | `#4a4237` |
| `text-muted` | `#7a7263` |
| `text-dim` | `#8b8271` |
| `text-placeholder` | `#9a9180` |
| `red` | `#b0402c` |
| `red-bg` | `#f8e9e3` |
| `red-border` | `#d9b3a6` |
| `blue` | `#3f6486` |
| `blue-bg` | `#e9edf2` |
| `blue-border` | `#d5dde6` |
| `blue-text` | `#3d4c5c` |

Striped placeholder (light): `repeating-linear-gradient(45deg, #e4dccb 0 6px, #ddd4c1 6px 12px)`

Light mode is fully specified for the chat screen and the VN stage (frame 2a-3 in `Onsen Chat.dc.html`). The eight supporting screens are drawn dark-only — **map them to the light tokens above using the same role-for-role substitution;** no supporting screen introduces a color role that isn't in the table.

### Typography

**Spectral** (300, 400, 500, 600 + italics) — Google Fonts
**IBM Plex Mono** (400, 500, 600) — Google Fonts

| Role | Face | Size | Weight | Line-height | Letter-spacing |
| --- | --- | --- | --- | --- | --- |
| Prose (mobile) | Spectral | 17px | 400 | 1.64 | — |
| Prose (desktop) | Spectral | 17.5px | 400 | 1.66 | — |
| Prose excerpt/preview | Spectral | 14.5px | 400 | 1.5 | — |
| Field content | Spectral | 15.5px | 400 | 1.55 | — |
| Screen title | Spectral | 26px | 500 | — | −0.02em |
| Header title | Spectral | 19px | 500 | — | −0.01em |
| List item title | Spectral | 15–18px | 500 | — | — |
| Composer placeholder | Spectral italic | 16px | 400 | — | — |
| Speaker attribution | Plex Mono | 10px | 600 | — | **0.18em**, uppercase |
| Section label | Plex Mono | 9px | 400 | — | **0.18em**, uppercase |
| Screen kicker | Plex Mono | 10px | 400 | — | 0.16em, uppercase |
| Director reasoning | Plex Mono | 9.5px | 400 | 1.5 | 0.06–0.08em, uppercase |
| Button label | Plex Mono | 9.5–10px | 400–600 | — | 0.10–0.14em, uppercase |
| Cast card name | Plex Mono | 9px | 400–600 | — | 0.08em, uppercase |
| Token count | Plex Mono | 8.5–10px | 400 | — | — |
| OOC body | Plex Mono | 12.5–13px | 400 | 1.55 | — |
| Ops key glyph | Plex Mono | 13–14px | 400 | — | — |
| Ops key caption | Plex Mono | 7–8px | 400 | — | 0.10em, uppercase |
| Tab bar | Plex Mono | 9.5px | 400 | — | 0.12em, uppercase |

> **Amended in production (phase 53).** Every "uppercase" and every
> letter-spacing figure in the table above is superseded: labels are **sentence
> case with no tracking**. This is not a departure from the design — it is the
> instruction in `Instrument.dc.html`, the chat direction that was chosen:
> *"Labels are readable, not decorative: 11px, sentence case, no tracking."*
> The Instrument, Quiet and Broadsheet mockups use no uppercase and no
> letter-spacing between them; only the mockup drawn of what shipped does. The
> sizes and faces in the table still stand. See `SPEC.md` §16 and
> `test/voice.test.ts`.

Apply `text-wrap: pretty` to all prose paragraphs.

**Minimum sizes are load-bearing.** Mono captions go as small as 7px *only* on the ops-key second line, where the glyph above carries the meaning and the caption is a reminder. Never set body prose below 15px. The user reads this for hours.

### Spacing

Base scale: **4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 22 / 26 px**

- Screen horizontal padding (mobile): **22px** — 16px in the composer stack, 14px in the desktop rails
- Screen horizontal padding (desktop): **28px**
- Gap between messages in the log: **24–26px**
- Gap between paragraphs within one message: **9px**
- Gap between rows in the composer stack: **11px**
- Composer stack bottom padding: **10px** + `env(safe-area-inset-bottom)`
- List row vertical padding: **11–15px**

### Sizing

| Element | Size |
| --- | --- |
| Status bar | 46px |
| Composer text field | 46px min-height (mobile) / 62px (desktop) |
| Send button | 46 × 46 (mobile) / 62 × 62 (desktop) |
| OPS button | 46 × 46 |
| Cast card (composer) | 70 × 50 + label; cued: 82 × 58 + label, lifted 6px |
| Cast card (desktop rail) | full-width, 54 × 68 portrait |
| Ops grid cell | 52px tall, 3 columns, 6px gap |
| Character grid tile | 3 columns (5 on desktop), 128px tall, 12px/10px gap |
| VN stage | 196px tall (mobile) |
| Desktop sidebar | 232px |
| Desktop cast rail | 292px |
| Desktop prose measure | **620px max-width** |
| Desktop list measure | **860px max-width** — the list screens only |
| Icon button | 34–36 square |
| Tap target minimum | **44px** — never smaller, anywhere |

---

## Screens

Nine screens across three files. Screen IDs below match the badge on each frame in the design canvas.

### 1. Chat — `Onsen Chat.dc.html`, frames `2a`

**The product.** Everything else is support.

**Layout (top to bottom):**
1. Status bar — 46px
2. Header — kicker + title + overflow button, hairline rule below
3. *(conditional)* Autopilot banner — red-bordered, 8px 11px, margin `10px 18px 8px`
4. *(conditional)* VN stage — 196px, margin `10px 14px`
5. **Message log** — `flex: 1`, `justify-content: flex-end` (see below), 22px horizontal padding, 24–26px gaps
6. **Composer stack** — `flex: none`, hairline rule above, `bg-raised`

**The log is bottom-anchored.** `justify-content: flex-end` — content grows upward from the composer, as chat does. Older content scrolls off the top. This is not cosmetic: the streaming indicator and its STOP control live at the bottom of the log and must never be pushed below the fold.

**During generation**, the entire log gets `border-left: 2px solid red` — the whole reading surface acknowledges that the app is writing. This is the same rail used for autopilot.

**The composer stack (the hard problem).** At 390px, above an open keyboard. Resting state is **two rows tall**; everything else is progressive disclosure.

Rows, in order:
1. **Cast strip** — horizontal row of striped cards, one per character, + an "add" tile. The cued speaker's card is **larger (82 × 58 vs 70 × 50), lifted 6px above the baseline, carries a 2px red top border, a red uppercase caption above it (`AUTO · NEXT` or `YOU CUED`), and a brighter name.** Tap a card to cue that character.
2. **Director reason** — one line of mono, e.g. `DIRECTOR CUED HIM — MIRA ADDRESSED HIM, SILENT 3 TURNS`. **This is the answer to "why is the classifier picking them" — it is printed, always, with no tooltip and no modal.** When the user cues manually it reads `YOUR PICK OVERRIDES THE DIRECTOR THIS TURN`.
3. **Steer / guides strip** — hairline rules top and bottom, 8px padding. Persistent steer text left, guides count right in blue. Omitted when neither is active.
4. **Input row** — text field + `OPS` button + send button. **The send button shows the initials of who will speak** (`AR ↑`), so the user never sends blind.
5. **Ops** — closed by default behind the `OPS` key.

**Ops grid (open state).** 3 × 2 grid of 52px cells: `N NUDGE`, `S GUIDED SWIPE`, `I AS ME`, `G GUIDES · 4` (blue), `⇥ NO REPLY`, `⋯ TOOLS`. Each cell is a mono glyph over a mono caption. **Lettered keys, like proofreading marks — deliberately not emoji.** When the grid opens, the cast strip and director-reason rows collapse away and are replaced by a single line summarising the cue (`CUED: YOU · BELL`), so total composer height stays manageable above the keyboard. The OPS button takes the red-tinted active treatment while open.

**Three message kinds, one document:**

| Kind | Treatment |
| --- | --- |
| **Prose** | Mono uppercase speaker name (0.18em tracking) + hairline rule running to the right edge, with the swipe indicator `◂ 3/5 ▸` sitting at the end of that rule when >1 version exists. Then Spectral paragraphs. No bubble, no avatar, no timestamp. |
| **Reasoning** | Collapsed strip: `1px dashed rule-strong`, 7px 10px, `▸ REASONING … 412 tok`. Entirely mono. Reads as an annotation, not a message. |
| **OOC** | 18px left inset with a **2px solid blue vertical rule** running the full height. Blue mono label `KESTREL · OOC` above. Body in a bubble: `blue-bg`, 1px `blue-border`, radius `3px 12px 12px 12px`, mono 12.5px. |

**The swipe indicator appears only when a message has more than one version.** Single-version messages show nothing — no empty `1/1`.

**OOC — both treatments, one system.** The default is the **inline marginal aside** above. Its header carries an `OPEN CHANNEL ▾` affordance on the right. Tapping it promotes the exchange to the **OOC channel**: a bottom sheet (`blue-bg`, 2px blue top border, `16px 16px 0 0`) with the scene dimmed to ~30% behind it, and alternating bubbles — author left (`3px 12px 12px 12px`), user right (`12px 3px 12px 12px`, warm-tinted `#2b2118` / text `#e2cdb4`). Its own input is blue-bordered with a blue send button. `BACK TO SCENE ▾` dismisses.

**This is not a mode the user lives in.** Notes arrive inline; the channel is where a note *becomes a conversation*. Both treatments are shipped; the channel is reachable from any OOC message and from the ops menu.

**Autopilot** is a distinct app state, not a toggle:
- Red-bordered banner under the header: `AUTOPILOT · 2 OF 3` + a `TAKE OVER` button in solid red
- The red rail down the entire log
- The banner and the streaming STOP are both always reachable

**VN stage** (optional, frame 2a-3): 196px, striped background placeholder, three sprite placeholders bottom-aligned. **The spotlit character is larger (106 × 164 vs 82 × 116/124) and rendered in full red; the others are dimmed to 55% opacity in neutral stripes.** Two floating chips on a translucent warm-white ground: speaker name top-left with a red dot, `COLLAPSE ▴` top-right. It must be collapsible — it costs 196px of a 844px screen.

### 2. Scenes list — `Onsen Screens.dc.html` `3a`

Entry screen. Large Spectral title, search + new buttons. **A red-bordered "still writing" strip** floats under the header when generation is running in a roleplay the user isn't currently viewing, with an `OPEN` affordance — this is the cross-screen generation indicator.

Each row: title + relative time, one line of Spectral excerpt (the last line of prose, muted), then a mono footer with the cast left and counts right - names while they fit, initials past three, since a row reading `A` says less than one reading `ALDAN`. Hairline rules between. Empty roleplays show `No messages yet.` and drop to 75% opacity.

Bottom tab bar: 5 mono items, active in red.

### 3. Scene setup — `3b`

Author picker (striped portrait + name + one-line summary + token cost), cast strip (68 × 74 cards with per-character token costs + add tile), then a hairline-ruled list: Persona, Model profile, Turn strategy, Lorebooks, Guides (blue label). Each row is a mono label over a Spectral value with a `›` chevron.

`ADVANCED ▾` disclosure at the bottom of the scroll.

**Footer rail: standing token cost** — `3,240 / 32,000 TOK` over a 4px progress bar. This footer pattern recurs across every editor.

### 4. Author editor — `3c`

The AI partner's card. Two large bordered Spectral fields (Personality, Writing style), each with its **token cost printed on the field's own label row**. Then a hairline list: Directing style, OOC voice (blue label), Boundaries (red label).

**Sample voice block** — a live preview of the author's OOC register, rendered in the exact OOC treatment (blue rule + mono). The user sees the voice they're configuring, in the form they'll meet it.

Footer: `CARD TOTAL · 890 TOK`.

### 5. Character library — `3d`

3-column grid, 128px tiles, virtualized (hundreds of cards). Search field + filter chips (`IN SCENE` active in red, then `RECENT`, location, `UNUSED`).

**Characters in the current scene carry a 2px red top border on their tile.** Name in Spectral below, mono metadata under that (`620 TOK · 4 SPRITES`).

### 6. Character editor — `3e`

Tab row under the header: `CARD` (active, 2px red underline) · `LORE` · `SPRITES · 6` · `GREETINGS`.

Portrait (88 × 118) beside Name and "Speaks as" fields. Then Description and Speech as bordered Spectral fields, **each with its own token cost on the label row.** Then hairline rows for Example dialogue and Advanced.

Footer: `CARD TOTAL · 710 TOK · 2.2% OF CTX` + progress bar. **Cost is always expressed as a share of the context window, not an abstract number.**

### 7. Guides panel — `3f`

A bottom sheet over the dimmed scene (~32%). Blue system throughout: 2px blue top border, `16px 16px 0 0`.

Header: `GUIDES · INJECTED NOW` + total cost. Then one hairline-ruled row per guide (Situational, Thinking, Clothes, Positions, Rules). Expanded guides show their content as Spectral prose and carry a **red-bordered `FLUSH`** button; collapsed ones show cost + chevron.

Actions: `REBUILD ALL` (outlined) and `DONE` (solid blue).

### 8. Prompt inspector — `3g`

**Eviction is the headline, not a footnote.** This is the screen that wins over a dissatisfied SillyTavern user.

Budget bar at top: a segmented 6px bar (red = author, muted = cast, blue = guides, dark = history, empty = headroom) with a mono legend beneath, over `29,940 / 32,000`.

Then one row per block: a 3px color chip matching the budget bar, block name, a mono sub-line explaining *what happened to it* (`BELL FULL · OTHERS SUMMARISED`, `FROM TURN 1,120`), and its token count right-aligned.

Then the **`EVICTED`** section — red label, red rule, red total — listing what got dropped and why: `— HISTORY, TURNS 1,061–1,119 (OLDEST FIRST)`.

Footer: `RAW TEXT` and `TUNE BUDGET`.

### 9. Lorebook editor — `3h`

The entry being edited is **open inline at the top of the list**, in a red-bordered container with an `EDITING` label and its token cost. Fields: Title, Keys (mono chips + a dashed `+ key` chip), Content (Spectral). A footer row inside the container: Activation (`KEY MATCH · DEPTH 4`), Priority, and a solid red `SAVE`.

Below it, the rest of the entries as hairline rows: Spectral title over a mono line of keys and activation rule, token count right. Disabled entries drop to 55% opacity and read `DISABLED`.

Footer: `BOOK TOTAL · 4,610 TOK · 6 HIT LAST TURN`.

### 10. Settings — `3i`

Three groups, each a mono section label over hairline rows.

- **Connections** — status dot (green/grey) + Spectral name over a mono spec line (`70B q5 · 32K CTX · 41 TOK/S`).
- **Routing by operation** — Prose / Speaker classify / Guide rebuild / Summarise history, each with its assigned connection in mono. **This is the interesting screen for this audience** — per-operation model routing is a headline capability, not a preference.
- **Reading** — Theme (three mono segments, active solid red), Prose size (a slider between a small and large Spectral `A`, 13px red square handle), VN stage (42 × 22 red toggle, 16px square knob — square, not a pill).

### 11. Desktop — `Onsen Desktop.dc.html` `4a`

**1440 × 900. Same components, unrolled — not a separate design.**

Three columns:

| Column | Width | Contents |
| --- | --- | --- |
| Sidebar | 232px, `bg-sunken` | Wordmark, nav (the mobile tab bar turned vertical, active row = `bg-inset` + 2px red left border + count), `RECENT` roleplay list, solid red `+ NEW ROLEPLAY` footer |
| Main | fluid | Header, autopilot banner, log, composer |
| Cast rail | 292px, `bg-sunken` | `WHO SPEAKS NEXT`, cast cards, guides footer |

**The prose column is capped at 620px** inside the fluid main column. Widening it past a reading measure would break the one thing the app is for.

**The list screens are capped at 860px instead.** Settings, roleplays, the library, authors and lorebooks are rows and grids, not something anyone reads left to right, so the reading measure buys them nothing and at 620px on a wide window it leaves the page looking unfinished. Forms keep the reading measure — scene setup, the character editor, the lorebook entry editor — because a textarea 860px wide is a worse place to write than one 620px wide.

**The cast leaves the composer and becomes the rail.** With the space, each card can finally carry what a phone can't: portrait, name, status (`CUED` / `JUST SPOKE` / `WRITING` / `BENCHED`), the director's reason in mono, and their last line in Spectral italic. The cued card takes the red-tinted fill + 2px red top border. Benched characters drop to 72%.

**The ops grid flattens into one horizontal row** of bordered mono chips (`N · NUDGE`, `S · GUIDED SWIPE`, …), always visible — no OPS key needed. Keyboard hints sit at the right end: `⌘↵ SEND · ⌘K CAST`.

The guides panel becomes a **persistent footer on the cast rail** rather than a sheet: label + cost, a line of guide content, and `EDIT` / `FLUSH`.

Message hover reveals `REROLL · BRANCH · EDIT` at the end of the attribution rule. **This is the only hover affordance in the system, and it exists only on desktop** — every mobile equivalent is a tap, swipe, or long-press.

Header carries `PROMPT · 29,940 TOK`, `SETUP`, and `STAGE OFF` as bordered mono chips.

---

## Interactions & behaviour

Static mocks. All of this must be built.

### Gestures (mobile)

| Gesture | Target | Result |
| --- | --- | --- |
| Swipe **left** | message | Reroll |
| Swipe **right** | message | Swipe carousel between alternate versions |
| **Long-press** | message | Full action sheet (edit, branch, delete, copy, continue-from-here) |
| **Tap** | cast card | Cue that character to speak next |
| **Long-press** | cast card | Character quick-actions (bench, view card, spotlight) |
| **Tap** | reasoning strip | Expand / collapse |
| **Tap** | `OPEN CHANNEL ▾` | Promote OOC exchange to the channel sheet |

**Direction locking must feel certain, not fussy.** These gestures live inside a vertically scrolling virtualized list. Lock to an axis early (~10px of travel) and commit — do not re-evaluate mid-gesture. Once horizontal is locked, suppress vertical scroll for that pointer entirely.

Swipe-left-to-reroll on a message with existing alternates should not fight the right-swipe carousel: they are opposite directions by design, and the carousel must have a rubber-band stop at both ends of the version list.

### No hover, anywhere on mobile

Not a preference — a constraint. Every affordance is a tap, long-press, or swipe. The one hover in the system is the desktop message action row.

### Streaming

- Streaming shows **which character is speaking**, by name, in the log footer: red dot + `SISTER BELL IS WRITING`.
- **STOP is reachable at all times**, including mid-autopilot with several turns queued. It sits at the end of the streaming row, red-bordered.
- The red rail down the log is present for the whole duration.
- Text should stream into the prose block in place, under its attribution header — the header appears first.

### Autopilot

A distinct app state. Entering it changes the chrome (banner + rail), not just a setting. `TAKE OVER` halts the queue immediately and returns control — instantly, no confirmation. The remaining-turn count decrements visibly.

### Cross-screen generation

Generation continues when the user navigates away. The **"still writing" strip** on the scenes list is the persistent affordance; it should appear on any screen that isn't the generating roleplay's chat, anchored below the header, and tapping it returns to that roleplay.

### Keyboard (iOS)

- `100dvh`, **never** `100vh`.
- The composer tracks the keyboard via `visualViewport` — it must sit directly above the keyboard, not behind it and not floating above a gap.
- Respect `env(safe-area-inset-bottom)` when the keyboard is closed.
- When the keyboard opens, the composer stack sheds rows (cast strip, director reason) in favour of the one-line cue summary.

### Progressive disclosure

**UI density is the single most common complaint about the incumbent and the main thing this product is reacting against.** The default view of every screen is clean. Depth sits behind `ADVANCED ▾`. When in doubt, hide it.

### Virtualization

The message log and the character grid are both virtualized. Designs must survive **thousands of messages and hundreds of character cards**. Note that variable-height prose messages make simple fixed-height virtualization inadequate — plan for measured/dynamic row heights, and keep the bottom-anchored scroll stable while heights resolve.

### Accessibility

- **Keyboard focus must be visible.** The system has no focus treatment drawn — add one that fits: a 2px red outline offset 2px is consistent with the language.
- **Respect `prefers-reduced-motion`.** Suppress the streaming pulse and any sheet-slide transitions; do not suppress the state changes themselves.
- Contrast: the mono chrome runs small and low-contrast by design. `text-dim #6f6a5f` on `bg #14120f` is ~4.6:1 — acceptable at these weights but do not push dimmer.
- Tap targets never below 44px.

---

## State

Per roleplay:
- `messages[]` — each with kind (`prose` | `ooc` | `reasoning`), speaker, versions[], activeVersionIndex
- `cast[]` — character, status (`in-play` | `cued` | `writing` | `benched`), lastLine
- `cuedSpeaker` + `cueSource` (`user` | `director`) + `cueReason` (string, shown verbatim)
- `autopilot` — `{ active, remaining, total }`
- `persistentSteer` — string | null
- `guides[]` — kind, content, tokenCost, dirty
- `generation` — `{ active, speaker, roleplayId }` — **global, not per-screen**, so the cross-screen indicator works
- `oocChannelOpen` — boolean
- `vnStage` — `{ enabled, collapsed, spotlight }`
- `theme` — `dark` | `light` | `auto`
- `proseSize` — user-scalable; prose must scale, chrome must not

Token costs are shown everywhere and must come from real tokenization against the active model, not estimates — the audience will notice.

---

## Assets

**None shipped.** Every image in the mocks is a diagonal-stripe placeholder standing in for user-supplied content: character portraits, VN sprites, scene backgrounds.

Fonts are Google Fonts (Spectral, IBM Plex Mono) — for a **self-hosted** app, bundle them locally rather than hotlinking; this app is expected to run on hardware without reliable outbound internet.

No icon library is used. The handful of glyphs in the design are Unicode set in IBM Plex Mono: `‹ › ▸ ▾ ▴ ⌕ ≡ ⋮ ⋯ ↑ ⇥ ◂ ▮ ⇧ ⌫ +`. Keep them as text — they are typographic marks, part of the mono voice, not icons. **Do not substitute an icon set.**

---

## Files

| File | Contents |
| --- | --- |
| `Onsen Chat.dc.html` | **Turn 2 (`2a`) is the accepted direction** — three frames: autopilot + inline OOC, ops grid open over keyboard, light mode + VN stage. Turn 1 below it (`1a` Marginalia, `1b` Callsheet) is the superseded exploration, kept for reference on the OOC-channel treatment. |
| `Onsen Screens.dc.html` | Eight supporting screens, `3a`–`3i`, dark only. |
| `Onsen Desktop.dc.html` | Desktop, `4a`, 1440 × 900. Most current vocabulary. |

Open each in a browser to view. **Ignore `support.js`** — design-tool runtime, not part of the design.

---

## Open questions for production

1. **All nouns**, per the top of this document.
2. Light mode is specified for chat + VN stage only; the eight supporting screens need the token substitution applied and a review pass.
3. The desktop breakpoint between mobile and the 3-column layout isn't set. Suggest collapsing the cast rail first (~1100px), then the sidebar (~840px), then falling back to the mobile composer stack.
4. Focus-visible treatment is unspecified — see Accessibility.
5. Empty states beyond "no messages yet" aren't drawn (no cast, no lorebooks, first boot).
6. Error states aren't drawn: connection lost mid-stream, context overflow, model unreachable. The red pencil is the obvious carrier.
