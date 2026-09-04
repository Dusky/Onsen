# The polish pass: Workbench

**Chosen: Workbench.** It is a power tool with 200 endpoints, so it should stop
apologising for that. Hierarchy comes from structure — panes, tabs, tables, a
status bar — rather than from thirty-one identically weighted labels.

Everything is drawn against the real tokens in `client/styles/tokens.css`.
Nothing here introduces a colour.

## The diagnosis, in numbers

- 31 `section-label`s on one 1,596-line settings scroll. When everything is a
  heading, nothing is.
- 19 identical full-width buttons in the message sheet — a menu pretending to
  be a form.
- ~40% of the desktop width unused on every screen but chat.
- Characters have avatars and the log never shows them.
- The design doc says Spectral is *the reader's material* and mono is *the app
  speaking*, but the machinery outnumbers the prose about ten to one, so the
  material never gets to feel like material.

## What the four artboards settle

| Artboard | What it resolves |
| --- | --- |
| `Main` | A turn is **selected** (j/k), which is what gives ⌘K an object. Four common actions inline with their keys; the token budget as one stacked bar; a status bar that collects every chip that used to float on some other screen. |
| `Palette` | ⌘K replaces the 19-button sheet **and** the ops grid. Scoped to the selected turn, grouped (this turn / this roleplay / go to), fuzzy — `dr` finds *Draw this* and *Director note*. |
| `Settings` | 31 labels become 8 categories and a filter. Rows are a table with meaningful columns; editing opens in the pane, not in a stack of sheets. |
| `Phone` | The direction's real test, since it is desktop-shaped. The rail becomes the back arrow, the inspector becomes the status bar, and the palette carries all 200 commands with no stacked-button sheets. |

## Two risks worth naming before this becomes code

**The status bar is load-bearing on mobile.** It is both the "what is
happening" strip and the inspector's handle. Elegant, but it is doing two jobs:
if the tap is not discoverable, the inspector becomes unreachable on a phone.
Prototype that one interaction for real before committing to it.

**⌘K only works if the command list is genuinely complete.** A palette covering
40 of 200 things is worse than a menu, because people stop trusting it. Every
op, every navigation target, every setting reachable by name is a real share of
the phase's budget.

## Directions not taken

Kept on the canvas's second page, and in this directory:

- **Manuscript** (`Manuscript.dc.html`) — the current typographic thesis
  committed rather than abandoned: speaker names hanging in the left margin,
  machinery in the right. Its cost was that it is more of what already is not
  working.
- **Room** (`Room.dc.html`) — faces, a presence strip, warmer ground. Its cost
  was looking like everything else.
- **Thread** (`Thread.dc.html`) — play-by-post, where roleplay actually comes
  from. Unapologetic chrome. Its cost was deliberately not being a beautiful
  object.

Manuscript's marginalia and Room's presence strip are **not** mutually
exclusive with Workbench and could be lifted in later.

## Working files

`Main.dc.html`, `Palette.dc.html`, `Settings.dc.html`, `Phone.dc.html`
(page one), `Manuscript.dc.html`, `Room.dc.html`, `Thread.dc.html`,
`Mobile.dc.html` (page two) and `canvas.json`. Editing any of them means
re-seeding the canvas from all of them; the seeded output is a build artefact
and is not tracked.

The mockups are static. They exist to settle a direction, not to be
implemented from pixel by pixel.
