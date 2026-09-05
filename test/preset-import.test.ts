import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import { parseStPreset } from "../server/presets/st.ts";

/**
 * SillyTavern preset import (SPEC §18, §20 phase 28).
 *
 * The parser's decisions are read directly where the format is hostile — a
 * marker, a disabled block, a macro nobody implements — and then read again
 * through the import route as a user would see them.
 */

let harness: TestHarness | null = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

async function signedIn(): Promise<TestHarness> {
  harness = createHarness();
  await completeSetup(harness);
  return harness;
}

async function importPreset(t: TestHarness, json: unknown): Promise<{ status: number; body: unknown }> {
  const form = new FormData();
  form.append("file", new File([JSON.stringify(json) as unknown as BlobPart], "preset.json"));
  const response = await t.fetch("/api/connections/presets/import", { method: "POST", body: form });
  return { status: response.status, body: await response.json() };
}

const CHAT_PRESET = {
  name: "Ridge Suite",
  temperature: 1.2,
  top_p: 0.9,
  top_k: 40,
  min_p: 0.05,
  repetition_penalty: 1.1,
  top_a: 0.15,
  max_context: 16_384,
  max_length: 512,
  prompts: [
    {
      identifier: "main",
      name: "Main",
      role: "system",
      content: "You are the author of a story.",
      marker: true,
      enabled: true,
      injection_position: 0,
      injection_depth: 4,
    },
    {
      identifier: "charDescription",
      name: "Character",
      role: "system",
      content: "",
      marker: true,
      enabled: true,
      injection_position: 1,
      injection_depth: 0,
    },
    {
      identifier: "pov",
      name: "Point of view",
      role: "system",
      content: "Write in third person. {{setvar::mood}}",
      enabled: true,
      injection_position: 1,
      injection_depth: 1,
    },
    {
      identifier: "length",
      name: "Length",
      role: "user",
      content: "Keep the reply short.",
      enabled: false,
      injection_position: 0,
      injection_depth: 0,
    },
  ],
};

describe("the preset parser (pure)", () => {
  test("reads samplers, blocks, markers and macros", () => {
    const parsed = parseStPreset(JSON.stringify(CHAT_PRESET), "ridge.json");
    expect(parsed.detected).toBe("chat_completion");
    expect(parsed.samplers.temperature).toBe(1.2);
    expect(parsed.samplers.top_k).toBe(40);
    expect(parsed.samplers.dry_multiplier).toBeUndefined();
    expect(parsed.unmappedSamplers).toContain("top_a");
    expect(parsed.contextSize).toBe(16_384);
    expect(parsed.maxResponseTokens).toBe(512);

    // Two content blocks; the markers left the content list.
    expect(parsed.blocks.map((block) => block.identifier)).toEqual(["pov", "length"]);
    expect(parsed.blocks[0]!.atDepth).toBe(true);
    expect(parsed.blocks[0]!.depth).toBe(1);
    expect(parsed.blocks[1]!.enabled).toBe(false);

    expect(parsed.markers.map((marker) => marker.identifier)).toEqual([
      "main",
      "charDescription",
    ]);
    expect(parsed.unsupportedMacros).toContain("setvar");
  });

  test("detects a text-completion preset", () => {
    const parsed = parseStPreset(
      JSON.stringify({ name: "Text", temperature: 1, prompt_order: [], context_template: {} }),
      "text.json",
    );
    expect(parsed.detected).toBe("text_completion");
  });

  test("rejects a non-JSON file", () => {
    expect(() => parseStPreset("not json", "x.json")).toThrow();
  });
});

describe("preset import (SPEC §18)", () => {
  test("creates a preset, its blocks, and reports the loss", async () => {
    const t = await signedIn();
    const { status, body } = await importPreset(t, CHAT_PRESET);
    expect(status).toBe(201);
    const report = body as {
      presetId: string;
      blocksImported: number;
      blocksDisabled: number;
      markersOverridden: string[];
      markersRecognised: string[];
      unmappedSamplers: string[];
      unsupportedMacros: string[];
    };
    expect(report.presetId).toBeTruthy();
    expect(report.blocksImported).toBe(2);
    expect(report.blocksDisabled).toBe(1);
    expect(report.markersOverridden).toEqual(["main"]);
    expect(report.markersRecognised).toEqual(["charDescription"]);
    expect(report.unmappedSamplers).toContain("top_a");
    expect(report.unsupportedMacros).toContain("setvar");

    // The preset carried the samplers and the main marker's content.
    const presets = (await (await t.fetch("/api/connections/presets")).json()) as {
      id: string;
      name: string;
      samplerSettings: { temperature: number };
      blocks: { enabled: boolean }[];
      blockOrder: { id: string }[] | null;
    }[];
    const imported = presets.find((preset) => preset.id === report.presetId);
    expect(imported?.name).toBe("Ridge Suite");
    expect(imported?.samplerSettings.temperature).toBe(1.2);

    // §20 phase 56: the source's prompts are this preset's own blocks, in the
    // order the file gave and carrying its enabled flags — not a menu of
    // options nobody switched on.
    expect(imported?.blocks).toHaveLength(2);
    expect(imported?.blocks.filter((block) => !block.enabled)).toHaveLength(1);
    expect(imported?.blockOrder?.some((entry) => entry.id.startsWith("custom:"))).toBe(true);
  });

  test("refuses a text-completion preset clearly", async () => {
    const t = await signedIn();
    const { status, body } = await importPreset(t, {
      name: "Text",
      prompt_order: [],
      context_template: {},
    });
    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("wrong_kind");
  });

  test("refuses a non-JSON upload", async () => {
    const t = await signedIn();
    const form = new FormData();
    form.append("file", new File(["garbage" as unknown as BlobPart], "preset.json"));
    const response = await t.fetch("/api/connections/presets/import", { method: "POST", body: form });
    expect(response.status).toBe(400);
  });
});
