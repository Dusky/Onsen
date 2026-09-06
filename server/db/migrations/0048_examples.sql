-- Phase 64: what happens to the examples, and whether system turns merge.
--
-- `example_eviction` is the incumbent's *Gradual push-out / never / always*
-- under names that say what they do. `keep` is what this builder has always
-- done — hold every example and trim history around it — and stays the default,
-- so no existing roleplay's prompt changes shape on upgrade.
--
-- No CHECK on it. HANDOFF's schema discipline says a CHECK that has to grow is
-- the rebuild dance, and a policy list is exactly the kind of thing that grows;
-- the value is parsed with a fallback instead, which is how `reasoning_config`
-- has always been read.
ALTER TABLE presets ADD COLUMN example_eviction TEXT NOT NULL DEFAULT 'keep';

-- Off by default for the same reason: on, it changes what every prompt on this
-- preset looks like, and that is a decision rather than an upgrade.
ALTER TABLE presets ADD COLUMN squash_system INTEGER NOT NULL DEFAULT 0
  CHECK (squash_system IN (0, 1));
