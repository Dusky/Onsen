import type { Database } from "bun:sqlite";
import { ulid } from "../lib/ulid.ts";
import { insertPreset } from "../db/queries/connections.ts";
import { DEFAULT_BLOCK_ORDER } from "../prompt/types.ts";
import { customBlockId, type PromptOrderEntry } from "../../shared/types.ts";
import type { StPresetParse } from "./st.ts";

/**
 * Turning a parsed SillyTavern preset into rows (SPEC §18, §20 phase 28).
 *
 * Two things are created: a sampler preset, and one option group holding the
 * prompt blocks. The markers are split three ways — `main` and `jailbreak`
 * land on the preset's own override columns (that is what those columns are
 * for), the rest are recognised but not applied (this app builds character and
 * scenario blocks from the card, and duplicating them is exactly the failure
 * §18 warns about), and everything the parser could not understand is named in
 * the report rather than dropped.
 */

const MARKER_OVERRIDES: Record<string, "system_prompt" | "jailbreak"> = {
  main: "system_prompt",
  jailbreak: "jailbreak",
};

export interface ImportReport {
  presetId: string;
  presetName: string;
  blocksImported: number;
  /**
   * Blocks the source had switched off. They arrive switched off too, in place
   * and in order, rather than being dropped — an import that silently loses the
   * disabled half of a preset is lossy in the way §22 warns about for cards.
   */
  blocksDisabled: number;
  markersOverridden: string[];
  /** Markers that map to card-built blocks and so were not applied. */
  markersRecognised: string[];
  unmappedSamplers: string[];
  unsupportedMacros: string[];
}

export function importStPreset(db: Database, parsed: StPresetParse): ImportReport {
  const mainMarker = parsed.markers.find((marker) => marker.identifier.toLowerCase() === "main");
  const jailbreakMarker = parsed.markers.find(
    (marker) => marker.identifier.toLowerCase() === "jailbreak",
  );

  const preset = insertPreset(db, {
    name: parsed.name,
    samplers: parsed.samplers,
    contextSize: parsed.contextSize ?? 32_768,
    maxResponseTokens: parsed.maxResponseTokens ?? 1_024,
    systemPrompt: mainMarker?.enabled === false ? null : (mainMarker?.content ?? null),
    jailbreak: jailbreakMarker?.enabled === false ? null : (jailbreakMarker?.content ?? null),
  });

  const markersOverridden = parsed.markers
    .filter((marker) => marker.identifier.toLowerCase() in MARKER_OVERRIDES)
    .map((marker) => marker.identifier);
  const markersRecognised = parsed.markers
    .filter((marker) => !(marker.identifier.toLowerCase() in MARKER_OVERRIDES))
    .map((marker) => marker.identifier);

  if (parsed.blocks.length === 0) {
    return {
      presetId: preset.ulid,
      presetName: preset.name,
      blocksImported: 0,
      blocksDisabled: 0,
      markersOverridden,
      markersRecognised,
      unmappedSamplers: parsed.unmappedSamplers,
      unsupportedMacros: parsed.unsupportedMacros,
    };
  }

  /*
   * The source preset's blocks become *this preset's* blocks (§20 phase 56).
   *
   * They used to arrive as an option group — fragments selected per roleplay,
   * never on by default. That was a defensible reading of §13.5 and it made
   * importing a preset fail to reproduce its prompt: a file whose author
   * intended "these rules always apply" turned into a menu nobody had switched
   * on. A block that the source had enabled is now enabled here, in the order
   * the source gave, and the report still says how many arrived switched off.
   */
  const now = Date.now();
  let disabled = 0;
  const order: PromptOrderEntry[] = [];
  parsed.blocks
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((block, index) => {
      if (!block.enabled) disabled += 1;
      const blockUlid = ulid();
      db.query(
        `INSERT INTO preset_blocks
           (ulid, preset_id, label, role, content, enabled, sort_order, created_at, updated_at)
         VALUES ($ulid, $preset, $label, $role, $content, $enabled, $sort, $now, $now)`,
      ).run({
        ulid: blockUlid,
        preset: presetIdOf(db, preset.ulid),
        label: block.name === "" ? block.identifier : block.name,
        role: block.role,
        content: block.content,
        enabled: block.enabled ? 1 : 0,
        sort: index,
        now,
      });
      order.push({ id: customBlockId(blockUlid), enabled: block.enabled });
    });

  /*
   * An order built from §3's default with the imported blocks ahead of the
   * history — the same place a hand-written block lands. `injection_position`
   * is not honoured yet: a block asking to sit at a depth arrives in the prefix
   * and says so in `atDepth`, which is a gap worth naming rather than a
   * placement worth guessing at.
   */
  const full: PromptOrderEntry[] = [];
  for (const id of DEFAULT_BLOCK_ORDER) {
    if (id === "history") full.push(...order);
    full.push({ id, enabled: true });
  }
  db.query("UPDATE presets SET prompt_order = $order, updated_at = $now WHERE ulid = $ulid").run({
    order: JSON.stringify(full),
    now,
    ulid: preset.ulid,
  });

  return {
    presetId: preset.ulid,
    presetName: preset.name,
    blocksImported: parsed.blocks.length,
    blocksDisabled: disabled,
    markersOverridden,
    markersRecognised,
    unmappedSamplers: parsed.unmappedSamplers,
    unsupportedMacros: parsed.unsupportedMacros,
  };
}

function presetIdOf(db: Database, ulidValue: string): number {
  return (db.query("SELECT id FROM presets WHERE ulid = $ulid").get({ ulid: ulidValue }) as {
    id: number;
  }).id;
}
