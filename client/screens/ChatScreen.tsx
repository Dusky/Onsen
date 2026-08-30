import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MessageDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { navigate } from "../lib/router.ts";
import {
  useDeleteMessage,
  useEditMessage,
  useScene,
  useSendMessage,
  useSetLeaf,
  useSiblings,
} from "../lib/queries.ts";
import { useGeneration } from "../lib/generation.ts";
import { MessageBlock, MessageEditor, Reasoning } from "../components/MessageBlock.tsx";
import { Composer } from "../components/Composer.tsx";
import { Sheet, SheetAction } from "../components/Sheet.tsx";
import { CastStrip } from "../components/CastStrip.tsx";
import { OpsGrid, OpPrompt, type Op } from "../components/OpsGrid.tsx";
import { ContextSheet, type ContextTab } from "../components/ContextSheet.tsx";
import {
  useBenchMember,
  useEditGuide,
  useEditSummary,
  useForgetSummary,
  useRewriteSummary,
  useSummaries,
  useSummariseNow,
  useFlushGuides,
  useRebuildGuides,
  useRevertAnnotation,
  useRunPasses,
  useSceneSetup,
  useSplitBeat,
  useTasks,
} from "../lib/queries.ts";
import type {
  GuideKind,
  ImpersonateResponse,
  NextSpeakerDto,
  ReviseMode,
  SceneMemberDto,
  TurnScope,
} from "@shared/types.ts";
import { api } from "../lib/api.ts";

/**
 * The chat screen. Everything else in the app is support.
 *
 * Two things drive the layout. The log is **bottom-anchored** — content grows
 * upward from the composer, as chat does — because the streaming indicator and
 * its stop control live at the bottom of the log and must never be pushed below
 * the fold. And **during generation the whole log takes a red left rail**: the
 * entire reading surface acknowledges that the app is writing, rather than a
 * spinner in a corner.
 */

/**
 * Who a turn is attributed to. A character voices the turn; the author is the
 * one writing them, and is named only when there is no cast member to name.
 */
function speakerFor(message: MessageDto, authorName: string | null): string {
  if (message.authorType === "user") return strings.chat.you;
  // A beat is the author writing several characters at once, so attributing the
  // whole thing to whoever opened it would be wrong: the parts name themselves.
  if (message.kind === "beat") return authorName ?? strings.chat.beatLabel;
  return message.speakerName ?? authorName ?? strings.chat.narratorName;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export function ChatScreen({ sceneId }: { sceneId: string }) {
  const scene = useScene(sceneId);
  const send = useSendMessage(sceneId);
  const edit = useEditMessage(sceneId);
  const remove = useDeleteMessage(sceneId);
  const setLeaf = useSetLeaf(sceneId);
  const generation = useGeneration();

  const bench = useBenchMember(sceneId);
  const split = useSplitBeat(sceneId);
  const setup = useSceneSetup(sceneId);
  // Per-op configuration (SPEC §7): a hidden button is not a disabled op, so
  // this only decides what the grid shows.
  const tasks = useTasks();
  const runPasses = useRunPasses(sceneId);
  const revert = useRevertAnnotation(sceneId);
  const rebuildGuides = useRebuildGuides(sceneId);
  const editGuide = useEditGuide(sceneId);
  const flushGuides = useFlushGuides(sceneId);
  /** Whether the blue sheet is up, which half of it, and what is working. */
  const [guidesOpen, setGuidesOpen] = useState(false);
  const [contextTab, setContextTab] = useState<ContextTab>("guides");
  const [guideWorking, setGuideWorking] = useState<GuideKind | "all" | null>(null);
  // Only fetched while the sheet is open: the pending count moves on every turn,
  // and polling it behind a closed panel would be a request per message.
  const summaries = useSummaries(sceneId, guidesOpen);
  const summariseNow = useSummariseNow(sceneId);
  const rewriteSummary = useRewriteSummary(sceneId);
  const editSummary = useEditSummary(sceneId);
  const forgetSummary = useForgetSummary(sceneId);
  const [acting, setActing] = useState<MessageDto | null>(null);
  /** The beat whose parts are being picked from, for a recast. */
  const [recasting, setRecasting] = useState<MessageDto | null>(null);
  /**
   * One voice or the room. Like the cue, this is a decision about the next turn
   * rather than scene configuration, so it lives here and not on the server.
   */
  const [requestedScope, setScope] = useState<TurnScope>("spotlight");
  /**
   * The composer draft lives here because the ops read it: "no reply" posts it,
   * and "as me" replaces it with a turn written from it.
   */
  const [draft, setDraft] = useState("");
  /**
   * Which ops panel is open. Closed by default — the design's whole approach to
   * the composer is progressive disclosure, because it has to fit above a
   * keyboard at 390px.
   */
  const [opsPanel, setOpsPanel] = useState<
    null | "grid" | "nudge" | "guided_swipe" | "steer" | "impersonate"
  >(null);
  /** Set while an op that produces a draft is working. */
  const [opWorking, setOpWorking] = useState(false);
  /** A message being corrected, once the user has said which one. */
  const [correcting, setCorrecting] = useState<MessageDto | null>(null);
  const [castActing, setCastActing] = useState<SceneMemberDto | null>(null);
  /**
   * Who the user cued for this turn. Client-side and one-shot: a cue is a
   * decision about the next turn, not scene configuration, so it is not
   * persisted and it clears once it has been spent.
   */
  const [cued, setCued] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [versionsFor, setVersionsFor] = useState<MessageDto | null>(null);
  const siblings = useSiblings(sceneId, versionsFor?.id ?? null);

  const log = useRef<HTMLDivElement>(null);
  const messages = scene.data?.messages ?? [];
  const title = scene.data?.scene.title ?? "";
  const authorName = scene.data?.scene.authorName ?? null;
  const cast = scene.data?.scene.cast ?? [];
  // Versioned per message and read off the active path, so this changes when the
  // reader rewinds — which is why it is read from the scene every time rather
  // than cached anywhere (SPEC §8).
  const guides = scene.data?.guides ?? [];

  // The server's decision, overridden locally while the user has cued someone.
  const serverChoice = scene.data?.nextSpeaker ?? null;
  const cuedMember = cued === null ? null : cast.find((m) => m.characterId === cued);
  const nextSpeaker: NextSpeakerDto | null =
    cuedMember === undefined || cuedMember === null
      ? serverChoice
      : {
          characterId: cuedMember.characterId,
          name: cuedMember.name,
          hasAvatar: cuedMember.hasAvatar,
          source: "user",
          reason: strings.chat.yourPickOverrides,
        };
  /**
   * With the classifier, nobody knows who speaks until the turn is under way
   * (SPEC §6) — so the composer says so rather than naming the fallback and
   * being wrong about it half the time.
   */
  const strategy = scene.data?.scene.turnStrategy ?? "manual";
  // `auto` is a question for the classifier; under any other strategy there is
  // nobody to ask, so it reads as a spotlight rather than quietly meaning one.
  const scope: TurnScope = requestedScope === "auto" && strategy !== "classifier"
    ? "spotlight"
    : requestedScope;
  const decidesOnSend = strategy === "classifier" && cued === null && cast.length > 1;
  const speakerName = decidesOnSend
    ? null
    : (nextSpeaker?.name ?? authorName ?? strings.chat.narratorName);

  const active = generation.active;
  const isGenerating =
    active !== null &&
    active.sceneId === sceneId &&
    (active.status === "connecting" || active.status === "streaming");
  // A recast lands inside a message that is already in the log, so it is drawn
  // there rather than as a new turn arriving at the bottom.
  const recastInFlight =
    isGenerating && active.recast !== undefined
      ? { ...active.recast, text: active.text }
      : null;

  // Keep the newest content in view as it arrives. Bottom-anchored layout does
  // most of the work; this covers the case where the log has overflowed.
  useLayoutEffect(() => {
    const element = log.current;
    if (element === null) return;
    element.scrollTop = element.scrollHeight;
  }, [messages.length, active?.text]);

  // Once a generation lands, its text belongs to the tree rather than the
  // store, so the streaming block is dropped and the refetched message shows.
  useEffect(() => {
    if (active === null || active.sceneId !== sceneId) return;
    if (active.status === "done" || active.status === "cancelled") {
      const timer = setTimeout(() => generation.clear(), 150);
      return () => clearTimeout(timer);
    }
    return;
  }, [active, generation, sceneId]);

  async function sendAndReply(text: string) {
    await send.mutateAsync({ kind: "user", authorType: "user", content: text });
    await generation.start(nextTurn());
    // A cue is spent once it has been used; the scope is not — asking for the
    // room once usually means asking for it again.
    setCued(null);
  }

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

  /* ---------------- guided ops (SPEC §7) ---------------- */

  const lastReply = [...messages].reverse().find((message) => message.authorType !== "user") ?? null;

  /** A one-shot instruction for the next turn. Never becomes a message. */
  async function nudge(instruction: string) {
    setOpsPanel(null);
    await generation.start({ ...nextTurn(), nudge: instruction });
    setCued(null);
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
      const result = await api.post<ImpersonateResponse>(`/scenes/${sceneId}/impersonate`, {
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

  const steer = scene.data?.scene.directorNote ?? null;

  /**
   * Who speaks next, in one line — what replaces the cast strip and the
   * director's reason while the ops grid is open (design handoff).
   */
  function cueSummary(): string | undefined {
    if (cast.length === 0) return undefined;
    if (scope === "beat") return strings.chat.cueBeat(cast.filter((m) => m.isActive).length);
    if (speakerName === null) return strings.chat.cueUndecided;
    return cued === null
      ? strings.chat.cueAuto(speakerName)
      : strings.chat.cueYours(speakerName);
  }

  const ops: Op[] = [
    {
      key: "nudge",
      glyph: strings.chat.opNudgeKey,
      label: strings.chat.opNudge,
      onPress: () => setOpsPanel("nudge"),
    },
    {
      key: "guided_swipe",
      glyph: strings.chat.opGuidedSwipeKey,
      label: strings.chat.opGuidedSwipe,
      // Only when the last message is from the AI — there is nothing else to
      // reroll, and §7 says so explicitly.
      disabled: lastReply === null,
      onPress: () => setOpsPanel("guided_swipe"),
    },
    {
      key: "impersonate",
      glyph: strings.chat.opImpersonateKey,
      label: strings.chat.opImpersonate,
      onPress: () => setOpsPanel("impersonate"),
    },
    {
      key: "steer",
      glyph: strings.chat.opSteerKey,
      label: strings.chat.opSteer,
      onPress: () => setOpsPanel("steer"),
    },
    {
      key: "guides",
      glyph: strings.chat.opGuidesKey,
      // The count is on the cell because a guide costs tokens on every single
      // turn, and the design's rule is that cost is never hidden a level down.
      label:
        guides.length === 0
          ? strings.chat.opGuides
          : `${strings.chat.opGuides} · ${guides.length}`,
      tone: "blue",
      onPress: () => {
        setOpsPanel(null);
        setGuidesOpen(true);
      },
    },
    {
      key: "no_reply",
      glyph: strings.chat.opNoReplyKey,
      label: strings.chat.opNoReply,
      // An empty composer needs no explanation.
      disabled: draft.trim() === "",
      onPress: () => void sendWithoutReply(),
    },
  ];

  /**
   * The ops a user has asked to see. Hiding a button is not turning the op off:
   * something else asking for it still gets it (SPEC §7).
   */
  const shownOps = ops.filter((op) => {
    const task = (tasks.data ?? []).find((row) => row.key === op.key);
    return task === undefined || !task.hideable || task.buttonVisible;
  });

  function opsDrawer() {
    switch (opsPanel) {
      case null:
        return undefined;
      case "grid":
        return <OpsGrid ops={shownOps} cue={cueSummary()} />;
      case "nudge":
        return (
          <OpPrompt
            title={strings.chat.opNudgeTitle}
            hint={strings.chat.opNudgeHint}
            placeholder={strings.chat.opNudgePlaceholder}
            submitLabel={strings.chat.opApply}
            onSubmit={(value) => void nudge(value)}
            onCancel={() => setOpsPanel("grid")}
          />
        );
      case "guided_swipe":
        return (
          <OpPrompt
            title={strings.chat.opGuidedSwipeTitle}
            hint={strings.chat.opGuidedSwipeHint}
            placeholder={strings.chat.opNudgePlaceholder}
            submitLabel={strings.chat.opApply}
            onSubmit={(value) => void guidedSwipe(value)}
            onCancel={() => setOpsPanel("grid")}
          />
        );
      case "steer":
        return (
          <OpPrompt
            title={strings.chat.opSteerTitle}
            hint={strings.chat.opSteerHint}
            placeholder={strings.chat.opSteerPlaceholder}
            initial={steer ?? ""}
            submitLabel={strings.chat.opApply}
            onSubmit={(value) => {
              setup.mutate({ directorNote: value });
              setOpsPanel(null);
            }}
            onCancel={() => setOpsPanel("grid")}
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
            <p className="chrome mb-[9px] text-[9px] leading-[1.5] text-ink-dim">
              {strings.chat.opImpersonateHint}
            </p>
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
              onClick={() => setOpsPanel("grid")}
            >
              {opWorking ? strings.chat.opImpersonateWorking : strings.common.cancel}
            </button>
          </div>
        );
    }
  }

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="hairline flex flex-none items-baseline gap-[12px] px-[22px] pb-[12px]"
        style={{ paddingTop: "calc(18px + env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={() => navigate({ name: "scenes" })}
          aria-label={strings.common.back}
          className="chrome -ml-[6px] flex h-[34px] w-[24px] items-center text-[18px] text-ink-muted"
        >
          {strings.chat.back}
        </button>
        <div className="min-w-0 flex-1">
          <p className="screen-kicker">{strings.chat.kicker}</p>
          <h1 className="truncate text-[19px] font-medium tracking-[-0.01em]">{title}</h1>
        </div>
        <button
          type="button"
          onClick={() => navigate({ name: "setup", sceneId })}
          className="chrome flex-none border border-border-quiet px-[9px] py-[6px] text-[9px] tracking-[0.12em] text-ink-muted uppercase"
        >
          {strings.chat.setup}
        </button>
      </header>

      {/* The log is bottom-anchored: content grows up from the composer. */}
      <div
        ref={log}
        className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[18px]"
        style={
          isGenerating
            ? { borderLeft: "2px solid var(--onsen-color-red)", paddingLeft: "20px" }
            : undefined
        }
      >
        <div className="mx-auto flex min-h-full w-full max-w-[var(--onsen-prose-measure)] flex-col justify-end gap-[26px]">
          {messages.length === 0 && !isGenerating ? (
            <p className="chrome text-[10px] tracking-[0.14em] text-ink-dim uppercase">
              {strings.scenes.emptyScene}
            </p>
          ) : null}

          {messages.map((message) =>
            editing === message.id ? (
              <MessageEditor
                key={message.id}
                initial={message.content}
                onCancel={() => setEditing(null)}
                onSave={(content) => {
                  setEditing(null);
                  edit.mutate({ messageId: message.id, content });
                }}
              />
            ) : (
              <MessageBlock
                key={message.id}
                message={message}
                speakerName={speakerFor(message, authorName)}
                onReroll={() => void reroll(message)}
                onOpenVersions={() => setVersionsFor(message)}
                onLongPress={() => setActing(message)}
                onRevert={(note) => revert.mutate(note.id)}
                {...(recastInFlight?.messageId === message.id
                  ? {
                      recasting: { ordinal: recastInFlight.ordinal, text: recastInFlight.text },
                      // A recast streams inside the beat it belongs to, so its
                      // reasoning belongs there too rather than at the bottom.
                      ...(active?.reasoning ? { streamingReasoning: active.reasoning } : {}),
                    }
                  : {})}
              />
            ),
          )}

          {/* The message being written, in the same treatment as a finished one:
              the attribution header appears first, then text streams under it. */}
          {/* Nothing is drawn until there is a speaker to attribute it to: while
              the director is still choosing, the status row below already says
              so, and a header over an empty body says it twice. */}
          {isGenerating && recastInFlight === null && active.speaker !== null ? (
            <article>
              <header className="mb-[10px]">
                <div className="flex items-center gap-[10px]">
                  <span className="chrome shrink-0 text-[10px] font-semibold tracking-[0.18em] text-ink-label uppercase">
                    {active.speaker}
                  </span>
                  <span className="h-px flex-1 bg-rule" />
                </div>
                {/* The director's own sentence, where it had one to give. */}
                {active.director !== null && active.director.reason !== "" ? (
                  <p className="chrome mt-[5px] text-[9px] leading-[1.5] tracking-[0.06em] text-ink-dim uppercase">
                    {active.director.reason}
                  </p>
                ) : null}
              </header>
              {/* Reasoning while it is happening (SPEC §13). Collapsed like
                  any other, but present — a model that thinks for twenty
                  seconds before its first word should not look stalled. */}
              <Reasoning text={active.reasoning} />
              <p className="text-[length:var(--onsen-text-prose)] leading-[var(--onsen-leading-prose)] whitespace-pre-wrap">
                {active.text}
              </p>
            </article>
          ) : null}

          {active !== null && active.sceneId === sceneId && active.status === "error" ? (
            <p
              role="alert"
              className="chrome border border-red-border bg-red-bg px-[11px] py-[9px] text-[10px] tracking-[0.06em] text-red-text uppercase"
            >
              {active.error ?? strings.errors.generationFailed}
            </p>
          ) : null}

          {/* Stop is reachable at all times while writing (design handoff). */}
          {isGenerating ? (
            <div className="flex items-center gap-[10px]">
              <span
                className="h-[6px] w-[6px] flex-none"
                style={{ background: "var(--onsen-color-red)" }}
              />
              <span className="chrome flex-1 text-[9.5px] tracking-[0.14em] text-ink-muted uppercase">
                {active.speaker === null
                  ? strings.chat.choosing
                  : strings.chat.writing(active.speaker)}
              </span>
              <button
                type="button"
                onClick={() => void generation.cancel()}
                className="chrome border border-red-border px-[10px] py-[6px] text-[9.5px] tracking-[0.14em] uppercase"
                style={{ color: "var(--onsen-color-red)" }}
              >
                {strings.chat.stop}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Steer, when it is set: a hairline strip above the composer, so a note
          that changes every turn is visible while you write (design handoff). */}
      {steer !== null && opsPanel === null ? (
        <button
          type="button"
          onClick={() => setOpsPanel("steer")}
          className="flex-none border-t border-rule bg-bg-raised px-[16px] py-[8px] text-left"
        >
          <span className="chrome mx-auto flex w-full max-w-[var(--onsen-prose-measure)] gap-[8px] text-[9px] leading-[1.5] tracking-[0.06em] uppercase">
            <span style={{ color: "var(--onsen-color-red)" }}>{strings.chat.steerActive}</span>
            <span className="min-w-0 flex-1 truncate text-ink-dim">{steer}</span>
          </span>
        </button>
      ) : null}

      {/* With the ops drawer open the cast strip collapses away, so the whole
          composer stack still fits above an open keyboard (design handoff). */}
      {cast.length > 0 && !isGenerating && opsPanel === null ? (
        <div className="flex-none border-t border-rule bg-bg-raised px-[16px] pt-[2px]">
          <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
            <CastStrip
              cast={cast}
              nextSpeaker={nextSpeaker}
              onCue={(characterId) => setCued(characterId)}
              onLongPress={(member) => setCastActing(member)}
              scope={scope}
              onScope={setScope}
              strategy={strategy}
              decidesOnSend={decidesOnSend}
            />
          </div>
        </div>
      ) : null}

      <Composer
        onSend={(text) => void sendAndReply(text)}
        onGenerate={() => void generation.start(nextTurn()).then(() => setCued(null))}
        disabled={isGenerating}
        speakerInitials={
          scope === "beat"
            ? strings.chat.beatInitials
            : speakerName === null
              ? strings.chat.chooseInitials
              : initialsOf(speakerName)
        }
        draft={draft}
        onDraftChange={setDraft}
        opsOpen={opsPanel !== null}
        onToggleOps={() => setOpsPanel(opsPanel === null ? "grid" : null)}
        ops={opsDrawer()}
      />

      {acting !== null ? (
        <Sheet title={strings.chat.actions} onClose={() => setActing(null)}>
          <SheetAction label={strings.chat.reroll} onClick={() => void reroll(acting)} />
          <SheetAction
            label={strings.chat.edit}
            onClick={() => {
              setEditing(acting.id);
              setActing(null);
            }}
          />
          {/* Branching is a leaf move: the next message forks at this point. */}
          <SheetAction
            label={strings.chat.branch}
            onClick={() => {
              setLeaf.mutate({ messageId: acting.id, descend: false });
              setActing(null);
            }}
          />
          {/* SPEC §7.5: auto-run per scene, or manual per message. This is the
              per-message half — a second read of one turn you are unsure about. */}
          <SheetAction
            label={runPasses.isPending ? strings.chat.checking : strings.chat.checkTurn}
            onClick={() => {
              runPasses.mutate(acting.id);
              setActing(null);
            }}
          />
          <SheetAction label={strings.chat.opExpand} onClick={() => void revise(acting, "expand")} />
          {/* Continue lives here rather than in the ops grid: no adapter that
              ships can accept a partial assistant turn, and a permanently dark
              cell in a six-cell grid spends a sixth of it on an apology. It is
              still offered, and it still says why (SPEC §7). */}
          <SheetAction
            label={strings.chat.opContinue}
            disabled
            onClick={() => void revise(acting, "continue")}
          />
          <p className="chrome py-[8px] text-[9px] leading-[1.5] text-ink-dim">
            {strings.chat.opContinueUnavailable}
          </p>
          <SheetAction
            label={strings.chat.opCorrect}
            onClick={() => {
              setCorrecting(acting);
              setActing(null);
            }}
          />
          {/* A beat has parts, and correcting one of them is not a reroll of the
              whole exchange: that distinction is the point of recast (§7). */}
          {acting.kind === "beat" && (acting.segments?.length ?? 0) > 1 ? (
            <>
              <SheetAction
                label={strings.chat.recast}
                onClick={() => {
                  setRecasting(acting);
                  setActing(null);
                }}
              />
              <SheetAction
                label={strings.chat.splitBeat}
                onClick={() => {
                  if (!window.confirm(strings.chat.splitBeatConfirm)) return;
                  split.mutate(acting.id);
                  setActing(null);
                }}
              />
            </>
          ) : null}
          <SheetAction
            label={strings.chat.copy}
            onClick={() => {
              void navigator.clipboard?.writeText(acting.content);
              setActing(null);
            }}
          />
          <SheetAction
            label={strings.chat.delete}
            destructive
            onClick={() => {
              if (!window.confirm(strings.chat.deleteConfirm)) return;
              remove.mutate(acting.id);
              setActing(null);
            }}
          />
        </Sheet>
      ) : null}

      {guidesOpen ? (
        <ContextSheet
          tab={contextTab}
          onTab={setContextTab}
          guides={guides}
          tasks={tasks.data ?? []}
          customPrompt={scene.data?.scene.customGuidePrompt ?? null}
          guideWorking={guideWorking}
          onRebuild={(kind) => {
            setGuideWorking(kind);
            rebuildGuides.mutate(kind === "all" ? {} : { kind }, {
              onSettled: () => setGuideWorking(null),
            });
          }}
          onEditGuide={(guideId, content) => editGuide.mutate({ guideId, content })}
          onFlush={(kind) => flushGuides.mutate(kind)}
          summaries={summaries.data}
          evicting={scene.data?.scene.summariseEvict ?? false}
          summaryWorking={
            summariseNow.isPending || rewriteSummary.isPending || forgetSummary.isPending
          }
          onSummarise={() => summariseNow.mutate(undefined)}
          onRewriteSummary={(summaryId) => rewriteSummary.mutate(summaryId)}
          onEditSummary={(summaryId, content) => editSummary.mutate({ summaryId, content })}
          onForgetSummary={(summaryId) => forgetSummary.mutate(summaryId)}
          onClose={() => setGuidesOpen(false)}
        />
      ) : null}

      {correcting !== null ? (
        <Sheet title={strings.chat.opCorrectTitle} onClose={() => setCorrecting(null)}>
          <div className="pt-[6px] pb-[10px]">
            <OpPrompt
              title={strings.chat.opCorrectTitle}
              hint={strings.chat.opCorrectHint}
              placeholder={strings.chat.opCorrectPlaceholder}
              submitLabel={strings.chat.opApply}
              onSubmit={(value) => void revise(correcting, "correct", value.trim() || undefined)}
              onCancel={() => setCorrecting(null)}
            />
          </div>
        </Sheet>
      ) : null}

      {/* Which part to rewrite. A separate sheet rather than a long-press on the
          part itself: nesting a gesture target inside the beat's own would cost
          the beat its swipe, and both would fire at once. */}
      {recasting !== null ? (
        <Sheet title={strings.chat.recast} onClose={() => setRecasting(null)}>
          {(recasting.segments ?? []).map((segment) => (
            <button
              key={segment.ordinal}
              type="button"
              disabled={segment.speakerType !== "character"}
              onClick={() => void recast(recasting, segment.ordinal, segment.speakerName)}
              className="w-full border-b border-rule py-[13px] text-left disabled:opacity-40"
            >
              <span className="chrome text-[9px] tracking-[0.14em] text-ink-label uppercase">
                {segment.speakerName ?? strings.chat.narrationPart}
              </span>
              <p className="mt-[5px] line-clamp-2 text-[length:var(--onsen-text-prose-excerpt)] leading-[1.5] text-ink-prose-muted">
                {segment.content}
              </p>
            </button>
          ))}
        </Sheet>
      ) : null}

      {castActing !== null ? (
        <Sheet title={strings.chat.castMember} onClose={() => setCastActing(null)}>
          <SheetAction
            label={castActing.isActive ? strings.chat.bench : strings.chat.unbench}
            onClick={() => {
              bench.mutate({
                characterId: castActing.characterId,
                isActive: !castActing.isActive,
              });
              setCastActing(null);
            }}
          />
          <SheetAction
            label={strings.chat.viewCard}
            onClick={() =>
              navigate({ name: "character", characterId: castActing.characterId })
            }
          />
        </Sheet>
      ) : null}

      {versionsFor !== null ? (
        <Sheet title={strings.chat.versions} onClose={() => setVersionsFor(null)}>
          {(siblings.data ?? []).map((sibling) => (
            <button
              key={sibling.id}
              type="button"
              onClick={() => {
                setLeaf.mutate({ messageId: sibling.id });
                setVersionsFor(null);
              }}
              className="w-full border-b border-rule py-[13px] text-left"
              style={{
                borderTop:
                  sibling.id === versionsFor.id ? "2px solid var(--onsen-color-red)" : undefined,
              }}
            >
              <span className="chrome text-[9px] tracking-[0.12em] text-ink-dim uppercase">
                {sibling.siblingIndex + 1} / {sibling.siblingCount}
              </span>
              <p className="mt-[6px] line-clamp-3 text-[length:var(--onsen-text-prose-excerpt)] leading-[1.5] text-ink-prose-muted">
                {sibling.content}
              </p>
            </button>
          ))}
        </Sheet>
      ) : null}
    </div>
  );
}
