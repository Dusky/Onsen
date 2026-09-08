-- 0067 extension management — SPEC §15, §20 phase 143.
--
-- Extensions gain an enable switch, a description for the manager, and stored
-- settings plus the declarative schema the host renders as a form.

ALTER TABLE extensions ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE extensions ADD COLUMN description TEXT;
ALTER TABLE extensions ADD COLUMN settings TEXT;
ALTER TABLE extensions ADD COLUMN settings_schema TEXT;
