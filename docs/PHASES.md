# Phase record

What each completed phase of `SPEC.md` §20 actually built, what was deliberately
left out, and what it changed about the spec. Kept so that a later phase does not
have to re-derive an earlier one's reasoning.

---

## Phase 1 — Foundation

> Bun + Hono server, SQLite schema, migrations, static SPA serving, auth, setup
> wizard.

### Built

**Server.** A Bun process serving the API and the built SPA from one origin, so
there is no CORS anywhere (§1). Routes are thin; everything is constructed from
an explicit `AppContext` rather than module-level singletons, which is what makes
the whole surface testable against an in-memory database.

**Database.** `bun:sqlite` with WAL, `busy_timeout`, and foreign keys on.
Migrations are numbered SQL files applied at boot, each in its own transaction,
imported as text so that `bun build --compile` embeds them rather than reading
from a directory that will not exist at runtime. The runner refuses a list with
a gap instead of applying it out of order.

**Schema.** `app_settings`, `providers`, `presets`, `connection_profiles` —
integer primary keys internally, ULIDs externally, timestamps in Unix
milliseconds, `STRICT` tables throughout. The default preset is seeded with the
modern sampler values from §13 (temperature 1.0, min-P 0.05, rep-pen off, DRY
and XTC on), because a preset that arrives disabled is a bad first run (§13.5,
§22).

**Auth.** Single-user password auth via `Bun.password` (argon2id). The session is
a signed, HttpOnly, SameSite=Lax cookie with a thirty-day life. Revocation is a
generation counter in `app_settings` rather than a session table: bumping it
invalidates every outstanding cookie, which is what a password change will do.
Login attempts are rate-limited by a fixed-window counter, and a correct password
clears the penalty so a run of typos cannot lock the only user out.

**Secrets.** One 32-byte root secret, either injected via `ONSEN_SECRET_KEY` or
generated into `$ONSEN_DATA_DIR/secret.key` at mode `600`. Two HKDF-derived
subkeys: AES-256-GCM for provider credentials, HMAC-SHA256 for session cookies.
Provider keys are encrypted at rest and reach the client only as their last four
characters (§17).

**Setup wizard.** Password plus one connection profile, available only while the
install is unconfigured, re-checked inside the write transaction so two
submissions cannot race into two passwords, and it signs the caller in on success.

**Client.** React + Vite + Tailwind v4. The design system's tokens are
transcribed into `client/styles/tokens.css` in both dark and light, and Spectral
and IBM Plex Mono are bundled locally rather than hotlinked — this app is
expected to run on hardware with no reliable outbound internet. Three screens:
setup, login, and a holding screen that proves the session works. No browser
storage anywhere (HANDOFF non-negotiable 8).

**Deployment.** Dockerfile running as a non-root user over a `/data` volume,
plus `bun run build:standalone`, which embeds the client bundle into a single
executable and was verified to serve it.

### Deliberately not built

- **The rest of the §2 data model.** Scenes, the message tree, characters,
  lorebooks, documents, memory, guides, and trackers get their tables in the
  migration belonging to the phase that first uses them, so each is designed
  against working code rather than guessed at. Phase 2 adds the history tree.
- **Provider adapters.** Nothing calls a model yet (phase 4), so
  `providers.capabilities` stays null and the connection profile screen has no
  test button.
- **Editing connections.** The API reads providers, presets, and profiles; it
  does not write them outside the wizard. The editor screen needs phase 4 to be
  worth having.
- **TanStack Query and Zustand.** Both are in the §1 stack, and both arrive with
  the chat UI in phase 5. Three forms do not need them.
- **Instruct and context templates.** `connection_profiles` has no
  `instruct_template_id` / `context_template_id` yet; they arrive with
  text-completion support in phase 20.

### Spec changes

§1 and §24 now record the vector-store finding: `sqlite-vec` installs with no
compile step and works under `bun:sqlite`, but it is a native loadable extension
rather than pure Bun, and `bun build --compile` will not embed it without extra
work. Left open until phase 28, which is the first phase that needs vectors.

### Surprises

- `bun:sqlite`'s `db.transaction()` is synchronous, so anything async — password
  hashing, in particular — has to complete before the transaction opens rather
  than inside it.
- Bun's `fetch` is the only tool in the toolchain that does not read
  `NODE_EXTRA_CA_CERTS`/`HTTPS_PROXY` in a proxied environment. It affects
  nothing at runtime, but `scripts/fetch-fonts.ts` will fail behind a
  TLS-intercepting proxy.
