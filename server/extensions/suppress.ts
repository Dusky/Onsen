import type { Database } from "bun:sqlite";
import { setSetting } from "../db/queries/settings.ts";

/**
 * Native features an extension can take over (SPEC §15, §20 phase 147).
 *
 * An extension declares `disables: ["summarise"]` in its manifest, and the
 * host suppresses the matching native feature while that extension is enabled.
 * The mapping lives here so a feature name in a manifest never reaches a
 * setting key directly — an extension cannot turn off a feature the host has
 * not agreed can be taken over.
 */

const FEATURES = {
  summarise: "summarise.suppressed",
} as const;

/** Set or clear every suppressible feature, from the enabled extensions' set. */
export function applySuppression(db: Database, disabled: Set<string>): void {
  for (const [feature, key] of Object.entries(FEATURES)) {
    setSetting(db, key, disabled.has(feature) ? "1" : "0");
  }
}
