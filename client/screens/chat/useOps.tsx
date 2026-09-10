import { useState } from "react";
import type { MessageDto, NextSpeakerDto, PromptRoleName, ReviseMode, SceneMemberDto, TurnScope } from "@shared/types.ts";
import {
  ArrowDownToLine,
  Compass,
  Feather,
  MessageSquareOff,
  NotebookPen,
  PenLine,
  Play,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { api } from "../../lib/api.ts";
import { useGeneration } from "../../lib/generation.ts";
import { useSceneSetup, useSendMessage } from "../../lib/queries.ts";
import { strings } from "../../strings.ts";
import { OpsGrid, OpPrompt, SteerOp, type Op } from "../../components/OpsGrid.tsx";
import { ExtensionActionsButton } from "../../components/ExtensionActions.tsx";

export type OpsPanel = null | "grid" | "nudge" | "guided_swipe" | "steer" | "impersonate";

/**
 * The ops surface (SPEC §7, §20 phase 149): the grid, the drawer, and the turn
 * handlers every op and the palette dispatch through. Extracted whole from the
 * chat screen so that state stays in one place and the ops stay in another.
 */
export interface OpsDeps {
  sceneId: string;
  title: string;
  authorName: string | null;
  speakerName: string | null;
  scope: TurnScope;
  nextSpeaker: NextSpeakerDto | null;
  decidesOnSend: boolean;
  cast: SceneMemberDto[];
  messages: MessageDto[];
  cued: string | null;
  draft: string;
  setDraft(value: string): void;
  isGenerating: boolean;
  isDesktop: boolean;
  steer: string | null;
  steerDepth: number;
  steerInterval: number;
  steerRole: PromptRoleName;
  guidesCount: number;
  generation: ReturnType<typeof useGeneration>;
  send: ReturnType<typeof useSendMessage>;
  setup: ReturnType<typeof useSceneSetup>;
  setCued(id: string | null): void;
  setActing(message: MessageDto | null): void;
  setRecasting(message: MessageDto | null): void;
  setCorrecting(message: MessageDto | null): void;
  setOpsPanel(panel: OpsPanel): void;
  setPaletteOpen(open: boolean): void;
  setPaletteSeed(seed: string): void;
  setToolsOpen(open: boolean): void;
  setGuidesOpen(open: boolean): void;
  setOocOpen(open: boolean): void;
}

export function useOps(deps: OpsDeps) {
  const {
    sceneId,
    title,
    authorName,
    speakerName,
    scope,
    nextSpeaker,
    decidesOnSend,
    cast,
    messages,
    cued,
    draft,
    setDraft,
    isGenerating,
    isDesktop,
    steer,
    steerDepth,
    steerInterval,
    steerRole,
    guidesCount,
    generation,
    send,
    setup,
    setCued,
    setActing,
    setRecasting,
    setCorrecting,
    setOpsPanel,
    setPaletteOpen,
    setPaletteSeed,
    setToolsOpen,
    setGuidesOpen,
    setOocOpen,
  } = deps;

  const [opWorking, setOpWorking] = useState(false);

  /** What the send button is about to ask for. */
  function nextTurn() {
    return {
      sceneId,
      sceneTitle: title,
      // Null means "not decided yet"; the director event fills it in.
      speaker: scope === "beat" ? (authorName ?? strings.chat.beatLabel) : speakerName,
      scope,
      // In a beat the cue chooses who opens rather than who speaks.
      ...(nextSpeaker === null || decidesOnSend ? {} : { characterId: nextSpeaker.characterId }),
    };
  }

  /** Let the scene run on: a reply with no reader turn in front of it. */
  function continueScene() {
    void generation.start(nextTurn()).then(() => setCued(null));
  }

  async function sendAndReply(text: string) {
    await send.mutateAsync({ kind: "user", authorType: "user", content: text });
    await generation.start(nextTurn());
    // A cue is spent once it has been used; the scope is not — asking for the
    // room once usually means asking for it again.
    setCued(null);
  }

  /** Rewrite one character's part of a beat, holding the rest of it fixed. */
  async function recast(message: MessageDto, ordinal: number, name: string | null) {
    setRecasting(null);
    setActing(null);
    await generation.start({
      sceneId,
      sceneTitle: title,
      speaker: name ?? strings.chat.beatLabel,
      recast: { messageId: message.id, ordinal },
    });
  }

  /** Reroll: generate a sibling under the same parent, keeping the original. */
  async function reroll(message: MessageDto, nudge?: string) {
    setActing(null);
    await generation.start({
      sceneId,
      sceneTitle: title,
      speaker: strings.chat.narratorName,
      parentId: message.parentId,
      ...(nudge === undefined ? {} : { nudge }),
    });
  }

  const lastReply = [...messages].reverse().find((message) => message.authorType !== "user") ?? null;

  /** A one-shot instruction for the next turn. Never becomes a message. */
  async function nudge(instruction: string) {
    setOpsPanel(null);
    await generation.start({ ...nextTurn(), nudge: instruction });
    setCued(null);
  }

  /** A quick reply is a saved nudge: one tap, same path (SPEC §7, phase 65). */
  function fireQuickReply(prompt: string) {
    setOpsPanel(null);
    void nudge(prompt);
  }

  /** Reroll the last reply with direction. Only when there is one to reroll. */
  async function guidedSwipe(instruction: string) {
    setOpsPanel(null);
    if (lastReply === null) return;
    await reroll(lastReply, instruction);
  }

  /** Produce a better version of a turn, as a sibling (SPEC §7). */
  async function revise(message: MessageDto, mode: ReviseMode, instructions?: string) {
    setActing(null);
    setCorrecting(null);
    await generation.start({
      sceneId,
      sceneTitle: title,
      speaker: message.speakerName ?? authorName ?? strings.chat.narratorName,
      revise: {
        messageId: message.id,
        mode,
        ...(instructions === undefined ? {} : { instructions }),
      },
    });
  }

  /**
   * Expand the draft into a turn in the reader's voice, and put it back in the
   * composer. Nothing is sent — that is what makes this op safe (SPEC §7).
   */
  async function impersonate(person: "first" | "second" | "third") {
    setOpWorking(true);
    try {
      const result = await api.post<{ text: string | null }>(`/scenes/${sceneId}/impersonate`, {
        outline: draft,
        person,
      });
      if (result.text !== null) setDraft(result.text);
      setOpsPanel(null);
    } catch {
      // The op failed; the draft the user typed is still theirs, untouched.
      setOpsPanel(null);
    } finally {
      setOpWorking(false);
    }
  }

  /** Post without asking for a reply. Essential for stacking messages (§7). */
  async function sendWithoutReply() {
    const text = draft.trim();
    if (text === "") return;
    setDraft("");
    setOpsPanel(null);
    await send.mutateAsync({ kind: "user", authorType: "user", content: text });
  }

  /**
   * The composer as a command palette (§20 phase 130): a `/` first opens the
   * palette with what follows as its query, instead of writing a message.
   */
  function handleDraftChange(value: string) {
    if (value.startsWith("/")) {
      setDraft("");
      setPaletteSeed(value.slice(1));
      setPaletteOpen(true);
    } else {
      setDraft(value);
    }
  }

  /**
   * Who speaks next, in one line — what replaces the cast strip and the
   * director's reason while the ops grid is open (design handoff).
   */
  function cueSummary(): string | undefined {
    if (cast.length === 0) return undefined;
    if (scope === "beat") return strings.chat.cueBeat(cast.filter((m) => m.isActive).length);
    if (speakerName === null) return strings.chat.cueUndecided;
    return cued === null ? strings.chat.cueAuto(speakerName) : strings.chat.cueYours(speakerName);
  }

  const ops: Op[] = [
    {
      key: "nudge",
      glyph: <PenLine size={16} strokeWidth={1.75} />,
      label: strings.chat.opNudge,
      onPress: () => setOpsPanel("nudge"),
    },
    {
      key: "guided_swipe",
      glyph: <RefreshCw size={16} strokeWidth={1.75} />,
      label: strings.chat.opGuidedSwipe,
      // Only when the last message is from the AI — there is nothing else to
      // reroll, and §7 says so explicitly.
      disabled: lastReply === null,
      onPress: () => setOpsPanel("guided_swipe"),
    },
    {
      key: "impersonate",
      glyph: <Feather size={16} strokeWidth={1.75} />,
      label: strings.chat.opImpersonate,
      onPress: () => setOpsPanel("impersonate"),
    },
    {
      key: "steer",
      glyph: <Compass size={16} strokeWidth={1.75} />,
      label: strings.chat.opSteer,
      onPress: () => setOpsPanel("steer"),
    },
    {
      key: "guides",
      glyph: <NotebookPen size={16} strokeWidth={1.75} />,
      // The count is on the cell because a guide costs tokens on every single
      // turn, and the design's rule is that cost is never hidden a level down.
      label:
        guidesCount === 0 ? strings.chat.opGuides : `${strings.chat.opGuides} · ${guidesCount}`,
      tone: "blue",
      onPress: () => {
        setOpsPanel(null);
        setGuidesOpen(true);
      },
    },
    {
      key: "ooc",
      glyph: <MessageSquareOff size={16} strokeWidth={1.75} />,
      label: strings.chat.opOoc,
      // The author's own voice, so the author's own colour (design 2a).
      tone: "blue",
      onPress: () => {
        setOpsPanel(null);
        setOocOpen(true);
      },
    },
    {
      key: "no_reply",
      glyph: <ArrowDownToLine size={16} strokeWidth={1.75} />,
      label: strings.chat.opNoReply,
      // An empty composer needs no explanation.
      disabled: draft.trim() === "",
      onPress: () => void sendWithoutReply(),
    },
    {
      key: "run_on",
      glyph: <Play size={16} strokeWidth={1.75} />,
      label: strings.chat.opRunOn,
      // Let the scene run on: ask for a reply without saying anything. The one
      // thing a director does more than direct.
      disabled: isGenerating,
      onPress: () => {
        setOpsPanel(null);
        continueScene();
      },
    },
    {
      key: "tools",
      glyph: <Wrench size={16} strokeWidth={1.75} />,
      label: strings.chat.opTools,
      onPress: () => {
        setOpsPanel(null);
        setToolsOpen(true);
      },
    },
  ];

  function opsDrawer(panel: OpsPanel, shown: Op[]) {
    switch (panel) {
      case null:
        return undefined;
      case "grid":
        // Already a visible row up there, so the drawer has nothing to add.
        return isDesktop ? undefined : (
          <>
            <OpsGrid ops={shown} cue={cueSummary()} />
            <div className="mt-[11px] flex justify-end">
              <ExtensionActionsButton sceneId={sceneId} />
            </div>
          </>
        );
      case "nudge":
        return (
          <OpPrompt
            title={strings.chat.opNudgeTitle}
            placeholder={strings.chat.opNudgePlaceholder}
            submitLabel={strings.chat.opApply}
            onSubmit={(value) => void nudge(value)}
            onCancel={() => setOpsPanel(isDesktop ? null : "grid")}
          />
        );
      case "guided_swipe":
        return (
          <OpPrompt
            title={strings.chat.opGuidedSwipeTitle}
            placeholder={strings.chat.opNudgePlaceholder}
            submitLabel={strings.chat.opApply}
            onSubmit={(value) => void guidedSwipe(value)}
            onCancel={() => setOpsPanel(isDesktop ? null : "grid")}
          />
        );
      case "steer":
        return (
          <SteerOp
            initial={steer ?? ""}
            initialDepth={steerDepth}
            initialInterval={steerInterval}
            initialRole={steerRole}
            onSubmit={(note, knobs) => {
              setup.mutate({
                directorNote: note,
                directorNoteDepth: knobs.depth,
                directorNoteInterval: knobs.interval,
                directorNoteRole: knobs.role,
              });
              setOpsPanel(null);
            }}
            onCancel={() => setOpsPanel(isDesktop ? null : "grid")}
            {...(steer === null
              ? {}
              : {
                  onClear: () => {
                    setup.mutate({ directorNote: null });
                    setOpsPanel(null);
                  },
                })}
          />
        );
      case "impersonate":
        return (
          <div className="pb-[2px]">
            <p className="section-label mb-[6px]">{strings.chat.opImpersonateTitle}</p>
            <div className="flex gap-[6px]">
              {(["first", "second", "third"] as const).map((person) => (
                <button
                  key={person}
                  type="button"
                  disabled={opWorking}
                  className="btn flex-1"
                  onClick={() => void impersonate(person)}
                >
                  {person === "first"
                    ? strings.chat.opImpersonateFirst
                    : person === "second"
                      ? strings.chat.opImpersonateSecond
                      : strings.chat.opImpersonateThird}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn mt-[6px] w-full"
              onClick={() => setOpsPanel(isDesktop ? null : "grid")}
            >
              {opWorking ? strings.chat.opImpersonateWorking : strings.common.cancel}
            </button>
          </div>
        );
    }
  }

  return {
    sendAndReply,
    nextTurn,
    continueScene,
    recast,
    reroll,
    nudge,
    fireQuickReply,
    guidedSwipe,
    revise,
    impersonate,
    sendWithoutReply,
    handleDraftChange,
    lastReply,
    cueSummary,
    ops,
    opsDrawer,
  };
}

export type OpsApi = ReturnType<typeof useOps>;
