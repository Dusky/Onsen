-- Phase 107: a preset carries the utility prompts.
--
-- SillyTavern's presets hold the ops' prompts — impersonation, the continue
-- nudge, the new-chat opener, the group nudge. They round-trip here as JSON so
-- an imported preset keeps what it was asked to say in those moments.

ALTER TABLE presets ADD COLUMN utility_prompts TEXT;
