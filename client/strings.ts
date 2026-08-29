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

    you: "You",
    /** Provisional: the AI has no character until characters land. */
    narratorName: "Author",
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

  nav: {
    roleplays: "Roleplays",
    characters: "Cast",
  },

  errors: {
    network: "Could not reach the server.",
    unexpected: "Something went wrong.",
    generationFailed: "Generation failed",
  },
} as const;

export type Strings = typeof strings;
