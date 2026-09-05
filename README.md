# Onsen

A self-hosted, mobile-first AI roleplay frontend. Group scenes are the primary
case: one AI **author** with its own personality plays the whole cast, like a GM
running a table, while you direct.

> **Status: phase 47 — feature complete, less the deferred phase 42.**
> Set it up, **point it at your SillyTavern folder and move in** — cards, chats,
> group chats, personas, world info, instruct templates and regex scripts all
> come across, with your swipes intact as branches — give the AI an author
> persona of its own, and run a group scene: one writing partner voicing a
> whole cast, **beats** — a whole exchange between several
> characters written in one go, which you can then correct one character at a
> time or split into separate turns — and a **turn director that can be a model**
> and prints its reasoning before it writes a word. Direct it as you go: nudge a
> single turn, steer the whole scene, reroll with guidance, expand or rewrite a
> reply, or have it draft your own turn into the composer. Plus streaming, swipe
> to reroll, a version carousel, edit and branch, and a stream that survives a
> phone suspending its tab. It keeps **persistent guides** too — short notes on
> what everyone is thinking, wearing and doing, written behind the scene and
> carried on every prompt after that, versioned per message so rewinding rewinds
> them, and it **summarises what it can no longer afford to carry** — old turns
> condensed into a paragraph the prompt takes instead, so a scene can outlive
> its context window. Models that think out loud are handled: the reasoning is
> pulled out of the prose, shown collapsed, and never fed back into the next
> prompt unless you ask. And how it writes is a set of small switches rather than
> one long instruction — point of view, prose structure, length, planning — with
> a **ban list** of the phrasings models fall into, which it will offer to fill
> in for you by counting what your scene keeps repeating. **Lorebooks** are here
> in full — keyword activation with secondary logic, sticky, cooldown and delay
> counted along the branch you are actually on, inclusion groups, per-character
> knowledge out of one shared book, and recursion — with a test that shows what
> would fire against your scene right now *and why each miss missed*. It reads
> SillyTavern world info and hands back every field it was given, including ones
> it has never heard of. It talks to **OpenAI-compatible endpoints, Anthropic,
> and raw text-completion servers** — llama.cpp, KoboldCpp, TabbyAPI — with the
> named instruct templates those need (ChatML, Llama 3, Mistral, Alpaca, Vicuna,
> Metharme) and an editor for writing your own, previewed as you type, because a
> wrong template does not error, it just quietly makes the prose worse. The
> author can also **step out of the scene** — a question, a check, a flag —
> which arrives as a note in the margin rather than a line in your story, and
> you can ask it something back; that exchange opens into a channel of its own
> and never touches the prose. When it will not stop doing something, you can
> **fix it yourself**: find-and-replace with a test panel, applied to what you
> write, what the model writes, what you see, or what the model reads — four
> stages that differ in what survives — plus **named actions bound to moments**,
> so a lore entry firing can refresh a guide or run a rewrite. All of that
> travels: a **pack** is one file holding characters, lore, presets, writing
> partners, prompt options, scripts and triggers, which shows you what it will
> add before it adds it, installs whole or not at all, and remembers exactly
> what it brought so removing it takes that and nothing of yours. And it will
> **tell something else what happened** — a message written, a reply finished, a
> beat split by speaker, a tracker changed, lore firing — posted to a URL you
> run with a signature your receiver can check, which with the REST API is
> enough for a Discord bridge or a stream overlay with no code running inside
> the app. Open the same roleplay on a **phone and a desktop** and they keep
> step: a turn written on one appears on the other, and if one moves the story
> somewhere the other is not, the other holds what you were reading and says so
> rather than changing under you. And a roleplay can **answer as a model**:
> point any OpenAI-compatible client at this app, and `scene/the-pass` runs the
> whole pipeline behind it — author, cast, lore, guides — with the director's
> ops available as `((nudge: ...))` inline. Turns land in the tree like any
> other, so the terminal and the phone are the same story. Optionally it also
> **keeps track of who and what** — people, places, things and facts pulled out
> of the story as it goes, scored by how much they matter, brought back when the
> moment needs them and fading when it does not; edit one and the extractor
> never touches it again. It can **draw a scene, read a line aloud, and look at
> a picture you paste in** — a local Stable Diffusion WebUI or anything speaking
> the OpenAI shape — and what the author is told about a picture is its
> description, never the file, so a scene's context is not spent on an image it
> already has words for. Hiding a picture from the log and keeping it from the
> author are separate switches. A writing partner can also **remember you between
> roleplays** — a thread left hanging, a name that keeps coming back, how you
> like to be written for — but only when you ask it to, note by note, and every
> note is one you can read, edit or throw away. Built
> for a phone first, and on a
> wide screen the same pieces unroll into a sidebar, a capped prose column and a
> cast rail. See
> [`docs/SPEC.md` §20](docs/SPEC.md) for the build order and
> [`docs/PHASES.md`](docs/PHASES.md) for what exists today.

## Documents

| File | Authority |
| --- | --- |
| [`docs/SPEC.md`](docs/SPEC.md) | Behaviour, architecture, data model, build order. The source of truth. |
| [`docs/design/DESIGN.md`](docs/design/DESIGN.md) | Layout, visual system, component structure. |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | Process, non-negotiables, conventions. |
| [`docs/PHASES.md`](docs/PHASES.md) | What each completed phase actually built. |

`SPEC.md` wins on behaviour and data; the design doc wins on layout and
appearance.

## Running it

Requires [Bun](https://bun.sh) 1.3 or newer. No native modules — `bun install`
runs with no compile step.

```sh
bun install

# Development: API on :8787, Vite on :5173 proxying /api to it.
bun run dev

# Production: build the SPA, then serve API and client from one process.
bun run build
bun run start          # http://localhost:8787
```

Open the app and the setup wizard asks for a password and one connection
profile. There is no second account and no registration.

Themes are yours: seven ship, every colour and the four values that decide
depth are editable by hex, and you can save, export and import them. They live
on the server, so the phone and the desktop agree. An imported theme's own CSS
is shown to you before any of it runs.

It is an installable web app: add it to a phone's home screen and it opens
standalone, in its own window, with the shell cached so it starts without
waiting on the network. Nothing about a scene is cached — there is no offline
mode, and offline it says so rather than showing you a stale story.

### A single-file executable

```sh
bun run build:standalone      # -> dist/onsen, with the frontend embedded
ONSEN_DATA_DIR=./data ./dist/onsen
```

### Docker

```sh
docker build -t onsen .
docker run -p 8787:8787 -v onsen-data:/data onsen
```

## Configuration

Everything is environment variables; all state lives under one data directory.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ONSEN_DATA_DIR` | `./data` | SQLite database, uploads, avatars, root secret |
| `ONSEN_DB_PATH` | `$ONSEN_DATA_DIR/onsen.db` | Override the database location |
| `ONSEN_CLIENT_DIR` | `./dist/client` | Built SPA to serve |
| `ONSEN_REPO_DIR` | `.` | Git checkout the Settings updater pulls from |
| `ONSEN_PORT` | `8787` | Listen port |
| `ONSEN_HOST` | `0.0.0.0` | Listen address |
| `ONSEN_SECURE_COOKIES` | `false` | Set when terminating TLS in front of the app |
| `ONSEN_SECRET_KEY` | generated | 32 base64 bytes; overrides `$ONSEN_DATA_DIR/secret.key` |

## Deploying it safely

This is single-user software with one password and no account recovery. The
recommended deployment is **behind Tailscale or a Cloudflare Tunnel**, with the
password as defence in depth rather than the only defence. Exposing it directly
to the internet is not a supported configuration.

- Provider API keys are encrypted at rest with AES-256-GCM and are never
  returned to the browser — the UI sees only the last four characters.
- The root secret lives at `$ONSEN_DATA_DIR/secret.key` with mode `600`, or is
  injected via `ONSEN_SECRET_KEY`. **Back it up with the database**: without it,
  stored provider keys cannot be decrypted.
- Sessions are HttpOnly, SameSite=Lax cookies signed with an HMAC derived from
  that secret. Set `ONSEN_SECURE_COOKIES=1` when TLS terminates in front of the
  app.
- Login attempts are rate-limited.

## Working on it

```sh
bun test           # the suite
bun run typecheck  # tsc --noEmit, strict
```

Build one phase at a time, in the order `SPEC.md` §20 gives. The order exists
because later phases depend on earlier ones being correct, not merely present.

```
/server        Bun + Hono. Routes are thin; logic lives in modules.
  /db          schema, migrations, queries
  /prompt      the pure prompt builder - no imports from /db or /routes
  /adapters    provider adapters
  /cards       character card formats - PNG, CharX, JSON
  /generation  generation service, resumable streaming, routing
  /passes      the post-generation pipeline - a second read of a finished turn
  /tasks       the background-task primitive - every side call runs here
  /lib         ULIDs, crypto
  /middleware  session, rate limiting
  /routes
/client        React + Vite SPA
  /components  /screens  /styles  /lib  /state
/shared        types shared across the boundary
/test
```

Two structural rules. `/prompt` never imports from `/db` or `/routes`, and is
pure — no clock, no randomness, no I/O; `test/prompt-purity.test.ts` enforces
both by reading the source. And every user-facing string goes through
`client/strings.ts`: the product nouns in the design are provisional and will be
renamed.
