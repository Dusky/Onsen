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

  /**
   * How many of how many, on any list that can exceed a screen (§16 §Density
   * rule 2). Shared rather than per-screen so every list counts the same way.
   */
  showing: (shown: number, total: number): string =>
    shown === total ? `${total}` : `${shown} of ${total}`,

  common: {
    continue: "Continue",
    back: "Back",
    cancel: "Cancel",
    optional: "Optional",
    delete: "Delete",
    /** What a row says when it has nothing to list. One word, everywhere. */
    none: "None",
    /** The confirm sheet's own title. The question itself is the body. */
    areYouSure: "Are you sure",
    /** The default answer, where a caller has no better verb to name. */
    confirm: "Yes, do it",
    working: "Working…",
  },

  setup: {
    kicker: "First run",
    title: "Set up this install",

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
    modelLabel: "Model",
    modelPlaceholder: "Model identifier",
    profileNameLabel: "Profile name",

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
    empty: "No roleplays yet",
    emptyScene: "Nothing written yet",
    create: "New roleplay",
    untitled: "Untitled",
    /* Row actions and list controls (§20 phase 54). */
    search: "Search roleplays",
    noMatches: "Nothing matches that.",
    sortRecent: "Recent",
    sortTitle: "Title",
    sortLongest: "Longest",
    rename: "Rename",
    renameTitle: "Rename roleplay",
    startLike: "Start another like this",
    deleteConfirm: "Delete this roleplay? Every branch of it goes too.",
    manage: "Manage",
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

    /* Named places in the tree (SPEC §2). */
    checkpoint: "Mark this place",

    /* The palette (§20 phase 43). */
    paletteOpen: "Commands",
    palettePlaceholder: "Type a command",
    paletteEmpty: "Nothing matches that.",
    paletteHintMove: "\u2191\u2193 move",
    paletteHintRun: "\u21b5 run",
    paletteHintClose: "esc close",
    paletteScope: (speaker: string) => `${speaker}'s turn`,
    paletteGroups: {
      turn: "On this turn",
      scene: "In this roleplay",
      goto: "Go to",
    } as Record<string, string>,
    paletteMore: "More\u2026",

    /* The status bar (§20 phase 43). `statusWriting` above is the cast rail's. */
    barIdle: "Idle",
    barWriting: "Writing",
    barSelect: "j / k select",
    barCommands: "\u2318K commands",
    barContext: "Context",
    barNoModel: "No model",
    barTokens: (n: number) => `${n.toLocaleString()} tok`,

    /* The inspector pane (§20 phase 43). */
    inspectorPane: "Inspector",
    inspectorTabContext: "Context",
    inspectorTabCast: "Cast",
    checkpointName: "Call it",
    checkpointNamePlaceholder: "before she opens the ledger",
    checkpointSave: "Mark it",
    checkpoints: "Marked places",
    checkpointsEmpty: "Nothing marked yet.",
    checkpointGo: "Go back to it",
    checkpointForget: "Forget this mark",
    checkpointForgetConfirm: (name: string) =>
      `Forget the mark on ${name}? The message and everything after it stay.`,
    checkpointAt: (excerpt: string) => `at "${excerpt}"`,

    /* §2: kept in the log, kept out of the prompt. */
    hideFromPrompt: "Keep this from the author",
    showToPrompt: "Show this to the author",
    hiddenFromPrompt: "The author is not shown this.",

    copy: "Copy",
    copied: "Copied",
    delete: "Delete",
    deleteConfirm: "Delete this and everything after it?",

    /** Turn scope (SPEC §3.5). */
    scope: "This turn",
    scopeAuto: "Let it decide",
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
    opNudgePlaceholder: "Slow the pacing down here…",
    opGuidedSwipe: "Guided swipe",
    opGuidedSwipeKey: "S",
    opGuidedSwipeTitle: "Write it again, differently",
    opImpersonate: "As me",
    opImpersonateKey: "I",
    opImpersonateTitle: "Write my turn for me",
    opImpersonatePlaceholder: "count the barrels, keep quiet…",
    opImpersonateFirst: "I did",
    opImpersonateSecond: "You do",
    opImpersonateThird: "They did",
    opImpersonateWorking: "Writing…",
    opSteer: "Steer",
    opSteerKey: "D",
    opSteerTitle: "Steer the whole scene",
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
    guidesCustomHint: "Set a question in this roleplay's setup first.",
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
    /*
     * The deck (§20 phase 50). Each readout says what one subsystem is
     * holding right now — a figure, not a setting.
     */
    speakingNext: "Speaking next",
    /*
     * Two sentences rather than one joined by a dash: the director's reasons
     * are written as sentences and arrive capitalised, so "answers next —
     * Named in the last message" reads as a mid-sentence capital. The reason
     * is shown verbatim (§6), which means the sentence has to bend around it
     * rather than the other way about.
     */
    answersNext: (name: string, reason: string) =>
      reason === "" ? `${name} answers next.` : `${name} answers next. ${reason.replace(/\.$/, "")}.`,
    changeSpeaker: "change",
    deckGuides: "Guides",
    deckMemory: "Memory",
    deckMedia: "Media",
    deckLive: (n: number) => `${n} live`,
    deckKept: (n: number) => `${n} kept`,
    deckNone: "none",
    deckOn: "on",
    deckOff: "off",
    ctxLabel: "ctx",
    ctxOf: (used: number, total: number) =>
      `${used.toLocaleString()} / ${total >= 1000 ? `${Math.round(total / 1000)}k` : total}`,
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
    /* There was no way out of a signed-in install until now. */
    signOut: "Sign out",
    /* §20 phase 43: eight places instead of one 1,596-line scroll. */
    filterSettings: "Filter settings",
    categories: {
      models: "Models",
      generation: "Generation",
      tasks: "Background tasks",
      reading: "Reading",
      media: "Pictures & voices",
      data: "Data bank",
      automation: "Automation",
      outward: "Connections out",
      packs: "Packs & updates",
      migrate: "Moving in",
    } as Record<string, string>,
    categoryEmpty: "Nothing here matches that.",

    /** Connections group (design handoff, screen 3i). */
    providers: "Providers",
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
    /*
     * Phase 49. The fetch used to fill a <datalist>, which shows nothing until
     * you focus the field and start typing — so the button looked broken. The
     * models are a visible list now, and these name it.
     */
    modelsFound: (n: number) => (n === 1 ? "1 model" : `${n} models`),
    modelsFilter: "Search models",
    modelsShowing: (shown: number, total: number) => `${shown} of ${total}`,
    modelsMore: (n: number) => `${n} more — keep typing to narrow it`,
    modelsNoMatch: "Nothing matches that.",
    modelsNone: "That address answered, but listed no models.",
    modelsAddressFirst: "Enter the address first.",
    modelsNoProviderAddress: "This provider has no address to fetch models from.",
    providerDisabled: "Disabled",
    lastProvider: "The only provider. Add another before removing this one.",

    profiles: "Profiles",
    addProfile: "Add a profile",
    preset: "Preset",
    presetDefault: "Use the default",
    presetMakeDefault: "Make it the default",
    presetIsDefault: "Default",
    addPreset: "New preset",
    presetDeleteConfirm:
      "Delete this preset? Roleplays and profiles using it fall back to the default one.",
    presetDefaultUndeletable: "The default preset is what runs when nothing else is chosen.",
        profileName: "Name",
    profileDefault: "Default",
    makeDefault: "Make default",
    lastProfile: "The only profile. Add another before removing this one.",

    /** Routing by operation — the headline of this screen (design handoff). */
    routing: "Routing by operation",
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
    /* §18: "Don't pretend round-tripping is clean when it isn't." */
    exportPresetLabel: "Save a copy",
    exportPresetOwn: "Save this preset",
    exportPresetSt: "Save for SillyTavern",
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

    /* The prompt manager (§3, §20 phase 56). */
    promptOrder: "The prompt",
    promptOrderReset: "Back to the default order",
    blockAdd: "New block",
    blockLabel: "Name",
    blockRole: "Sent as",
    blockContent: "Text",
    blockContentPlaceholder: "Always keep chapter headings out of the prose.",
    blockUp: "Move up",
    blockDown: "Move down",
    blockDeleteConfirm: "Delete this block? The preset stops sending it.",
    blockOff: "Off",
    blockTokens: (n: number) => `${n}t`,
    blockOn: "On",
    /** Sentence case, no explanation: the label is the whole story (§16 Voice). */
    blockNames: {
      system_prompt: "System prompt",
      author_identity: "The author",
      spotlight_character: "Who is speaking",
      cast: "Cast",
      persona: "You",
      scenario: "Scenario",
      constant_lore: "Lore, always on",
      example_dialogue: "Example dialogue",
      summaries: "Summaries",
      history: "The transcript",
      documents: "Data bank",
      memory: "Memory",
      matched_lore: "Lore that matched",
      guides: "Guides",
      trackers: "Trackers",
      depth_prompts: "Depth prompts",
      prompt_option: "Options",
      ban_list: "Banned constructions",
      director_note: "Director's note",
      post_history: "After the transcript",
      nudge: "Nudge",
      ooc_invitation: "Off-script invitation",
      spotlight_instruction: "Write as",
      jailbreak: "Jailbreak",
      prefill: "Prefill",
      alternation_filler: "Alternation filler",
    } as Record<string, string>,

    contextSize: "Context window",
    contextSizeUnit: "tokens",
    maxResponseTokens: "Reserved for the reply",
    maxResponseTokensUnit: "tokens",

    /** Regex scripts and event triggers (SPEC §14, phase 33). */
    automation: "Automation",

    scripts: "Regex scripts",
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
    addTrigger: "Add a trigger",
    triggerName: "Name",
    triggerEvent: "When",
    triggerAction: "What runs",
    triggerActionRef: "Which one",
    triggerAutomationId: "Automation id",
    triggerRun: "Run it now",
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
    sceneApiOn: "On",
    sceneApiOff: "Off",
    sceneApiModel: "Model id",

    /** Reading preferences (SPEC §5, phase 36). */
    reading: "Reading",
    /* The layout presets (§20 phase 52). */
    layout: "Layout",
    layoutPresets: {
      instrument: "Instrument",
      quiet: "Quiet",
      broadsheet: "Broadsheet",
      custom: "Yours",
    } as Record<string, string>,
    layoutPresetHint: {
      instrument: "State stays on screen: who speaks next, and what each subsystem is holding.",
      quiet: "Everything but the story gets out of the way. One line above the composer.",
      broadsheet:
        "The log as a printed page — a standing line under the title, names set into the prose.",
      custom: "Your own mix of the switches below.",
    } as Record<string, string>,
    layoutReadouts: "Readout row",
    layoutCast: "Cast control",
    layoutCastSegments: "Segments",
    layoutCastLine: "One line",
    layoutDek: "Scene line under the title",
    layoutAttribution: "Attribution",
    layoutAttributionStacked: "Above the text",
    layoutAttributionInline: "In the text",
    /* The reading surface, which the reader sets (§20 phase 55). */
    prose: "Text size",
    proseMeasure: "Column width",
    proseLeading: "Line spacing",
    proseSample:
      "She set the ledger down without closing it, and waited to see which of them would look first.",
    proseReset: "Back to defaults",
    chime: "Chime when a reply lands",
    chimeOn: "On",
    chimeOff: "Off",

    /** Outbound webhooks (SPEC §15, phase 35). */
    webhooks: "Webhooks",
    addWebhook: "Add a subscription",
    webhookName: "Name",
    webhookUrl: "Where to post",
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

    /** Moving in from SillyTavern (SPEC §20 phase 44). */
    /** Themes (SPEC §20 phase 45). */
    theme: "Theme",
    themeDuplicate: "Duplicate",
    themeDelete: "Delete",
    themeExport: "Export",
    themeImport: "Import",
    themeBuiltin: "This one ships with Onsen. Duplicate it to change anything.",
    themeDepth: "Depth",
    themeCss: "Your own CSS",
    themeCssPlaceholder: ".prose em { color: var(--onsen-color-blue); }",
    themeCssPending:
      "This theme arrived with CSS. It is not running. Read it, then keep or discard it.",
    themeCssApprove: "Apply this CSS",
    themeCssDiscard: "Discard it",
    themeImported: (name: string) => `Imported ${name}.`,
    themeDropped: (n: number) =>
      `${n} value${n === 1 ? "" : "s"} were refused for holding something other than a colour or a length.`,

    migrate: "Move in from SillyTavern",
    migrateChoose: "Choose the folder",
    migrateWorking: "Reading the folder\u2026",
    migrateEmpty: "Nothing in that folder looked like a SillyTavern install.",
    migrateNothing: "Nothing in it could be read.",
    migrateResult: (added: number, skipped: number) =>
      `${added} brought over \u00b7 ${skipped} skipped`,
    migrateKind: {
      character: "Cast",
      chat: "Roleplay",
      group_chat: "Group roleplay",
      persona: "You",
      lorebook: "Lore",
      instruct: "Instruct template",
      context: "Context template",
      regex: "Regex script",
    } as Record<string, string>,

    /** The data bank's embeddings provider (SPEC §11, phase 30). */
    embeddings: "Embeddings",
    embeddingsBaseUrl: "Address",
    embeddingsModel: "Model",
    embeddingsKey: "API key",
    embeddingsSave: "Save",
    embeddingsSaved: "Saved.",
    embeddingsLexical: "No embeddings provider — keyword matching is in force.",

    /** Self-update for a git-checkout deployment (SPEC §17). */
    update: "Update",
    updateInstall: "This install",
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
    empty: "No characters yet",
    loadDemo: "Load the demo cast",
    search: "Search",
    searchPlaceholder: "Search name, description, notes",
    import: "Import card",
    create: "New card",
    importing: "Reading card…",
    imported: (name: string) => `Imported ${name}.`,
    importFolder: "Import folder",
    importReport: "Imported",
    importReportMeta: (added: number, skipped: number) =>
      `${added} added \u00b7 ${skipped} skipped`,
    importAdded: "Added",
    importSkipped: "Skipped",
    importNothing: "Nothing in that folder was a character card.",
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
    spriteLabel: "Label",
    spriteLabelPrompt: "Expression label, e.g. joy or worried",
    addSprite: "Add sprite",

    /** The data bank (SPEC §11, phase 30). */
    documents: "Data bank",
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
    mentionKeywords: "Also answers to",
    mentionKeywordsHint:
      "Comma separated. In a scene set to \u201cBy mention\u201d, any of these in the last message hands them the turn \u2014 their name always does.",
    exampleDialogue: "Example dialogue",
    firstMessage: "First message",
    alternateGreetings: "Alternate greetings",
    groupGreetings: "Group greetings",
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

  /* Pictures, voices and captions (SPEC §20 phase 41). */
  media: {
    kicker: "Pictures and voices",
    title: "Pictures and voices",

    imageSection: "What draws",
    speechSection: "What speaks",
    noImageService: "No picture service yet.",
    noSpeechService: "No voice service yet.",
    addImage: "Add a picture service",
    addSpeech: "Add a voice service",

    serviceName: "Name",
    serviceKind: "Kind",
    serviceUrl: "Address",
    serviceModel: "Model",
    serviceKey: "API key",
    serviceKeyKept: (mask: string) => `Stored: ${mask}. Leave empty to keep it.`,
    serviceKeyNotNeeded: "Usually blank for a local service.",
    serviceDefault: "Use this one",
    serviceIsDefault: "In use",
    /** A badge on the row: state. The buttons below say the action instead. */
    serviceOff: "Off",
    serviceEnable: "Turn it on",
    serviceDisable: "Turn it off",
    serviceDelete: "Remove",
    serviceDeleteConfirm: (name: string) => `Remove ${name}? Pictures it already made stay.`,
    save: "Save",

    /* On a message. */
    illustrate: "Draw this",
    illustrating: "Drawing…",
    speak: "Read it aloud",
    speaking: "Reading…",
    attach: "Add a picture",
    attaching: "Adding…",

    /* On a picture. */
    drawnFrom: "Drawn from",
    describedAs: "The author is told",
    notDescribed: "Not described yet.",
    recaption: "Describe it again",
    recaptioning: "Looking…",
    /* The two switches, said as what they do rather than as state. */
    hide: "Hide from the log",
    unhide: "Show in the log",
    dropFromPrompt: "Keep it from the author",
    addToPrompt: "Show it to the author",
    hiddenNote: "Hidden here.",
    quietNote: "The author is not told about this.",
    remove: "Delete",
    removeConfirm: "Delete this picture? It is gone from every branch.",
    /* Said once, where the distinction first bites. */
  },

  authors: {
    kicker: "Writing partner",
    listTitle: "Authors",
    empty: "No writing partner yet",
    create: "New author",
    /** The defining bet, said plainly on the screen that introduces it. */

    name: "Name",
    personality: "Personality",
    writingStyle: "Writing style",
    directingStyle: "Directing style",
    oocVoice: "Out-of-character voice",
    boundaries: "Boundaries",

    sampleVoice: "How this sounds",
    sampleVoiceEmpty: "Write an out-of-character voice to see it here.",
    memory: "Remember across roleplays",
    memoryNotes: "What it remembers",
    memoryEmpty: "Nothing yet. Ask it to remember something from inside a roleplay.",
    /** §11's provenance, said as a sentence rather than a badge nobody decodes. */
    memoryByAuthor: (name: string) => `${name} wrote this`,
    memoryByYou: "You wrote this",
    memoryInScene: (title: string) => `in ${title}`,
    memoryBudget: "Token budget",
    memoryOpenBook: "Open as a lorebook",
    memoryWipe: "Forget everything",
    memoryWipeConfirm: (name: string) =>
      `Delete every note ${name} has written? The roleplays they came from are untouched.`,
    makeDefault: "Use by default",
    isDefault: "Default",
    cardTotal: "Author total",
    deleteAuthor: "Delete author",
    deleteConfirm: (name: string) =>
      `Delete ${name}? Roleplays that used them keep their history and fall back to single-character mode.`,
  },

  sceneSetup: {
    kicker: "Setup",
    /*
     * Group headings (phase 47). Setup was twenty field labels in one stack
     * with nothing between them; these name the clusters that were already
     * there in that order — nothing was moved to make them fit. Provisional
     * like every other noun here.
     */
    groupScene: "Scene",
    groupDirection: "Direction",
    groupScenario: "Scenario",
    groupMemory: "Memory",
    groupModel: "Model",
    groupOffScript: "Off script",
    groupPlayback: "Playback",
    title: "Roleplay setup",
    author: "Author",
    authorNone: "No author — single character",
    persona: "You",
    personaEdit: "Edit personas",
    personaName: "Name",
    personaDescription: "Description",
    personaDescriptionPlaceholder: "Who you are in the story, in a sentence or two.",
    personaIsDefault: "Use this one by default",
    personaDeleteConfirm: "Delete this persona? Roleplays using it fall back to none.",
    personaAdd: "New persona",
    /* The persona list became a screen in phase 55 (§16 §Density rule 3). */
    personaKicker: "You",
    /** The screen's own title; `personaEdit` stays the button that reaches it. */
    personaTitle: "Personas",
    personaSearch: "Search personas",
    personaNoDescription: "No description",
    personaEmpty: "No personas yet",
        personaNone: "Not set",
    cast: "Cast",
    castEmpty: "Nobody in the cast yet",
    addToCast: "Add character",
    remove: "Remove",
    title_: "Title",
    done: "Done",
    turnStrategy: "Who speaks next",
    strategyManual: "I choose",
    strategyRoundRobin: "Round robin",
    strategyMention: "By mention",
    strategyClassifier: "Let a model decide",

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
    autoPassesOn: "On",
    autoPassesOff: "Off",

    /** The custom guide's question, which is per scene (SPEC §8). */
    ooc: "Off-script asides",
    oocOn: "Allowed",
    oocOff: "Never",
    /** Narrative memory (SPEC §11 layer 3, phase 38). */
    /**
     * §11 layer 3. Not "Remember what happened" — that is `summarise`, layer 1,
     * on the same screen. Two sections with one label is a worse problem than
     * either label being imperfect.
     */
    memory: "Keep track of who and what",
    memoryOn: "On",
    memoryOff: "Off",
    memoryEmpty: "Nothing noted yet.",
    memoryExtract: "Read the recent turns",
    memoryExtracting: "Reading…",
    memoryCount: (n: number) => `${n} ${n === 1 ? "note" : "notes"}`,
    memoryEdit: "Edit",
    memoryName: "What it is",
    memoryKind: "Kind",
    memoryContent: "What to remember",
    memorySalience: "How much it matters",
    memoryYoursHint: "Yours, so the extractor leaves it alone.",
        memoryYours: "Yours",
    memoryQuiet: (n: number) => (n === 0 ? "Just now" : `${n} ${n === 1 ? "turn" : "turns"} ago`),

    /* §11's author memory, asked for here because this is the roleplay there is
       something to remember about. The switch itself lives on the author. */
    remember: "Author's memory",
    rememberThis: "Remember this",
    rememberThisWorking: "Writing…",
    rememberHint: (name: string) =>
      `${name} writes one note about this roleplay and carries it into the others.`,
    rememberDone: (title: string) => `Noted: ${title}`,
    rememberNothing: "Nothing worth writing down yet.",
    rememberOff: (name: string) => `Off for ${name}. Switch it on in their card.`,
    memoryDelete: "Forget it",
    memoryDeleteConfirm: "This note is deleted. The extractor may write it again later.",
    memoryLinks: "Connected",
    memoryKindLabel: {
      person: "Person",
      place: "Place",
      object: "Thing",
      event: "Event",
      fact: "Fact",
    } as Record<string, string>,

    oocInterval: "Not more often than",
    oocIntervalUnit: "messages apart",
    oocInline: "Where asides live",
    oocInlineOn: "In the log and the channel",
    oocInlineOff: "Only in the channel",

    /** Autopilot (SPEC §6). The switch is on the cast strip; the cap lives here. */
    autopilot: "Autopilot",
    autopilotMaxTurns: "Turns per run",
    autopilotMaxTurnsUnit: "turns",

    /** Visual novel staging (SPEC §12). */
    vnMode: "Visual novel stage",
    vnModeOn: "On",
    vnModeOff: "Off",
    background: "Set a background",

    customGuide: "Custom guide",
    customGuidePlaceholder: "What does the crew believe about the captain?",

    /** This scene's own framing, in place of the card's (SPEC §2). */
    scenario: "Scenario",
    scenarioPlaceholder: "A relay station on the ridge, three days into a shortage…",

    /** Prompt option groups (SPEC §13.5). */
    options: "How it writes",
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
    summariseOn: "On",
    summariseOff: "Off",
    summariseEveryMessages: "Summarise every",
    summariseEveryMessagesUnit: "turns",
    summariseEveryWords: "or every",
    summariseEveryWordsUnit: "words",
    summariseThreshold: "Keep the last",
    summariseThresholdUnit: "turns in full",
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
    knowledgePublic: "Known publicly",
    knowledgePrivate: "Knows, but does not volunteer",
    knowledgeBuried: "Hiding",
    knowledgeBuriedHint:
      "Kept for you and never sent to the model. A secret in the prompt is a secret said aloud two turns later.",
    standing: "With you",
    injected: "What the prompt gets",
    injectedEmpty: "Nothing yet \u2014 fill a field above.",
    save: "Save",
    promote: "Make a character",
    promoteConfirm: (name: string) =>
      `Give ${name} a full character card? The dossier stops being injected \u2014 the card carries it instead.`,
    promoted: "Now a character",
    delete: "Delete",
    deleteConfirm: (name: string) => `Delete ${name}\u2019s dossier? Its lore entry goes too.`,
    open: "Dossiers",
  },

  lore: {
    on: "On",
    off: "Off",
    kicker: "Library",
    title: "Lore",
    /*
     * Empty states (§20 phase 51). Each says what the thing is *for*, because
     * an empty screen is the one moment the app has the reader's whole
     * attention and nothing else to compete with.
     */
    empty: "No lorebooks yet",
    /*
     * The entry list inside a book used `lore.empty` — "No lorebooks yet",
     * inside a lorebook. Nobody noticed until phase 51 rewrote that string
     * into something that could only be about the list of books.
     */
    entriesEmpty: "No entries yet",
    create: "New lorebook",
    import: "Import world info",
    importing: "Reading world info\u2026",
    imported: (name: string, entries: number) =>
      `Imported ${name} \u2014 ${entries} ${entries === 1 ? "entry" : "entries"}.`,
    entries: (n: number) => `${n} ${n === 1 ? "ENTRY" : "ENTRIES"}`,
    unbound: "Not attached to anything",
    /* §10: import and export both, and unknown fields survive either way. */
    exportBook: "Save as world info",
    /**
     * §11: the one book whose author is what attaches it, in the slot the
     * other bindings use, and parallel to managedNote's "Written by the app":
     * both answer the same question, which is who put these words here.
     */
    ownedBy: (author: string) => `Written by ${author}`,
    /** How a book reaches a prompt at all (§10). */
    bindings: "Attached to",
    attachTo: "Attach to",
    nothingToAttach: "Nothing left to attach",
    scopeGlobal: "Every roleplay",
    scopeScene: "One roleplay",
    scopeCharacter: "A character",
    scopePersona: "A persona",
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
    insertionRole: "Sent as",
    roleSystem: "System",
    roleUser: "You",
    roleAssistant: "The author",
    automationId: "Automation id",
    automationIdPlaceholder: "the-id-a-trigger-listens-for",
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
    testConstant: "Always in",
    testSticky: "Sticky",
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
