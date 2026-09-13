-- 0079 OOC lives in the sidebar — §20 phase 188.
--
-- Off-script conversation used to render inline in the log as well as in the
-- channel, and it read as the story talking about itself. It now lives only in
-- the sidebar panel: existing scenes are flipped to the new default, and new
-- ones insert with `ooc_inline = 0`. The per-scene toggle stays for a reader
-- who wants an aside inline.

UPDATE scenes SET ooc_inline = 0;
