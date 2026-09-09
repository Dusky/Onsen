import type { GuideDto, LayoutDto, MessageDto, NextSpeakerDto, SceneMemberDto, TurnScope } from "@shared/types.ts";
import { CastEditPane } from "../../components/CastEditPane.tsx";
import { PersonaEditPane } from "../../components/PersonaEditPane.tsx";
import { CastRail } from "../../components/CastRail.tsx";
import { Readouts } from "../../components/Deck.tsx";
import { strings } from "../../strings.ts";

/**
 * The scene pane — the desktop's right-rail half of the chat screen (design
 * `4a`): the cast rail, the reader/author footer, or a full editor when one of
 * the people is being edited. Rendered into the shell's global rail, not here;
 * the screen passes it up every render so it always carries live scene state.
 */
export function ScenePane({
  editingCastId,
  onCloseCastEdit,
  personaEditing,
  onClosePersona,
  sceneId,
  personaId,
  contextSize,
  layout,
  guides,
  summaryCount,
  mediaOn,
  onOpenContext,
  cast,
  nextSpeaker,
  messages,
  scope,
  onScope,
  onCue,
  onMember,
  writingName,
  autopilotOn,
  onToggleAutopilot,
  personaName,
  authorName,
  authorTokens,
  onEditPersona,
  onEditAuthor,
}: {
  editingCastId: string | null;
  onCloseCastEdit(): void;
  personaEditing: boolean;
  onClosePersona(): void;
  sceneId: string;
  personaId: string | null;
  contextSize: number | null;
  layout: LayoutDto;
  guides: GuideDto[];
  summaryCount: number;
  mediaOn: boolean;
  onOpenContext(pane: "guides" | "memory"): void;
  cast: SceneMemberDto[];
  nextSpeaker: NextSpeakerDto | null;
  messages: MessageDto[];
  scope: TurnScope;
  onScope(scope: TurnScope): void;
  onCue(characterId: string): void;
  onMember(member: SceneMemberDto): void;
  writingName: string | null;
  autopilotOn: boolean;
  onToggleAutopilot(on: boolean): void;
  personaName: string;
  authorName: string;
  authorTokens: number | null;
  onEditPersona(): void;
  onEditAuthor(): void;
}) {
  if (editingCastId !== null) {
    return (
      <CastEditPane
        characterId={editingCastId}
        onClose={onCloseCastEdit}
        contextSize={contextSize}
      />
    );
  }

  if (personaEditing) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-none px-[16px] pt-[12px]">
          <button
            type="button"
            className="chrome text-[12.5px] text-ink-muted"
            onClick={onClosePersona}
          >
            {strings.chat.back}
          </button>
        </div>
        <PersonaEditPane sceneId={sceneId} personaId={personaId} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none px-[14px] pt-[10px]" hidden={!layout.readouts}>
        <Readouts
          guides={guides}
          summaryCount={summaryCount}
          mediaOn={mediaOn}
          onOpen={onOpenContext}
        />
      </div>
      <CastRail
        embedded
        cast={cast}
        nextSpeaker={nextSpeaker}
        messages={messages}
        guides={guides}
        scope={scope}
        onScope={onScope}
        onCue={onCue}
        onMember={onMember}
        writingName={writingName}
        guidesCost={guides.reduce((sum, guide) => sum + guide.tokenCount, 0)}
        autopilotOn={autopilotOn}
        onToggleAutopilot={onToggleAutopilot}
        onGuides={() => onOpenContext("guides")}
      />
      {/* The scene's people in one footer: the reader, edited inline, and the
          author, edited in its own tab (§20 phase 90). */}
      <div className="flex-none border-t border-rule px-[14px] py-[10px]">
        <div className="flex items-center gap-[8px]">
          <span
            className="chrome flex-none text-[11px]"
            style={{ color: "var(--onsen-color-text-dim)" }}
          >
            {strings.rightRail.you}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12.5px]">{personaName}</span>
          <button
            type="button"
            className="chrome text-[12.5px]"
            style={{ color: "var(--onsen-color-blue-text)" }}
            onClick={onEditPersona}
          >
            {strings.rightRail.edit}
          </button>
        </div>
        <div className="mt-[6px] flex items-center gap-[8px]">
          <span
            className="chrome flex-none text-[11px]"
            style={{ color: "var(--onsen-color-text-dim)" }}
          >
            {strings.rightRail.author}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12.5px]">{authorName}</span>
          {authorTokens === null ? null : (
            <span className="meta flex-none">{strings.characters.tokens(authorTokens)}</span>
          )}
          <button
            type="button"
            className="chrome text-[12.5px]"
            style={{ color: "var(--onsen-color-blue-text)" }}
            onClick={onEditAuthor}
          >
            {strings.rightRail.edit}
          </button>
        </div>
      </div>
    </div>
  );
}
