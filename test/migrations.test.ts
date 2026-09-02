import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Migration registration lint (settled while building phase 31).
 *
 * A migration that exists on disk but is never imported into
 * `migrations/index.ts` silently never runs — the database drifts from the
 * schema the code expects, and the failure shows up later, far from the
 * migration that was meant to prevent it. This test closes that hole by reading
 * the directory and the registry and asserting they agree.
 */

const DIR = new URL("../server/db/migrations/", import.meta.url);

function migrationFiles(): number[] {
  const files = readdirSync(DIR).filter((name) => /^\d{4}_.*\.sql$/.test(name));
  return files.map((name) => Number(name.slice(0, 4))).sort((a, b) => a - b);
}

/** Parse the version list out of the registry source, rather than importing it. */
function registeredVersions(): number[] {
  const text = readFileSync(join(DIR.pathname, "index.ts"), "utf8");
  const versions: number[] = [];
  for (const match of text.matchAll(/version:\s*(\d+)/g)) {
    versions.push(Number(match[1]));
  }
  return [...new Set(versions)].sort((a, b) => a - b);
}

describe("migration registration", () => {
  test("every .sql file on disk is registered, and no more", () => {
    const onDisk = migrationFiles();
    const registered = registeredVersions();

    // Every file on disk has a registry entry.
    for (const version of onDisk) {
      expect(registered).toContain(version);
    }
    // Every registry entry has a file on disk.
    for (const version of registered) {
      expect(onDisk).toContain(version);
    }
    // And the sequence is gapless — a missing number means a reorder or a skip.
    for (let index = 1; index < onDisk.length; index += 1) {
      expect(onDisk[index]! - onDisk[index - 1]!).toBe(1);
    }
  });
});
