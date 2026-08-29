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
    kicker: "Roleplay",
    composerPlaceholder: "Direct the scene…",
    send: "Send",
    continueWithout: "Reply without me",
    writing: (speaker: string) => `${speaker} is writing`,
    stop: "Stop",
    edited: "Edited",
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

    /** Where the classifier runs (SPEC §6). */
    directorProfile: "Where the director runs",
    directorProfileSame: "Same as the scene",
    directorProfileHint:
      "A one-line question, so it wants a small fast model. Left alone it uses the scene's own, which works and costs more.",
  },

  nav: {
    settings: "Settings",
    roleplays: "Roleplays",
    characters: "Cast",
    authors: "Author",
  },

  errors: {
    network: "Could not reach the server.",
    unexpected: "Something went wrong.",
    generationFailed: "Generation failed",
  },
} as const;

export type Strings = typeof strings;
