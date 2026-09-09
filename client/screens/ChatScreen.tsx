import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MessageDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { useConfirm } from "../components/ConfirmSheet.tsx";
import { navigate } from "../lib/router.ts";
import { useSceneChannel } from "../lib/scene-channel.ts";
import {
  useDeleteMessage,
  useEditMessage,
  useScene,
  useReading,
  useSendMessage,
  useSetLeaf,
  useSiblings,
  useAttachImage,
  useIllustrate,
  useSpeak,
  useCheckpoints,
  useSceneStats,
  useSignOut,
} from "../lib/queries.ts";
import { useGeneration } from "../lib/generation.ts";
import { Composer } from "../components/Composer.tsx";
import { Sheet, SheetAction } from "../components/Sheet.tsx";
import { StatusBar } from "../components/StatusBar.tsx";
import { COMMANDS } from "../lib/commands.ts";
import { CastStrip } from "../components/CastStrip.tsx";
import { Deck } from "../components/Deck.tsx";
import { speakerFor, initialsOf } from "./chat/attribution.ts";
import { ScenePane } from "./chat/ScenePane.tsx";
import { MessageLog } from "./chat/MessageLog.tsx";
import { ChatSheets } from "./chat/ChatSheets.tsx";
import { OpsGrid, OpsRow, OpPrompt, SteerOp, type Op } from "../components/OpsGrid.tsx";
import { ExtensionActionsButton } from "../components/ExtensionActions.tsx";
import { QuickReplyRow } from "../components/QuickReplies.tsx";
import { VnStage } from "../components/VnStage.tsx";
import { TrackerPanel } from "../components/TrackerPanel.tsx";
import { useIsDesktop } from "../lib/breakpoint.ts";
import { useUiStore } from "../state/ui.ts";
import type { ContextTab } from "../components/ContextSheet.tsx";
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
  useStopAutopilot,
  useTasks,
  useAutopilot,
  useAuthors,
  useUpdateScene,
  useConnectionProfiles,
  useLayout,
  useInspector,
  usePreviewPrompt,
  useTranslateMessage,
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

export function ChatScreen({ sceneId }: { sceneId: string }) {
  /**
   * How much of the history is loaded (§20 phase 62).
   *
   * The reading preference is one window; "show earlier" asks for another. A
   * growing limit rather than a cursor, so the answer is always the newest N
   * of the active path and the order needs no merging — the same shape the
   * roleplay list's "show more" settled on in phase 59.
   */
  const [windows, setWindows] = useState(1);
  const reading = useReading();
  const scene = useScene(sceneId, reading.window * windows);
  const send = useSendMessage(sceneId);
  const edit = useEditMessage(sceneId);
  const remove = useDeleteMessage(sceneId);
  const setLeaf = useSetLeaf(sceneId);
  const generation = useGeneration();

  const bench = useBenchMember(sceneId);
  const split = useSplitBeat(sceneId);
  const setup = useSceneSetup(sceneId);
  // Autopilot (SPEC §6): the row that says whether the scene is writing
  // itself, and the one control that has to stop it from anywhere.
  const autopilot = useAutopilot(sceneId);
  // §5's multi-device head sync: this scene may also be open on a phone. The
  // channel says when the other one moved the head, and this one says so rather
  // than jumping the reader to a branch they did not choose.
  const channel = useSceneChannel(sceneId, scene.data?.scene.activeLeafId ?? null);
  const stopAutopilot = useStopAutopilot(sceneId);
  const updateScene = useUpdateScene(sceneId);
  const [profilePickerOpen, setProfilePickerOpen] = useState(false);
  const [confirmNode, confirm] = useConfirm();
  // Only once the picker is open: this list exists for a failure most sessions
  // never see, and a request per scene open for it would be waste.
  const profiles = useConnectionProfiles(profilePickerOpen);
  // Always on: the composer's model chip reads the scene's profile for its
  // model string (§20 phase 101).
  const modelProfiles = useConnectionProfiles();
  const sceneProfile =
    (modelProfiles.data ?? []).find(
      (candidate) => candidate.id === scene.data?.scene.connectionProfileId,
    ) ?? null;
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
  /** The reader's own card, edited inline in the scene pane (§20 phase 90). */
  const [personaEditing, setPersonaEditing] = useState(false);
  const [guideWorking, setGuideWorking] = useState<GuideKind | "all" | null>(null);
  // Only fetched while the sheet is open: the pending count moves on every turn,
  // and polling it behind a closed panel would be a request per message.
  const summaries = useSummaries(sceneId, guidesOpen);
  const summariseNow = useSummariseNow(sceneId);
  const rewriteSummary = useRewriteSummary(sceneId);
  const editSummary = useEditSummary(sceneId);
  const forgetSummary = useForgetSummary(sceneId);
  const [acting, setActing] = useState<MessageDto | null>(null);
  /** The message whose prompt the inspector sheet is showing (SPEC §16). */
  const [inspecting, setInspecting] = useState<MessageDto | null>(null);
  const inspector = useInspector(sceneId, inspecting?.id ?? null);
  /** The next-turn prompt preview (§20 phase 68): open while it is shown. */
  const [previewOpen, setPreviewOpen] = useState(false);
  const preview = usePreviewPrompt(sceneId);
  const translate = useTranslateMessage(sceneId);
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
  /** Whether the quick replies sheet is open (SPEC §7, §20 phase 65). */
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false);
  /** Set while an op that produces a draft is working. */
  const [opWorking, setOpWorking] = useState(false);
  /** A message being corrected, once the user has said which one. */
  const [correcting, setCorrecting] = useState<MessageDto | null>(null);
  /** The cast member whose card is open in the right pane (desktop, §20 phase 82). */
  const [editingCastId, setEditingCastId] = useState<string | null>(null);
  const [castActing, setCastActing] = useState<SceneMemberDto | null>(null);
  /**
   * Who the user cued for this turn. Client-side and one-shot: a cue is a
   * decision about the next turn, not scene configuration, so it is not
   * persisted and it clears once it has been spent.
   */
  const [cued, setCued] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [versionsFor, setVersionsFor] = useState<MessageDto | null>(null);
  // The off-script channel (SPEC §7). Not a mode the reader lives in: notes
  // arrive inline, and this is where one becomes a conversation.
  const [oocOpen, setOocOpen] = useState(false);
  const [oocAsked, setOocAsked] = useState(false);
  const siblings = useSiblings(sceneId, versionsFor?.id ?? null);

  /** The chosen layout (§20 phase 52). Instrument until preferences arrive. */
  const layout = useLayout();

  const log = useRef<HTMLDivElement>(null);
  // The cast becomes a rail and the ops flatten (design `4a`). Everything
  // else about this screen is the same components at a different width.
  const isDesktop = useIsDesktop();
  const setSceneInspector = useUiStore((state) => state.setSceneInspector);
  const setRightTab = useUiStore((state) => state.setRightTab);
  // §5's held view. While another device has moved the head somewhere this one
  // is not, the log keeps showing what the reader was reading — the whole point
  // of the prompt is that the scene does not change under them, and a client
  // that let its own background refetch converge behind the banner would be
  // doing exactly that with an explanation floating over it.
  const fetched = scene.data?.messages ?? [];
  const held = useRef(fetched);
  const moved = channel.movedTo !== null;
  if (!moved) held.current = fetched;
  const messages = moved ? held.current : fetched;
  // An aside renders inline in the log by default; a reader who would rather
  // the channel be its only home switches that off per scene (§7).
  const showInlineOoc = scene.data?.scene.oocInline ?? true;
  const logMessages = showInlineOoc ? messages : messages.filter((m) => m.kind !== "ooc");
  // How long the active path is, of which `messages` is the newest window
  // (§20 phase 62). Declared here rather than beside the control that reads it
  // because the turn ordinals need it too, and a `#17` on the forty-first turn
  // of forty-five is a number that means nothing.
  const historyTotal = scene.data?.historyTotal ?? messages.length;
  const title = scene.data?.scene.title ?? "";
  const authorName = scene.data?.scene.authorName ?? null;
  const authors = useAuthors();
  const authorTokens =
    (authors.data ?? []).find((candidate) => candidate.id === scene.data?.scene.authorId)?.tokens
      .total ?? null;
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
  // Whether the generation now running is an out-of-character answer.
  //
  // Tracked rather than inferred. The alternative is matching on what the
  // director announced, which is a copy string, or on the shape of the tree,
  // which is a race with the refetch — and this client is the one that asked,
  // so it simply knows.
  const oocInFlight = oocAsked && isGenerating;

  // Cleared once the answer has landed, so the next ordinary turn is not drawn
  // into the channel.
  useEffect(() => {
    if (oocAsked && !isGenerating) setOocAsked(false);
  }, [oocAsked, isGenerating]);

  // Autopilot (SPEC §6). The loop outlives any one generation this client
  // watched, so its row is what says another turn is coming — and the turn it
  // starts is adopted into the same streaming row a locally-started one uses.
  const autopilotActive = autopilot.data?.active === true;
  const apState = autopilot.data ?? null;
  // The reason a run ended, shown once: it is news for a moment, then it is
  // furniture. Tracked locally so it clears the next time the reader acts,
  // rather than living on the row forever.
  const sawAutopilot = useRef(false);
  const [autopilotNote, setAutopilotNote] = useState<string | null>(null);
  /**
   * What a picture or voice service said when it refused (§20 phase 41).
   *
   * Shown where the autopilot's reason is shown: a service being unreachable is
   * news for a moment and then it is furniture, and it clears on the next act.
   */
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  /** The message being marked, while the name is being typed (§2). */
  const [marking, setMarking] = useState<MessageDto | null>(null);
  const signOut = useSignOut();
  /** The palette opened on nothing, by key, rather than on a turn. */
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** Text after the `/` when the composer opened the palette (§20 phase 130). */
  const [paletteSeed, setPaletteSeed] = useState("");
  /**
   * The turn ⌘K and the single-key accelerators act on (§20 phase 43).
   *
   * Null is the resting state: nothing is selected until the reader picks a
   * turn, so a stray keystroke cannot reroll something they were only reading.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * What the palette acts on: a long-press names a turn explicitly, otherwise
   * whatever j/k has selected. Opening ⌘K with nothing selected is a real
   * state — the palette then offers only what does not need a turn.
   *
   * Declared here rather than beside `messages`: it reads `selectedId`, and
   * hoisting it above that state put it in the temporal dead zone, which no
   * test caught and the first page load did.
   */
  const paletteTurn =
    acting ?? messages.find((message) => message.id === selectedId) ?? null;

  /**
   * ⌘K anywhere in a roleplay.
   *
   * Ignored while a field has focus so it cannot eat a keystroke someone meant
   * for the composer, and registered once for the screen rather than per turn.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never steal a keystroke meant for a field, and never fight a modifier
      // combination the browser or the OS owns.
      const inField = document.activeElement?.matches("input, textarea, [contenteditable]");
      if (inField === true) return;

      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // j/k walk the log, the way every reader-shaped tool does. Down is
      // towards the newest turn, because that is the direction a scene runs.
      if (event.key === "j" || event.key === "k") {
        const ids = messages.map((message) => message.id);
        if (ids.length === 0) return;
        event.preventDefault();
        const at = selectedId === null ? -1 : ids.indexOf(selectedId);
        const next =
          event.key === "j"
            ? Math.min(ids.length - 1, at + 1)
            : Math.max(0, at === -1 ? ids.length - 1 : at - 1);
        setSelectedId(ids[next] ?? null);
        document
          .querySelector(`[data-message-id="${ids[next]}"]`)
          ?.scrollIntoView({ block: "nearest" });
        return;
      }

      if (event.key === "Escape") {
        setSelectedId(null);
        return;
      }

      // Single-key accelerators, only with a turn selected — which is what
      // makes them safe: there is nothing to act on until the reader picks one.
      if (selectedId === null) return;
      const command = COMMANDS.find(
        (candidate) => candidate.key === event.key && candidate.unavailable === undefined,
      );
      if (command === undefined) return;
      const turn = messages.find((message) => message.id === selectedId);
      if (turn === undefined) return;
      event.preventDefault();
      runCommand(command.id, turn);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /**
   * Run a command by id (§20 phase 43).
   *
   * One map, keyed by the registry's ids, so `test/commands.test.ts` can prove
   * every command in the palette actually does something. A row that does
   * nothing on return is the failure the whole registry exists to prevent.
   */
  function runCommand(id: string, on: MessageDto | null): void {
    const turn = on;
    const handlers: Record<string, () => void> = {
      /* on the selected turn */
      "inspect": () => turn && setInspecting(turn),
      "reroll": () => void (turn && reroll(turn)),
      "edit": () => turn && setEditing(turn.id),
      "versions": () => turn && setVersionsFor(turn),
      "branch": () => turn && setLeaf.mutate({ messageId: turn.id, descend: false }),
      "mark": () => turn && setMarking(turn),
      "hide": () => turn && edit.mutate({ messageId: turn.id, isHidden: !turn.isHidden }),
      "check": () => turn && runPasses.mutate(turn.id),
      "illustrate": () =>
        turn &&
        illustrate.mutate({ messageId: turn.id }, { onError: (e) => setMediaNote(e.message) }),
      "speak": () =>
        turn && speak.mutate(turn.id, { onError: (e) => setMediaNote(e.message) }),
      "expand": () => void (turn && revise(turn, "expand")),
      "correct": () => turn && setCorrecting(turn),
      "recast": () => turn && setRecasting(turn),
      "split": () =>
        turn &&
        confirm(strings.chat.splitBeatConfirm, () => split.mutate(turn.id), {
          confirmLabel: strings.chat.splitBeat,
        }),
      "copy": () => void navigator.clipboard?.writeText(turn?.content ?? ""),
      "translate": () => {
        // Display-only: needs a target language from scene setup.
        if (turn !== null && scene.data?.scene.translateTo !== null) {
          translate.mutate(turn.id);
        }
      },
      "delete": () =>
        turn &&
        confirm(strings.chat.deleteConfirm, () => remove.mutate(turn.id), {
          confirmLabel: strings.chat.delete,
        }),
      // §7: offered and explained rather than hidden. The palette greys it and
      // shows the reason, so this is never reached.
      "continue": () => undefined,

      /* on the roleplay */
      "nudge": () => setOpsPanel("nudge"),
      "steer": () => setOpsPanel("steer"),
      "impersonate": () => setOpsPanel("impersonate"),
      "guided-swipe": () => setOpsPanel("guided_swipe"),
      "ooc": () => setOocOpen(true),
      "no-reply": () => void generation.start(nextTurn()).then(() => setCued(null)),
      "guides": () => setGuidesOpen(true),
      "attach": () => document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')?.click(),
      "marks": () => setMarksOpen(true),
      "setup": () => navigate({ name: "setup", sceneId }),

      /* go to */
      "go-scenes": () => navigate({ name: "scenes" }),
      "go-characters": () => navigate({ name: "characters" }),
      "go-authors": () => navigate({ name: "authors" }),
      "go-lorebooks": () => navigate({ name: "lorebooks" }),
      "go-settings": () => navigate({ name: "settings" }),
      "sign-out": () => signOut.mutate(undefined),
    };
    handlers[id]?.();
  }

  const [marksOpen, setMarksOpen] = useState(false);
  const checkpoints = useCheckpoints(sceneId);
  const stats = useSceneStats(sceneId);
  const [statsOpen, setStatsOpen] = useState(false);
  const illustrate = useIllustrate(sceneId);
  const speak = useSpeak(sceneId);
  const attach = useAttachImage(sceneId);
  useEffect(() => {
    if (apState === null) return;
    if (apState.active) {
      sawAutopilot.current = true;
      setAutopilotNote(null);
      return;
    }
    if (sawAutopilot.current && apState.stopReason !== null) {
      sawAutopilot.current = false;
      setAutopilotNote(strings.chat.autopilotStopped(
        strings.chat.autopilotReasons[apState.stopReason] ?? apState.stopReason,
      ));
    }
  }, [apState]);
  // A turn the server started — autopilot's next, or one that began while
  // this tab was suspended — is watched like one this client started. The
  // offset it resumes from is the server's to remember (§5), which is why
  // adopting is just a subscription with no POST.
  const adoptable = autopilotActive ? (apState?.generationId ?? null) : null;
  useEffect(() => {
    if (adoptable === null || active !== null) return;
    void generation.adopt({ generationId: adoptable, sceneId, sceneTitle: title });
  }, [adoptable, active, sceneId, title, generation]);

  // Keep the newest content in view as it arrives. Bottom-anchored layout does
  // most of the work; this covers the case where the log has overflowed.
  useLayoutEffect(() => {
    const element = log.current;
    if (element === null) return;
    element.scrollTop = element.scrollHeight;
  }, [logMessages.length, active?.text]);

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

  const steer = scene.data?.scene.directorNote ?? null;
  const steerDepth = scene.data?.scene.directorNoteDepth ?? 0;
  const steerInterval = scene.data?.scene.directorNoteInterval ?? 1;
  const steerRole = scene.data?.scene.directorNoteRole ?? "system";

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
      key: "ooc",
      glyph: strings.chat.opOocKey,
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
        // Already a visible row up there, so the drawer has nothing to add.
        return isDesktop ? undefined : (
          <>
            <OpsGrid ops={shownOps} cue={cueSummary()} />
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

  const body = (
    <>

        {/* The log is bottom-anchored: content grows up from the composer. */}
        <MessageLog
          logRef={log}
          sceneId={sceneId}
          messages={messages}
          logMessages={logMessages}
          historyTotal={historyTotal}
          isGenerating={isGenerating}
          isFetching={scene.isFetching}
          onShowEarlier={() => setWindows((count) => count + 1)}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onSaveEdit={(messageId, content) => edit.mutate({ messageId, content })}
          authorName={authorName}
          layout={layout}
          personaId={scene.data?.scene.personaId ?? null}
          onReroll={(message) => void reroll(message)}
          onOpenVersions={(message) => setVersionsFor(message)}
          onLongPress={(message) => setActing(message)}
          onInspect={(message) => setInspecting(message)}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          onRevert={(note) => revert.mutate(note.id)}
          runCommand={runCommand}
          onOpenOoc={() => setOocOpen(true)}
          active={active}
          recastInFlight={recastInFlight}
          oocInFlight={oocInFlight}
          autopilotActive={autopilotActive}
          apState={apState}
          onStopAutopilot={() => stopAutopilot.mutate()}
          onCancel={() => void generation.cancel()}
          autopilotNote={autopilotNote}
          mediaNote={mediaNote}
          onDismissMediaNote={() => setMediaNote(null)}
        />

        {/* The tracker panel (§8, phase 31): collapsible, above the composer. */}
        {opsPanel === null ? <TrackerPanel sceneId={sceneId} /> : null}

        {/* Why a turn never started (SPEC §5): a refused POST, not a stream that
            died. Shown where the reader is looking, with the fix for the one
            case that has a one-tap fix — a scene with no profile yet. */}
        {generation.startError !== null ? (
          <div className="flex-none border-t border-red-border bg-red-bg px-[16px] py-[8px]">
            <div className="mx-auto flex w-full max-w-[var(--onsen-prose-measure)] items-center gap-[10px]">
              <p
                role="alert"
                className="chrome min-w-0 flex-1 truncate text-[13px]"
                style={{ color: "var(--onsen-color-red)" }}
              >
                {generation.startError.message}
              </p>
              {generation.startError.code === "no_connection" ? (
                <button
                  type="button"
                  className="btn flex-none"
                  style={{ color: "var(--onsen-color-red)", borderColor: "var(--onsen-color-red)" }}
                  onClick={() => setProfilePickerOpen(true)}
                >
                  {strings.chat.setProfile}
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Close"
                className="chrome flex-none text-[12px]"
                style={{ color: "var(--onsen-color-red)" }}
                onClick={() => generation.clearStartError()}
              >
                ×
              </button>
            </div>
          </div>
        ) : null}

        {/* Steer, when it is set, on the phone: a hairline strip above the
            composer. On the desktop the same note sits inline in the Direct
            row, where the mockup keeps it. */}
        {steer !== null && opsPanel === null && !isDesktop ? (
          <button
            type="button"
            onClick={() => setOpsPanel("steer")}
            className="flex-none border-t border-rule bg-bg-raised px-[16px] py-[8px] text-left"
          >
            <span className="chrome mx-auto flex w-full max-w-[var(--onsen-prose-measure)] gap-[8px] text-[12.5px] leading-[1.5]">
              <span style={{ color: "var(--onsen-color-red)" }}>{strings.chat.steerActive}</span>
              <span className="min-w-0 flex-1 truncate text-ink-dim">{steer}</span>
            </span>
          </button>
        ) : null}

        {/* The deck (§20 phase 50). With the ops drawer open it collapses away,
            so the whole composer stack still fits above an open keyboard —
            the same rule the cast strip followed, and the reason Instrument's
            cast is a segmented control rather than a row of cards. */}
        {/* Visible while it writes (§20 phase 52). It used to disappear the
            moment generation started, which is exactly backwards for a layout
            whose whole argument is that state stays on screen — and it made
            the screen look frozen at the one moment it is busiest. Cueing who
            speaks *next* while somebody is mid-turn is a real thing to want. */}
        {cast.length > 0 && opsPanel === null && !isDesktop ? (
          <div className="flex-none border-t border-rule bg-bg-raised px-[16px] py-[10px]">
            <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
              <Deck
                cast={cast}
                nextSpeaker={nextSpeaker}
                onCue={(characterId) => setCued(characterId)}
                onLongPress={(member) => setCastActing(member)}
                scope={scope}
                onScope={setScope}
                strategy={strategy}
                decidesOnSend={decidesOnSend}
                readouts={layout.readouts}
                castDisplay={layout.cast}
                guides={scene.data?.guides ?? []}
                summaryCount={scene.data?.scene.summaryCount ?? 0}
                mediaOn={scene.data?.scene.vnModeEnabled ?? false}
                onOpen={(pane) => {
                  setContextTab(pane === "memory" ? "memory" : "guides");
                  setGuidesOpen(true);
                }}
              />
            </div>
          </div>
        ) : null}

        {/* Always visible with room for it, and no OPS key (design `4a`). The
            mockup's Direct row: a label, the ops, and the steer note inline. */}
        {isDesktop ? (
          <div className="flex-none border-t border-rule bg-bg-raised px-[16px] py-[9px]">
            <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
              <div className="flex flex-wrap items-center gap-[6px]">
                <span className="chrome text-[11px]" style={{ color: "var(--onsen-color-text-dim)" }}>
                  {strings.chat.direct}
                </span>
                <OpsRow ops={shownOps} />
                <ExtensionActionsButton sceneId={sceneId} wide />
                {steer === null ? null : (
                  <span className="chrome ml-auto flex min-w-0 items-center gap-[6px] text-[11px]">
                    <span className="flex-none" style={{ color: "var(--onsen-color-text-dim)" }}>
                      {strings.chat.steering}
                    </span>
                    <span className="min-w-0 truncate" style={{ color: "var(--onsen-color-text-label)" }}>
                      {steer}
                    </span>
                    <button
                      type="button"
                      className="flex-none"
                      style={{ color: "var(--onsen-color-red)" }}
                      onClick={() => setup.mutate({ directorNote: null })}
                    >
                      {strings.chat.opSteerClear}
                    </button>
                  </span>
                )}
              </div>
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
          speakerName={scope === "beat" ? null : speakerName}
          model={{
            label:
              sceneProfile === null
                ? strings.header.noModel
                : sceneProfile.model === null
                  ? sceneProfile.name
                  : `${sceneProfile.name} \u00b7 ${sceneProfile.model}`,
            hasModel: sceneProfile !== null,
          }}
          draft={draft}
          onDraftChange={handleDraftChange}
          onAttach={(file) =>
            attach.mutate(file, {
              // A caption that failed is worth saying once — the picture is
              // still here, and the reader may have wanted it that way.
              onSuccess: (result) => setMediaNote(result.captionError),
              onError: (error) => setMediaNote(error.message),
            })
          }
          attaching={attach.isPending}
          pending={(scene.data?.pendingMedia ?? []).map((asset) => ({
            id: asset.id,
            url: asset.url,
          }))}
          opsOpen={opsPanel !== null}
          onToggleOps={() => setOpsPanel(opsPanel === null ? "grid" : null)}
          ops={opsDrawer()}
          quickReplies={
            <QuickReplyRow
              onFire={fireQuickReply}
              onEdit={() => setQuickRepliesOpen(true)}
              disabled={isGenerating}
            />
          }
          wide={isDesktop}
        />

        {/* §20 phase 43: what is true right now, in one line. On a phone its
            right-hand control is the only way to the inspector — the same panel
            the desktop shows beside the log, laid down rather than stood up. */}
        <StatusBar
          profileName={scene.data?.scene.connectionProfileName ?? null}
          tokens={scene.data?.scene.lastPromptTokens ?? null}
          contextSize={scene.data?.scene.contextSize ?? null}
          generating={isGenerating}
          onOpenPrompt={() => {
            preview.mutate({
              ...(nextSpeaker === null ? {} : { characterId: nextSpeaker.characterId }),
              scope,
            });
            setPreviewOpen(true);
          }}
          {...(isDesktop ? {} : { onOpenContext: () => setGuidesOpen(true) })}
        />
    </>
  );

  const scenePane = (
    <ScenePane
      editingCastId={editingCastId}
      onCloseCastEdit={() => setEditingCastId(null)}
      personaEditing={personaEditing}
      onClosePersona={() => setPersonaEditing(false)}
      sceneId={sceneId}
      personaId={scene.data?.scene.personaId ?? null}
      contextSize={scene.data?.scene.contextSize ?? null}
      layout={layout}
      guides={guides}
      summaryCount={scene.data?.scene.summaryCount ?? 0}
      mediaOn={scene.data?.scene.vnModeEnabled ?? false}
      onOpenContext={(pane) => {
        setContextTab(pane === "memory" ? "memory" : "guides");
        setGuidesOpen(true);
      }}
      cast={cast}
      nextSpeaker={nextSpeaker}
      messages={messages}
      scope={scope}
      onScope={setScope}
      onCue={(characterId) => setCued(characterId)}
      onMember={(member) => setCastActing(member)}
      writingName={isGenerating ? active.speaker : null}
      autopilotOn={scene.data?.scene.autopilotEnabled ?? false}
      onToggleAutopilot={(on) => updateScene.mutate({ autopilotEnabled: on })}
      personaName={scene.data?.scene.personaName ?? strings.sceneSetup.personaNone}
      authorName={scene.data?.scene.authorName ?? strings.chat.narratorName}
      authorTokens={authorTokens}
      onEditPersona={() => setPersonaEditing(true)}
      onEditAuthor={() => setRightTab("authors")}
    />
  );

  // The scene panes render in the shell's global right rail, not here (§20
  // phase 87). The node is refreshed every render so it always carries the
  // live scene state, and cleared when the chat unmounts.
  useLayoutEffect(() => {
    setSceneInspector(isDesktop ? scenePane : null);
    return () => setSceneInspector(null);
  });

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="hairline flex flex-none items-baseline gap-[12px] px-[22px] pb-[12px]"
        style={{ paddingTop: "18px" }}
      >
        {/* Back is how a phone leaves a screen. On desktop the sidebar is
            always there, so the affordance would point at nothing. */}
        {isDesktop ? null : (
          <button
            type="button"
            onClick={() => navigate({ name: "scenes" })}
            aria-label={strings.common.back}
            className="chrome -ml-[6px] flex h-[34px] w-[24px] items-center text-[18px] text-ink-muted"
          >
            {strings.chat.back}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="screen-kicker">{strings.chat.kicker}</p>
          <h1 className="truncate text-[19px] font-medium tracking-[-0.01em]">{title}</h1>
          {/* Broadsheet's standing dek (§20 phase 52). Not a new field: it is
              the scene's own scenario, which until now was visible only in
              setup and in the prompt. Clamped to two lines — it is a header,
              not the scenario editor. */}
          {layout.dek && (scene.data?.scene.scenarioOverride ?? "").trim() !== "" ? (
            <p className="explain mt-[4px] line-clamp-2">
              {scene.data!.scene.scenarioOverride}
            </p>
          ) : null}
        </div>
        {/* Design `4a` puts `PROMPT · n TOK` and `STAGE OFF` here beside SETUP.
            Both are chips onto screens that do not exist yet — the inspector is
            phase 25 and the VN stage is phase 29 — and a number with nothing
            behind it to open is worse than the space it saves. */}
        {/* §2's marked places. Only offered once there is one: a chip onto an
            empty list is the thing the comment above argues against. */}
        {(checkpoints.data?.length ?? 0) > 0 ? (
          <button
            type="button"
            onClick={() => setMarksOpen(true)}
            className="chrome flex-none border border-border-quiet px-[9px] py-[6px] text-[12.5px] text-ink-muted"
          >
            {`${strings.chat.checkpoints} · ${checkpoints.data?.length ?? 0}`}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setStatsOpen(true)}
          className="chrome flex-none border border-border-quiet px-[9px] py-[6px] text-[12.5px] text-ink-muted"
        >
          {strings.chat.stats}
        </button>
        <button
          type="button"
          onClick={() => navigate({ name: "setup", sceneId })}
          className="chrome flex-none border border-border-quiet px-[9px] py-[6px] text-[12.5px] text-ink-muted"
        >
          {strings.chat.setup}
        </button>
      </header>
      {/* The VN stage (SPEC §12): sprites above the log, on only when the
          scene asked for staging. Below it the log is unchanged, so turning
          the toggle off degrades to normal chat with nothing else moving. */}
      {scene.data?.scene.vnModeEnabled === true ? (
        <VnStage
          cast={cast}
          messages={messages}
          background={scene.data.scene.hasBackground}
          sceneId={sceneId}
        />
      ) : null}
      {/* The desktop shape: the log, the ops and the composer in a capped
          prose column, with the cast rail beside them (design `4a`). The
          pieces are identical either way — only their parent differs, which
          is the one thing a media query cannot do. */}
      {/* §5: "the losing client showing a 'chat moved' prompt rather than
          silently diverging". Jumping the reader onto someone else's branch
          mid-sentence is the failure that rule exists to prevent, so this is a
          button rather than a redraw. */}
      {channel.movedTo !== null ? (
        <button
          type="button"
          onClick={channel.accept}
          className="mx-[18px] mt-[10px] flex flex-none items-center justify-between gap-[10px] border border-blue-border bg-blue-bg px-[11px] py-[8px]"
        >
          <span className="chrome truncate text-[13px] text-blue-text">
            {strings.chat.movedElsewhere}
          </span>
          <span className="chrome flex-none text-[13px] text-blue-text">
            {strings.chat.movedShow}
          </span>
        </button>
      ) : null}

      {isDesktop ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">{body}</div>
        </div>
      ) : (
        body
      )}

      {profilePickerOpen ? (
        <Sheet title={strings.chat.setProfile} onClose={() => setProfilePickerOpen(false)}>
          {(profiles.data ?? []).length === 0 ? (
            <>
              <p className="meta py-[10px] leading-[1.5]">
                {strings.chat.noProfiles}
              </p>
              <button
                type="button"
                className="btn btn-primary w-full"
                onClick={() => {
                  setProfilePickerOpen(false);
                  generation.clearStartError();
                  navigate({ name: "settings" });
                }}
              >
                {strings.chat.goToSettings}
              </button>
            </>
          ) : (
            (profiles.data ?? []).map((profile) => (
              <SheetAction
                key={profile.id}
                label={profile.name}
                onClick={() => {
                  updateScene.mutate(
                    { connectionProfileId: profile.id },
                    {
                      onSuccess: () => {
                        setProfilePickerOpen(false);
                        generation.clearStartError();
                      },
                    },
                  );
                }}
              />
            ))
          )}
        </Sheet>
      ) : null}

      <ChatSheets
        sceneId={sceneId}
        messages={messages}
        authorName={authorName}
        isDesktop={isDesktop}
        isGenerating={isGenerating}
        oocInFlight={oocInFlight}
        oocText={active?.text ?? ""}
        confirm={confirm}
        paletteOpen={paletteOpen}
        acting={acting}
        paletteTurn={paletteTurn}
        paletteSeed={paletteSeed}
        onRunCommand={(id, turn) => runCommand(id, turn)}
        onClosePalette={() => {
          setActing(null);
          setPaletteOpen(false);
          setPaletteSeed("");
        }}
        marking={marking}
        onCloseMark={() => setMarking(null)}
        marksOpen={marksOpen}
        onCloseMarks={() => setMarksOpen(false)}
        statsOpen={statsOpen}
        stats={stats.data ?? null}
        onCloseStats={() => setStatsOpen(false)}
        guidesOpen={guidesOpen}
        contextTab={contextTab}
        onContextTab={setContextTab}
        guides={guides}
        tasks={tasks.data ?? []}
        customPrompt={scene.data?.scene.customGuidePrompt ?? null}
        guideWorking={guideWorking}
        onRebuildGuide={(kind) => {
          setGuideWorking(kind);
          rebuildGuides.mutate(kind === "all" ? {} : { kind }, {
            onSettled: () => setGuideWorking(null),
          });
        }}
        onEditGuide={(guideId, content) => editGuide.mutate({ guideId, content })}
        onFlushGuide={(kind) => flushGuides.mutate(kind)}
        summaries={summaries.data}
        evicting={scene.data?.scene.summariseEvict ?? false}
        summaryWorking={
          summariseNow.isPending || rewriteSummary.isPending || forgetSummary.isPending
        }
        onSummarise={() => summariseNow.mutate(undefined)}
        onRewriteSummary={(summaryId) => rewriteSummary.mutate(summaryId)}
        onEditSummary={(summaryId, content) => editSummary.mutate({ summaryId, content })}
        onForgetSummary={(summaryId) => forgetSummary.mutate(summaryId)}
        onCloseContext={() => setGuidesOpen(false)}
        inspecting={inspecting}
        inspection={inspector.data}
        onCloseInspector={() => setInspecting(null)}
        previewOpen={previewOpen}
        previewInspection={preview.data}
        previewPending={preview.isPending}
        previewError={preview.error?.message ?? null}
        onClosePreview={() => setPreviewOpen(false)}
        correcting={correcting}
        onCloseCorrecting={() => setCorrecting(null)}
        onRevise={(message, mode, instructions) => void revise(message, mode, instructions)}
        recasting={recasting}
        onCloseRecasting={() => setRecasting(null)}
        onRecast={(message, ordinal, name) => void recast(message, ordinal, name)}
        castActing={castActing}
        onCloseCastActing={() => setCastActing(null)}
        onBench={(patch) => bench.mutate(patch)}
        onEditCard={(characterId) => {
          if (isDesktop) {
            setEditingCastId(characterId);
            setCastActing(null);
          } else {
            navigate({ name: "character", characterId });
          }
        }}
        oocOpen={oocOpen}
        onCloseOoc={() => setOocOpen(false)}
        onStartOoc={(question) => {
          setOocAsked(true);
          void generation.start({
            sceneId,
            sceneTitle: scene.data?.scene.title ?? "",
            speaker: authorName,
            ooc: { question },
          });
        }}
        versionsFor={versionsFor}
        siblings={siblings.data ?? []}
        onSetLeaf={(messageId) => setLeaf.mutate({ messageId })}
        onDeleteMessage={(messageId) => remove.mutate(messageId)}
        onCloseVersions={() => setVersionsFor(null)}
        quickRepliesOpen={quickRepliesOpen}
        onCloseQuickReplies={() => setQuickRepliesOpen(false)}
      />
      {confirmNode}
    </div>
  );
}
