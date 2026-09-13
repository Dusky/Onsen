-- 0078 a context window per connection profile — §20 phase 186.
--
-- The prompt budget is the smaller of the preset's window and the model's own,
-- and the model's own was hardcoded to 32k for every OpenAI-compatible
-- provider — so a reader on a 128k model could never use it. The window is a
-- property of the model a profile names, so it lives here: null means the
-- provider's default stands, a number overrides it.

ALTER TABLE connection_profiles ADD COLUMN context_size INTEGER
  CHECK (context_size IS NULL OR (context_size >= 512 AND context_size <= 2000000));
