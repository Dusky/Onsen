/**
 * Every user-facing string in the app.
 *
 * The design handoff is explicit that all product nouns are provisional and
 * will be renamed in production — "Roleplay"/"Scene", "Author", "Cast",
 * "Persona", "Guides", "Steer", "Nudge", "Autopilot", "OOC" and the rest. They
 * are routed through this one module so a rename is one file, not a hunt, and
 * so no component hardcodes vocabulary that is going to change.
 *
 * Corollary: type names, database columns, and route paths take their names
 * from SPEC.md, never from the labels here.
 */
export const strings = {
  app: {
    /** Provisional product name. */
    name: "Onsen",
  },

  common: {
    continue: "Continue",
    back: "Back",
    cancel: "Cancel",
    optional: "Optional",
    /** The confirm sheet's own title. The question itself is the body. */
    areYouSure: "Are you sure",
    /** The default answer, where a caller has no better verb to name. */
    confirm: "Yes, do it",
    working: "Working…",
  },

  setup: {
    kicker: "First run",
    title: "Set up this install",
    intro:
      "This is a single-user, self-hosted install. Choose a password, then point it at one model to start with — you can add more connections later.",

    passwordSection: "Password",
    passwordLabel: "Password",
    passwordPlaceholder: "At least 8 characters",
    passwordConfirmLabel: "Confirm password",
    passwordHint:
      "There is no account recovery. Keep this app behind Tailscale or a Cloudflare Tunnel; the password is defence in depth, not the only defence.",
    passwordMismatch: "The two passwords do not match.",

    connectionSection: "First connection",
    providerKindLabel: "Provider",
    providerNameLabel: "Name",
    providerNamePlaceholder: "What to call this provider",
    baseUrlLabel: "Base URL",
    baseUrlPlaceholderOpenAi: "https://api.openai.com/v1",
    baseUrlPlaceholderLocal: "http://localhost:8080",
    apiKeyLabel: "API key",
    apiKeyHint: "Stored encrypted. It is never sent back to this browser.",
    modelLabel: "Model",
    modelPlaceholder: "Model identifier",
    profileNameLabel: "Profile name",
    profileNameHint: "A connection profile is provider, model and settings in one switchable bundle.",

    submit: "Finish setup",
    submitting: "Setting up…",
  },

  providerKind: {
    openai_compatible: "OpenAI-compatible",
    anthropic: "Anthropic",
    text_completion: "Text completion",
  },

  providerKindHint: {
    openai_compatible: "OpenAI, OpenRouter, and most local OpenAI-compatible servers.",
    anthropic: "Claude models, via the Anthropic API.",
    text_completion: "llama.cpp, KoboldCpp, TabbyAPI and other raw completion servers.",
  },

  login: {
    kicker: "Locked",
    title: "Sign in",
    passwordLabel: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
  },

  scenes: {
    kicker: "Onsen",
    title: "Roleplays",
    empty: "Nothing here yet. Start one.",
    emptyScene: "No messages yet.",
    create: "New roleplay",
    untitled: "Untitled",
    stillWriting: (title: string) => `Still writing in ${title}`,
    open: "Open",
    counts: (messages: number) => `${messages} ${messages === 1 ? "reply" : "replies"}`,
    noCast: "No cast",
  },

  chat: {
    /**
     * The design's `KESTREL · OOC` label above an inline aside. With no author
     * set there is no name worth printing, and `Off script · OOC` says the same
     * thing twice.
     */
    oocLabel: (name: string | null) => (name === null ? "OOC" : `${name} \u00b7 OOC`),
    /**
     * §5's multi-device head sync. The blue pencil, not the red: this is the
     * app talking about its own machinery, not something happening in the story.
     */
    movedElsewhere: "This roleplay moved on another device",
    movedShow: "Show me",

    oocOpenChannel: "Open channel \u25be",
    opOoc: "Off script",
    opOocKey: "OOC",
    kicker: "Roleplay",
    composerPlaceholder: "Direct the scene…",
    send: "Send",
    continueWithout: "Reply without me",
    writing: (speaker: string) => `${speaker} is writing`,
    stop: "Stop",

    /** Autopilot (SPEC §6) — the strip while it runs, the line when it stops. */
    autopilot: "Autopilot",
    autopilotCount: (turns: number, max: number) => `${turns} OF ${max}`,
    autopilotTakeOver: "Take over",
    autopilotStopped: (reason: string) => `Autopilot stopped — ${reason}`,
    autopilotReasons: {
      cap: "it wrote its turns",
      user: "you sent a message",
      stopped: "you stopped it",
      addressed: "the scene turned to you",
      off: "it was switched off",
      error: "a turn failed",
    } as Record<string, string>,
    edited: "Edited",
    /** The reasoning strip (SPEC §13), collapsed by default. */
    reasoning: (chars: number) => `Thought · ${chars} chars`,
    save: "Save",
    versionCounter: (index: number, total: number) => `◂ ${index}/${total} ▸`,
    versions: "Versions",
    setup: "Setup",
    back: "‹",

    /** The prompt inspector (SPEC §16, phase 25). */
    inspect: "Inspect the prompt",
    inspectorTitle: "The prompt",
    inspectorTotal: (total: number, available: number) => `${total} / ${available}`,
    inspectorBudget: (debug: {
      budget: number;
      reservedForResponse: number;
      fixedTokens: number;
      historyTokens: number;
      headroom: number;
    }) =>
      `window ${debug.budget} · reply ${debug.reservedForResponse} · fixed ${debug.fixedTokens} · history ${debug.historyTokens} · left ${debug.headroom}`,
    inspectorEstimated: "Estimated tokens",
    inspectorCounted: "Counted tokens",
    inspectorNoHeadroom: "Nothing left — the window is full",
    inspectorBlocks: "Blocks",
    inspectorEvicted: "What the window could not carry",
    inspectorLore: "Lore",
    inspectorPrefix: "prefix",
    inspectorDepth: (depth: number) => `depth ${depth}`,
    inspectorOutlet: (name: string) => `outlet ${name}`,
    inspectorTokens: (n: number) => `${n} tok`,
    inspectorEviction: {
      history_budget: "trimmed",
      hidden: "hidden",
      summarized: "summarised",
    } as Record<string, string>,
    inspectorLoreFired: (key: string) => `fired on “${key}”`,
    inspectorLoreConstant: "always on",
    inspectorSkip: {
      disabled: "off",
      delayed: "not yet due",
      cooling_down: "cooling down",
      no_match: "no match",
      secondary_keys: "blocked by its other keys",
      character_filter: "not present for it",
      probability: "not drawn",
      group_not_chosen: "group lost",
      book_budget: "book was full",
    } as Record<string, string>,
    inspectorOutlets: (names: string) => `Outlets nothing filled: ${names}`,
    inspectorMacros: (names: string) => `Macros this app does not know: ${names}`,

    /** Long-press action sheet (§16). */
    actions: "Message",
    reroll: "Reroll",
    edit: "Edit",
    branch: "Branch from here",
    copy: "Copy",
    copied: "Copied",
    delete: "Delete",
    deleteConfirm: "Delete this and everything after it?",

    /** Turn scope (SPEC §3.5). */
    scope: "This turn",
    scopeAuto: "Let it decide",
    scopeAutoHint: "The director chooses one voice or the room when you send",
    /** Before the director has answered — with a classifier, that takes a moment. */
    choosing: "Choosing who speaks",
    chooseInitials: "?",
    /** The reader, as the history listing names them. */
    youLabel: "You",
    /** The cast rail's heading, and the statuses a card can be in (design 4a). */
    whoSpeaksNext: "Who speaks next",
    statusCued: "Cued",
    statusWriting: "Writing",
    statusJustSpoke: "Just spoke",
    statusBenched: "Benched",
    /** The desktop keyboard hints, at the end of the flattened ops row. */
    keyHints: "⌘↵ send",
    /** The desktop hover row, which the design draws as REROLL · BRANCH · EDIT. */
    hoverBranch: "Branch",
    scopeSpotlight: "One voice",
    scopeBeat: "The room",
    scopeBeatHint: (names: string) => `${names} — one exchange, written together`,
    beatLabel: "Beat",
    /** The send button reads initials; a beat has no single speaker. */
    beatInitials: "ALL",
    beatUnparsed: "The speaker labels did not come through — kept as written",
    recast: "Rewrite this part",
    recasting: (name: string) => `Rewriting ${name}`,
    splitBeat: "Split into separate turns",
    splitBeatConfirm: "Split this beat into one message per part? The beat is kept.",
    beatPart: "Part of a beat",
    narrationPart: "Narration",

    /** Guided ops (SPEC §7). Lettered keys, like proofreading marks. */
    ops: "Ops",
    opsClose: "Close",
    opNudge: "Nudge",
    opNudgeKey: "N",
    opNudgeTitle: "Direct this turn",
    opNudgeHint: "One instruction, this turn only. Never becomes a message.",
    opNudgePlaceholder: "Slow the pacing down here…",
    opGuidedSwipe: "Guided swipe",
    opGuidedSwipeKey: "S",
    opGuidedSwipeTitle: "Write it again, differently",
    opGuidedSwipeHint: "Rerolls the last turn with direction. The original is kept.",
    opImpersonate: "As me",
    opImpersonateKey: "I",
    opImpersonateTitle: "Write my turn for me",
    opImpersonateHint: "Lands in the composer. Nothing is sent until you send it.",
    opImpersonatePlaceholder: "count the barrels, keep quiet…",
    opImpersonateFirst: "I did",
    opImpersonateSecond: "You do",
    opImpersonateThird: "They did",
    opImpersonateWorking: "Writing…",
    opSteer: "Steer",
    opSteerKey: "D",
    opSteerTitle: "Steer the whole scene",
    opSteerHint: "Applied to every turn until you clear it.",
    opSteerPlaceholder: "Keep everyone cold and hungry…",
    opSteerClear: "Clear",
    opNoReply: "No reply",
    opNoReplyKey: "⇥",
    opContinue: "Continue",
    opContinueKey: "→",
    opContinueUnavailable: "This provider cannot continue a finished message.",
    /** The guides panel (SPEC §8, design screen 3f). Blue: the author's own notes. */
    opGuides: "Guides",
    opGuidesKey: "G",
    guides: "Guides · injected now",
    guidesEmpty: "No guides yet. Writing one reads the scene so far and takes a note on it.",
    guidesNone: "None",
    guidesTotal: (n: number) => `${n} TOK`,

    /** Why a turn never started (SPEC §5). */
    setProfile: "Set a profile",
    noProfiles: "No connection profiles yet. Make one in settings, then come back.",
    goToSettings: "Open settings",

    /** Structured trackers (SPEC §8, phase 31). */
    trackers: "Trackers",
    trackerScene: "Scene",
    trackerCharacters: "Characters",
    flush: "Flush",
    rebuild: "Rebuild",
    doneEditing: "Done",
    /** Marks a version somebody wrote themselves, which a refresh leaves alone. */
    guidesPinned: "Yours",
    guidesRebuild: "Rebuild",
    guidesWrite: "Write it",
    guidesRebuildAll: "Rebuild all",
    guidesWorking: "Writing…",
    guidesEdit: "Edit",
    guidesSave: "Save",
    guidesFlush: "Flush",
    guidesFlushAll: "Flush all",
    guidesFlushConfirm: (label: string) => `Stop injecting ${label}? Every version of it goes.`,
    guidesFlushAllConfirm: "Stop injecting every guide? Every version of them goes.",
    guidesDone: "Done",
    guidesCustomHint: "Needs a question first, which is set in this roleplay's setup.",

    /** The memory half of the blue sheet (SPEC §11, §16 "memory panel"). */
    tabGuides: "Guides",
    tabMemory: "Memory",
    memory: "Memory · what it remembers",
    memoryEmpty:
      "Nothing summarised yet. Once the story is long enough, old turns are condensed and the prompt carries the condensed version instead.",
    memoryPending: (messages: number, words: number) =>
      `${messages} waiting · ${words} words`,
    memoryPendingNone: "Nothing waiting",
    memoryCovers: (messages: number) => `${messages} turns`,
    memoryInjected: "In the prompt",
    memoryHeld: "Too recent",
    memoryEdited: "Yours",
    memoryFolded: (level: number) => `Condensed ×${level}`,
    memoryEvicting: (messages: number) => `Standing in for ${messages} turns`,
    memoryShowing: "Shown as well as summarised",
    memoryNow: "Summarise now",
    memoryWorking: "Reading…",
    memoryRewrite: "Rewrite",
    memoryEdit: "Edit",
    memorySave: "Save",
    memoryForget: "Forget",
    memoryForgetAll: "Forget all",
    memoryForgetConfirm: "Forget this summary? The turns it covers get summarised again.",
    memoryForgetAllConfirm: "Forget every summary? The whole scene gets summarised again.",
    opExpand: "Write it longer",
    opCorrect: "Rewrite this…",
    opCorrectTitle: "What should change?",
    opCorrectHint: "Everything that was working is kept.",
    opCorrectPlaceholder: "she should refuse…",
    opApply: "Go",
    steerActive: "Steer",
    /** One line replacing the cast strip while the ops grid is open. */
    cueAuto: (name: string) => `Cued: auto · ${name}`,
    cueYours: (name: string) => `Cued: you · ${name}`,
    cueBeat: (count: number) => `Cued: the room · ${count} in play`,
    cueUndecided: "Cued: chosen when you send",

    /** Post-generation passes (SPEC §7.5). A note in the margin, not a modal. */
    checkTurn: "Check this turn",
    checking: "Reading it back…",
    passesPending: "Reading it back…",
    passOk: (label: string) => `${label} · ok`,
    passFailed: (label: string) => `${label} · could not run`,
    passRevert: "Put it back",
    passPart: (name: string) => `${name} —`,

    you: "You",
    /** Cast strip captions (design handoff). */
    autoNext: "Auto · next",
    /** In a beat the director's pick is who starts it, not who speaks. */
    autoOpens: "Auto · opens",
    youOpens: "You chose",
    youCued: "You cued",
    yourPickOverrides: "Your pick overrides the director this turn",
    benched: "Benched",
    bench: "Bench",
    unbench: "Bring back",
    viewCard: "View card",
    castMember: "Cast member",

    /** Provisional: the AI has no character until characters land. */
    narratorName: "Author",
  },

  settings: {
    kicker: "Settings",

    /** Connections group (design handoff, screen 3i). */
    providers: "Providers",
    providersHint: "Where the models are. One box or twenty.",
    addProvider: "Add a provider",
    providerName: "Name",
    providerKind: "Kind",
    providerBaseUrl: "Address",
    providerModel: "Model",
    providerKey: "API key",
    providerKeyHeld: (mask: string) => `Key held · ${mask}`,
    providerKeyNone: "No key",
    providerKeyKeep: "Leave blank to keep the stored key",
    providerTest: "Test",
    providerTesting: "Testing…",
    providerTestOk: "Reached",
    providerTestFail: "Failed",
    fetchModels: "Fetch",
    fetchingModels: "Fetching…",
    providerDisabled: "Disabled",
    lastProvider: "The only provider. Add another before removing this one.",

    profiles: "Profiles",
    profilesHint: "A provider, a model and a preset under one name. What an operation is routed at.",
    addProfile: "Add a profile",
    profileName: "Name",
    profileDefault: "Default",
    makeDefault: "Make default",
    lastProfile: "The only profile. Add another before removing this one.",

    /** Routing by operation — the headline of this screen (design handoff). */
    routing: "Routing by operation",
    routingHint:
      "Bookkeeping on a cheap local model, prose on an expensive one. Each operation goes where you send it.",
    routingSame: "Scene's own",
    opEnabled: "On",
    opDisabled: "Off",
    opHidden: "Button hidden",
    opAutoTrigger: "Runs after every reply",
    opEffectFlag: "Reports what it finds",
    opEffectReplace: "Rewrites the turn, keeping the original",
    opEffectGuide: "Rewrites this guide, and every turn carries it until you flush it",

    /** The preset editor (SPEC §13, §16). */
    generation: "Generation",
    generationHint:
      "How the model is asked to write. These ship on modern values — high repetition penalty with low temperature actively degrades current models.",
    presetKicker: "Preset",
    samplers: "Samplers",
    samplersReset: "Back to defaults",
    samplerTemperature: "Temperature",
    samplerMinP: "Min-P",
    samplerTopP: "Top-P",
    samplerTopK: "Top-K",
    samplerRepetitionPenalty: "Repetition penalty",
    samplerDryMultiplier: "DRY multiplier",
    samplerDryBase: "DRY base",
    samplerDryAllowedLength: "DRY allowed length",
    samplerXtcThreshold: "XTC threshold",
    samplerXtcProbability: "XTC probability",
    samplerOff: "Off",
    dryHint:
      "DRY penalises anything that would extend a sequence the model has already written. Far better than repetition penalty for roleplay, and the reason repetition penalty ships off.",
    xtcHint:
      "XTC drops the most-likely tokens while keeping one viable choice, which raises creativity. Threshold is how likely a token must be to qualify; probability is how often it fires.",
    /** Preset import (SPEC §18, phase 28). */
    importPreset: "Import a SillyTavern preset",
    importingPreset: "Importing…",
    presetImported: (name: string) => `Imported ${name}.`,
    presetReport: (report: {
      blocksImported: number;
      blocksDisabled: number;
      unmappedSamplers: string[];
      unsupportedMacros: string[];
    }) =>
      `${report.blocksImported} blocks (${report.blocksDisabled} off)` +
      (report.unmappedSamplers.length > 0
        ? ` · not mapped: ${report.unmappedSamplers.join(", ")}`
        : "") +
      (report.unsupportedMacros.length > 0
        ? ` · macros unknown: ${report.unsupportedMacros.join(", ")}`
        : ""),

    contextSize: "Context window",
    contextSizeUnit: "tokens",
    maxResponseTokens: "Reserved for the reply",
    maxResponseTokensUnit: "tokens",
    budgetHint:
      "The window is what the prompt is built to fit. What is reserved for the reply comes off it before anything is placed.",

    /** Regex scripts and event triggers (SPEC §14, phase 33). */
    automation: "Automation",
    automationHint:
      "Find-and-replace over what you write and what the model writes, and named actions that run at set moments.",

    scripts: "Regex scripts",
    scriptsHint: "Ordered. Each one sees the last one's output.",
    addScript: "Add a script",
    scriptName: "Name",
    scriptPattern: "Find",
    scriptPatternHint: "A regular expression. Groups are $1, or $<name> if you name them.",
    scriptReplacement: "Replace with",
    scriptReplacementHint:
      "{{char}}, {{user}}, {{cast}}, {{time}}, {{date}} and {{newline}} resolve here.",
    scriptFlags: "Flags",
    scriptFlagsHint: "g runs it everywhere, i ignores case, m and s change what . and ^ mean.",
    scriptStage: "When it runs",
    scriptScope: "Where it applies",
    scriptEnabled: "On",
    scriptDisabled: "Off",
    scriptOff: "Off",
    scriptDelete: "Delete",
    scriptDeleteConfirm: "This script is deleted, and any trigger that fires it stops working.",
    /** Plain language for each stage — the whole design is in these four lines. */
    stageLabel: {
      user_input: "What you write",
      ai_output: "What the model writes",
      display_only: "What you see",
      prompt: "What the model reads",
    } as Record<string, string>,
    stageHint: {
      user_input: "Rewritten before it is stored. Permanent, and the model sees it.",
      ai_output: "Rewritten before it is stored. Permanent. Asides are left alone.",
      display_only: "Only the log changes. The stored text and the prompt keep the original.",
      prompt: "Only the prompt changes. Nothing on disk is touched.",
    } as Record<string, string>,
    scopeLabel: {
      global: "Everywhere",
      character: "One character",
      scene: "One roleplay",
    } as Record<string, string>,

    scriptTest: "Try it",
    scriptTestHint: "Runs the real thing. Nothing is saved.",
    scriptTestInput: "Some text",
    scriptTestRun: "Run",
    scriptTestBefore: "Before",
    scriptTestAfter: "After",
    scriptTestNoChange: "Nothing matched.",
    scriptTestCount: (n: number) => `${n} ${n === 1 ? "match" : "matches"}`,
    scriptTestUnknown: (names: string) => `Left alone: ${names}`,

    triggers: "Triggers",
    triggersHint: "Run something at a set moment. Lore entries can fire one by name.",
    addTrigger: "Add a trigger",
    triggerName: "Name",
    triggerEvent: "When",
    triggerAction: "What runs",
    triggerActionRef: "Which one",
    triggerAutomationId: "Automation id",
    triggerAutomationIdHint: "The id on the lore entry that should fire this.",
    triggerRun: "Run it now",
    triggerRunHint: "Pick a roleplay to run it against.",
    triggerDelete: "Delete",
    triggerDeleteConfirm: "This trigger is deleted. The script or guide it ran is untouched.",
    eventLabel: {
      scene_start: "A roleplay starts",
      user_message: "You send a message",
      before_generation: "Before a reply is written",
      after_generation: "After a reply is written",
      lore_activation: "A lore entry fires",
    } as Record<string, string>,
    actionLabel: {
      guide: "Refresh a guide",
      tracker: "Refresh a tracker",
      script: "Run a regex script",
    } as Record<string, string>,

    /** The outbound OpenAI-compatible API (SPEC §19, phase 37). */
    apiKeys: "Use a roleplay as a model",
    apiKeysHint:
      "Point any OpenAI-compatible client at this app and a roleplay answers like a model. Turn it on per roleplay in that roleplay's setup, then make a key here.",
    addApiKey: "Make a key",
    apiKeyName: "What is it for",
    apiKeyScope: "Which roleplay",
    apiKeyAllScenes: "Any that are switched on",
    apiKeyNone: "No keys.",
    apiKeyRevoked: "Revoked",
    apiKeyUses: (n: number) => `${n} ${n === 1 ? "request" : "requests"}`,
    apiKeyUnused: "Never used",
    apiKeyRevoke: "Revoke",
    apiKeyRevokeConfirm: "Anything using this key stops working immediately.",
    apiKeyDelete: "Delete",
    apiKeyDeleteConfirm: "The key and its request log are deleted.",
    apiKeyToken: "The key",
    apiKeyTokenHint:
      "Shown once. Put it in your client as the API key; the base URL is this app's address.",
    apiKeyTokenDone: "Saved it",
    apiKeyRequests: "Recent requests",
    apiKeyNoRequests: "Nothing yet.",
    apiKeyWarned: "Client sent its own character card",

    sceneApi: "Answer as a model",
    sceneApiHint:
      "Lets an outside client drive this roleplay. Off unless you say otherwise. You still need a key, made in Settings.",
    sceneApiOn: "On",
    sceneApiOff: "Off",
    sceneApiModel: "Model id",
    sceneApiModelHint: "What your client puts in its model field.",

    /** Reading preferences (SPEC §5, phase 36). */
    reading: "Reading",
    readingHint: "How the app behaves while you are looking at something else.",
    chime: "Chime when a reply lands",
    chimeHint:
      "Only when this tab is in the background. Your browser will not let it make a sound until you have clicked something.",
    chimeOn: "On",
    chimeOff: "Off",

    /** Outbound webhooks (SPEC §15, phase 35). */
    webhooks: "Webhooks",
    webhooksHint:
      "Post what happens in a roleplay to a URL you run. Signed, so your receiver can tell it came from here.",
    addWebhook: "Add a subscription",
    webhookName: "Name",
    webhookUrl: "Where to post",
    webhookUrlHint: "http or https. A local address is fine — that is usually where the receiver is.",
    webhookEvents: "What to send",
    webhookScope: "Which roleplay",
    webhookAllScenes: "All of them",
    /** The buttons are actions; the row shows the state. */
    webhookOff: "Switch it off",
    webhookOn: "Switch it on",
    webhookIsOff: "Off",
    webhookTest: "Send a test",
    webhookTesting: "Sending…",
    webhookTestOk: (status: number | null) => `Delivered${status === null ? "" : ` · ${status}`}`,
    webhookTestFail: "Not delivered",
    webhookRotate: "New signing key",
    webhookRotateHint: "The old one stops working immediately.",
    webhookDelete: "Delete",
    webhookDeleteConfirm: "This subscription is deleted and stops receiving anything.",
    webhookSecret: "Signing key",
    webhookSecretHint:
      "Shown once. Your receiver checks it against the X-Onsen-Signature header; copy it now.",
    webhookSecretDone: "Saved it",
    webhookDeliveries: "Recent deliveries",
    webhookNoDeliveries: "Nothing sent yet.",
    webhookDisabled: (reason: string) => reason,
    webhookFailures: (n: number) => `${n} failing`,
    webhookNone: "Nothing subscribed.",
    webhookDelivery: (status: string, code: number | null) =>
      `${status === "ok" ? "Delivered" : "Failed"}${code === null ? "" : ` · ${code}`}`,
    eventName: {
      "message.created": "A message is written",
      "generation.complete": "A reply finishes",
      "beat.parsed": "A beat is split by speaker",
      "tracker.updated": "A tracker changes",
      "lore.activated": "Lore fires",
    } as Record<string, string>,

    /** Packs (SPEC §15 tier 2, phase 34). */
    packs: "Packs",
    packsHint:
      "A bundle of characters, lore, presets and settings in one file. Nothing in one runs; it is all data.",
    packInstall: "Install a pack",
    packInstalling: "Reading…",
    packExport: "Make a pack",
    packNone: "Nothing installed.",
    packVersion: (version: string) => `Version ${version}`,
    packBy: (author: string) => `by ${author}`,
    packOwns: (n: number) => `${n} ${n === 1 ? "thing" : "things"}`,
    packAdd: "Adds",
    packSkip: "Skips",
    packSkipHint: "Already here. Nothing of yours is touched.",
    packInstallConfirm: "Install",
    packCancel: "Cancel",
    packStrays: (n: number) => `${n} extra ${n === 1 ? "file" : "files"} carried along.`,
    packDone: "Done",
    packInstalled: (added: number, skipped: number) =>
      `Added ${added}. Skipped ${skipped}.`,
    packRemove: "Remove",
    packRemoveTitle: "Remove this pack",
    packRemoveHint: "Everything below goes. Nothing you made yourself is touched.",
    packRemoveConfirm: "Remove",
    packRemoved: (n: number) => `Removed ${n}.`,

    packName: "Name",
    packVersionField: "Version",
    packAuthor: "Author",
    packDescription: "What it is",
    packContents: "What goes in",
    packContentsHint: "Only what you tick. A pack is something to share, not a backup.",
    packBanlist: "The ban list",
    packEmpty: "Tick something to put in it.",
    packMake: "Make it",
    packKind: {
      characters: "Cast",
      lorebooks: "Lore",
      presets: "Presets",
      authors: "Writing partners",
      options: "Prompt options",
      regex: "Regex scripts",
      triggers: "Triggers",
      banlists: "Ban list",
    } as Record<string, string>,

    /** The data bank's embeddings provider (SPEC §11, phase 30). */
    embeddings: "Embeddings",
    embeddingsHint:
      "The model that embeds the data bank's documents. Leave empty and retrieval falls back to keyword matching.",
    embeddingsBaseUrl: "Address",
    embeddingsModel: "Model",
    embeddingsKey: "API key",
    embeddingsSave: "Save",
    embeddingsSaved: "Saved.",
    embeddingsLexical: "No embeddings provider — keyword matching is in force.",

    /** Self-update for a git-checkout deployment (SPEC §17). */
    update: "Update",
    updateInstall: "This install",
    updateHint:
      "A checkout can pull its own commits and rebuild. Restart the server afterwards to run them.",
    updateUpToDate: "Up to date",
    updateBehind: (n: number) => `${n} ${n === 1 ? "commit" : "commits"} behind`,
    updateAhead: (n: number) => `${n} ahead`,
    updateUnchecked: "Not checked yet",
    updateNoRemote: "Not on the remote",
    updateChanged: "Changed",
    updateCheck: "Check for updates",
    updateChecking: "Checking…",
    updateApply: (n: number) => `Pull ${n === 1 ? "commit" : n + " commits"}`,
    updateApplying: "Pulling…",
    updateDirty: "Tracked files have local changes. Commit or stash them first.",
    updateRestart: "Pulled. Restart the server to run the new code.",
    updateNotGit: "Not a git checkout — update by redeploying.",

    prefill: "Prefill",
    prefillHint:
      "Seeds the start of the assistant's turn, which is the strongest way to enforce a format. Only sent where the endpoint accepts it.",
    prefillPlaceholder: "*She did not look up.*",
    prefillUnsupported:
      "No provider is set to accept a prefill. Turn it on for the provider that does.",
    providerPrefill: "Accepts a prefill",
    providerPrefillAuto: "Adapter decides",
    providerPrefillYes: "Yes",
    providerPrefillNo: "No",
    providerPrefillHint:
      "A partial assistant turn the model continues from. OpenAI refuses one; most local servers speaking the same API accept it. Leave it on the adapter unless you know your endpoint.",

    reasoningTitle: "Reasoning",
    reasoningParseInline: "Strip <think> tags from the prose",
    reasoningParseInlineHint:
      "On, a block wrapped in <think> is pulled out and shown collapsed. Off, it is left in the turn as written.",
    reasoningReinject: "Feed the last",
    reasoningReinjectUnit: "blocks back in",
    reasoningReinjectHint:
      "Zero is off, and off is right for most providers — most advise against feeding reasoning back into context. Above zero, the most recent blocks ride on the prompt.",
    reasoningPrefix: "Before each block",
    reasoningSuffix: "After each block",
    opWords: "Words",
    opWordsDefault: "Built-in",
    opWordsOverridden: "Yours",
    opWordsHint: (variables: string) =>
      variables === ""
        ? "The usual macros work here."
        : `${variables} — plus the usual macros.`,
    opWordsReset: "Use the built-in",
    opRole: "Injected as",
    opTurnOnly: "Part of the turn's own prompt, so it has no model of its own.",

    save: "Save",
    remove: "Remove",
    removeConfirm: "Remove this? Anything using it falls back to nothing.",
  },

  characters: {
    kicker: "Library",
    title: "Cast",
    empty: "No characters yet. Import a card to start.",
    loadDemo: "Load the demo cast",
    search: "Search",
    searchPlaceholder: "Search name, description, notes",
    import: "Import card",
    create: "New card",
    importing: "Reading card…",
    imported: (name: string) => `Imported ${name}.`,
    noResults: "Nothing matches that.",
    tokens: (n: number) => `${n} TOK`,

    /** The library at scale (SPEC §9, phase 26). */
    actions: "Actions",
    allTags: "All",
    allFolders: "Any folder",
    tagFilter: "Tag",
    folderFilter: "Folder",
    savedFilters: "Saved filters",
    saveFilter: "Save this filter",
    filterName: "Name",
    noSavedFilters: "No saved filters yet.",
    select: "Select",
    selected: (n: number) => `${n} selected`,
    done: "Done",
    bulkTag: "Tag",
    bulkMove: "Move",
    bulkDelete: "Delete",
    bulkDeleteConfirm: (n: number) => `Delete ${n} card${n === 1 ? "" : "s"}? The card files are not touched.`,
    folderPrompt: "Folder name (empty clears)",
    tagPrompt: "Tag name",
    derive: "Make a variant",
    /** Version history (SPEC §9). */
    versions: "Versions",
    noVersions: "No versions yet.",
    restore: "Restore",
    restoreConfirm: "Restore this version? The current state becomes a version too.",
    /** AI-assisted tagging (SPEC §9). */
    suggestTags: "Suggest tags",
    suggestingTags: "Reading the card…",
    noTagSuggestions: "No suggestions came back.",

    /** AI-assisted authoring (SPEC §9, phase 27). */
    writeWithAi: "Write with AI",
    writeTitle: "Write a character",
    writePlaceholder: "Describe the character in a sentence or two…",
    writeGo: "Write the card",
    writingCard: "Writing the card…",
    reviseWithAi: "Revise with AI",
    revisePrompt: "What should change?",
    voiceWithAi: "Suggest voice notes",
    extracting: "Reading the scene…",
    extractFromScene: "Extract from this scene",
    extractNamePrompt: "Name the character to extract",
    suggestLore: "Suggest lore",
    loreFromScene: "Lore from this scene",
    addToBook: "Add",

    /** Sprites and expressions (SPEC §12, phase 29). */
    sprites: "Sprites",
    spritesHint: "One image per expression label. The stage falls back to the avatar, then the placeholder.",
    spriteLabel: "Label",
    spriteLabelPrompt: "Expression label, e.g. joy or worried",
    addSprite: "Add sprite",

    /** The data bank (SPEC §11, phase 30). */
    documents: "Data bank",
    documentsHint: "Text the model can recall by meaning. Chunked and embedded, recalled into the prompt when the scene touches on it.",
    addDocument: "Add a document",
    documentTitle: "Title",
    documentText: "Text",
    noDocuments: "Nothing in the data bank yet.",
    documentGlobal: "Visible in every scene",
    /** Cost is always a share of the context window (design handoff). */
    shareOfContext: (n: number, context: number) =>
      `${n} TOK · ${((n / context) * 100).toFixed(1)}% OF CTX`,

    editorKicker: "Character",
    tabCard: "Card",
    tabGreetings: "Greetings",
    tabSprites: "Sprites",
    tabAdvanced: "Advanced",

    name: "Name",
    description: "Description",
    personality: "Personality",
    scenario: "Scenario",
    speech: "Speech",
    speechHint: "Speech tics, vocabulary, rhythm. Sent only when this character is speaking.",
    exampleDialogue: "Example dialogue",
    firstMessage: "First message",
    alternateGreetings: "Alternate greetings",
    groupGreetings: "Group greetings",
    groupGreetingsHint: "Used only when this character opens a scene with others.",
    addGreeting: "Add greeting",
    removeGreeting: "Remove",
    depthPrompt: "Depth note",
    depthPromptHint: "Injected this many turns from the end, whenever this character is present.",
    depth: "Depth",
    systemPrompt: "System prompt override",
    postHistory: "Post-history instructions",
    creatorNotes: "Creator notes",
    creator: "Creator",
    version: "Version",

    cardTotal: "Card total",
    preserved: "Preserved from the original card but not editable here",
    format: (format: string) => `Imported as ${format.replace("_", " ")}`,
    exportAs: "Export",
    exportPng: "PNG",
    exportCharx: "CharX",
    exportJson: "JSON",
    deleteCharacter: "Delete character",
    deleteConfirm: (name: string) => `Delete ${name}? The card file is not touched.`,
    saved: "Saved",
  },

  authors: {
    kicker: "Writing partner",
    listTitle: "Authors",
    empty: "No writing partner yet. Create one to switch on author mode.",
    create: "New author",
    /** The defining bet, said plainly on the screen that introduces it. */
    explainer:
      "An author is the AI's own identity: one writing partner who plays every character in a scene, rather than a separate bot per character.",

    name: "Name",
    personality: "Personality",
    personalityHint: "Who this partner is as a collaborator.",
    writingStyle: "Writing style",
    writingStyleHint: "Prose style, tense, point of view, paragraph length.",
    directingStyle: "Directing style",
    directingStyleHint: "Pacing, how much it escalates, how it handles silence.",
    oocVoice: "Out-of-character voice",
    boundaries: "Boundaries",
    boundariesHint: "What it steers toward, and away from.",

    sampleVoice: "How this sounds",
    sampleVoiceEmpty: "Write an out-of-character voice to see it here.",
    memory: "Remember across roleplays",
    memoryHint:
      "Off by default. An author that quietly accumulates notes about you is a different thing, so this stays a choice.",
    makeDefault: "Use by default",
    isDefault: "Default",
    cardTotal: "Author total",
    deleteAuthor: "Delete author",
    deleteConfirm: (name: string) =>
      `Delete ${name}? Roleplays that used them keep their history and fall back to single-character mode.`,
  },

  sceneSetup: {
    kicker: "Setup",
    title: "Roleplay setup",
    author: "Author",
    authorNone: "No author — single character",
    authorHint: "With an author, one partner plays the whole cast.",
    persona: "You",
    personaNone: "Not set",
    cast: "Cast",
    castEmpty: "Nobody yet. Add a character.",
    addToCast: "Add character",
    remove: "Remove",
    title_: "Title",
    done: "Done",
    turnStrategy: "Who speaks next",
    strategyManual: "I choose",
    strategyRoundRobin: "Round robin",
    strategyMention: "By mention",
    strategyClassifier: "Let a model decide",
    strategyNotReady: "Not built yet — falls back to round robin",
    strategyClassifierHint:
      "A model reads the last few turns and picks, in its own words. It runs when you send.",

    /** The run log (SPEC §7): a side call's failures are swallowed by design. */
    directorRuns: "Recent decisions",
    directorRunsEmpty: "Nothing yet — it runs when you send.",
    directorRunStatus: (status: string) => {
      switch (status) {
        case "ok":
          return "Answered";
        case "skipped":
          return "Not asked";
        case "unusable":
          return "Unreadable answer";
        case "timeout":
          return "Too slow";
        case "cancelled":
          return "Cancelled";
        default:
          return "Failed";
      }
    },
    directorRunTiming: (ms: number) => `${(ms / 1000).toFixed(1)}s`,

    /** The post-generation pipeline (SPEC §7.5). */
    autoPasses: "Read every turn back",
    autoPassesHint:
      "After each reply, the passes you have switched on read it and leave a note. They never delay the turn.",
    autoPassesOn: "On",
    autoPassesOff: "Off",

    /** The custom guide's question, which is per scene (SPEC §8). */
    ooc: "Off-script asides",
    oocOn: "Allowed",
    oocOff: "Never",
    oocHint:
      "Lets the author break off to ask you something \u2014 a check, a flag, a question about where this is going. A collaborator rather than a narrator. You can always ask it something yourself.",
    oocInterval: "Not more often than",
    oocIntervalUnit: "messages apart",
    oocIntervalHint:
      "The earliest it may speak up again, not a schedule it has to keep. It usually will not.",
    oocInline: "Where asides live",
    oocInlineOn: "In the log and the channel",
    oocInlineOff: "Only in the channel",
    oocInlineHint:
      "Inline is the note in the margin of the story; the channel is where a note becomes a conversation. Hide the margin note if it feels like duplication.",

    /** Autopilot (SPEC §6). The switch is on the cast strip; the cap lives here. */
    autopilot: "Autopilot",
    autopilotHint:
      "The scene keeps writing after a reply, up to a bound you set, and hands itself back the moment it turns to face you.",
    autopilotMaxTurns: "Turns per run",
    autopilotMaxTurnsUnit: "turns",

    /** Visual novel staging (SPEC §12). */
    vnMode: "Visual novel stage",
    vnModeOn: "On",
    vnModeOff: "Off",
    background: "Set a background",

    customGuide: "Custom guide",
    customGuideHint:
      "One question, asked of the story after every turn. The answer rides on every prompt until you flush it. Leave it empty and the custom guide stays off.",
    customGuidePlaceholder: "What does the crew believe about the captain?",

    /** This scene's own framing, in place of the card's (SPEC §2). */
    scenario: "Scenario",
    scenarioHint:
      "Replaces the scenario written on the card. A card's scenario was written for a scene nobody had had yet; this one is about the scene you are actually in.",
    scenarioPlaceholder: "A relay station on the ridge, three days into a shortage…",

    /** Prompt option groups (SPEC §13.5). */
    options: "How it writes",
    optionsHint:
      "Small rules the prompt carries, rather than one long instruction. Groups marked one-of pick exactly one — choosing another swaps it.",
    optionsCost: (n: number) => `${n} TOK on every turn`,
    optionsNone: "None",
    optionsDefaults: "Shipped defaults",
    optionsReset: "Back to defaults",
    optionsResetConfirm: "Put every group back to what the app ships with?",
    optionsOneOf: "Pick one",
    optionsAnyOf: "Any number",
    optionsEmpty: "Adds nothing to the prompt",
    optionsDone: "Done",

    /** The ban list (SPEC §13.6). */
    bans: "Banned phrasings",
    bansHint:
      "Phrases the prompt asks it to avoid, and the slop scan flags when they appear anyway. Kept as data because the same list feeds the prompt, the samplers and the pass.",
    bansCount: (enforced: number, proposed: number) =>
      proposed === 0 ? `${enforced} in force` : `${enforced} in force · ${proposed} proposed`,
    bansAdd: "Ban a phrase",
    bansPlaceholder: "the air hung heavy",
    bansScopeGlobal: "Everywhere",
    bansScopeScene: "This roleplay",
    bansAnalyse: "What does it repeat?",
    bansAnalysing: "Counting…",
    bansAccept: "Ban it",
    bansProposed: "Proposed",
    bansGlobal: "Everywhere",
    bansBuiltin: "Shipped",
    bansHits: (n: number) => `${n} turns`,
    bansOff: "Off",
    bansRemove: "Remove",
    bansEmpty: "Nothing banned yet.",
    bansNothingFound: "Nothing repeats often enough to be worth banning yet.",

    /** Rolling summarisation, all per scene (SPEC §11). */
    summarise: "Remember what happened",
    summariseHint:
      "Old turns are condensed into a paragraph the prompt carries instead of the turns. A long scene stops fitting otherwise.",
    summariseOn: "On",
    summariseOff: "Off",
    summariseEveryMessages: "Summarise every",
    summariseEveryMessagesUnit: "turns",
    summariseEveryWords: "or every",
    summariseEveryWordsUnit: "words",
    summariseEveryHint: "Whichever comes first. Twenty short exchanges and twenty long ones are very different amounts of story.",
    summariseThreshold: "Keep the last",
    summariseThresholdUnit: "turns in full",
    summariseThresholdHint:
      "Recent turns are shown as written, never as a summary. Nothing inside this window is condensed or replaced.",
    summariseEvict: "Drop the turns it covers",
    summariseEvictOn: "Drop them",
    summariseEvictOff: "Keep both",
    summariseEvictHint:
      "Off, the prompt carries the summary and the original turns until the budget forces a choice. On, the summary stands in for them and the room is yours. Your last message is always kept.",
    summariseFreeze: "Move the summary every",
    summariseFreezeUnit: "turns",
    summariseFreezeHint:
      "Changing what the prompt carries invalidates the provider's cache, and the summary sits near the front, so everything after it moves too. Holding it still for a few turns costs a little staleness and saves a lot.",

    /** Where the classifier runs (SPEC §6). */
    directorProfile: "Where the director runs",
    directorProfileSame: "Same as the scene",
    directorProfileHint:
      "A one-line question, so it wants a small fast model. Left alone it uses the scene's own, which works and costs more.",
  },

  ooc: {
    /** The bottom sheet an exchange is promoted to (design 2a). */
    title: "Off script",
    hint: "Speaking to the author, not to anyone in the scene. Nothing here is part of the story.",
    empty: "Nothing off script yet. Ask the author something.",
    placeholder: "Ask the author\u2026",
    send: "Send",
    back: "Back to scene",
    thinking: "Answering\u2026",
    reader: "You",
  },

  dossiers: {
    title: "Dossiers",
    hint: "Sheets for characters who turned up during play. They reach the prompt when their name does \u2014 not on every turn.",
    count: (n: number) => `${n} WRITTEN`,
    noticed: "This roleplay keeps mentioning",
    mentions: (n: number) => `${n} turns`,
    writing: "Writing\u2026",
    written: "Written",
    empty: "None yet. Names the scene keeps returning to show up above.",
    write: "Write one by hand",
    noRole: "No role yet",
    name: "Name",
    role: "Role, and where they are usually found",
    voice: "Voice",
    canonLock: "Established in play",
    canonLockHint: "Facts later turns must not contradict.",
    knowledgePublic: "Known publicly",
    knowledgePrivate: "Knows, but does not volunteer",
    knowledgeBuried: "Hiding",
    knowledgeBuriedHint:
      "Kept for you and never sent to the model. A secret in the prompt is a secret said aloud two turns later.",
    standing: "With you",
    injected: "What the prompt gets",
    injectedEmpty: "Nothing yet \u2014 fill a field above.",
    buriedHint: "Everything except what they are hiding.",
    save: "Save",
    promote: "Make a character",
    promoteConfirm: (name: string) =>
      `Give ${name} a full character card? The dossier stops being injected \u2014 the card carries it instead.`,
    promoted: "Now a character",
    delete: "Delete",
    deleteConfirm: (name: string) => `Delete ${name}\u2019s dossier? Its lore entry goes too.`,
    open: "Dossiers",
    openHint: "Characters the story invented, and the sheets that keep them consistent.",
  },

  lore: {
    on: "On",
    off: "Off",
    kicker: "Library",
    title: "Lore",
    empty: "No lorebooks yet. Import world info, or start one.",
    create: "New lorebook",
    import: "Import world info",
    importing: "Reading world info\u2026",
    imported: (name: string, entries: number) =>
      `Imported ${name} \u2014 ${entries} ${entries === 1 ? "entry" : "entries"}.`,
    entries: (n: number) => `${n} ${n === 1 ? "ENTRY" : "ENTRIES"}`,
    unbound: "Not attached to anything",
    /** How a book reaches a prompt at all (§10). */
    bindingGlobal: "Every roleplay",
    bindingScene: (name: string) => `Roleplay: ${name}`,
    bindingCharacter: (name: string) => `With ${name}`,
    bindingPersona: (name: string) => `As ${name}`,
    deleteBook: "Delete lorebook",
    deleteBookConfirm: (name: string) =>
      `Delete ${name} and every entry in it? This cannot be undone.`,

    editorKicker: "Lorebook",
    editing: "Editing",
    name: "Name",
    description: "Description",
    addEntry: "New entry",
    untitled: "Untitled entry",
    entryTitle: "Title",
    keys: "Keys",
    addKey: "+ key",
    keyPlaceholder: "Word or phrase",
    content: "Content",
    contentPlaceholder: "What the model should know when this fires.",
    save: "Save",
    close: "Close",
    deleteEntry: "Delete",
    deleteEntryConfirm: "Delete this entry?",
    disabled: "Disabled",
    enable: "Enable",
    disable: "Disable",
    noKeys: "No keys",
    constant: "Always in",
    keyMatch: "Key match",
    /** The design’s activation summary line: `KEY MATCH · DEPTH 4`. */
    activationLine: (constant: boolean, depth: number | null, bookDepth: number) =>
      `${constant ? "ALWAYS IN" : "KEY MATCH"} · DEPTH ${depth ?? bookDepth}`,
    priority: "Priority",
    priorityHint: "Lower goes in first, and survives the budget longest.",
    tokens: (n: number) => `${n} TOK`,
    bookTotal: (tokens: number, entries: number) =>
      `BOOK TOTAL · ${tokens.toLocaleString()} TOK · ${entries} ${
        entries === 1 ? "ENTRY" : "ENTRIES"
      }`,

    advanced: "Advanced",
    secondaryKeys: "Secondary keys",
    secondaryKeysHint:
      "Qualify a match rather than cause one: a primary key must hit first, then these decide.",
    secondaryLogic: "Secondary logic",
    logicAndAny: "And any",
    logicAndAll: "And all",
    logicNotAny: "Not any",
    logicNotAll: "Not all",
    matchWholeWords: "Whole words",
    matchWholeWordsHint: "Off, an entry keyed on \u201cash\u201d fires on \u201cwashed\u201d.",
    caseSensitive: "Case sensitive",
    probability: "Probability",
    probabilityUnit: "% of turns",
    scanDepth: "Scan depth",
    /** On an entry, blank means "whatever the book says". On the book it cannot. */
    scanDepthUnit: "messages, blank for the book\u2019s",
    bookScanDepthUnit: "messages every entry scans",
    tokenBudget: "Token budget",
    tokenBudgetUnit: "0 for no budget",
    sticky: "Sticky",
    stickyUnit: "messages it stays",
    cooldown: "Cooldown",
    cooldownUnit: "messages it cannot return",
    delay: "Delay",
    delayUnit: "messages before it can fire",
    delayFrom: "Delay counted from",
    delayFromScene: "Scene start",
    delayFromBranch: "This branch",
    timedHint: "Timed effects are cleared when an entry is edited: new text has not earned them.",
    inclusionGroup: "Inclusion group",
    inclusionGroupHint: "Entries sharing a label compete, and exactly one of them goes in.",
    groupWeight: "Weight",
    groupSelection: "Chosen by",
    selectionWeight: "Weight",
    selectionPrioritize: "Priority",
    selectionScore: "Score",
    characterFilter: "Only when present",
    characterFilterHint:
      "Empty means every character. This is how two characters in one scene know different things.",
    position: "Position",
    positionBeforeCharacter: "Before character",
    positionAfterCharacter: "After character",
    positionBeforeExamples: "Before examples",
    positionAfterExamples: "After examples",
    positionBeforeHistory: "Before history",
    positionAtDepth: "At depth",
    positionOutlet: "Outlet",
    insertionDepth: "Depth",
    insertionDepthUnit: "messages from the end",
    outletName: "Outlet name",
    recursionLevel: "Recursion level",
    recursionLevelUnit: "0 scans the transcript",
    nonRecursable: "Cannot be matched by recursion",
    preventFurtherRecursion: "Stops recursion after it",
    preserved: "Preserved from the imported file but not editable here",

    sceneRow: "Lorebooks",
    sceneRowNone: "None attached",
    sceneRowCount: (books: number, firing: number) =>
      `${books} ${books === 1 ? "BOOK" : "BOOKS"} \u00b7 ${firing} FIRING NOW`,
    sheetTitle: "Lorebooks \u00b7 this roleplay",
    sheetAttached: "Attached",
    sheetAvailable: "Available",
    attach: "Attach",
    detach: "Detach",
    globalNote: "Attached to every roleplay",
    /** A book the app writes: dossiers (§11). Visible, but not unhookable. */
    managedNote: "Written by the app",
    testTitle: "What fires right now",
    testEmpty: "Nothing to activate: no book reaches this roleplay yet.",
    testFired: "In",
    testSkipped: "Out",
    testMatched: (key: string) => `MATCHED \u201c${key}\u201d`,
    testConstant: "ALWAYS IN",
    testSticky: "STICKY",
    testRound: (n: number) => `ROUND ${n}`,
    testReason: (reason: string) => reason.replace(/_/g, " ").toUpperCase(),
    open: "Open",
    done: "Done",
  },

  instruct: {
    label: "Instruct template",
    hint: "How this model\u2019s turns are marked. A wrong template does not error \u2014 it produces prose that drifts, repeats you, or never stops.",
    builtIn: "Built in",
    custom: "Yours",
    copy: "Copy this one",
    copyName: (name: string) => `${name} copy`,
    edit: "Edit markers",
    hide: "Hide markers",
    remove: "Delete template",
    removeConfirm: (name: string) => `Delete ${name}? Providers using it fall back to the default.`,
    name: "Name",
    bos: "Start of text",
    bosHint: "Left blank on most formats: many servers add it themselves, and two is a real quality loss.",
    systemPrefix: "System opens",
    systemSuffix: "System closes",
    userPrefix: "You open",
    userSuffix: "You close",
    assistantPrefix: "Reply opens",
    assistantSuffix: "Reply closes",
    stopSequences: "Stop at",
    stopHint: "Comma separated. Without these the model writes your next turn too.",
    systemInUser: "No system turn",
    systemInUserHint: "For formats that never had one: the system text leads the first of your turns instead.",
    builtInLocked: "Built-in templates cannot be edited. Copy it to change the markers.",
    preview: "Preview",
  },

  nav: {
    /** The app, above a page title. Provisional, like every other noun here. */
    appName: "Onsen",
    /** The desktop sidebar's roleplay list (design 4a). */
    recent: "Recent",
    settings: "Settings",
    roleplays: "Roleplays",
    characters: "Cast",
    authors: "Author",
    lore: "Lore",
  },

  errors: {
    network: "Could not reach the server.",
    unexpected: "Something went wrong.",
    generationFailed: "Generation failed",
  },
} as const;

export type Strings = typeof strings;
