/**
 * Reading a SillyTavern chat log (SPEC §20 phase 44).
 *
 * Pure, and tested without a database, for the same reason the prompt builder
 * and the turn director are: the shape this produces is the whole migration,
 * and being able to prove it against a real file without standing a scene up
 * first is what makes that provable.
 *
 * A chat is JSONL. Line one is a header; every later line is a message. The
 * conversation is linear, with alternates hanging off individual messages —
 * which is exactly a tree with siblings, so nothing has to be flattened or
 * thrown away on the way in.
 */

/** One version of one turn. Several under the same parent are swipes. */
export interface ChatNode {
  content: string;
  /** Whose turn this is. `null` for the reader and for narration. */
  speaker: SpeakerRef | null;
  isUser: boolean;
  /** SillyTavern's `is_system`: still in the log, kept out of the prompt. */
  isHidden: boolean;
  reasoning: string | null;
  /** Milliseconds. Null when the file's date could not be read. */
  sentAt: number | null;
}

/**
 * How a message says who spoke.
 *
 * `avatar` is SillyTavern's own identifier — the card's filename — and is the
 * half worth trusting. `name` is a display string that a rename in the app will
 * happily desynchronise from the card it came from.
 */
export interface SpeakerRef {
  avatar: string | null;
  name: string;
}

/** One turn: its versions, and which of them the reader left showing. */
export interface ChatTurn {
  versions: ChatNode[];
  /** Index into `versions`. Always in range. */
  liveIndex: number;
}

export interface ParsedChat {
  turns: ChatTurn[];
  /** Every distinct speaker the log mentions, for resolving the cast. */
  speakers: SpeakerRef[];
  /** What could not be read, one line each. Never thrown — reported. */
  warnings: string[];
}

export class ChatParseError extends Error {}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * SillyTavern writes `send_date` as a formatted string on older chats and as a
 * number of milliseconds on newer ones. Neither is worth failing an import
 * over, so an unreadable date is simply absent.
 */
function readDate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = asString(value);
  if (text === null) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The header line, identified the way SillyTavern identifies it: by carrying
 * `chat_metadata`. Its `user_name` and `character_name` are deliberately *not*
 * read — SillyTavern writes the literal string "unused" into both on some
 * paths, and a scene titled "unused" is worse than one titled after its file.
 */
function isHeader(line: Record<string, unknown>): boolean {
  return "chat_metadata" in line;
}

function speakerOf(line: Record<string, unknown>, isUser: boolean): SpeakerRef | null {
  if (isUser) return null;
  const name = asString(line["name"])?.trim() ?? "";
  const avatar = asString(line["original_avatar"])?.trim() ?? null;
  if (name === "" && avatar === null) return null;
  return { avatar: avatar === "" ? null : avatar, name };
}

/**
 * The versions of one message.
 *
 * `swipes` holds the alternates and `swipe_id` says which is showing — but
 * `mes` is authoritative, because editing a message after swiping updates `mes`
 * and leaves the array behind. So the array supplies the alternates and `mes`
 * replaces the live one.
 */
function versionsOf(line: Record<string, unknown>): { texts: string[]; live: number } {
  const mes = asString(line["mes"]) ?? "";
  const raw = line["swipes"];
  if (!Array.isArray(raw) || raw.length === 0) return { texts: [mes], live: 0 };

  const swipes = raw.map((entry) => asString(entry) ?? "");
  const claimed = line["swipe_id"];
  const live =
    typeof claimed === "number" &&
    Number.isInteger(claimed) &&
    claimed >= 0 &&
    claimed < swipes.length
      ? claimed
      : 0;

  const texts = [...swipes];
  texts[live] = mes;
  return { texts, live };
}

/** SillyTavern keeps a model's thinking under `extra`, spelled two ways. */
function reasoningOf(line: Record<string, unknown>): string | null {
  const extra = asRecord(line["extra"]);
  if (extra === null) return null;
  const text = asString(extra["reasoning"]) ?? asString(extra["display_text"]);
  return text === null || text.trim() === "" ? null : text;
}

/**
 * Parse one `.jsonl` chat.
 *
 * A line that will not parse is a warning, not a failure: these files are
 * append-only and a crash mid-write leaves a truncated last line, which should
 * cost that turn and not the other four hundred.
 */
export function parseChat(text: string): ParsedChat {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new ChatParseError("The file is empty.");

  const turns: ChatTurn[] = [];
  const warnings: string[] = [];
  const speakers = new Map<string, SpeakerRef>();
  let sawHeader = false;

  lines.forEach((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      warnings.push(`Line ${index + 1} is not valid JSON and was skipped.`);
      return;
    }

    const record = asRecord(parsed);
    if (record === null) {
      warnings.push(`Line ${index + 1} is not a message and was skipped.`);
      return;
    }
    if (isHeader(record)) {
      sawHeader = true;
      return;
    }

    // A message says nothing else reliably, but it always has `mes`.
    if (!("mes" in record)) {
      warnings.push(`Line ${index + 1} has no message text and was skipped.`);
      return;
    }

    const isUser = record["is_user"] === true;
    const speaker = speakerOf(record, isUser);
    if (speaker !== null) {
      const key = (speaker.avatar ?? speaker.name).toLowerCase();
      if (!speakers.has(key)) speakers.set(key, speaker);
    }

    const { texts, live } = versionsOf(record);
    const sentAt = readDate(record["send_date"]);
    const isHidden = record["is_system"] === true;
    const reasoning = reasoningOf(record);

    turns.push({
      liveIndex: live,
      versions: texts.map((content) => ({
        content,
        speaker,
        isUser,
        isHidden,
        // Only the version actually shown carries the reasoning and the date;
        // SillyTavern records both per message, not per swipe.
        reasoning,
        sentAt,
      })),
    });
  });

  if (turns.length === 0) {
    throw new ChatParseError(
      sawHeader ? "The chat has a header but no messages." : "No messages could be read.",
    );
  }
  return { turns, speakers: [...speakers.values()], warnings };
}

/**
 * A readable title for an imported chat.
 *
 * SillyTavern names the file for the moment the chat began — "2024-04-12 @18h
 * 03m 21s" — which is a timestamp, not a title, but it is the only thing that
 * distinguishes one chat with a character from the next forty. Pairing it with
 * the character's name is the most a migration can honestly infer.
 */
export function titleFor(subject: string, filename: string): string {
  const stem = (filename.split("/").at(-1) ?? filename).replace(/\.jsonl$/i, "").trim();
  // A group chat is named for the group, and the folder it sits in is the group
  // too, so pairing them would produce "The ridge — The ridge".
  if (stem === "" || stem === subject) return subject;
  return `${subject} — ${stem}`;
}
