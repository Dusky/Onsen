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
  },

  chat: {
    /**
     * The design's `KESTREL · OOC` label above an inline aside. With no author
     * set there is no name worth printing, and `Off script · OOC` says the same
     * thing twice.
     */
    oocLabel: (name: string | null) => (name === null ? "OOC" : `${name} \u00b7 OOC`),
    oocOpenChannel: "Open channel \u25be",
    opOoc: "Off script",
    opOocKey: "OOC",
    kicker: "Roleplay",
    composerPlaceholder: "Direct the scene…",
    send: "Send",
    continueWithout: "Reply without me",
    writing: (speaker: string) => `${speaker} is writing`,
    stop: "Stop",
    edited: "Edited",
    /** The reasoning strip (SPEC §13), collapsed by default. */
    reasoning: (chars: number) => `Thought · ${chars} chars`,
    save: "Save",
    versionCounter: (index: number, total: number) => `◂ ${index}/${total} ▸`,
    versions: "Versions",
    setup: "Setup",
    back: "‹",

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
    title: "Connections",

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
    contextSize: "Context window",
    contextSizeUnit: "tokens",
    maxResponseTokens: "Reserved for the reply",
    maxResponseTokensUnit: "tokens",
    budgetHint:
      "The window is what the prompt is built to fit. What is reserved for the reply comes off it before anything is placed.",

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
    search: "Search",
    searchPlaceholder: "Filter by name",
    import: "Import card",
    create: "New card",
    importing: "Reading card…",
    imported: (name: string) => `Imported ${name}.`,
    noResults: "Nothing matches that.",
    tokens: (n: number) => `${n} TOK`,
    /** Cost is always a share of the context window (design handoff). */
    shareOfContext: (n: number, context: number) =>
      `${n} TOK · ${((n / context) * 100).toFixed(1)}% OF CTX`,

    editorKicker: "Character",
    tabCard: "Card",
    tabGreetings: "Greetings",
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
