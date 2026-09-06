-- Phase 63: the two automatic retries.
--
-- Both are policy about a turn that came back wrong, so both live on the preset
-- beside the samplers and the response cap rather than on the scene: they are
-- the same kind of decision as `max_response_tokens`, and the thing that
-- triggers auto-continue *is* `max_response_tokens` being reached.
--
-- Zero is off in both cases, which is the shipped default. Nothing retries on
-- its own until somebody asks for it.
ALTER TABLE presets ADD COLUMN auto_continue INTEGER NOT NULL DEFAULT 0;
ALTER TABLE presets ADD COLUMN auto_swipe_min_chars INTEGER NOT NULL DEFAULT 0;
ALTER TABLE presets ADD COLUMN auto_swipe_attempts INTEGER NOT NULL DEFAULT 2;
