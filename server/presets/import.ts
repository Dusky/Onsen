import type { Database } from "bun:sqlite";
import { ulid } from "../lib/ulid.ts";
import { insertPreset } from "../db/queries/connections.ts";
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
  /** The group holding the imported prompt blocks, when there were any. */
  groupId: string | null;
  groupName: string | null;
  blocksImported: number;
  /** Blocks the source had disabled — imported as options, not forced on. */
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
      groupId: null,
      groupName: null,
      blocksImported: 0,
      blocksDisabled: 0,
      markersOverridden,
      markersRecognised,
      unmappedSamplers: parsed.unmappedSamplers,
      unsupportedMacros: parsed.unsupportedMacros,
    };
  }

  const now = Date.now();
  const sortOrder =
    ((db.query("SELECT MAX(sort_order) AS max FROM option_groups").get() as { max: number | null })
      .max ?? 0) + 1;
  const group = db
    .query(
      `INSERT INTO option_groups
         (ulid, key, name, description, cardinality, sort_order, is_builtin, created_at, updated_at)
       VALUES ($ulid, $key, $name, $description, 'any_of', $sort, 0, $now, $now)
       RETURNING ulid, name`,
    )
    .get({
      ulid: ulid(),
      key: `st_${ulid()}`,
      name: `${preset.name} blocks`,
      description: "Prompt blocks imported from a SillyTavern preset.",
      sort: sortOrder,
      now,
    }) as { ulid: string; name: string };

  // Enabled is honoured in the only direction that matters: nothing is forced
  // on. The blocks arrive as options — selected per scene, never by default —
  // and the report says how many the source had switched off.
  let disabled = 0;
  parsed.blocks
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((block, index) => {
      if (!block.enabled) disabled += 1;
      db.query(
        `INSERT INTO options
           (ulid, group_id, key, name, fragment, position, depth, role, sort_order,
            is_builtin, created_at, updated_at)
         VALUES ($ulid, $group, $key, $name, $fragment, $position, $depth, $role,
                 $sort, 0, $now, $now)`,
      ).run({
        ulid: ulid(),
        group: groupIdOf(db, group.ulid),
        key: `block_${index}`,
        name: block.name === "" ? block.identifier : block.name,
        fragment: block.content,
        position: block.atDepth ? "depth" : "prefix",
        depth: block.depth,
        role: block.role,
        sort: index,
        now,
      });
    });

  return {
    presetId: preset.ulid,
    presetName: preset.name,
    groupId: group.ulid,
    groupName: group.name,
    blocksImported: parsed.blocks.length,
    blocksDisabled: disabled,
    markersOverridden,
    markersRecognised,
    unmappedSamplers: parsed.unmappedSamplers,
    unsupportedMacros: parsed.unsupportedMacros,
  };
}

function groupIdOf(db: Database, ulidValue: string): number {
  return (db.query("SELECT id FROM option_groups WHERE ulid = $ulid").get({ ulid: ulidValue }) as {
    id: number;
  }).id;
}
