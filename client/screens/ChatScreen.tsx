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
import { MessageBlock, MessageEditor } from "../components/MessageBlock.tsx";
import { Composer } from "../components/Composer.tsx";
import { Sheet, SheetAction } from "../components/Sheet.tsx";
import { CastStrip } from "../components/CastStrip.tsx";
import { useBenchMember, useSplitBeat } from "../lib/queries.ts";
import type { NextSpeakerDto, SceneMemberDto, TurnScope } from "@shared/types.ts";

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
  const [acting, setActing] = useState<MessageDto | null>(null);
  /** The beat whose parts are being picked from, for a recast. */
  const [recasting, setRecasting] = useState<MessageDto | null>(null);
  /**
   * One voice or the room. Like the cue, this is a decision about the next turn
   * rather than scene configuration, so it lives here and not on the server.
   */
  const [scope, setScope] = useState<TurnScope>("spotlight");
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
  const speakerName = nextSpeaker?.name ?? authorName ?? strings.chat.narratorName;

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
      speaker: scope === "beat" ? (authorName ?? strings.chat.beatLabel) : speakerName,
      scope,
      // In a beat the cue chooses who opens rather than who speaks.
      ...(nextSpeaker === null ? {} : { characterId: nextSpeaker.characterId }),
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
  async function reroll(message: MessageDto) {
    setActing(null);
    await generation.start({
      sceneId,
      sceneTitle: title,
      speaker: strings.chat.narratorName,
      parentId: message.parentId,
    });
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
                {...(recastInFlight?.messageId === message.id
                  ? { recasting: { ordinal: recastInFlight.ordinal, text: recastInFlight.text } }
                  : {})}
              />
            ),
          )}

          {/* The message being written, in the same treatment as a finished one:
              the attribution header appears first, then text streams under it. */}
          {isGenerating && recastInFlight === null ? (
            <article>
              <header className="mb-[10px] flex items-center gap-[10px]">
                <span className="chrome shrink-0 text-[10px] font-semibold tracking-[0.18em] text-ink-label uppercase">
                  {active.speaker}
                </span>
                <span className="h-px flex-1 bg-rule" />
              </header>
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
                {strings.chat.writing(active.speaker)}
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

      {cast.length > 0 && !isGenerating ? (
        <div className="flex-none border-t border-rule bg-bg-raised px-[16px] pt-[2px]">
          <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
            <CastStrip
              cast={cast}
              nextSpeaker={nextSpeaker}
              onCue={(characterId) => setCued(characterId)}
              onLongPress={(member) => setCastActing(member)}
              scope={scope}
              onScope={setScope}
            />
          </div>
        </div>
      ) : null}

      <Composer
        onSend={(text) => void sendAndReply(text)}
        onGenerate={() => void generation.start(nextTurn()).then(() => setCued(null))}
        disabled={isGenerating}
        speakerInitials={
          scope === "beat" ? strings.chat.beatInitials : initialsOf(speakerName)
        }
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
