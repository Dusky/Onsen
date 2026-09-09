import type { MessageDto } from "@shared/types.ts";
import { strings } from "../../strings.ts";

/**
 * Turn attribution (SPEC §3, §3.5). Who a message is spoken by, and the initials
 * the send button and avatars show. Pure — no hooks, no screen state.
 */

export function speakerFor(message: MessageDto, authorName: string | null): string {
  if (message.authorType === "user") return strings.chat.you;
  // A beat is the author writing several characters at once, so attributing the
  // whole thing to whoever opened it would be wrong: the parts name themselves.
  if (message.kind === "beat") return authorName ?? strings.chat.beatLabel;
  return message.speakerName ?? authorName ?? strings.chat.narratorName;
}
