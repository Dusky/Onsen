import type {
  GuideDto,
  MessageDto,
  NextSpeakerDto,
  SceneMemberDto,
  TurnScope,
} from "@shared/types.ts";
import { strings } from "../strings.ts";
import { blueMuted, blueText } from "./blue.ts";

/**
 * The cast rail (design `4a`).
 *
 * "The cast leaves the composer and becomes the rail." On a phone the cast is a
 * strip of small cards above the composer, because that is all the room there
 * is. With 292px of column, each card can finally carry what a phone cannot:
 * the portrait, the name, what state they are in, the director's own sentence
 * about why them, and the last thing they actually said.
 *
 * That last line is the one worth having. The cast strip on a phone can tell
 * you who is cued; only the rail can tell you who these people are *right now*,
 * which is what somebody scanning a group scene actually wants to know.
 *
 * The guides sit in a footer here rather than behind a sheet, for the same
 * reason: there is room, so what the prompt is carrying can simply be visible.
 */
export function CastRail({
  cast,
  nextSpeaker,
  messages,
  guides,
  scope,
  onScope,
  onCue,
  onMember,
  embedded,
  writingName,
  guidesCost,
  onGuides,
  autopilotOn,
  onToggleAutopilot,
}: {
  /** One tab inside the Inspector rather than a pane of its own (§43). */
  embedded?: boolean;
  cast: SceneMemberDto[];
  nextSpeaker: NextSpeakerDto | null;
  /** The active path, for the last line each character spoke. */
  messages: MessageDto[];
  guides: GuideDto[];
  scope: TurnScope;
  onScope(scope: TurnScope): void;
  onCue(characterId: string): void;
  onMember(member: SceneMemberDto): void;
  /** Set while a turn is streaming, so a card can say so. */
  writingName: string | null;
  guidesCost: number;
  onGuides(): void;
  /** The autopilot switch (SPEC §6) — the phone puts it on the cast strip. */
  autopilotOn: boolean;
  onToggleAutopilot(on: boolean): void;
}) {
  // Who spoke most recently, and what they said. Walked once rather than per
  // card: a long scene is a long array and there are only a handful of cards.
  const lastLine = new Map<string, string>();
  let lastSpeaker: string | null = null;
  for (const message of messages) {
    if (message.characterId === null) continue;
    lastLine.set(message.characterId, message.content);
    lastSpeaker = message.characterId;
  }

  return (
    // Embedded: the Inspector owns the pane's width, border and ground, and
    // this is one tab inside it (§20 phase 43). Standalone is the old shape.
    <aside
      className={
        embedded === true
          ? "flex min-h-0 flex-1 flex-col"
          : "flex w-[292px] flex-none flex-col border-l border-rule bg-bg-sunken"
      }
    >
      <div className="hairline flex-none px-[18px] pt-[22px] pb-[12px]">
        <p className="section-label">{strings.chat.whoSpeaksNext}</p>
      </div>

      {/* One voice or the room. The same control the phone puts in the cast
          strip, and it means the same thing here. A beat needs two members who
          can actually speak, so a muted one does not count (§20 phase 62) —
          the server degrades a beat of one to a spotlight, and offering the
          choice anyway would be offering something that does not happen. */}
      {cast.filter((member) => member.isActive && !member.isMuted).length > 1 ? (
        <div className="flex-none px-[14px] pt-[12px]">
          <div className="flex gap-[5px]">
            {(["spotlight", "beat"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onScope(value)}
                className={`btn flex-1 ${scope === value ? "btn-primary" : ""}`}
                style={{ minHeight: "32px", fontSize: "8.5px", padding: "0 8px" }}
              >
                {value === "spotlight" ? strings.chat.scopeSpotlight : strings.chat.scopeBeat}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Autopilot (SPEC §6), beside the scope it belongs with. Amber rather
          than the shared `.btn-primary` blue: on while running, it is a live
          state, not a chosen mode like the scope buttons above it. */}
      <div className="flex-none px-[14px] pt-[6px] pb-[6px]">
        <button
          type="button"
          onClick={() => onToggleAutopilot(!autopilotOn)}
          aria-pressed={autopilotOn}
          className="btn w-full"
          style={{
            minHeight: "32px",
            fontSize: "8.5px",
            padding: "0 8px",
            borderColor: autopilotOn ? "var(--onsen-color-amber)" : undefined,
            color: autopilotOn ? "var(--onsen-color-amber)" : undefined,
          }}
        >
          {strings.chat.autopilot}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[14px] py-[12px]">
        {cast.length === 0 ? (
          <p className="explain">
            {strings.sceneSetup.castEmpty}
          </p>
        ) : null}

        {cast.map((member) => {
          const cued = nextSpeaker?.characterId === member.characterId;
          const writing = writingName === member.name;
          const status = writing
            ? strings.chat.statusWriting
            : cued
              ? strings.chat.statusCued
              : !member.isActive
                ? strings.chat.statusBenched
                : member.isMuted
                  ? strings.chat.statusMuted
                  : lastSpeaker === member.characterId
                    ? strings.chat.statusJustSpoke
                    : null;

          return (
            <div
              key={member.characterId}
              className="mb-[8px]"
              style={{
                // The cued card takes an amber-tinted fill and a 2px amber top
                // border — live/now, not destructive (design review fix 1) —
                // a benched one drops to 72% (design `4a`).
                background: cued ? "var(--onsen-color-amber-bg)" : "transparent",
                borderTop: `2px solid ${cued ? "var(--onsen-color-amber)" : "transparent"}`,
                // Benched drops furthest — they are not in the prompt at all;
                // muted sits between, still present and simply not speaking.
                opacity: !member.isActive ? 0.72 : member.isMuted ? 0.85 : 1,
              }}
            >
              <button
                type="button"
                onClick={() => onCue(member.characterId)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onMember(member);
                }}
                className="flex w-full gap-[10px] p-[10px] text-left"
              >
                <span
                  className="h-[54px] w-[42px] flex-none border border-rule bg-cover bg-center"
                  style={
                    member.hasAvatar
                      ? {
                          backgroundImage: `url(/api/characters/${member.characterId}/avatar)`,
                        }
                      : { background: "var(--onsen-color-bg-inset)" }
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-[6px]">
                    <span className="min-w-0 flex-1 truncate text-ui-loose">{member.name}</span>
                    {status === null ? null : (
                      <span
                        className="chrome flex-none text-[11.5px]"
                        style={{
                          color: cued || writing
                            ? "var(--onsen-color-amber)"
                            : "var(--onsen-color-text-dim)",
                        }}
                      >
                        {status}
                      </span>
                    )}
                  </span>

                  {/* The director's own sentence, on the card it is about. On a
                      phone this is one line under the whole strip; here it
                      belongs to the character it explains. */}
                  {cued && nextSpeaker !== null && nextSpeaker.reason !== "" ? (
                    <span className="chrome mt-[4px] block text-[12px] leading-[1.5] text-ink-dim">
                      {nextSpeaker.reason}
                    </span>
                  ) : null}

                  {/* What they last said. Spectral italic, because it is the
                      story speaking rather than the app. */}
                  {lastLine.has(member.characterId) ? (
                    <span className="mt-[5px] block text-ui-loose leading-[1.45] text-ink-muted italic">
                      {excerpt(lastLine.get(member.characterId)!)}
                    </span>
                  ) : null}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* The guides panel becomes a footer here rather than a sheet (design
          `4a`): with the room, what the prompt carries is simply visible. */}
      <button
        type="button"
        onClick={onGuides}
        className="flex-none border-t px-[14px] py-[12px] text-left"
        style={{
          borderColor: "var(--onsen-color-blue-border)",
          background: "var(--onsen-color-blue-bg)",
        }}
      >
        <span className="flex items-baseline gap-[8px]">
          <span
            className="chrome min-w-0 flex-1 text-ui"
            style={blueText}
          >
            {strings.chat.guides}
          </span>
          <span
            className="chrome flex-none text-ui"
            style={blueMuted}
          >
            {strings.chat.guidesTotal(guidesCost)}
          </span>
        </span>
        <span className="mt-[6px] block text-ui-loose leading-[1.5]" style={blueMuted}>
          {guides.length === 0
            ? strings.chat.guidesEmpty
            : excerpt(guides[0]!.content, 120)}
        </span>
      </button>
    </aside>
  );
}

/** A line of prose, cut to fit a card rather than wrapping down the rail. */
function excerpt(text: string, limit = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}
