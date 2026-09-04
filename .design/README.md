# Direction sketches for the polish pass

Four bets on what Onsen should look like, drawn against the real tokens in
`client/styles/tokens.css` rather than invented ones — the palette is identical
across all four, so what is being compared is the direction and nothing else.

| | The bet | What it fixes | What it costs |
| --- | --- | --- | --- |
| **Manuscript** | The current thesis, committed. Speaker names hang in the left margin; the machinery moves to the right margin in the blue pencil. | Wasted desktop width becomes margin that carries something. Flat hierarchy: one register for the story, one for the notes. | Still austere. If the current look is the problem, this is more of it. |
| **Workbench** | It is a power tool with 200 endpoints, so stop apologising. Three panes, ⌘K, four inspector tabs. | 31 section labels become four tabs. The 19-button sheet becomes a palette. Full width used. | Reads like an IDE. Loses what makes it not look like everything else. |
| **Room** | Faces. A presence strip, an avatar beside every voice, warmer ground. | The log finally looks populated. Closest to what the audience already knows. | Closest to what everything else already looks like. |
| **Thread** | Play-by-post, which is where roleplay actually comes from. Solid header bars, real buttons, alternating post rows, quick reply. | The 19 actions get an obvious home. Avatars become structural. Width used without inventing a reason. | Deliberately not a beautiful object. |

The mockups are static — they exist to pick a direction, not to be implemented
from. Settings is deliberately not drawn: the choice lives in the chat screen,
and each direction implies its own obvious answer (Manuscript a left nav,
Workbench a two-pane preferences window, Thread tabbed sections).

## Working files

`Main.dc.html` (Manuscript), `Workbench.dc.html`, `Room.dc.html`,
`Thread.dc.html`, `Mobile.dc.html` (all four phones side by side) and
`canvas.json`. Editing any of them means re-seeding the canvas from all of
them; the seeded output is a build artefact and is not tracked.
