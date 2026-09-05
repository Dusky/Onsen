import type {
  CastDisplay,
  GuideDto,
  NextSpeakerDto,
  SceneMemberDto,
  TurnScope,
  TurnStrategy,
} from "@shared/types.ts";
import { strings } from "../strings.ts";

/**
 * The deck (SPEC §16 layout direction, §20 phase 50).
 *
 * Instrument's bet is that the machine's state is the second half of the
 * product, so it stays on screen rather than behind a tap. Three things, in
 * one block above the composer:
 *
 *  1. **Who speaks next, and why.** The reason is printed, always — the design
 *     is emphatic about this and it is the answer to "why is it picking them".
 *     A decision nobody can read is the arbitrary dice roll this replaces.
 *  2. **The cast as one segmented control** rather than a row of cards. Cards
 *     carried a portrait nobody has supplied yet and cost 70px of height above
 *     an open keyboard; a name in a segment carries the same decision.
 *  3. **What each subsystem is holding**, one cell each, each in its own hue.
 *     Four figures in one colour read as one figure — which is why guides keep
 *     the blue pencil, memory takes the green, and media takes a brass.
 *
 * Red is deliberately absent from the readout. It stays the colour of *now*:
 * the cued speaker, and nothing else here.
 */

interface DeckProps {
  cast: SceneMemberDto[];
  nextSpeaker: NextSpeakerDto | null;
  onCue(characterId: string): void;
  onLongPress(member: SceneMemberDto): void;
  scope: TurnScope;
  onScope(scope: TurnScope): void;
  strategy: TurnStrategy;
  /** True when the classifier chooses at send time, so there is nobody to mark. */
  decidesOnSend: boolean;
  /** Whether the subsystem row is shown at all (§20 phase 52). */
  readouts: boolean;
  /** Segments, or one line of prose naming who answers. */
  castDisplay: CastDisplay;
  guides: GuideDto[];
  summaryCount: number;
  mediaOn: boolean;
  /** Opens the panel behind whichever readout was pressed. */
  onOpen(pane: "guides" | "memory" | "media"): void;
}

/** One subsystem's state. The hue is the whole point of the row. */
function Readout({
  label,
  value,
  hue,
  onClick,
}: {
  label: string;
  value: string;
  hue: "blue" | "green" | "amber";
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[44px] flex-col items-start gap-[2px] bg-bg-inset px-[10px] py-[8px] text-left"
      style={{ borderLeft: `2px solid var(--onsen-color-${hue})` }}
    >
      <span
        className="chrome text-[10.5px]"
        style={{ color: `var(--onsen-color-${hue}-text-muted)` }}
      >
        {label}
      </span>
      <span
        className="chrome truncate text-[13px]"
        style={{ color: `var(--onsen-color-${hue}-text)` }}
      >
        {value}
      </span>
    </button>
  );
}

export function Deck({
  cast,
  nextSpeaker,
  onCue,
  onLongPress,
  scope,
  onScope,
  strategy,
  decidesOnSend,
  readouts,
  castDisplay,
  guides,
  summaryCount,
  mediaOn,
  onOpen,
}: DeckProps) {
  const inPlay = cast.filter((member) => member.isActive);
  const cuedId = decidesOnSend ? null : (nextSpeaker?.characterId ?? null);
  // The scope control only means anything with two or more in play: a beat is
  // several characters interacting, so with one there is nothing to choose.
  const canBeat = inPlay.length > 1;
  // `auto` means "ask the director", so it is a segment only where a director
  // can answer. Offering it under a strategy that cannot would be a button
  // that secretly means something else.
  const autoOffered = canBeat && strategy === "classifier";

  /*
   * Why this speaker, printed verbatim. The design is emphatic that it is
   * always shown — a decision nobody can read is the arbitrary dice roll this
   * replaces — so it is computed once here and rendered by whichever cast
   * control is on.
   */
  const reason =
    canBeat && scope === "beat"
      ? strings.chat.scopeBeatHint(inPlay.map((member) => member.name).join(", "))
      : nextSpeaker === null
        ? ""
        : decidesOnSend
          ? nextSpeaker.reason
          : nextSpeaker.source === "user"
            ? strings.chat.yourPickOverrides
            : nextSpeaker.reason;

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex flex-col gap-[6px]">
        {/* The header row states the name and the reason separately, which is
            what the segments below need. The one-line control says both in a
            sentence, so showing both is saying it twice. */}
        <div
          className="flex items-baseline justify-between gap-[10px]"
          hidden={castDisplay === "line"}
        >
          <span
            className="chrome text-[10.5px]"
            style={{ color: "var(--onsen-color-red-text)" }}
          >
            {strings.chat.speakingNext}
          </span>
          {/* Printed, always. No tooltip, no modal. The wording follows the
              cast strip's exactly, because it is the same statement — a
              classifier that has not run yet has no name to print, and
              printing the fallback would be a guess. */}
          <span className="chrome min-w-0 flex-1 truncate text-right text-[10.5px] text-ink-dim">
            {reason}
          </span>
        </div>

        <div className="flex border border-rule-strong" hidden={castDisplay !== "segments"}>
          {inPlay.map((member) => {
            const cued = scope === "spotlight" && member.characterId === cuedId;
            return (
              <button
                key={member.characterId}
                type="button"
                onClick={() => {
                  onScope("spotlight");
                  onCue(member.characterId);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onLongPress(member);
                }}
                aria-pressed={cued}
                className="chrome min-h-[44px] min-w-0 flex-1 truncate border-r border-rule-strong px-[6px] text-[13px] last:border-r-0"
                style={{
                  color: cued ? "var(--onsen-color-text-bright)" : "var(--onsen-color-text-muted)",
                  background: cued ? "var(--onsen-color-red-bg)" : "transparent",
                }}
              >
                {member.name}
              </button>
            );
          })}
          {canBeat ? (
            <button
              type="button"
              onClick={() => onScope("beat")}
              aria-pressed={scope === "beat"}
              className="chrome min-h-[44px] min-w-0 flex-1 truncate border-r border-rule-strong px-[6px] text-[13px] last:border-r-0"
              style={{
                color:
                  scope === "beat"
                    ? "var(--onsen-color-text-bright)"
                    : "var(--onsen-color-text-muted)",
                background: scope === "beat" ? "var(--onsen-color-red-bg)" : "transparent",
              }}
            >
              {strings.chat.scopeBeat}
            </button>
          ) : null}
          {autoOffered ? (
            <button
              type="button"
              onClick={() => onScope("auto")}
              aria-pressed={scope === "auto"}
              className="chrome min-h-[44px] min-w-0 flex-1 truncate px-[6px] text-[13px]"
              style={{
                color:
                  scope === "auto"
                    ? "var(--onsen-color-text-bright)"
                    : "var(--onsen-color-text-muted)",
                background: scope === "auto" ? "var(--onsen-color-red-bg)" : "transparent",
              }}
            >
              {strings.chat.scopeAuto}
            </button>
          ) : null}
        </div>
      </div>

      {/*
       * Quiet's cast control: one line of prose rather than a row of
       * segments. The name that answers is a button, because "change" has to
       * lead somewhere — it cycles to the next in play, which on a cast of
       * two or three is the whole decision.
       */}
      {castDisplay === "line" && inPlay.length > 0 ? (
        <p className="explain">
          {strings.chat.answersNext(
            scope === "beat" ? strings.chat.scopeBeat : (nextSpeaker?.name ?? inPlay[0]!.name),
            reason,
          )}{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            style={{ color: "var(--onsen-color-red)" }}
            onClick={() => {
              const at = inPlay.findIndex((m) => m.characterId === cuedId);
              const next = inPlay[(at + 1) % inPlay.length]!;
              onScope("spotlight");
              onCue(next.characterId);
            }}
          >
            {strings.chat.changeSpeaker}
          </button>
        </p>
      ) : null}

      {readouts ? (
        <Readouts
          guides={guides}
          summaryCount={summaryCount}
          mediaOn={mediaOn}
          onOpen={onOpen}
        />
      ) : null}
    </div>
  );
}

/**
 * What each subsystem is holding, one cell each.
 *
 * Separate from the deck because the desktop rail wants the same row without
 * the cast segments — there the cast is already a column of cards with room
 * for a portrait and a last line, which is the one thing a phone cannot give
 * it. The readouts are the part that is the same at both widths.
 */
export function Readouts({
  guides,
  summaryCount,
  mediaOn,
  onOpen,
}: Pick<DeckProps, "guides" | "summaryCount" | "mediaOn" | "onOpen">) {
  return (
    <div className="grid grid-cols-3 gap-[8px]">
      <Readout
        label={strings.chat.deckGuides}
        value={guides.length === 0 ? strings.chat.deckOff : strings.chat.deckLive(guides.length)}
        hue="blue"
        onClick={() => onOpen("guides")}
      />
      <Readout
        label={strings.chat.deckMemory}
        value={summaryCount === 0 ? strings.chat.deckNone : strings.chat.deckKept(summaryCount)}
        hue="green"
        onClick={() => onOpen("memory")}
      />
      <Readout
        label={strings.chat.deckMedia}
        value={mediaOn ? strings.chat.deckOn : strings.chat.deckOff}
        hue="amber"
        onClick={() => onOpen("media")}
      />
    </div>
  );
}
