# A use review, phase 188

Driven in Chromium at 1600×950 and 390×844, both themes, against the real
`data/onsen.db`. Every claim below is something measured or reproduced, not
something inferred from reading source. Where I guessed wrong, I have said so
rather than quietly dropping it.

The prompt was "something about using it feels clumsy and amateurish." That
turns out to be three different problems wearing one coat:

1. **One defect that silently loses your story.** Not cosmetic at all.
2. **A handful of small leaks** — a raw database key, two casings of the same
   unit, block glyphs used as buttons. Individually trivial, and collectively
   the whole "amateurish" impression, because they are the details a reader
   reads as *care*.
3. **A structural inversion**: the machinery is louder than the writing, and
   the writing is what the app is for.

There is also a fourth thing, which is the most useful finding in here and is
not a defect at all — it is a *pattern* in how this codebase verifies itself.
It gets its own section at the end.

---

## Tier 1 — the one that actually loses work

### 1. An off-script question can hijack the story, invisibly

**Your scene is in this state right now.** "The Last Inn" stores 11 messages.
When I opened it, the log rendered **one turn**.

The mechanism, reproduced end to end:

- Off-script messages are ordinary rows in the message tree, appended with
  `parentId: scene.active_leaf_id` (`server/routes/generation.ts:665`).
- `appendMessage` then **unconditionally** moves the scene's active leaf to the
  row it just wrote (`server/db/queries/history.ts:776`).
- Phase 187 moved off-script messages *out of the log* and into the sidebar.

Each step is reasonable. Together they mean: **ask a question from anywhere
other than the tip of the story, and the off-script chain becomes the active
path.** The story turns after that point are orphaned, and because off-script
messages no longer render in the log, the log just quietly gets shorter. There
is no warning, no "5 turns hidden", nothing.

Reproduced live against your database:

```
reader rewinds to turn 1 (to reread, or to branch)
  → log correctly walks forward and shows all 6 story turns
reader asks ONE off-script question
  → active path becomes: spotlight, ooc, ooc, ooc, ooc, ooc, ooc
  → 5 story turns still stored, no longer reachable by rewinding
```

It compounds. `PUT /scenes/:id/leaf` resolves *forward* to the newest branch
tip, so once an off-script chain exists off turn 1, rewinding to turn 1 lands
you back in the off-script chain rather than the story. The story is then only
reachable through the branch map — which the reader has no reason to suspect
they need.

The list screen shows the damage from outside: "The Last Inn" previews as
**"ooc: who built this inn?"**, because the preview is the last message on the
active path and the active path is now off-script chatter.

Worth saying plainly: nothing is deleted. All 11 messages are intact. But
"your work is fine, it is merely unreachable by every control you know about"
is not a distinction a reader makes at the moment their story vanishes.

**To recover your scene now:** open the branch map and jump to the turn
beginning "checking state preservation" (message id 7). That re-roots the
active path on the story branch.

**The fix worth considering** is that an off-script exchange is not a story
turn and should not live on the story's spine — either parent it outside the
tree, or leave the active leaf alone when appending one. The second is a
one-line change and the more conservative.

### 2. Three different places count turns, and none matches what you can read

The header says **"11 turns"**. The list says **"11 replies"**. The log
renders **6**.

`countMessages` (`server/db/queries/history.ts:657`) is
`SELECT count(*) FROM messages WHERE scene_id = ?` — every row, across every
branch, including off-script. The log walks the active path.

`activePathLength` — the function that answers exactly this question, with a
doc comment explaining why it exists — is defined 280 lines further down the
same file and is not what the header calls.

This one is cheap to fix and worth fixing even alone, because a number that
contradicts the thing it labels is the single fastest way to make software feel
untrustworthy. Every swipe inflates it further.

---

## Tier 2 — the small leaks that do most of the "amateurish" work

These are individually a few characters. They are also the ones a reader
*notices*, because each is a place where the app stops speaking English.

### 3. A raw database key is on screen

In the prompt block list, between "Depth prompts" and "Options":

```
Depth prompts
dialogue_colour        ← here
Options
Banned constructions
Director's note
```

Every neighbour is written for a person. This one is a column value.

The cause is precise and worth the detail: `client/strings.ts:747`'s
`blockNames` is typed **`as Record<string, string>`**. The block union
`PromptBlockId` has 27 members; `blockNames` has 26. Because the map is typed
by `string` rather than by the union, TypeScript cannot notice the gap, the
lookup returns `undefined`, and the UI falls back to the raw id.

I swept all 27 rather than fixing the one I saw — `dialogue_colour` is the only
one missing, and there are no dead entries. Typing it
`Record<PromptBlockId, string>` makes the build fail the next time a block is
added without a name, which is the actual fix.

Note it *does* have a proper label — `blocks.ts:705` passes
`"Dialogue colour"`. Two lists render the same block, one via the label and one
via the key.

### 4. The same unit is spelled two ways on one screen

On the chat screen simultaneously:

| Where | Renders |
|---|---|
| Left rail, per block | `9 tok`, `172 tok` |
| Right rail, guides | `0 TOK` |
| Right rail, author | `95 TOK` |
| Status bar | `~6 tok` |

Five call sites use lowercase (`strings.ts:163, 215, 270, 1240, 1450`), four use
uppercase (`420, 1415, 1762`, `CastRail.tsx:248`). One of them also emits
`% OF CTX`, which is both shouting and jargon.

### 5. Two buttons are Unicode block glyphs

The header's rail toggles render as **`▎`** and **`▕`** — half-block drawing
characters. Their neighbours are words ("Dark", "Light", "Settings") or letters
("A", "A"). They read as text-rendering artifacts rather than controls.

They do have `aria-label` and `title`, so they are not inaccessible — they just
look broken. (Credit where due: the 9-glyph "Direct:" bar that I expected to be
mystery meat *is* fully labelled and tooltipped. I was wrong about that one.)

### 6. Accessible names run together

`"·The Last Inn11 turns"`, `"Elira VossElira does not laugh"`,
`"DuskyCuedSuggested — has not spoken yet"`,
`"Guides · injected now0 TOKNo guides yet"`.

Adjacent text nodes with no separator. Visually spaced by layout; to a screen
reader, one run-on string.

### 7. A role name leaks where a character name belongs

On a scene with no cast, the Spotlight block reads **"Assistant · prefix ·
system"**. On a populated scene the same slot correctly reads "Elira Voss". The
empty case falls through to the wire-protocol role name.

---

## Tier 3 — structural clumsiness

### 8. The composer is not reachable by keyboard

I pressed Tab **90 times** from the top of the chat screen and never reached
the composer. The header takes 44.

The cause: the Prompt rail lists ~26 blocks, each with a toggle and two
reorder arrows — roughly 78 tab stops — and it precedes the main content in DOM
order. Tab order runs right rail → (focus escapes to `body`) → left rail →
eventually the header.

There is no shortcut standing in for it either: `useCommandKeys.ts` binds ⌘K
(palette), `j`/`k` (walk the log) and Escape. Nothing focuses the composer.

For an app whose primary verb is "write your turn", this is the clearest
structural version of "clumsy".

### 9. The left rail shows a live prompt editor on screens with no scene

On the Roleplays list, on Characters, on Settings — the left rail renders all
26 prompt blocks with working reorder arrows and toggles. The right rail, on
the same screens, correctly says *"Open a roleplay to see its cast here."*

One rail knows there is no scene; the other offers you a prompt to reorder for
nothing in particular.

### 10. An empty scene offers two competing text boxes

"Describe the scene / What happens, and where? / **Set it up**" in the middle,
and "Write your turn, or send nothing and let the scene run…" at the bottom —
both visible, the lower one fully live. Nothing indicates which comes first.

### 11. Settings tabs are clipped with no affordance

At 1600px, the tab strip is 1040px of content in 831px — **209px hidden**. It
scrolls (`overflow-x: auto`) but there is no fade, arrow, or shadow, and the
last visible tab is cut mid-word as "Connections ou". At the widest layout the
app supports, a top-level navigation is truncated silently.

### 12. Sort controls outweigh the content they sort

On the Roleplays list, Recent / Title / Longest are three 273×42 buttons
spanning the full column — the loudest element on the page, louder than the
roleplay titles. Above them "★ Favourites" is a 108px button. And a bare
unlabelled **"2"** floats to the left of "New roleplay".

---

## Tier 4 — measured inconsistency

Not individually visible; collectively this is the texture that reads as
unconsidered.

**Light theme contrast fails.** Measuring real composited pixels (not tokens):

| Region | Dark | Light |
|---|---|---|
| Rail metadata (`preset · prefix · system`) | 4.15:1 | **2.63:1** |
| Status bar | 7.94:1 | 4.56:1 |
| Transcript body | 16:1 | 17.6:1 |

2.63:1 is below WCAG AA (4.5:1) and below even the 3:1 large-text floor. The
prose itself is excellent in both themes; it is the metadata over the
translucent-panel-on-photograph that fails.

**Spread, desktop:**

- **13 distinct font sizes** — including 8.5px, 11.5px, 12.5px, 13.5px. Half-
  pixel sizes render soft.
- **22 distinct interactive-control heights** — 19, 20, 21, 22, 24, 26, 28, 32,
  34, 37, 38, 41, 44, 49…
- **13 distinct flex/grid gaps** — including 3px, 7px, 9px, off any 4px grid.
- **849 interactive elements below 44×44** on desktop. The 26 prompt-block
  toggles are 16×22.
- **11 elements overflow horizontally** without a scroll container (no screen
  scrolls the document sideways, so this is contained — but it is 11 places
  where text is being clipped rather than wrapped).

**Border radius: 0px on all 980 measured elements.** That is not a defect —
that is the one axis where the design is perfectly consistent, and it is
clearly deliberate.

---

## The pattern underneath (the useful finding)

Three of the defects above share a cause, and it is the same one phase 182 just
shipped a fix for:

> **A check that asks a different question than the real thing can pass while
> the app is broken.**

- **Phase 182** — the Test button posted no model and built its own Anthropic
  path, so it tested a request no turn ever makes. Test passed; every turn
  404'd.
- **Contrast (§Tier 4)** — `test/surfaces.test.ts` measures
  `contrastRatio(tokens[tier], tokens[ground])`: one flat hex against another.
  The real rail is a *translucent panel over a photograph*. The guard's own doc
  comment admits `color-mix()` and gradients "are not colours this module can
  read, and callers filter them out." The guard passes at 2.63:1 on screen.
- **Turn counts (§2)** — the count and the renderer answer different questions
  about the same scene, and nothing compares them.
- **Block labels (§3)** — the map was widened to `Record<string, string>`, so
  the compiler stopped being the check.

Phase 181 found the same shape (three readouts re-deriving `resolveRoute`) and
fixed it by making one server-resolved answer that everyone reads. That is the
move available here too, in three places.

The guards in this repo are unusually good at protecting the *design system*.
What none of them do is measure the *rendered screen*. A pass that screenshots
at two widths and asserts composited contrast, control-height count, and font-
size count would have caught most of Tier 4 before it accumulated.

---

## What I would do first

Ranked by (reader impact) ÷ (effort):

1. **Stop off-script appends from moving the active leaf** (§1). One line. This
   is the only defect here that costs somebody their writing.
2. **Point the header and list at `activePathLength`** (§2). The function is
   already written.
3. **`blockNames: Record<PromptBlockId, string>` + the missing entry** (§3).
   Two lines, and the compiler holds it from then on.
4. **Pick one casing for `tok`** (§4). Nine call sites.
5. **Give the composer a keyboard route** (§8) — and consider whether 78 rail
   tab stops should precede the main content at all.
6. **Darken the light-theme scrim** until rail metadata clears 4.5:1 (§Tier 4).
7. Replace `▎`/`▕` with real icons (§5); add a scroll affordance to the
   settings tabs (§11).

Tier 4's spread is a longer job and wants a decision (a type scale and a
control-height scale) more than it wants a patch.

---

## What is genuinely good, for calibration

Saying this because a review that only lists faults gives a false picture of
where this app actually stands:

- **The prose setting is excellent.** Serif, well-measured column, generous
  leading, speaker names in character colour. The reading experience — the
  thing the app exists for — is better than most commercial equivalents, in
  both themes.
- **Focus rings are present on all 22 tab stops I sampled.** Many apps fail
  this outright.
- **Every icon button in the Direct bar is labelled and tooltipped.** I
  predicted mystery meat and was wrong.
- **Empty states are written, not defaulted**: "Nothing written yet", "No
  cast", "Nobody in the cast yet", "No guides yet. Writing one reads the scene
  so far and takes a note on it."
- **The 0px radius is held perfectly** across 980 elements. The design language
  is real and it is applied.

The gap between how good the reading surface is and how rough the chrome around
it is, is most of the answer to the original question. It does not read as an
app built without care. It reads as an app where the care went into the middle
of the screen and the edges were assembled as features arrived.
