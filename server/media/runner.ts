import type { Database } from "bun:sqlite";
import { createEstimatingTokenizer, defaultTemplateOf } from "../prompt/index.ts";
import type { BuiltPrompt, PromptImage } from "../prompt/index.ts";
import { CAPTION_IMAGE, taskKind } from "../tasks/registry.ts";
import type { TaskRunner } from "../tasks/runner.ts";
import { taskConfig, templateOf } from "../db/queries/tasks.ts";
import { resolveRoute } from "../generation/route.ts";
import type { Keyring } from "../lib/crypto.ts";
import { decryptSecret } from "../lib/crypto.ts";
import {
  defaultService,
  insertAsset,
  setCaption,
  type MediaAssetRow,
  type MediaServiceRow,
} from "../db/queries/media.ts";
import { imageAdapterFor, speechAdapterFor } from "./index.ts";
import { store } from "./store.ts";

/**
 * Making pictures and voices, and reading pictures (SPEC §20 phase 41).
 *
 * Everything here is asked for. Nothing runs on a turn: §8's rule that a
 * background task must never block generation applies with more force to these,
 * because an image is slow and a voice costs money per character. A reader
 * presses a button and waits, which is also why these are awaited rather than
 * fired and forgotten like the extractor.
 */

/** How much prose one image or speech request carries. */
const IMAGE_PROMPT_LIMIT = 1_000;

/**
 * Prose as a service prompt.
 *
 * Markdown emphasis, the speaker labels a beat carries, and out-of-character
 * asides are all formatting rather than content: a picture of "**Mira Vance:**"
 * is a picture of a name. This does not try to write a good image prompt out of
 * a paragraph — that needs a model, and it is deferred. It removes what is
 * certainly noise and leaves the reader a prompt they can edit.
 */
export function proseToPrompt(content: string, limit = IMAGE_PROMPT_LIMIT): string {
  const flat = content
    // §7's asides and OOC lines are the app talking, not the story.
    .replace(/\(\((?:.|\n)*?\)\)/g, " ")
    .replace(/^\s*\*\*[^*\n]{1,60}:\*\*/gm, " ")
    .replace(/[*_`~#>]/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/** The prompt the caption op sends: words plus the picture itself. */
export function buildCaptionPrompt(question: string, image: PromptImage): BuiltPrompt {
  const tokenizer = createEstimatingTokenizer();
  const system = "You describe images plainly and accurately for someone who cannot see them.";
  const tokens = tokenizer.count(system) + tokenizer.count(question);
  return {
    system,
    messages: [{ role: "user", content: question, images: [image] }],
    outlets: {},
    debug: {
      // What every side call uses. The field describes a scene assembly and
      // a side call is not one; the guides, the summariser and the memory
      // runner all say the same thing here.
      mode: "author",
      tokensAreEstimated: tokenizer.isEstimate,
      tokenizerId: tokenizer.id,
      budget: tokens,
      reservedForResponse: 0,
      available: tokens,
      fixedTokens: tokenizer.count(system),
      historyTokens: tokenizer.count(question),
      totalTokens: tokens,
      headroom: 0,
      blocks: [
        {
          id: "system_prompt",
          label: "Describe a picture",
          source: "guided op",
          role: "system",
          content: system,
          placement: { kind: "prefix" },
          tokens: tokenizer.count(system),
        },
        {
          id: "caption",
          label: "Question",
          source: "guided op",
          role: "user",
          // The bytes are deliberately not in the block. The inspector shows
          // what was asked; a base64 payload in a debug panel is a wall of
          // characters that pushes everything readable off the screen.
          content: `${question}\n\n[the attached image]`,
          placement: { kind: "depth", depth: 0 },
          tokens: tokenizer.count(question),
        },
      ],
      evicted: [],
      historyIncluded: [],
      unresolvedOutlets: [],
      unknownMacros: [],
      loreTrace: [],
      retrievedChunks: [],
      memoryTrace: [],
    },
  };
}

export interface MediaRunnerOptions {
  db: Database;
  keyring: Keyring;
  tasks: TaskRunner;
  mediaDir: string;
}

export class MediaRunner {
  private readonly db: Database;
  private readonly keyring: Keyring;
  private readonly tasks: TaskRunner;
  private readonly mediaDir: string;
  private stopped = false;

  constructor(options: MediaRunnerOptions) {
    this.db = options.db;
    this.keyring = options.keyring;
    this.tasks = options.tasks;
    this.mediaDir = options.mediaDir;
  }

  shutdown(): void {
    this.stopped = true;
  }

  private configOf(service: MediaServiceRow) {
    return {
      baseUrl: service.base_url ?? "",
      apiKey:
        service.api_key_encrypted === null
          ? null
          : decryptSecret(this.keyring, service.api_key_encrypted),
      model: service.model,
      options: parseOptions(service.options),
    };
  }

  /** Draw something for a message. Returns the stored asset. */
  async illustrate(input: {
    service: MediaServiceRow;
    prompt: string;
    messageId: number | null;
    characterId: number | null;
    sceneId: number | null;
    signal?: AbortSignal;
  }): Promise<MediaAssetRow> {
    const adapter = imageAdapterFor(input.service.kind, this.configOf(input.service));
    const controller = new AbortController();
    const signal =
      input.signal === undefined
        ? controller.signal
        : AbortSignal.any([input.signal, controller.signal]);
    const result = await adapter.draw({ prompt: input.prompt }, signal);
    const written = await store(this.mediaDir, result.bytes, result.mime);
    return insertAsset(this.db, {
      kind: "image",
      role: "illustration",
      path: written.path,
      mime: result.mime,
      bytes: written.bytes,
      width: result.width ?? null,
      height: result.height ?? null,
      prompt: input.prompt,
      serviceId: input.service.id,
      messageId: input.messageId,
      characterId: input.characterId,
      sceneId: input.sceneId,
    });
  }

  /** Say something aloud. Returns the stored asset. */
  async speak(input: {
    service: MediaServiceRow;
    text: string;
    voice: string | null;
    messageId: number | null;
    sceneId: number | null;
    signal?: AbortSignal;
  }): Promise<MediaAssetRow> {
    const adapter = speechAdapterFor(input.service.kind, this.configOf(input.service));
    const controller = new AbortController();
    const signal =
      input.signal === undefined
        ? controller.signal
        : AbortSignal.any([input.signal, controller.signal]);
    const result = await adapter.speak({ text: input.text, voice: input.voice }, signal);
    const written = await store(this.mediaDir, result.bytes, result.mime);
    return insertAsset(this.db, {
      kind: "audio",
      role: "speech",
      path: written.path,
      mime: result.mime,
      bytes: written.bytes,
      durationMs: result.durationMs ?? null,
      prompt: input.text,
      serviceId: input.service.id,
      messageId: input.messageId,
      sceneId: input.sceneId,
    });
  }

  /**
   * Read a picture, and store what it says on the asset.
   *
   * Runs on an ordinary connection profile rather than a media service: a
   * caption comes from a language model that can see, which is a provider this
   * app already knows how to reach.
   */
  async caption(
    asset: MediaAssetRow,
    base64: string,
    fallbackProfileId: number | null,
  ): Promise<string | null> {
    if (this.stopped) return null;
    const op = taskKind(CAPTION_IMAGE);
    if (op === null) return null;
    const row = taskConfig(this.db, op);
    if (row.enabled !== 1) return null;

    // Checked before the call rather than after: a text-completion endpoint has
    // nowhere to put an image, and sending one would produce a confident
    // description of nothing.
    const profileId = row.connection_profile_id ?? fallbackProfileId;
    const route = resolveRoute(this.db, this.keyring, { profileId });
    if (route.kind === "text_completion") {
      throw new VisionUnsupported(
        `${route.providerName} is a text-completion endpoint, which cannot be shown a picture. Point "Describe a picture" at a vision model in Settings.`,
      );
    }

    const question = (templateOf(row, op) || defaultTemplateOf(CAPTION_IMAGE)).trim();
    const outcome = await this.tasks.run({
      kind: op,
      sceneId: asset.scene_id,
      fallbackProfileId,
      prompt: buildCaptionPrompt(question, { mime: asset.mime, base64 }),
    });
    if (this.stopped || !outcome.ok) return null;
    const caption = outcome.text.trim();
    if (caption === "") return null;
    setCaption(this.db, asset.id, caption);
    return caption;
  }

  /** The service a purpose will use, or null when none is configured. */
  serviceFor(purpose: "image" | "speech"): MediaServiceRow | null {
    return defaultService(this.db, purpose);
  }
}

/** Raised when the chosen profile cannot be shown a picture at all. */
export class VisionUnsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionUnsupported";
  }
}

function parseOptions(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
