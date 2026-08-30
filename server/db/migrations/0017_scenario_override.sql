-- 0017 the scene's own scenario — SPEC §20 phase 20 (the schema review).
--
-- Found by reading §2 against the schema rather than against my memory of it.
-- `scenes.scenario_override` is listed in §2 as "nullable, overrides character
-- scenario", and the prompt builder has believed in it since phase 3: the
-- scenario block chooses between it and the spotlight character's, and the
-- {{scenario}} macro prefers it. Both have been reading a field the context
-- hardcoded to null, because the column was never added.
--
-- So this is not a new feature. It is a column the rest of the system already
-- expects, and the review is what noticed nothing could ever set it.
--
-- Why it matters more in this app than in most: a character card's scenario is
-- written by whoever made the card, for a scene nobody has had yet. Running the
-- same cast somewhere else is the ordinary case here, not the exotic one.

ALTER TABLE scenes ADD COLUMN scenario_override TEXT;
