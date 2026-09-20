/**
 * The nine places settings live (SPEC §20 phase 43), as data.
 *
 * Its own module since phase 226, so the filter's one hard rule can be swept
 * rather than described: `test/settings-filter.test.ts` reads this table and
 * fails if any search term reaches two categories. Importing a screen component
 * into a test would drag the whole client tree in behind it; a table is a
 * table.
 *
 * Thirty-one section labels in one 1,596-line scroll was not a hierarchy: when
 * everything is a heading, nothing is, and nothing can be found twice. The
 * filter searches these names and the words under them, so a reader who
 * remembers "webhook" but not "connections out" still lands on it.
 *
 * **No search term may reach two drawers** (§20 phase 226). The whole point of
 * the filter is to send a reader to one place, and five terms sent them to two.
 * The fourth review found two of them by hand — `picture` (Background *and*
 * Pictures & voices) and `api key` (Models *and* Connections out). The sweep in
 * `test/settings-filter.test.ts` found the other three, which is the argument
 * for a sweep: `import` under both Packs & updates and Moving in, and two of a
 * shape nobody had thought to look for at all.
 *
 * Those two are the reason the rule is phrased about *terms* rather than about
 * word lists. The filter matches a category's **name** as well as its words, so
 * Background's `picture` collided with the name *Pictures & voices*, and
 * Agents' `background` collided with the name *Background*. Neither is a clash
 * between two lists; both send a reader to two drawers just the same.
 *
 * A category owns the words in its own name. So: Pictures & voices takes
 * `portrait`, Connections out takes `access token`, Moving in takes `bring
 * over`, Background keeps `scenery` and gives up `picture`, and Agents gives up
 * `background` — it has `agent`, `routing`, `ops` and `classifier`, and the
 * wallpaper drawer is what a reader typing "background" is looking for.
 */
export const CATEGORIES = [
  { id: "models", words: ["provider", "profile", "model", "api key", "endpoint", "anthropic", "llama"] },
  { id: "generation", words: ["preset", "sampler", "temperature", "context", "reasoning", "prefill"] },
  { id: "tasks", words: ["agent", "routing", "ops", "behind a turn", "guide", "summariser", "classifier"] },
  { id: "reading", words: ["font", "size", "theme", "prose", "light", "dark"] },
  { id: "branding", words: ["logo", "mark", "icon", "wordmark", "silhouette", "branding"] },
  { id: "backgrounds", words: ["backdrop", "background", "wallpaper", "scenery"] },
  { id: "media", words: ["portrait", "voice", "image", "speech", "tts", "draw", "caption"] },
  { id: "data", words: ["embedding", "document", "retrieval", "rag", "data bank"] },
  { id: "automation", words: ["trigger", "script", "regex", "action", "event"] },
  { id: "outward", words: ["access token", "webhook", "outbound", "bridge", "token"] },
  { id: "packs", words: ["pack", "update", "import", "export", "version", "extension"] },
  {
    id: "migrate",
    words: ["sillytavern", "migrate", "move", "switch", "chats", "jsonl", "bring over"],
  },
  { id: "account", words: ["password", "sign out", "log out", "session", "account", "devices"] },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
