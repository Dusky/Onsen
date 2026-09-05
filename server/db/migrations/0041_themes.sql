-- 0041 themes — SPEC §20 phase 45.
--
-- The client already exposes every colour as a CSS custom property and maps
-- them into Tailwind with `@theme inline`, whose own comment says "a theme
-- switch on :root re-colours the whole app with no rebuild". That was true and
-- unused: nothing ever switched one. This is where a switch's worth of state
-- goes.
--
-- Themes live here rather than in the browser because SPEC §5 forbids browser
-- storage, and its reasoning is the point rather than an obstacle: the phone
-- and the desktop are two views of one install, so a theme kept in one browser
-- is the wrong shape for the feature.
CREATE TABLE themes (
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,

  -- Which set of defaults the overrides sit on top of. A theme only has to
  -- name what it changes, so a light theme does not restate every dark value.
  base        TEXT    NOT NULL DEFAULT 'dark' CHECK (base IN ('dark', 'light')),

  -- token name -> value, as JSON. Names are the `--onsen-*` custom properties;
  -- anything not listed falls through to the stylesheet's own default, which is
  -- what keeps a theme small and a new token backwards compatible.
  tokens      TEXT    NOT NULL DEFAULT '{}',

  -- The escape hatch, for what the tokens cannot reach. Never applied from an
  -- import until a person has looked at it: see `custom_css_pending`.
  custom_css  TEXT    NOT NULL DEFAULT '',

  -- CSS that arrived with an imported theme and has NOT been approved. It is
  -- stored so it can be shown, and it is not served to the client until the
  -- reader moves it into `custom_css` themselves. CSS can reach the network
  -- (`background: url(...)`), and a theme from someone else is their code.
  custom_css_pending TEXT NOT NULL DEFAULT '',

  -- A shipped theme cannot be edited or deleted; editing one derives a copy.
  is_builtin  INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),

  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX themes_name ON themes (name COLLATE NOCASE);

-- Which one is on. A row in `settings` rather than a column here, because it is
-- a property of the install and not of any theme.
