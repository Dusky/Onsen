-- 0072 a colour per character — SPEC §9, §20 phase 162.
--
-- Who is speaking is carried by their name and by the turn's spine, both in
-- the ink colour every other turn uses, so a scene with five characters is
-- five identical grey columns that have to be read to be told apart. A colour
-- on the card is the cheapest thing that fixes it, and it belongs to the
-- character rather than to the scene: the same person should look the same in
-- every roleplay they are in.
--
-- Null is the behaviour every existing card already has, so nothing changes
-- until somebody picks one. `CHECK` rather than trust: the value is
-- interpolated into a `style` attribute and exported inside a card's
-- `extensions`, and React escaping is not a reason to let anything else into
-- the column. Six hex digits, the same shape `isSafeToken` allows a theme.

ALTER TABLE characters ADD COLUMN colour TEXT
  CHECK (colour IS NULL OR colour GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]');
