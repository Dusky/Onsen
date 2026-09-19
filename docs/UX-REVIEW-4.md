# Fourth pass — organization and fit, against a live provider

The brief was *"I'm still not happy with organization, or how the app feels to
use"*, with all four readings of "organization" chosen: where things live,
Settings as a junk drawer, the chat screen itself, and the vocabulary.

Run against `data/onsen.db` with a real DeepSeek key (`deepseek-flash`), added
through the app's own UI rather than the database. Everything mutated was
snapshotted first and restored; what was mutated is listed at the end.

**Method.** Nine findings across the three previous reviews had to be withdrawn,
almost all of them inferred from a screenshot and several of them documented
decisions with better reasoning than the observation. So every finding here is a
failed task, a measured number, or a reproduction — and each was checked against
the component's own documented rationale before being written down. Three
candidate findings died that way during this pass and are listed under *What I
nearly reported and did not*.

---

## 1. The prompt editor is three quarters of the app, on every screen that is not the chat

This is the answer to "feels disorganized", and it is a count rather than an
impression.

Interactive controls on screen at 1600×950, by where they are:

| screen | total | left rail | the screen's own first control, in DOM order |
|---|---|---|---|
| **Roleplays** | 141 | **105** (74%) | #119 — "New roleplay" |
| **Settings** | 143 | **105** (73%) | #119 — the filter box |
| **Characters** | 147 | **105** (71%) | #119 — "Cast groups" |
| **Assistant** | 132 | **105** (80%) | #119 — "What it can do" |
| Chat | 117 | 26 (22%) | #41 — "Setup" |

On the app's home screen, the reader's primary action is the **119th** control.
The 105 ahead of it are the prompt editor: twenty-six blocks, each with a
toggle, a name and two reorder arrows.

The chat screen is the one place this is proportionate, and it is the one place
the prompt is the subject.

**It can be closed, and closing it survives until the next reload.**

| | left-rail controls |
|---|---|
| Roleplays, rail open | 105 of 141 |
| after collapsing | 10 of **39** — a 72% reduction |
| after clicking **Assistant** | 10 of 30 |
| after clicking **Settings** | 18 of 41 |
| after a reload | 105 of 143 |

> **Corrected.** This paragraph first said the collapse "is discarded on the
> next navigation and on reload", and the navigation half was wrong. The probe
> used `page.goto()` for every step, which loads a fresh document each time — so
> it measured five first-loads and called them navigation. Re-measured with real
> in-app clicks, the collapse holds across screens and is lost only on reload,
> which is `client/state/ui.ts` being in memory by policy rather than anything
> throwing the choice away. `useAutoCollapseRails` tracks the *previous* media
> match precisely so an unrelated re-render cannot reopen a rail, and says so in
> its own comment.

The finding that survives is the **default**: 74% of the controls, on every
non-chat screen, every time the app is opened.

**On the documented decision.** Phase 100 decided the prompt's *structure*
belongs to the preset rather than to a scene, "so it is editable anywhere", and
phase 191 cited that when declining to change the rail. That decision is about
**availability** and this finding is about **default prominence and
persistence** — they are separable, and nothing in the entry argues that the
panel must be expanded by default on a library screen, or that a reader's choice
to collapse it should be forgotten every time the app is opened.

Cheapest fix that tests the theory: default the rail to its icon strip on
screens with no scene, and remember the reader's choice. Neither changes where
the prompt can be edited, and the second has a home already — prose scale,
theme and the dock's own widths all persist server-side, and phase 173 calls the
widths a preference in as many words, so this needs no browser storage and
leaves HANDOFF non-negotiable 8 intact.

---

## 2. A turn can finish with no reply and no error

**Reproduced twice, with a fixed wait so nothing was cut off.** Send a turn. The
composer shows Stop. Five seconds later Stop is gone. No assistant message was
created, no notice appeared, nothing was written to any log.

```
415  user   "I set my cup down and ask her plainly what the Warden wants."   → no child
421  user   "Tell me what the Warden actually wants."                        → no child
```

The reader is left looking at their own turn with no way to tell whether the
model failed, the request never went, or the app dropped something. Pressing
send again is the only available move, and it costs another call.

Severity: high. The app's whole contract is that a turn either lands or says why
it did not — §5.6 goes out of its way to keep a *cancelled* turn's partial text
on exactly that principle.

## 3. Reasoning shares the response cap, so a turn can come back as a stub

Same root, different symptom. `max_response_tokens` is sent as `max_tokens`
(phase 196, correctly), and a reasoning model counts its thinking against that
budget. Measured on turns that did land:

| turn | reasoning | prose | share of the output that was the story |
|---|---|---|---|
| 417 | 4075 chars | **77 chars** | **2%** |
| 419 | 932 chars | 404 chars | 30% |

Turn 417 is a 77-character fragment, delivered after four thousand characters of
thinking, with nothing on screen to explain why it is short. Confirmed at the
wire: a 60-token cap on this model returns `content: ""`, `finish_reason:
"length"` and 60 reasoning tokens. Given room (1024 tokens on a short prompt) the
same model writes 1083 characters of prose — so the cap is not wrong, it is
*shared*, and the app does not know that.

What is missing is the app noticing. "The model spent its budget thinking —
raise the response cap for this profile" is a sentence the app has all the
numbers for and never says.

---

## 4. Settings tells you nothing matches, and shows you everything

Reproduced:

| filter | says "Nothing here matches that." | Providers still on screen | "Sign out" still on screen |
|---|---|---|---|
| *(none)* | no | yes | yes |
| `zzzznomatch` | **yes** | **yes** | **yes** |
| `webhook` | no | no | yes |

The filter narrows the category tabs, but the panel body only clears when at
least one category matches. With no match the tab row empties, the message
appears, and the previously selected category's whole panel stays below it — so
the reader is told nothing matches while looking at a screen full of settings.

## 5. The categories overlap, and one of them is a junk drawer

The app's own filter words put the same term under two categories:

- **`picture`** → Backgrounds *and* Pictures & voices
- **`api key`** → Models *and* Connections out

So the app's own search sends a reader to two different drawers for one thing.

And **"Change password" and "Sign out" are on the Models page**, under Providers
and Profiles — account actions filed where the model settings are, which is
explained by where they were built rather than by what they are.

## 6. Setting up a provider: 12 steps, and the check is one screen from the typing

Adding DeepSeek end to end: Settings → Add a provider → *Start from: DeepSeek* →
paste the key → Save → Add a profile → name → provider → model → **Test** →
Save. Twelve steps, and the shape of it is good — the preset catalogue has 18
entries and picking DeepSeek fills the name, kind and address in one move; Fetch
returns the real model list; Test reports "Reached · 1070ms".

The friction is that **the provider form has no Test.** The moment a reader most
wants to know whether they typed the key correctly is the moment they have
typed it, and the answer is only available after creating a profile. Phase 210
moved Test to the profile deliberately, because a test needs a model — sound,
and the cost is that a mistyped key is discovered two screens later. A
key-only check on the provider form (`GET /models`, which Fetch already calls)
would answer the question where it is asked.

---

## 7. Smaller, measured

- **Four fields in the add-a-provider form have no programmatic label** — Name,
  Kind, Address, API key have no `id`+`<label for>`, no `aria-label`, no
  `aria-labelledby`; the visible text is a sibling `<p>`. A screen reader
  announces the API key field as "edit, blank". Three more at rest across the
  app (Scene Setup's Title, three selects on Backgrounds) — so this is the
  forms, not the app.
- **Run-together accessible names in the Models list**:
  `"DeepSeekOpenAI-compatible · keyed›"`, `"DefaultAnthropic ·
  claude-3-5-sonnet-20241022Default›"`. Phase 190 fixed this class in the
  header; the sweep it added did not reach here.
- **Thirteen 34px icon buttons sit in one row above the composer** (Nudge,
  Guided swipe, As me, Steer, Guides, Off script, No reply, Continue, Tools,
  Extension actions, plus Send, Branch map and the context readout). Named here
  as a count rather than a judgement: what to do about it belongs with finding 1.

## What I checked and found working

- **Phase 189 holds under real use.** With the scene's active leaf sitting on an
  off-script branch, a new turn attached to message 7 — the story branch — not
  to the newest `ooc` child.
- **Phases 219–223 all hold on screen**: focus returns to the Search button,
  the routing row reads "App default | Default", the smallest inline type is
  11px, and no `**bold**` survives inside a quoted run.
- **The provider catalogue, Fetch and Test** all do what they say.
- **Scene Setup's "Runs on"** (phase 210) changed the scene's model and the
  footer agreed immediately: `DeepSeek · deepseek-flash`.
- **No console errors** on any screen driven during this pass.

## What I nearly reported and did not

- **"Fetch does nothing."** My probe looked for a `<select>`; `ModelPicker`
  renders a list of lines. It works, and shows both models with the current one
  highlighted.
- **"The provider form's fields are unlabelled"** — as *visible* labels, which
  was wrong: they are there, as `<p>` elements. The real and narrower finding is
  the programmatic association, above.
- **"The desktop header has no library navigation."** Documented at length in
  `Header.tsx` as design review fix 5, with a rationale about the rails owning
  those destinations. Finding 1 is the version of this that survives contact
  with a measurement.

## What this pass did not reach

Beats, recast, autopilot, auto-continue, swipe/branch/checkpoint as gestures,
trackers and summaries firing, the assistant's write tools against a live model,
vanish mode, document and reading modes, the phone at 390×844 for the live loop,
and the naming sweep (question four of the brief). Findings 2 and 3 took the
budget: an intermittent silent no-op on the app's central action outranked
finishing the list.

## What was mutated

The DeepSeek provider and profile were added through the UI; "The Last Inn" was
pointed at that profile; seven messages (415–421) were written into it. All of
it was reverted by restoring `data/onsen.db` from the snapshot taken before the
pass, verified byte-for-byte against the copy taken at the session's start.

---

# Addendum — the live loop

The first pass stopped at findings 2 and 3 and left the loop itself unmeasured.
This is that work, driven against the same `deepseek-flash` key, in a scene
created through the app's own **New roleplay** rather than by reaching into the
database: fourteen generations across spotlight turns, a beat, autopilot,
auto-continue and the phone.

Same method. Every item below is a failed task, a measured number or a
reproduction, and four candidates died on inspection — they are at the end.

---

## 8. The composer's only keyboard hint names a key that does not send

Under the composer, on every desktop width, the app prints:

> `⌘↵ SEND · ⌘K CAST`

It is `strings.chat.keyboardHints`, a constant, rendered at
`client/components/Composer.tsx:353` whenever the composer is wide. It consults
nothing.

What actually sends is a reader setting with three values — `SendKey` in
`shared/types.ts:2024` — and this install has `reader_send: "button"`, chosen
by its owner. So the measurement:

| pressed in the composer | what happened |
|---|---|
| `Return` | a newline in the draft; nothing sent |
| `Ctrl+Return` | a newline in the draft; nothing sent |
| the send button | the turn went, `POST /generate`, reply in 7.4s |

No message row appeared for either key press. The hint named the one input that
did nothing, twice, and never named the one that worked.

It is wrong at the shipped default too. `READER_DEFAULTS.send` is `"enter"`, and
`Composer.tsx:204` reads `sendKey === "enter" ? !event.shiftKey && !modified` —
so with the default setting a **modified** Return is explicitly excluded. `⌘↵`
sends under exactly one of the three settings, and the hint is shown under all
three.

And `⌘` is a Mac key. The app already knows this: six hundred lines away in the
same file, the setting that offers this behaviour is labelled
`readerSendMod: "⌘ or Ctrl + Return sends"`. The hint is the only place in the
app that assumes the reader is on a Mac.

`strings.chat.keyHints` (`"⌘↵ send"`) is a second copy with no reference
anywhere in `client/`.

## 9. A turn that comes back with nothing at all still says nothing

Phase 224 shipped this session, from this app, against this model: a turn that
lands nothing now explains itself. It does — in the case where the model
*thought*. Twice during this pass the model returned nothing whatsoever, and the
app was silent again.

Generation 11, from the database after the fact:

| | |
|---|---|
| `status` | `complete` |
| `finishReason` | `stop` |
| `completionTokens` | **0** |
| `buffer` | empty |
| `target_message_id` | **null** |

On screen: the reader's turn sitting there, no assistant turn, no notice, no
error, nothing in the log. The same shape phase 224 was written for.

The reason is one line of my own code. `thinTurn()`
(`server/generation/service.ts`) opens with:

```ts
const reasoningChars = generation.reasoning.trim().length;
if (reasoningChars === 0) return null;
```

A model that spends its budget thinking is diagnosed. A model that returns zero
tokens of anything is not — it fails the guard before the `empty` branch is
reached. The reasoning count is what makes the *sentence* useful; it should not
be what decides whether there is a sentence. An empty buffer is worth saying so
about on its own, and the numbers can say "and it did not think either".

## 10. When phase 224 does fire, it names a setting the app does not have

Both notices landed live, with real numbers, and read well:

> That turn came back short — 546 characters of story after 3729 of reasoning,
> which shared the same reply budget. Raise the response cap in the preset for
> more room.

> No turn was written — the model spent its whole 160-token reply budget
> thinking (711 characters of it). Raise the response cap in the preset, or pick
> a model that does not reason.

Both say **"the response cap in the preset"**. The preset editor's field is
called **"Reserved for the reply"** (`strings.settings.maxResponseTokens`).
There is no "response cap" anywhere in the app's interface. A reader who follows
the instruction opens the Preset rail and scans for a name that is not there.

This is question four of the brief — the vocabulary — in the one place the app
explicitly sends a reader to go and change something.

## 11. Autopilot turned on does nothing, and does not say it is waiting

Clicked **Autopilot** in the right rail. `aria-pressed` went `true`, the button
went amber, `scenes.autopilot_enabled` went to `1`. Then 200 seconds:

- no generation row
- no turn
- no `N OF 3` strip
- no notice
- no line saying what it is waiting for

This is correct. `server/generation/autopilot.ts` says so at the top: *"a turn
the reader started themselves is what arms it, not what interrupts it."* The
loop runs *after* a reply completes, and with the scene idle there is nothing to
run after. The design is right and the rationale is good.

What is missing is any of that reaching the reader. The control is one word and
a colour. A switch that produces no observable change, in an app whose central
complaint is a silent no-op (finding 2), is the same failure wearing a different
hat: the reader cannot tell "armed, waiting for your turn" from "broken".

Armed properly — autopilot on, then a reader turn — it ran. The turn it ran came
back empty (finding 9), so the run ended there.

## 12. Auto-continue cannot reach the case it exists for

"When a turn comes back wrong → **Carry on** 2 times" is the setting for a turn
the cap cut off. Its own comment says so:

> Continue first: a turn cut off by the cap is short *because* it was cut off,
> and rerolling it would throw away a good beginning to ask for a whole new one.

Set **Reserved for the reply** to 160 and **Carry on** to 2 — both verified in
the `presets` row — and sent a turn. Generation 13:

| | |
|---|---|
| `finishReason` | **`length`** — cut off by the cap |
| `reservedForResponse` | 160 |
| landed | **nothing** |

Auto-continue did not fire. `maybeRetry` (`server/generation/service.ts:2075`)
begins `if (generation.landedMessageId === null) return false;`, so a turn the
cap cut off *before it wrote a word* is outside the retry configured for turns
the cap cut off.

Defensible — you cannot continue a message that does not exist — and it is
still the reader setting two numbers and getting the behaviour neither of them
describes. Continuing from nothing is a reroll, and the app has one.

## 13. The cast card shows raw markup, alone in the app

The right rail's "Just spoke" card, after a beat:

> `**Elira Voss:** took two keys off the board behind her, the ring rattling
> once, and set t…`

The transcript six inches to the left renders the same content with the speaker
as a coloured label and no asterisks — that is phase 216/223's strip and phase
161/221's tokenizer. The card gets neither. `excerpt()`
(`client/components/CastRail.tsx:278`) collapses whitespace and cuts to 90
characters; it strips no markup, so every `**`, `*` and `Name:` in a turn shows
as itself in the one place a reader glances to see who just spoke.

## 14. The touch-target guard cannot see a control that was never in its list

At 390×844 with `hasTouch`, in the chat, controls under the 44px floor:

| control | size | since |
|---|---|---|
| `⌄ Model reasoning · N chars` (×3) | 346×**28** | phase 196 |
| `Trackers 533 tok ▸` | 358×**24** | the tracker strip |
| `change` (who speaks next) | 46×**22** | — |
| nav `More` | **33**×50 | — |
| nav `Search` | **27**×48 | — |

`test/density.test.ts` passes. It asserts that eleven *named files* still carry
`tap` in a className — an allow-list, added by the phase that found those eleven.
A control in a twelfth file has nothing to fail. The guard checks that a past
fix is still applied; it cannot check that the rule holds.

That is the recurring shape again, now for the fifth time: **a check that asks a
different question than the real thing can pass while the app is broken.** The
file's own comment is honest about why — "structural rather than rendered — this
project runs no DOM tests — so it cannot measure a height" — which is precisely
the gap `scripts/rendered-guard.ts` exists to close, and precisely what
phase 222 is for.

## What I checked and found working

- **Beats.** "The room" cued, the turn stored as `kind: "beat"`, per-part
  speaker labels rendered and coloured, `Cued → Just spoke` tracked in the rail.
- **Trackers fire.** Five tracker rows written across the pass, `Trackers · 533
  tok` in the prompt inspector, a per-turn `▸ State` disclosure under each reply.
- **Phase 220 holds on screen** — speaker names and dialogue legible in the
  light theme at 1600×950, over the photograph.
- **Phase 223 holds** — no `**Name:**` in the transcript, streaming or settled.
- **Phase 224 fires and reads well** when a turn has reasoning to report.
- **The scene's model** changed from the Models rail tab and the footer agreed
  immediately.
- **The phone** at 390×844: 88 controls, no horizontal scroll, rails correctly
  absent, a full turn sent and rendered.
- **No console errors** at any point in the pass.

## What I nearly reported and did not

- **"The preset's number fields are unlabelled."** My sweep looked for an
  `aria-label` and an `<input>` has no text of its own. `Whole`
  (`PresetEditor.tsx:744`) wraps each one in a `<label>` with a `<span>`. They
  are named correctly. *(The five that genuinely are not: the Model select and
  the four instruction textareas — Impersonation, Continue, New chat, Group
  nudge — which belong with finding 7's forms pass.)*
- **"Editing the preset does not persist."** It does. My probe set the value
  with a native setter and dispatched a synthetic `blur` Event; React binds
  `onBlur` to `focusout`, so nothing committed. Driven with a real click, type
  and Tab, both fields wrote through to the `presets` row.
- **"`Inspect the prompt` is an 18px touch target."** It is, and
  `test/density.test.ts` documents it as the one deliberate exemption — the
  token count doubles as the doorway and sits inline in 12px mono, with the same
  action at the floor on the turn's `⋯` sheet and in the palette.
- **"Recast is missing."** It is not on the turn's hover row, which is where I
  looked. It is a turn-scoped command: select a turn, `⌘K`, "Rewrite this part".
  I confirmed it is reachable and did not drive it to completion.

## What this pass still did not reach

Summaries firing (the test scene never passed the summariser's 20-message
threshold — 0 rows written), recast driven end to end, swipe/branch/checkpoint
as gestures, the assistant's write tools against a live model, vanish mode,
document and reading modes.

## What was mutated in this pass

A DeepSeek provider and a "DeepSeek flash" profile added through the UI; one new
roleplay created through **New roleplay** (scene 4, "Untitled") with Elira Voss
and The Warden as its cast and ten messages (397–406) written into it; fourteen
generation rows (9–14); five tracker rows; the default preset's **Reserved for
the reply** moved 1024 → 160 and **Carry on** 0 → 2.

All of it reverted by stopping the dev server and restoring `data/onsen.db` from
the snapshot taken before the pass. Verified byte-for-byte (`cmp`) and by
content afterwards: three scenes, one provider, preset back to 1024/0, highest
message id 396.
