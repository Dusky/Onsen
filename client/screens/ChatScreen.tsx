import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MessageDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { notify } from "../state/notices.ts";
import { useConfirm } from "../components/ConfirmSheet.tsx";
import { navigate } from "../lib/router.ts";
import { useSceneChannel } from "../lib/scene-channel.ts";
import {
  useDeleteMessage,
  useEditMessage,
  useScene,
  saveDraft,
  useReader,
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
import { OocExchange } from "../components/OocChannel.tsx";
import { Sheet, SheetAction } from "../components/Sheet.tsx";
import { StatusBar } from "../components/StatusBar.tsx";
import { Deck } from "../components/Deck.tsx";
import { speakerFor } from "./chat/attribution.ts";
import { ScenePane } from "./chat/ScenePane.tsx";
import { MessageLog } from "./chat/MessageLog.tsx";
import { ChatSheets } from "./chat/ChatSheets.tsx";
import { useCommandKeys } from "./chat/useCommandKeys.ts";
import { useOps } from "./chat/useOps.tsx";
import { OpsRow, type Op } from "../components/OpsGrid.tsx";
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
  useDock,
  useLayout,
  useInspector,
  usePreviewPrompt,
  useTranslateMessage,
  useTrackers,
  useTrackerHistory,
  useRemoveFromCast,
} from "../lib/queries.ts";
import type {
  GuideKind,
  NextSpeakerDto,
  SceneMemberDto,
  TrackerDto,
  TurnScope,
} from "@shared/types.ts";

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
  const removeFromCast = useRemoveFromCast(sceneId);
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
  /*
   * Where the next turn will run, as the server resolved it (§20 phase 181).
   *
   * This was a re-derivation from the profile, and it had to be corrected
   * twice — once when a roleplay could choose its own model, once when it
   * could choose its own provider. Three readouts were each doing their own
   * version of `resolveRoute`, which is three chances to disagree with the
   * turn, so the server resolves it and this reads the answer.
   */
  const runsOn = scene.data?.scene.runsOn ?? null;
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
  const reader = useReader();

  const log = useRef<HTMLDivElement>(null);
  // The cast becomes a rail and the ops flatten (design `4a`). Everything
  // else about this screen is the same components at a different width.
  const isDesktop = useIsDesktop();
  const setSceneInspector = useUiStore((state) => state.setSceneInspector);
  const setOocPanel = useUiStore((state) => state.setOocPanel);
  const setRightActive = useUiStore((state) => state.setRightActive);
  const setLeftActive = useUiStore((state) => state.setLeftActive);
  const setRightRailOpen = useUiStore((state) => state.setRightRailOpen);
  const setLeftRailOpen = useUiStore((state) => state.setLeftRailOpen);
  const vanished = useUiStore((state) => state.vanished);
  const dock = useDock();
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
  // An aside renders inline in the log only when the scene asks for it; the
  // channel is the home (§7, §188).
  const showInlineOoc = scene.data?.scene.oocInline ?? false;
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
  /**
   * Who is which colour, by character (§162). Built here because the cast is
   * already on the scene payload — a lookup per turn rather than a request per
   * speaker — and handed down rather than looked up in the log, which is
   * virtualised and renders the same speaker many times.
   */
  /**
   * The state each reply was written under (§20 phase 163), grouped by turn.
   *
   * Only asked for when the scene has trackers at all — a scene with them
   * switched off should not be making the request — and grouped here rather
   * than in the log, which is virtualised and would regroup on every scroll.
   */
  // Shares `TrackerPanel`'s query by key, so asking here costs no request.
  const trackers = useTrackers(sceneId);
  const trackerHistory = useTrackerHistory(sceneId, (trackers.data?.length ?? 0) > 0);
  const trackerState = useMemo(() => {
    const byMessage = new Map<string, TrackerDto[]>();
    for (const tracker of trackerHistory.data ?? []) {
      if (tracker.messageId === null) continue;
      const found = byMessage.get(tracker.messageId);
      if (found === undefined) byMessage.set(tracker.messageId, [tracker]);
      else found.push(tracker);
    }
    return byMessage;
  }, [trackerHistory.data]);

  const colours = useMemo(
    () =>
      new Map(
        cast
          .filter((member) => member.colour !== null)
          .map((member) => [member.characterId, member.colour!] as const),
      ),
    [cast],
  );
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

  /**
   * The one way into the off-script channel (§20 phase 177).
   *
   * On a desktop it is a rail panel, so opening it means selecting it in
   * whichever rail hosts it and making sure that rail is open — the exchange
   * sits beside the log instead of over it, which is what a conversation held
   * *while* reading needs. Everywhere else it is still the sheet: a phone has
   * no rails, vanish mode has deliberately hidden them, and a reader who has
   * undocked the panel from both sides still has to be able to get in. A way
   * in that depends on a preference is not a way in.
   */
  const openOoc = () => {
    if (isDesktop && !vanished) {
      if (dock.right.includes("ooc")) {
        setRightActive("ooc");
        setRightRailOpen(true);
        return;
      }
      if (dock.left.includes("ooc")) {
        setLeftActive("ooc");
        setLeftRailOpen(true);
        return;
      }
    }
    setOocOpen(true);
  };

  /**
   * Ask the author something out of character.
   *
   * Hoisted out of the sheet's props, because the rail panel and the sheet are
   * two ways into the same exchange and a question asked through either has to
   * start the same generation.
   */
  const startOoc = (question: string) => {
    setOocAsked(true);
    void generation.start({
      sceneId,
      sceneTitle: scene.data?.scene.title ?? "",
      speaker: authorName,
      ooc: { question },
    });
  };

  // Autopilot (SPEC §6). The loop outlives any one generation this client
  // watched, so its row is what says another turn is coming — and the turn it
  // starts is adopted into the same streaming row a locally-started one uses.
  const autopilotActive = autopilot.data?.active === true;
  const apState = autopilot.data ?? null;
  // The reason a run ended, shown once: it is news for a moment, then it is
  // furniture. Tracked locally so it clears the next time the reader acts,
  // rather than living on the row forever.
  const sawAutopilot = useRef(false);
  /**
   * What a picture or voice service said when it refused (§20 phase 41).
   *
   * Shown where the autopilot's reason is shown: a service being unreachable is
   * news for a moment and then it is furniture, and it clears on the next act.
   */
  /** The message being marked, while the name is being typed (§2). */
  const [marking, setMarking] = useState<MessageDto | null>(null);
  const signOut = useSignOut();
  /**
   * The turn ⌘K and the single-key accelerators act on (§20 phase 43).
   *
   * Null is the resting state: nothing is selected until the reader picks a
   * turn, so a stray keystroke cannot reroll something they were only reading.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ⌘K, j/k, Escape and the single-key accelerators, plus the palette state
  // they drive (§149). `runCommand` is hoisted, so the hook can take it.
  const { paletteOpen, setPaletteOpen, paletteSeed, setPaletteSeed } = useCommandKeys({
    messages,
    selectedId,
    setSelectedId,
    runCommand,
  });

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

  /** The `⋯ TOOLS` sheet, behind the ops cell (design handoff). */
  const [toolsOpen, setToolsOpen] = useState(false);

  const steer = scene.data?.scene.directorNote ?? null;
  const steerDepth = scene.data?.scene.directorNoteDepth ?? 0;
  const steerInterval = scene.data?.scene.directorNoteInterval ?? 1;
  const steerRole = scene.data?.scene.directorNoteRole ?? "system";

  // The ops surface (§149): the grid, the drawer, and every turn handler the
  // ops and the palette dispatch through, extracted into one hook.
  const {
    sendAndReply,
    nextTurn,
    continueScene,
    recast,
    reroll,
    revise,
    fireQuickReply,
    handleDraftChange,
    ops,
    opsDrawer,
  } = useOps({
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
    guidesCount: guides.length,
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
    openOoc,
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
        illustrate.mutate({ messageId: turn.id }, { onError: (e) => notify("failed", e.message) }),
      "speak": () =>
        turn && speak.mutate(turn.id, { onError: (e) => notify("failed", e.message) }),
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
      "ooc": openOoc,
      "no-reply": () => void generation.start(nextTurn()).then(() => setCued(null)),
      "guides": () => setGuidesOpen(true),
      "attach": () => document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')?.click(),
      "marks": () => setMarksOpen(true),
      "branch-map": () => setBranchMapOpen(true),
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
  /** The branch map (§20 phase 172): every branch and checkpoint, at once. */
  const [branchMapOpen, setBranchMapOpen] = useState(false);
  const illustrate = useIllustrate(sceneId);
  const speak = useSpeak(sceneId);
  const attach = useAttachImage(sceneId);
  useEffect(() => {
    if (apState === null) return;
    if (apState.active) {
      sawAutopilot.current = true;
      return;
    }
    if (sawAutopilot.current && apState.stopReason !== null) {
      sawAutopilot.current = false;
      // Posted rather than held in state and rendered at the bottom of the log
      // (§20 phase 167). It is the app reporting that a background task
      // finished, which is the notice region's whole job — and down there it
      // was never announced, and scrolled away the moment the next turn
      // arrived.
      notify("done", strings.chat.autopilotStopped(
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

  /*
   * The unsent turn, kept and restored (§20 phase 166).
   *
   * Two effects rather than one, because they are two different events.
   *
   * The first restores: it fires when the scene's draft arrives, and only into
   * an empty composer. Guarded by the scene id so switching roleplays restores
   * the new one's draft rather than the old one's, and guarded on emptiness so
   * a late refetch cannot overwrite a sentence being typed right now — the
   * request that carries the draft is the same one that carries the log, and it
   * runs whenever the window regains focus.
   *
   * The second saves, debounced: a keystroke is not a save. `draftSaved` holds
   * what was last sent, so a scene whose draft already matches the server's —
   * the common case on open — issues no write at all.
   */
  const restoredFor = useRef<string | null>(null);
  const draftSaved = useRef<string | null>(null);
  const storedDraft = scene.data?.scene.draft ?? null;
  useEffect(() => {
    if (!reader.drafts || storedDraft === null) return;
    if (restoredFor.current === sceneId) return;
    restoredFor.current = sceneId;
    draftSaved.current = storedDraft;
    if (storedDraft !== "" && draft === "") setDraft(storedDraft);
  }, [reader.drafts, storedDraft, sceneId, draft, setDraft]);

  useEffect(() => {
    if (!reader.drafts) return;
    if (restoredFor.current !== sceneId) return;
    if (draftSaved.current === draft) return;
    const timer = setTimeout(() => {
      draftSaved.current = draft;
      saveDraft(sceneId, draft);
    }, 700);
    return () => clearTimeout(timer);
  }, [draft, reader.drafts, sceneId]);

  /*
   * Keep the newest content in view as it arrives. Bottom-anchored layout does
   * most of the work; this covers the case where the log has overflowed.
   *
   * The reader can turn it off (§20 phase 166), which is the difference between
   * reading back through a scene while a turn streams and being yanked to the
   * bottom every few hundred milliseconds. A *new* turn still scrolls either
   * way: arriving text is the thing being followed, and a log that silently
   * stopped moving when a message landed would read as a broken log rather
   * than as a setting.
   */
  useLayoutEffect(() => {
    const element = log.current;
    if (element === null) return;
    element.scrollTop = element.scrollHeight;
  }, [logMessages.length]);

  useLayoutEffect(() => {
    const element = log.current;
    if (element === null || !reader.autoScroll) return;
    element.scrollTop = element.scrollHeight;
  }, [active?.text, reader.autoScroll]);

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

  /**
   * The ops a user has asked to see. Hiding a button is not turning the op off:
   * something else asking for it still gets it (SPEC §7).
   */
  const shownOps = ops.filter((op) => {
    const task = (tasks.data ?? []).find((row) => row.key === op.key);
    return task === undefined || !task.hideable || task.buttonVisible;
  });

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
          reader={reader}
          colours={colours}
          trackerState={trackerState}
          personaId={scene.data?.scene.personaId ?? null}
          onReroll={(message) => void reroll(message)}
          onOpenVersions={(message) => setVersionsFor(message)}
          onLongPress={(message) => setActing(message)}
          onInspect={(message) => setInspecting(message)}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          onRevert={(note) => revert.mutate(note.id)}
          runCommand={runCommand}
          onOpenOoc={openOoc}
          active={active}
          recastInFlight={recastInFlight}
          oocInFlight={oocInFlight}
          autopilotActive={autopilotActive}
          apState={apState}
          onStopAutopilot={() => stopAutopilot.mutate()}
          onCancel={() => void generation.cancel()}
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
              <span style={{ color: "var(--onsen-color-amber)" }}>{strings.chat.steerActive}</span>
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
          onContinue={continueScene}
          disabled={isGenerating}
          speakerName={scope === "beat" ? null : speakerName}
          model={{
            /*
             * The model the turn will actually run on (§20 phase 180).
             *
             * This read the profile's model, which stopped being the answer
             * when a roleplay could choose its own: the chip would name one
             * model while `resolveRoute` used another, and a status readout
             * that disagrees with the turn is worse than none. Same chain the
             * server resolves — the scene's, then the profile's.
             */
            label:
              runsOn === null
                ? strings.header.noModel
                : `${runsOn.providerName}${runsOn.model === null ? "" : ` \u00b7 ${runsOn.model}`}`,
            hasModel: runsOn !== null,
          }}
          draft={draft}
          onDraftChange={handleDraftChange}
          onAttach={(file) =>
            attach.mutate(file, {
              // A caption that failed is worth saying once — the picture is
              // still here, and the reader may have wanted it that way.
              onSuccess: (result) => {
                if (result.captionError !== null) notify("failed", result.captionError);
              },
              onError: (error) => notify("failed", error.message),
            })
          }
          attaching={attach.isPending}
          pending={(scene.data?.pendingMedia ?? []).map((asset) => ({
            id: asset.id,
            url: asset.url,
          }))}
          opsOpen={opsPanel !== null}
          onToggleOps={() => setOpsPanel(opsPanel === null ? "grid" : null)}
          ops={opsDrawer(opsPanel, shownOps)}
          quickReplies={
            <QuickReplyRow
              onFire={fireQuickReply}
              onEdit={() => setQuickRepliesOpen(true)}
              disabled={isGenerating}
            />
          }
          wide={isDesktop}
          sendKey={reader.send}
          marks={reader.marks}
        />

        {/* §20 phase 43: what is true right now, in one line. On a phone its
            right-hand control is the only way to the inspector — the same panel
            the desktop shows beside the log, laid down rather than stood up. */}
        {/* `profileName` is where it runs, not which profile it is filed
            under: the status bar had the same re-derivation problem as the
            composer's chip. */}
        <StatusBar
          profileName={runsOn === null ? null : runsOn.providerName}
          tokens={scene.data?.scene.lastPromptTokens ?? null}
          contextSize={scene.data?.scene.contextSize ?? null}
          generating={isGenerating}
          onOpenBranchMap={() => setBranchMapOpen(true)}
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
      onEditAuthor={() => setRightActive("authors")}
    />
  );

  // The scene panes and the off-script exchange both render in the shell's
  // rails, not here (§20 phases 87, 177). The nodes are refreshed every render
  // so they always carry the live scene state — the streaming answer included,
  // which is the whole reason the channel has to be a slot rather than a
  // panel that fetches for itself — and cleared when the chat unmounts.
  useLayoutEffect(() => {
    setSceneInspector(isDesktop ? scenePane : null);
    setOocPanel(
      isDesktop ? (
        <OocExchange
          messages={messages.filter((message) => message.kind === "ooc")}
          authorName={scene.data?.scene.authorName ?? null}
          personaName={strings.ooc.reader}
          pending={isGenerating && oocInFlight ? (active?.text ?? "") : null}
          onSend={startOoc}
        />
      ) : null,
    );
    return () => {
      setSceneInspector(null);
      setOocPanel(null);
    };
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
            className="chrome tap -ml-[6px] flex h-[34px] w-[24px] items-center self-center text-[18px] text-ink-muted"
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
        <button
          type="button"
          onClick={() => navigate({ name: "setup", sceneId })}
          className="chrome tap flex flex-none items-center self-center border border-border-quiet px-[9px] text-[12.5px] text-ink-muted"
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
        toolsOpen={toolsOpen}
        onCloseTools={() => setToolsOpen(false)}
        checkpointCount={checkpoints.data?.length ?? 0}
        onOpenCheckpoints={() => {
          setToolsOpen(false);
          setMarksOpen(true);
        }}
        onOpenStats={() => {
          setToolsOpen(false);
          setStatsOpen(true);
        }}
        branchMapOpen={branchMapOpen}
        onOpenBranchMap={() => {
          setToolsOpen(false);
          setBranchMapOpen(true);
        }}
        onCloseBranchMap={() => setBranchMapOpen(false)}
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
        onRemoveFromCast={(characterId) => {
          removeFromCast.mutate(characterId);
          setCastActing(null);
        }}
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
        onStartOoc={startOoc}
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
