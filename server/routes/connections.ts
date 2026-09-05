import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/session.ts";
import {
  countConnectionProfiles,
  createPreset,
  createPresetBlock,
  deletePresetBlock,
  parsePromptOrder,
  updatePresetBlock,
  deleteConnectionProfile,
  deletePreset,
  deleteProvider,
  findConnectionProfileByUlid,
  findPresetByUlid,
  findProviderById,
  findProviderByUlid,
  insertConnectionProfile,
  insertProvider,
  listConnectionProfiles,
  listPresets,
  setDefaultPreset,
  listProviders,
  toConnectionProfileDto,
  toPresetDto,
  toProviderDto,
  ulidLookup,
  updateConnectionProfile,
  updatePreset,
  updateProvider,
  type PresetPatch,
  type PresetRow,
} from "../db/queries/connections.ts";
import { parseReasoningConfig } from "../generation/reasoning.ts";
import { customBlockId, isInjectionRole, type PromptOrderEntry } from "../../shared/types.ts";
import { fetchProviderModels } from "../adapters/models.ts";
import { parseStPreset, StPresetError } from "../presets/st.ts";
import { importStPreset } from "../presets/import.ts";
import {
  allTemplates,
  deleteCustomTemplate,
  findCustomTemplate,
  insertCustomTemplate,
  updateCustomTemplate,
} from "../db/queries/instruct.ts";
import {
  findInstructTemplate,
  parseInstructTemplate,
  type InstructTemplate,
} from "../prompt/instruct.ts";
import { encryptSecret, decryptSecret, maskSecret } from "../lib/crypto.ts";
import {
  PROVIDER_KINDS,
  samplerProblem,
  type ProviderKind,
  type SamplerSettings,
} from "../../shared/types.ts";

/**
 * Providers and connection profiles (SPEC §20 phase 13).
 *
 * A profile is provider + model + preset under a name, and the reason it is an
 * entity rather than three fields on a scene is per-operation routing (§7):
 * bookkeeping goes to a cheap local model, prose to an expensive one, and both
 * are one tap to switch. Until this phase you could only use the profile the
 * setup wizard made, which made the routing that exists unreachable.
 */
export function connectionRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth());

  app.get("/providers", (c) =>
    c.json(listProviders(ctx.db).map((row) => toProviderDto(row, ctx.keyring))),
  );

  /** The data bank's embeddings provider — its own config, not a generation
   * provider (§11, phase 30). Nulls mean the lexical fallback is in force. */
  app.get("/embeddings", (c) => {
    const row = ctx.db.query("SELECT * FROM embeddings_config WHERE id = 1").get() as
      | { base_url: string | null; model: string | null; api_key_encrypted: string | null }
      | null;
    return c.json({
      baseUrl: row?.base_url ?? null,
      model: row?.model ?? null,
      hasApiKey: (row?.api_key_encrypted ?? null) !== null,
      apiKeyMask:
        row?.api_key_encrypted == null
          ? null
          : maskSecret(decryptSecret(ctx.keyring, row.api_key_encrypted)),
    });
  });

  app.put("/embeddings", async (c) => {
    const body = await readJson(c);
    if (body === null) return c.json(badRequest("Expected a JSON body."), 400);
    const baseUrl = text(body["baseUrl"], 500);
    const model = text(body["model"], 200);
    const apiKey = text(body["apiKey"], 400);
    const existing = ctx.db.query("SELECT api_key_encrypted FROM embeddings_config WHERE id = 1").get() as
      | { api_key_encrypted: string | null }
      | null;
    const storedKey =
      apiKey === null || apiKey === ""
        ? (existing?.api_key_encrypted ?? null)
        : encryptSecret(ctx.keyring, apiKey);
    ctx.db
      .query(
        `INSERT INTO embeddings_config (id, base_url, model, api_key_encrypted, updated_at)
         VALUES (1, $base, $model, $key, $now)
         ON CONFLICT (id) DO UPDATE SET
           base_url = $base, model = $model, api_key_encrypted = $key, updated_at = $now`,
      )
      .run({ base: baseUrl, model, key: storedKey, now: Date.now() });
    return c.json({
      baseUrl,
      model,
      hasApiKey: storedKey !== null,
      apiKeyMask: storedKey === null ? null : maskSecret(decryptSecret(ctx.keyring, storedKey)),
    });
  });

  app.get("/presets", (c) => c.json(listPresets(ctx.db).map((row) => toPresetDto(ctx.db, row))));

  /**
   * A new preset on the shipped defaults (§20 phase 54).
   *
   * There was no way to make one: presets could be imported, edited and
   * exported, and the only one that ever ran was the row setup wrote.
   */
  app.post("/presets", async (c) => {
    const body = (await readJson(c)) ?? {};
    const name = text((body as Record<string, unknown>)["name"], 120) ?? "New preset";
    return c.json(toPresetDto(ctx.db, createPreset(ctx.db, name)), 201);
  });

  /**
   * Remove one. `profiles.preset_id` and `scenes.preset_id` are both
   * `ON DELETE SET NULL`, so anything pointing here falls back to the default
   * preset rather than breaking — which the confirmation says out loud.
   */
  app.delete("/presets/:id", (c) => {
    const row = findPresetByUlid(ctx.db, c.req.param("id"));
    if (row === null) return c.json(notFound("preset"), 404);
    if (row.is_default === 1) {
      return c.json(badRequest("The default preset is what runs when nothing else is chosen."), 400);
    }
    deletePreset(ctx.db, row.id);
    return c.body(null, 204);
  });

  /**
   * Import a SillyTavern chat-completion preset (SPEC §18, phase 28). The
   * parser is pure and the report is the product: what mapped, what did not,
   * and why — a silent partial import is the worst outcome §18 names.
   */
  app.post("/presets/import", async (c) => {
    let file: File | null = null;
    try {
      const form = await c.req.formData();
      const candidate = form.get("file");
      if (candidate instanceof File) file = candidate;
    } catch {
      return c.json(badRequest("Expected a file upload."), 400);
    }
    if (file === null) return c.json(badRequest("No file was uploaded."), 400);
    if (file.size > 4 * 1024 * 1024) return c.json(badRequest("That preset is too large."), 413);

    const bytes = new Uint8Array(await file.arrayBuffer());
    let parsed;
    try {
      parsed = parseStPreset(bytes, file.name);
    } catch (caught) {
      if (caught instanceof StPresetError) return c.json(badRequest(caught.message), 400);
      throw caught;
    }

    // §18: a text-completion preset has no prompt blocks, and its context and
    // instruct templates mean nothing here. Refuse the mismatch clearly.
    if (parsed.detected === "text_completion") {
      return c.json(
        {
          error: {
            code: "wrong_kind",
            message:
              "That is a text-completion preset. This app imports chat-completion presets.",
          },
        },
        400,
      );
    }

    const report = importStPreset(ctx.db, parsed);
    return c.json(report, 201);
  });

  /**
   * Export a preset. The app's own format is the preset row as it is stored;
   * the SillyTavern format is lossy and says so — samplers map back, but the
   * prompt blocks live in option groups now, not in the preset, and pretending
   * the round trip is clean would be exactly what §18 forbids.
   */
  app.get("/presets/:id/export", (c) => {
    const row = findPresetByUlid(ctx.db, c.req.param("id"));
    if (row === null) return c.json(notFound("preset"), 404);

    const format = c.req.query("format") ?? "onsen";
    if (format === "sillytavern") {
      const samplers = JSON.parse(row.sampler_settings) as Record<string, unknown>;
      const body = {
        name: row.name,
        temperature: samplers["temperature"] ?? 1,
        top_p: samplers["top_p"] ?? 1,
        top_k: samplers["top_k"] ?? 0,
        min_p: samplers["min_p"] ?? 0,
        repetition_penalty: samplers["repetition_penalty"] ?? 1,
        dry_multiplier: samplers["dry_multiplier"] ?? 0,
        dry_base: samplers["dry_base"] ?? 0,
        dry_allowed_length: samplers["dry_allowed_length"] ?? 2,
        dry_sequence_breakers: samplers["dry_sequence_breakers"] ?? [],
        xtc_threshold: samplers["xtc_threshold"] ?? 0,
        xtc_probability: samplers["xtc_probability"] ?? 0,
        max_context: row.context_size,
        max_length: row.max_response_tokens,
        prompts: [],
        // The honest part of a lossy export: what the app could not carry back.
        _onsen_lossy: {
          note: "Prompt blocks were imported as option-group members and do not live on this preset. Samplers round-trip; blocks do not.",
          system_prompt: row.system_prompt,
          jailbreak: row.jailbreak,
          prefill: row.prefill,
        },
      };
      return c.json(body);
    }

    return c.json({
      name: row.name,
      samplerSettings: JSON.parse(row.sampler_settings) as unknown,
      contextSize: row.context_size,
      maxResponseTokens: row.max_response_tokens,
      prefill: row.prefill,
      systemPrompt: row.system_prompt,
      jailbreak: row.jailbreak,
      reasoningConfig: row.reasoning_config,
    });
  });

  /**
   * Edit a preset: samplers, the context budget, the prefill, and how reasoning
   * is handled (SPEC §13).
   *
   * The modern defaults have shipped since phase 1 but have never been
   * reachable, which is most of the way to not having them — a default nobody
   * can see is indistinguishable from a hardcoded constant.
   */
  app.patch("/presets/:id", async (c) => {
    const row = findPresetByUlid(ctx.db, c.req.param("id"));
    if (row === null) return c.json(notFound("preset"), 404);

    const body = await readJson(c);
    if (body === null) return c.json(badRequest("Expected a JSON body."), 400);

    const patch: PresetPatch = {};
    const name = text(body["name"], 120);
    if (name !== null) patch.name = name;

    // The flag that decides which preset runs when a scene and its profile
    // both name none. Written once at setup until phase 54, which meant an
    // imported preset could never be the one in force.
    if (body["isDefault"] === true) setDefaultPreset(ctx.db, row.id);

    if ("samplerSettings" in body) {
      // Validated with the same function the editor uses, so a value the form
      // accepts is never one the server refuses.
      const problem = samplerProblem(body["samplerSettings"]);
      if (problem !== null) return c.json(badRequest(problem), 400);
      patch.samplerSettings = body["samplerSettings"] as SamplerSettings;
    }

    for (const [field, min, max] of [
      ["contextSize", 512, 2_000_000],
      ["maxResponseTokens", 16, 32_768],
    ] as const) {
      if (!(field in body)) continue;
      const value = body[field];
      if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        const said = `${field} must be a whole number between ${min} and ${max}.`;
        return c.json(badRequest(said), 400);
      }
      if (field === "contextSize") patch.contextSize = value;
      else patch.maxResponseTokens = value;
    }

    if ("prefill" in body) patch.prefill = text(body["prefill"], 2_000);

    if ("reasoning" in body) {
      const value = body["reasoning"];
      if (typeof value !== "object" || value === null) {
        return c.json(badRequest("reasoning must be an object."), 400);
      }
      // Merged onto what is stored rather than replacing it, so a client that
      // sends one field does not silently reset the other three. The parser
      // clamps and defaults, so anything unusable becomes the safe value.
      const merged = { ...parseReasoningConfig(row.reasoning_config), ...value };
      patch.reasoningConfig = JSON.stringify(parseReasoningConfig(JSON.stringify(merged)));
    }

    /*
     * The assembly order (§3, §20 phase 56).
     *
     * Sent whole rather than as a move, so two clients cannot interleave half
     * an order between them. Unknown ids are kept rather than dropped: an order
     * saved by a newer build must survive a downgrade, and the builder already
     * ignores an id it drafted nothing under.
     */
    if ("blockOrder" in body) {
      const value = body["blockOrder"];
      if (value === null) patch.promptOrder = null;
      else if (!Array.isArray(value)) {
        return c.json(badRequest("blockOrder must be a list, or null for the default."), 400);
      } else {
        const entries: PromptOrderEntry[] = [];
        const seen = new Set<string>();
        for (const raw of value) {
          if (typeof raw !== "object" || raw === null) continue;
          const entry = raw as Record<string, unknown>;
          const id = entry["id"];
          // A duplicated id would assemble the same block twice.
          if (typeof id !== "string" || id === "" || seen.has(id)) continue;
          seen.add(id);
          entries.push({ id, enabled: entry["enabled"] !== false });
        }
        patch.promptOrder = entries.length === 0 ? null : JSON.stringify(entries);
      }
    }

    return c.json(toPresetDto(ctx.db, updatePreset(ctx.db, row.id, patch)));
  });

  /* ---------------- a preset's own blocks (§20 phase 56) ---------------- */

  /** The preset named in the path, or null with the 404 already written. */
  function presetOf(c: { req: { param(name: string): string } }) {
    return findPresetByUlid(ctx.db, c.req.param("presetId"));
  }

  app.post("/presets/:presetId/blocks", async (c) => {
    const row = presetOf(c);
    if (row === null) return c.json(notFound("preset"), 404);
    const body = (await readJson(c)) ?? {};
    const role = body["role"];
    const id = createPresetBlock(ctx.db, row.id, {
      label: text(body["label"], 120) ?? "New block",
      role: isInjectionRole(role) ? role : "system",
      content: text(body["content"], 20_000) ?? "",
    });
    // New blocks join the order at the end of the prefix rather than nowhere:
    // a block that exists and is in no order is invisible, which is the defect
    // this whole phase is about.
    const order = parsePromptOrder(row.prompt_order);
    if (order !== null) {
      const at = order.findIndex((entry) => entry.id === "history");
      const entry: PromptOrderEntry = { id: customBlockId(id), enabled: true };
      order.splice(at === -1 ? order.length : at, 0, entry);
      updatePreset(ctx.db, row.id, { promptOrder: JSON.stringify(order) });
    }
    return c.json(toPresetDto(ctx.db, findPresetByUlid(ctx.db, row.ulid) as PresetRow), 201);
  });

  app.patch("/presets/:presetId/blocks/:blockId", async (c) => {
    const row = presetOf(c);
    if (row === null) return c.json(notFound("preset"), 404);
    const body = (await readJson(c)) ?? {};
    const patch: Parameters<typeof updatePresetBlock>[3] = {};
    const label = text(body["label"], 120);
    if (label !== null) patch.label = label;
    if (isInjectionRole(body["role"])) patch.role = body["role"];
    if (typeof body["content"] === "string") patch.content = body["content"].slice(0, 20_000);
    if (typeof body["enabled"] === "boolean") patch.enabled = body["enabled"];
    if (!updatePresetBlock(ctx.db, row.id, c.req.param("blockId"), patch)) {
      return c.json(notFound("block"), 404);
    }
    return c.json(toPresetDto(ctx.db, findPresetByUlid(ctx.db, row.ulid) as PresetRow));
  });

  app.delete("/presets/:presetId/blocks/:blockId", (c) => {
    const row = presetOf(c);
    if (row === null) return c.json(notFound("preset"), 404);
    const blockUlid = c.req.param("blockId");
    if (!deletePresetBlock(ctx.db, row.id, blockUlid)) return c.json(notFound("block"), 404);
    // And out of the order with it, so nothing points at a block that is gone.
    const order = parsePromptOrder(row.prompt_order);
    if (order !== null) {
      const kept = order.filter((entry) => entry.id !== customBlockId(blockUlid));
      updatePreset(ctx.db, row.id, {
        promptOrder: kept.length === 0 ? null : JSON.stringify(kept),
      });
    }
    return c.json(toPresetDto(ctx.db, findPresetByUlid(ctx.db, row.ulid) as PresetRow));
  });

  app.get("/profiles", (c) => {
    const providers = ulidLookup(ctx.db, "providers");
    const presets = ulidLookup(ctx.db, "presets");
    return c.json(
      listConnectionProfiles(ctx.db).map((row) =>
        toConnectionProfileDto(
          row,
          providers.get(row.provider_id) ?? "",
          row.preset_id === null ? null : (presets.get(row.preset_id) ?? null),
        ),
      ),
    );
  });

  /* -------------------------------------------------------------- */
  /* Providers                                                       */
  /* -------------------------------------------------------------- */

  function providerDtos() {
    return listProviders(ctx.db).map((row) => toProviderDto(row, ctx.keyring));
  }

  app.post("/providers", async (c) => {
    const body = await readJson(c);
    if (body === null) return c.json(badRequest("Expected a JSON body."), 400);

    const name = text(body["name"], 120);
    if (name === null) return c.json(badRequest("A provider needs a name."), 400);
    const kind = body["kind"];
    if (!(PROVIDER_KINDS as readonly unknown[]).includes(kind)) {
      return c.json(badRequest("Unknown provider kind."), 400);
    }

    const apiKey = text(body["apiKey"], 400);
    const row = insertProvider(ctx.db, {
      name,
      kind: kind as ProviderKind,
      baseUrl: text(body["baseUrl"], 500),
      // Encrypted here and never read back: the client only ever sees a mask.
      apiKeyEncrypted: apiKey === null ? null : encryptSecret(ctx.keyring, apiKey),
      model: text(body["model"], 200),
    });
    return c.json(toProviderDto(row, ctx.keyring), 201);
  });

  app.patch("/providers/:id", async (c) => {
    const row = findProviderByUlid(ctx.db, c.req.param("id"));
    if (row === null) return c.json(notFound("provider"), 404);

    const body = await readJson(c);
    if (body === null) return c.json(badRequest("Expected a JSON body."), 400);

    const patch: Parameters<typeof updateProvider>[2] = {};
    const name = text(body["name"], 120);
    if (name !== null) patch.name = name;
    if ("baseUrl" in body) patch.baseUrl = text(body["baseUrl"], 500);
    if ("model" in body) patch.model = text(body["model"], 200);
    if ("enabled" in body) {
      if (typeof body["enabled"] !== "boolean") {
        return c.json(badRequest("enabled must be a boolean."), 400);
      }
      patch.enabled = body["enabled"];
    }
    // Whether this endpoint takes a prefill (§13). Three-valued on purpose:
    // null is "use whatever the adapter says", which is not the same as "no".
    if ("supportsPrefill" in body) {
      const value = body["supportsPrefill"];
      if (value !== null && typeof value !== "boolean") {
        return c.json(badRequest("supportsPrefill must be a boolean, or null."), 400);
      }
      patch.supportsPrefill = value;
    }
    // Which instruct template marks this model's turns (§4). Null restores the
    // shipped default; an unknown id is refused rather than silently ignored,
    // because a template that does not exist renders as the plain transcript
    // and the prose just quietly gets worse.
    if ("instructTemplate" in body) {
      const value = body["instructTemplate"];
      if (value === null) {
        patch.instructTemplate = null;
      } else if (typeof value !== "string") {
        return c.json(badRequest("instructTemplate must be a template id, or null."), 400);
      } else if (
        findInstructTemplate(value) === null &&
        findCustomTemplate(ctx.db, value) === null
      ) {
        return c.json(badRequest("No such instruct template."), 400);
      } else {
        patch.instructTemplate = value;
      }
    }

    // Absent leaves the key alone; null clears it; a string replaces it. A form
    // that came back empty must not delete a credential nobody touched.
    if ("apiKey" in body) {
      const key = text(body["apiKey"], 400);
      patch.apiKeyEncrypted = key === null ? null : encryptSecret(ctx.keyring, key);
    }

    return c.json(toProviderDto(updateProvider(ctx.db, row.id, patch), ctx.keyring));
  });

  /**
   * Pull a provider's model list from its own API, so the reader picks from
   * what the endpoint actually serves rather than typing a model string
   * (§16). The key comes from the form — this is the one case where it crosses
   * to the server transiently, and it is never stored, only used for the call.
   */
  app.post("/providers/models", async (c) => {
    const body = await readJson(c);
    if (body === null) return c.json(badRequest("Expected a JSON body."), 400);
    const baseUrl = text(body["baseUrl"], 500);
    if (baseUrl === null) return c.json(badRequest("A provider address is required."), 400);

    // The form's key wins; a stored one stands in for an existing provider.
    let apiKey = text(body["apiKey"], 400);
    if ((apiKey === null || apiKey === "") && typeof body["providerId"] === "string") {
      const row = findProviderByUlid(ctx.db, body["providerId"]);
      apiKey =
        row?.api_key_encrypted == null ? null : decryptSecret(ctx.keyring, row.api_key_encrypted);
    }

    // The kind was accepted and dropped on the floor until phase 49, which is
    // why an Anthropic provider could never list its models.
    const kind = text(body["kind"], 40);
    const models = await fetchProviderModels({
      baseUrl,
      apiKey,
      ...(kind === null || kind === "" ? {} : { kind }),
    });
    if (models === null) {
      return c.json(
        { error: { code: "unreachable", message: "No models endpoint answered. Check the address." } },
        502,
      );
    }
    return c.json({ models });
  });

  /**
   * The §16 test button: one tiny round trip to the endpoint, so a bad key or
   * a mistyped host reads as a timed call, not a failed first generation.
   */
  app.post("/providers/:id/test", async (c) => {
    const row = findProviderByUlid(ctx.db, c.req.param("id"));
    if (row === null) return c.json(notFound("provider"), 404);
    if (row.base_url === null) {
      return c.json(badRequest("This provider has no address to test."), 400);
    }

    const baseUrl = row.base_url.replace(/\/+$/, "");
    const apiKey =
      row.api_key_encrypted === null ? null : decryptSecret(ctx.keyring, row.api_key_encrypted);
    const headers = {
      "Content-Type": "application/json",
      ...(apiKey === null ? {} : { Authorization: `Bearer ${apiKey}` }),
    };

    // One token is the whole test: the request shape is the provider's own.
    let body: string;
    let path = "/chat/completions";
    switch (row.kind) {
      case "openai_compatible":
        body = JSON.stringify({
          model: row.model ?? "",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        });
        break;
      case "text_completion":
        path = "/completions";
        body = JSON.stringify({ prompt: "ping", max_tokens: 1 });
        break;
      case "anthropic":
        path = "/messages";
        body = JSON.stringify({
          model: row.model ?? "",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        });
        break;
    }

    const started = Date.now();
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 200);
        return c.json({ ok: false, latencyMs: Date.now() - started, detail: `HTTP ${response.status}: ${detail}` });
      }
      return c.json({ ok: true, latencyMs: Date.now() - started, detail: null });
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "Unreachable.";
      return c.json({ ok: false, latencyMs: Date.now() - started, detail });
    }
  });

  app.delete("/providers/:id", (c) => {
    const row = findProviderByUlid(ctx.db, c.req.param("id"));
    if (row === null) return c.json(notFound("provider"), 404);
    if (listProviders(ctx.db).length === 1) {
      return c.json(
        badRequest("This is the only provider. Add another before removing it."),
        400,
      );
    }
    deleteProvider(ctx.db, row.id);
    return c.json(providerDtos());
  });

  /* -------------------------------------------------------------- */
  /* Connection profiles                                             */
  /* -------------------------------------------------------------- */

  function profileDto(row: { id: number; provider_id: number; preset_id: number | null }) {
    const providers = ulidLookup(ctx.db, "providers");
    const presets = ulidLookup(ctx.db, "presets");
    const full = listConnectionProfiles(ctx.db).find((profile) => profile.id === row.id)!;
    return toConnectionProfileDto(
      full,
      providers.get(full.provider_id) ?? "",
      full.preset_id === null ? null : (presets.get(full.preset_id) ?? null),
    );
  }

  app.post("/profiles", async (c) => {
    const body = await readJson(c);
    if (body === null) return c.json(badRequest("Expected a JSON body."), 400);

    const name = text(body["name"], 120);
    if (name === null) return c.json(badRequest("A profile needs a name."), 400);
    const providerUlid = text(body["providerId"], 40);
    const provider = providerUlid === null ? null : findProviderByUlid(ctx.db, providerUlid);
    if (provider === null) return c.json(badRequest("No such provider."), 400);

    const preset = presetRef(body["presetId"]);
    if (preset === INVALID) return c.json(badRequest("No such preset."), 400);

    const row = insertConnectionProfile(ctx.db, {
      name,
      providerId: provider.id,
      model: text(body["model"], 200),
      presetId: preset,
      isDefault: body["isDefault"] === true,
    });
    return c.json(profileDto(row), 201);
  });

  app.patch("/profiles/:id", async (c) => {
    const row = findConnectionProfileByUlid(ctx.db, c.req.param("id"));
    if (row === null) return c.json(notFound("connection profile"), 404);

    const body = await readJson(c);
    if (body === null) return c.json(badRequest("Expected a JSON body."), 400);

    const patch: Parameters<typeof updateConnectionProfile>[2] = {};
    const name = text(body["name"], 120);
    if (name !== null) patch.name = name;
    if ("model" in body) patch.model = text(body["model"], 200);
    if ("isDefault" in body) {
      if (typeof body["isDefault"] !== "boolean") {
        return c.json(badRequest("isDefault must be a boolean."), 400);
      }
      patch.isDefault = body["isDefault"];
    }
    if ("providerId" in body) {
      const providerUlid = text(body["providerId"], 40);
      const provider = providerUlid === null ? null : findProviderByUlid(ctx.db, providerUlid);
      if (provider === null) return c.json(badRequest("No such provider."), 400);
      patch.providerId = provider.id;
    }
    if ("presetId" in body) {
      const preset = presetRef(body["presetId"]);
      if (preset === INVALID) return c.json(badRequest("No such preset."), 400);
      patch.presetId = preset;
    }

    return c.json(profileDto(updateConnectionProfile(ctx.db, row.id, patch)));
  });

  app.delete("/profiles/:id", (c) => {
    const row = findConnectionProfileByUlid(ctx.db, c.req.param("id"));
    if (row === null) return c.json(notFound("connection profile"), 404);
    // Scenes pointing at a deleted profile survive with a null and say they
    // have no connection; a roleplay with nowhere at all to generate is worse.
    if (countConnectionProfiles(ctx.db) === 1) {
      return c.json(badRequest("This is the only profile. Add another before removing it."), 400);
    }
    deleteConnectionProfile(ctx.db, row.id);
    const providers = ulidLookup(ctx.db, "providers");
    const presets = ulidLookup(ctx.db, "presets");
    return c.json(
      listConnectionProfiles(ctx.db).map((profile) =>
        toConnectionProfileDto(
          profile,
          providers.get(profile.provider_id) ?? "",
          profile.preset_id === null ? null : (presets.get(profile.preset_id) ?? null),
        ),
      ),
    );
  });

  /* -------------------------------------------------------------- */
  /* Small helpers                                                   */
  /* -------------------------------------------------------------- */

  const INVALID = Symbol("invalid");

  /** A preset reference: absent, cleared, or one that exists. */
  function presetRef(value: unknown): number | null | typeof INVALID {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") return INVALID;
    const row = ctx.db.query("SELECT id FROM presets WHERE ulid = $ulid").get({ ulid: value }) as
      | { id: number }
      | null;
    return row === null ? INVALID : row.id;
  }

  /* -------------------------------------------------------------- */
  /* Instruct templates (SPEC §4)                                     */
  /* -------------------------------------------------------------- */

  /**
   * The shipped six plus whatever the user has written.
   *
   * One list rather than two, because the choice a user is making is "how are
   * this model's turns marked" and where the answer came from is not part of
   * that question. `builtIn` is on each row for the editor, which may not offer
   * to edit a shipped one.
   */
  app.get("/instruct-templates", (c) =>
    c.json(
      allTemplates(ctx.db).map((template) => ({
        ...template,
        builtIn: findInstructTemplate(template.id) !== null,
      })),
    ),
  );

  app.post("/instruct-templates", async (c) => {
    const body = await readJson(c);
    if (body === null) return c.json(badRequest("Expected a JSON body."), 400);
    const name = text(body["name"], 80);
    if (name === null) return c.json(badRequest("A template needs a name."), 400);

    // Starting from a copy is the common case: a new format is almost always
    // an existing one with different markers, and an empty eight-field form is
    // a worse starting point than ChatML.
    const source = text(body["copyFrom"], 60);
    const base: InstructTemplate | null =
      source === null
        ? null
        : (findInstructTemplate(source) ??
          (() => {
            const row = findCustomTemplate(ctx.db, source);
            return row === null ? null : parseInstructTemplate(JSON.parse(row.body), source);
          })());

    const template = parseInstructTemplate({ ...(base ?? {}), ...body, name }, "pending");
    if (template === null) return c.json(badRequest("That is not a template."), 400);
    const row = insertCustomTemplate(ctx.db, { name, template });
    return c.json({ ...toTemplateDto(row.template_id, row.name, row.body) }, 201);
  });

  app.patch("/instruct-templates/:id", async (c) => {
    const id = c.req.param("id");
    // A shipped template is not editable: correcting a format for everyone is a
    // release, not a setting, and a user who edited ChatML in place would
    // silently change every provider using it.
    if (findInstructTemplate(id) !== null) {
      return c.json(badRequest("A built-in template cannot be edited. Copy it first."), 400);
    }
    const row = findCustomTemplate(ctx.db, id);
    if (row === null) return c.json(notFound("instruct template"), 404);

    const body = await readJson(c);
    if (body === null) return c.json(badRequest("Expected a JSON body."), 400);
    const name = text(body["name"], 80) ?? row.name;
    const template = parseInstructTemplate(
      { ...(JSON.parse(row.body) as Record<string, unknown>), ...body, name },
      row.template_id,
    );
    if (template === null) return c.json(badRequest("That is not a template."), 400);
    const updated = updateCustomTemplate(ctx.db, row.id, { name, template });
    return c.json(toTemplateDto(updated.template_id, updated.name, updated.body));
  });

  app.delete("/instruct-templates/:id", (c) => {
    const id = c.req.param("id");
    if (findInstructTemplate(id) !== null) {
      return c.json(badRequest("A built-in template cannot be deleted."), 400);
    }
    const row = findCustomTemplate(ctx.db, id);
    if (row === null) return c.json(notFound("instruct template"), 404);
    deleteCustomTemplate(ctx.db, row.id);
    return c.json({ ok: true });
  });

  return app;
}

function badRequest(message: string) {
  return { error: { code: "bad_request", message } } as const;
}

function notFound(what: string) {
  return { error: { code: "not_found", message: `No such ${what}.` } } as const;
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<
  Record<string, unknown> | null
> {
  try {
    const parsed: unknown = await c.req.json();
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** A stored template row as the wire shape, without re-deriving it twice. */
function toTemplateDto(templateId: string, name: string, body: string) {
  const parsed = parseInstructTemplate(JSON.parse(body) as unknown, templateId);
  return { ...(parsed ?? { id: templateId, name }), name, builtIn: false };
}

/** A trimmed string, or null for absent, empty, or the wrong type. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
}
