import type { NextSpeakerDto, SceneMemberDto } from "@shared/types.ts";
import { strings } from "../strings.ts";

/**
 * The cast strip and the director's reason.
 *
 * Two things the design is emphatic about. The cued speaker's card is larger,
 * lifted above the baseline, and carries a red top border and a red caption —
 * so who is about to speak is legible at a glance rather than by reading. And
 * the director's reason is **printed, always**, with no tooltip and no modal:
 * it is the answer to "why is it picking them", and a decision nobody can read
 * is the arbitrary dice roll this replaces.
 */

interface CastStripProps {
  cast: SceneMemberDto[];
  nextSpeaker: NextSpeakerDto | null;
  /** Tap a card to cue that character for the next turn. */
  onCue(characterId: string): void;
  onLongPress(member: SceneMemberDto): void;
}

export function CastStrip({ cast, nextSpeaker, onCue, onLongPress }: CastStripProps) {
  if (cast.length === 0) return null;

  return (
    <div className="mb-[11px]">
      {/* The strip scrolls horizontally; the lifted cued card needs headroom. */}
      <div className="flex items-end gap-[8px] overflow-x-auto pt-[16px] pb-[2px]">
        {cast.map((member) => {
          const cued = member.characterId === nextSpeaker?.characterId;
          return (
            <button
              key={member.characterId}
              type="button"
              onClick={() => onCue(member.characterId)}
              onContextMenu={(event) => {
                event.preventDefault();
                onLongPress(member);
              }}
              aria-current={cued ? "true" : undefined}
              aria-label={`${member.name}${cued ? " — cued" : ""}`}
              className="relative flex-none text-left"
              style={{ marginBottom: cued ? "6px" : "0" }}
            >
              {cued ? (
                <span
                  className="chrome absolute -top-[14px] left-0 text-[7.5px] tracking-[0.14em] uppercase"
                  style={{ color: "var(--onsen-color-red)" }}
                >
                  {nextSpeaker!.source === "user" ? strings.chat.youCued : strings.chat.autoNext}
                </span>
              ) : null}

              <span
                className="block bg-cover bg-center"
                style={{
                  width: cued ? "82px" : "70px",
                  height: cued ? "58px" : "50px",
                  borderTop: cued ? "2px solid var(--onsen-color-red)" : "1px solid var(--onsen-color-rule)",
                  borderLeft: "1px solid var(--onsen-color-rule)",
                  borderRight: "1px solid var(--onsen-color-rule)",
                  borderBottom: "1px solid var(--onsen-color-rule)",
                  opacity: member.isActive ? 1 : 0.45,
                  ...(member.hasAvatar
                    ? { backgroundImage: `url(/api/characters/${member.characterId}/avatar)` }
                    : { background: cued ? "var(--onsen-stripe-cued)" : "var(--onsen-stripe)" }),
                }}
              />

              <span
                className="chrome mt-[4px] block truncate text-[9px] tracking-[0.08em] uppercase"
                style={{
                  width: cued ? "82px" : "70px",
                  color: cued
                    ? "var(--onsen-color-text-bright)"
                    : "var(--onsen-color-text-muted)",
                  fontWeight: cued ? 600 : 400,
                }}
              >
                {member.name}
              </span>
            </button>
          );
        })}
      </div>

      {/* Printed, always. No tooltip, no modal. */}
      {nextSpeaker !== null ? (
        <p className="chrome mt-[8px] text-[9.5px] leading-[1.5] tracking-[0.06em] text-ink-dim uppercase">
          {nextSpeaker.source === "user"
            ? strings.chat.yourPickOverrides
            : `${nextSpeaker.name} — ${nextSpeaker.reason}`}
        </p>
      ) : null}
    </div>
  );
}
