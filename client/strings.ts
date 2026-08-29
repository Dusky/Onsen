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

  home: {
    kicker: "Set up",
    title: "Ready",
    body: "The server is running and this install is configured. The chat screen arrives with the next phases.",
    signOut: "Sign out",
    connectionsLabel: "Connection profiles",
  },

  errors: {
    network: "Could not reach the server.",
    unexpected: "Something went wrong.",
  },
} as const;

export type Strings = typeof strings;
