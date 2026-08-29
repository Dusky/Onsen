import type {
  NextSpeakerDto,
  SceneMemberDto,
  TurnScope,
  TurnStrategy,
} from "@shared/types.ts";
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
 *
 * The scope control lives here rather than in the composer because it is a
 * decision about the same thing the strip is about — what the next turn is —
 * and because it only means anything with two or more characters in play: a
 * beat is several of them interacting, so with one there is nothing to choose.
 */

interface CastStripProps {
  cast: SceneMemberDto[];
  nextSpeaker: NextSpeakerDto | null;
  /** Tap a card to cue that character for the next turn. */
  onCue(characterId: string): void;
  onLongPress(member: SceneMemberDto): void;
  /** One voice or the whole room (SPEC §3.5). */
  scope: TurnScope;
  onScope(scope: TurnScope): void;
  strategy: TurnStrategy;
  /**
   * True when the classifier will choose the speaker at send time, so there is
   * nobody to cue-highlight yet and saying otherwise would be a guess.
   */
  decidesOnSend: boolean;
}

export function CastStrip({
  cast,
  nextSpeaker,
  onCue,
  onLongPress,
  scope,
  onScope,
  strategy,
  decidesOnSend,
}: CastStripProps) {
  if (cast.length === 0) return null;

  const inPlay = cast.filter((member) => member.isActive);
  const canBeat = inPlay.length > 1;
  // `auto` means "ask the director", so it is offered only where a director can
  // answer. Offering it under a strategy that cannot would be a button that
  // secretly means something else.
  const options: TurnScope[] =
    canBeat && strategy === "classifier"
      ? ["spotlight", "beat", "auto"]
      : ["spotlight", "beat"];

  return (
    <div className="mb-[11px]">
      {/* The strip scrolls horizontally; the lifted cued card needs headroom. */}
      <div className="flex items-end gap-[8px] overflow-x-auto pt-[16px] pb-[2px]">
        {cast.map((member) => {
          const cued = !decidesOnSend && member.characterId === nextSpeaker?.characterId;
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
                  {nextSpeaker!.source === "user"
                    ? scope === "beat" && canBeat
                      ? strings.chat.youOpens
                      : strings.chat.youCued
                    : scope === "beat" && canBeat
                      ? strings.chat.autoOpens
                      : strings.chat.autoNext}
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

      {/* One voice, or the room. Offered only when there is a room. */}
      {canBeat ? (
        <div className="mt-[9px] flex gap-[6px]">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onScope(option)}
              aria-pressed={scope === option}
              className="chrome flex-1 border py-[8px] text-[9px] tracking-[0.14em] uppercase"
              style={{
                borderColor:
                  scope === option ? "var(--onsen-color-red)" : "var(--onsen-color-border-quiet)",
                color:
                  scope === option
                    ? "var(--onsen-color-red)"
                    : "var(--onsen-color-text-muted)",
              }}
            >
              {option === "beat"
                ? strings.chat.scopeBeat
                : option === "auto"
                  ? strings.chat.scopeAuto
                  : strings.chat.scopeSpotlight}
            </button>
          ))}
        </div>
      ) : null}

      {/* Printed, always. No tooltip, no modal. In a beat the director's choice
          is who opens rather than who speaks, so the caption says what is
          actually about to happen instead. */}
      {canBeat && scope === "beat" ? (
        <p className="chrome mt-[8px] text-[9.5px] leading-[1.5] tracking-[0.06em] text-ink-dim uppercase">
          {strings.chat.scopeBeatHint(inPlay.map((member) => member.name).join(", "))}
        </p>
      ) : scope === "auto" ? (
        <p className="chrome mt-[8px] text-[9.5px] leading-[1.5] tracking-[0.06em] text-ink-dim uppercase">
          {strings.chat.scopeAutoHint}
        </p>
      ) : nextSpeaker !== null ? (
        <p className="chrome mt-[8px] text-[9.5px] leading-[1.5] tracking-[0.06em] text-ink-dim uppercase">
          {/* While the classifier is still to decide there is no name to print:
              the fallback is a guess, and printing it would be one. */}
          {decidesOnSend
            ? nextSpeaker.reason
            : nextSpeaker.source === "user"
              ? strings.chat.yourPickOverrides
              : `${nextSpeaker.name} — ${nextSpeaker.reason}`}
        </p>
      ) : null}
    </div>
  );
}
