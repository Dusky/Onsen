import type { MessageDto, SceneMemberDto } from "@shared/types.ts";
import { useExpressionPack } from "../lib/queries.ts";

/**
 * The visual novel stage (SPEC §12, §20 phase 29).
 *
 * Sprites above the log, one per active cast member, changed by the expression
 * the author declared in the turn that just happened. The binding is read
 * live: a label that has no sprite falls back to the avatar, then the stripe —
 * exactly the graceful degradation §12 asks for. The spotlighted speaker is
 * full-opacity; everyone else dims. The background sits behind the whole row.
 */

/** The latest declared expression per character, oldest-to-newest. */
export function resolveExpressions(messages: MessageDto[]): Map<string, string> {
  const current = new Map<string, string>();
  for (const message of messages) {
    if (message.expression !== null && message.characterId !== null) {
      current.set(message.characterId, message.expression);
    }
    for (const segment of message.segments ?? []) {
      if (segment.expression !== null && segment.characterId !== null) {
        current.set(segment.characterId, segment.expression);
      }
    }
  }
  return current;
}

function Sprite({
  member,
  label,
  dimmed,
}: {
  member: SceneMemberDto;
  label: string | null;
  dimmed: boolean;
}) {
  const pack = useExpressionPack(member.characterId);
  const expression =
    label === null ? undefined : (pack.data?.expressions.find((entry) => entry.label === label));
  const image = expression?.hasImage
    ? `/api/characters/expressions/${expression.id}/image`
    : member.hasAvatar
      ? `/api/characters/${member.characterId}/avatar`
      : null;

  return (
    <div className="flex flex-none flex-col items-center" style={{ opacity: dimmed ? 0.45 : 1 }}>
      <div
        className="h-[132px] w-[92px] border bg-cover bg-center"
        style={{
          borderColor: dimmed ? "var(--onsen-color-rule)" : "var(--onsen-color-red)",
          borderTopWidth: dimmed ? "1px" : "2px",
          ...(image === null
            ? { background: "var(--onsen-stripe)" }
            : { backgroundImage: `url(${image})` }),
        }}
      />
      <p className="chrome mt-[5px] max-w-[92px] truncate text-[10.5px] text-ink-label">
        {member.name}
      </p>
    </div>
  );
}

export function VnStage({
  cast,
  messages,
  background,
  sceneId,
}: {
  cast: SceneMemberDto[];
  messages: MessageDto[];
  background: boolean;
  sceneId: string;
}) {
  const inPlay = cast.filter((member) => member.isActive);
  if (inPlay.length === 0) return null;

  const expressions = resolveExpressions(messages);
  // Who spoke most recently, for the spotlight's emphasis.
  let lastSpeaker: string | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.characterId !== null) {
      lastSpeaker = message.characterId;
      break;
    }
  }

  return (
    <div
      className="flex-none overflow-hidden border-b border-rule"
      style={{
        height: "180px",
        position: "relative",
        ...(background
          ? {
              backgroundImage: `url(/api/scenes/${sceneId}/background)`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : { background: "var(--onsen-color-bg-sunken)" }),
      }}
    >
      <div className="flex h-full items-end justify-center gap-[10px] overflow-x-auto px-[12px] py-[12px]">
        {inPlay.map((member) => (
          <Sprite
            key={member.characterId}
            member={member}
            label={expressions.get(member.characterId) ?? null}
            dimmed={lastSpeaker !== null && member.characterId !== lastSpeaker}
          />
        ))}
      </div>
    </div>
  );
}
