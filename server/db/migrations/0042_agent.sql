-- 0042 the agent — SPEC §20 phase 46.
--
-- A second model with tools, which can read and change the install: cast,
-- roleplays, lore, personas, themes. Not a cast member — §22's rule against
-- independent agents is about who writes the story, and this one does not. It
-- is the thing you ask to tag two hundred imported cards.
--
-- Threads are kept because the useful asks are long: a plan, a correction, a
-- follow-up. Losing that on reload would make it a toy.
CREATE TABLE agent_threads (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid       TEXT    NOT NULL UNIQUE,
  title      TEXT    NOT NULL DEFAULT 'New thread',
  -- Null runs on the install's default profile. Its own, because the work is
  -- tool calling rather than prose and the right model for it is rarely the
  -- one writing the story.
  connection_profile_id INTEGER REFERENCES connection_profiles (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE agent_messages (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ulid       TEXT    NOT NULL UNIQUE,
  thread_id  INTEGER NOT NULL REFERENCES agent_threads (id) ON DELETE CASCADE,

  -- user | assistant | tool. No system row: the system prompt is built from
  -- the tool registry every turn, so adding a tool never leaves old threads
  -- describing a set of tools that no longer exists.
  role       TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content    TEXT    NOT NULL DEFAULT '',

  -- Calls this assistant turn asked for, as JSON. Null on every other role.
  tool_calls TEXT,
  -- Which call a tool result answers. Null on every other role.
  tool_call_id TEXT,
  -- Whether the tool reported failure, so the UI can show it as one.
  is_error   INTEGER NOT NULL DEFAULT 0 CHECK (is_error IN (0, 1)),

  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX agent_messages_thread ON agent_messages (thread_id, id);
