-- 0081 a colour for the cast that predates the palette — §20 phase 217.
--
-- Phase 217 started assigning a colour the moment a colourless character joins
-- a scene. That fixed new casts but left every character created before it
-- grey — which is most of an existing library. This backfills: a character
-- still without a colour takes the palette slot matching their creation order,
-- so a scene built before the feature is told apart at a glance without
-- anyone opening an editor.
--
-- Same palette as `CAST_PALETTE` in server/db/queries/authors.ts; keep the two
-- in step. Cycling by creation order means a cast that arrived together gets
-- consecutive slots and therefore distinct colours. Two characters from
-- different eras sharing a slot inside one scene is possible, cosmetic, and one
-- repaint away.

WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, rowid) - 1 AS n
  FROM characters
  WHERE colour IS NULL
)
UPDATE characters
SET colour = (
  SELECT CASE n % 8
    WHEN 0 THEN '#c77ba9'
    WHEN 1 THEN '#6b9bd1'
    WHEN 2 THEN '#5ba884'
    WHEN 3 THEN '#c79a4e'
    WHEN 4 THEN '#8f6bd1'
    WHEN 5 THEN '#4aa8a3'
    WHEN 6 THEN '#c76b6b'
    ELSE '#6b7fd1'
  END
  FROM numbered
  WHERE numbered.id = characters.id
)
WHERE colour IS NULL;
