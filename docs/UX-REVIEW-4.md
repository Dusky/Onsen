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
