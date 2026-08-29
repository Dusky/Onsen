# Onsen

A self-hosted, mobile-first AI roleplay frontend. Group scenes are the primary
case: one AI **author** with its own personality plays the whole cast, like a GM
running a table, while you direct.

> **Status: phase 14 of 41 — usable.** Set it up, import character cards, give
> the AI an author persona of its own, and run a group scene: one writing
> partner voicing a whole cast, **beats** — a whole exchange between several
> characters written in one go, which you can then correct one character at a
> time or split into separate turns — and a **turn director that can be a model**
> and prints its reasoning before it writes a word. Direct it as you go: nudge a
> single turn, steer the whole scene, reroll with guidance, expand or rewrite a
> reply, or have it draft your own turn into the composer. Plus streaming, swipe
> to reroll, a version carousel, edit and branch, and a stream that survives a
> phone suspending its tab. See
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
