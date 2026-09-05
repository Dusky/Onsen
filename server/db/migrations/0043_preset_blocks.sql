-- 0043 preset-owned prompt blocks — SPEC §3, §13, §20 phase 56.
--
-- A block a person wrote, belonging to a preset, sitting in that preset's
-- assembly order. The incumbent's users keep several — house rules, consent
-- notes, a per-provider prefill — and they are template text rather than a
-- per-scene choice, which is what makes them the preset's and not the scene's.
--
-- Options (§13.5) stay what they are: fragments *selected* per roleplay.
-- Already-imported option groups are left alone; from this phase an imported
-- SillyTavern preset's `prompts` array lands here instead, so importing a
-- preset reproduces its prompt rather than a menu of switches.
CREATE TABLE preset_blocks (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid       TEXT    NOT NULL UNIQUE,
  preset_id  INTEGER NOT NULL REFERENCES presets (id) ON DELETE CASCADE,
  label      TEXT    NOT NULL,
  -- The three injection roles (shared/types.ts INJECTION_ROLES). Widening this
  -- means HANDOFF's table-rebuild dance; it is not expected to widen.
  role       TEXT    NOT NULL DEFAULT 'system'
             CHECK (role IN ('system', 'user', 'assistant')),
  content    TEXT    NOT NULL DEFAULT '',
  -- A block switched off keeps its place in the order. Disabled blocks are
  -- filtered out before the prompt context is built, so the pure builder never
  -- sees one and `enabled` stays a storage concern.
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  -- Position among *custom* blocks only. Where a block sits relative to the
  -- built-ins is `presets.prompt_order`, which carries both.
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX preset_blocks_preset ON preset_blocks (preset_id, sort_order);

-- `presets.prompt_order` has existed since 0001 and has never been read or
-- written: the pure builder honours `ctx.preset.blockOrder` and
-- `server/generation/context.ts` passed a literal null between them. It now
-- carries the whole assembly order as JSON, built-ins and custom blocks
-- together, each with its enabled flag:
--
--   [{"id":"system_prompt","enabled":true},{"id":"custom:01ABC…","enabled":false}]
--
-- Null keeps meaning "the default order", so every existing preset is
-- unchanged and nothing needs backfilling.
