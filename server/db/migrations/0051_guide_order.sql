-- Phase 96: a per-scene order for guides.
--
-- Guides are injected in the fixed GUIDE_KINDS order (situational, thinking,
-- clothes, state, rules, custom). A scene that wants a different order — the
-- reader's way of weighting one guide above another — stores it here as a JSON
-- array of kinds. Null means the default order.

ALTER TABLE scenes ADD COLUMN guide_order TEXT;
