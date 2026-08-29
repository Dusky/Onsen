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

---

## Phase 2 — History tree

> Store, active path, branching, swipe/edit/delete, checkpoints. API first,
> tested, before any UI.

### Built

**Schema.** `scenes`, `messages`, `checkpoints`. A message's `parent_id` is
nullable — null is a root, and a scene may have several, because alternate
greetings are siblings at the top of the tree (§9). `scenes.active_leaf_id` is
added by `ALTER TABLE` after `messages` exists, since the reference is circular.

**One operation, four names.** Swipe, rewind, branch and checkpoint restore are
all "move the leaf pointer". Nothing is copied and nothing is truncated; only an
explicit delete removes a node. Appending to something that is not the current
leaf is not an error — it forks there, which is what branching is.

The one substantive decision: **swiping descends, rewinding does not.** Landing
on a sibling follows the most recent child down to a leaf, so swiping away from
a version and back restores that version's own continuation instead of chopping
it off. Rewind and checkpoint restore stop exactly on the chosen message, so the
next turn forks at that point — which is the whole purpose of a bookmark you can
"return to and optionally fork from later" (§2). Both are recorded in SPEC §2
under "Tree operations".

**Active path** is a recursive CTE from the leaf upward, returning each message
with its `sibling_index` and `sibling_count` in the same query — the swipe
counter comes free rather than costing a query per row. The UI shows it only
when the count exceeds one; there is no empty `1/1`.

**Deleting** takes the subtree by cascade. If the active leaf was inside it, the
pointer moves to the surviving branch below the parent; deleting the last root
empties the scene rather than leaving a dangling pointer.

**Editing** invalidates the cached `token_count` and stamps `edited_at`. Hiding
a message does neither — `is_hidden` is a prompt concern, not an edit — and
rewriting a message with identical text is not an edit either.

**API.** Scenes (list, create, read-with-history, rename, delete), messages
(append, edit, delete, siblings), the leaf pointer, and checkpoints. Every
message and checkpoint route verifies the record belongs to the scene it was
requested under, so one scene's identifiers cannot reach into another's.

**Tests.** 46 new: 24 against the tree module for semantics, 22 against the HTTP
surface. Covers everything §23 names for this phase — branch, swipe,
edit-in-place, rewind, checkpoint restore — plus a 2,000-message chain, deletion
of the active branch, root siblings, and cross-scene isolation.

### Deliberately not built

- **MessageSegment.** Beats are phase 9; in phase 2 a message's content is the
  whole of it.
- **`character_id`, `reasoning`, `expression`, `generation_meta` on messages.**
  Each arrives by `ALTER TABLE` with the phase that gives it behaviour —
  characters (6), reasoning extraction (17), expressions (27), the generation
  service (4).
- **`author_id`, `persona_id`, turn strategy, autopilot, OOC and VN flags on
  scenes.** Phases 7, 8, 21, 22 and 27 respectively.
- **Any UI.** The phase says API first, and the chat screen is phase 5.

### Spec changes

SPEC §2 gains a "Tree operations" subsection recording the five decisions above,
which the spec described the data for but not the behaviour of.

### Surprises

Nothing structural. Worth noting for later phases: SQLite's `IS` rather than `=`
is what makes root siblings work, since `parent_id = NULL` matches nothing — a
sibling query written with `=` silently reports that every alternate greeting is
the only one of its kind.
