-- Expressions, sprite packs and visual novel mode (SPEC §12, §20 phase 29).
--
-- Three parts, one migration because they are one feature: an expression is a
-- tag bound to a sprite, and the VN stage is where that binding is drawn.

-- The turn's primary expression, for a spotlight (§2's message field). A beat's
-- expressions live per segment instead (0007 already has that column).
ALTER TABLE messages ADD COLUMN expression TEXT;

-- One pack per character: the named set of labelled sprites. The link is the
-- pack's character, not the character's pack — a character has at most one
-- pack, and looking it up either way is the same index.
CREATE TABLE expression_packs (
  id           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid         TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  character_id INTEGER NOT NULL UNIQUE REFERENCES characters (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
) STRICT;

-- A labelled sprite. `label` is the expression tag (`joy`, `worried`); the
-- canonical set is GoEmotions' 28, but custom labels are allowed (§12).
-- `variant_index` supports numeric variants (`joy-1`) and is 0 for the base.
CREATE TABLE expressions (
  id            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid          TEXT    NOT NULL UNIQUE,
  pack_id       INTEGER NOT NULL REFERENCES expression_packs (id) ON DELETE CASCADE,
  label         TEXT    NOT NULL,
  image_path    TEXT    NOT NULL,
  variant_index INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
) STRICT;
CREATE INDEX expressions_by_pack ON expressions (pack_id, label);
CREATE UNIQUE INDEX expressions_one_variant ON expressions (pack_id, label, variant_index);

-- Visual novel staging (SPEC §12). Off by default: sprites occupy the upper
-- portion of a phone screen, and a reader who wants prose wants prose.
ALTER TABLE scenes ADD COLUMN vn_mode_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (vn_mode_enabled IN (0, 1));
-- A scene background, settable per scene. Served from the data directory.
ALTER TABLE scenes ADD COLUMN background_path TEXT;
