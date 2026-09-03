/**
 * A pack's manifest (SPEC §15 tier 2).
 *
 * A pack is data. Nothing in it executes, and nothing in this file interprets
 * anything as code — the manifest says what the archive is and what host it was
 * written against, and that is all it is allowed to say.
 */

/**
 * What this host answers to when a pack declares a range.
 *
 * Deliberately not the app's own version from `package.json`. That number moves
 * with every release, most of which change nothing a pack can see; this one
 * moves when the shape of what a pack carries changes, which is the only thing
 * a `host_api_range` can usefully be about.
 */
export const HOST_API_VERSION = "1.0.0";

/** The entity kinds a pack can carry, and the directory each lives in. */
export const PACK_KINDS = [
  "characters",
  "lorebooks",
  "presets",
  "authors",
  "options",
  "regex",
  "triggers",
  "banlists",
] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export interface PackManifest {
  name: string;
  version: string;
  author: string;
  description: string;
  /**
   * A semver range the pack expects of its host, in the two forms that mean
   * something without a full range parser: `1.x` and `>=1.2 <2`. Absent means
   * the pack makes no claim, which is treated as compatible — a pack of three
   * characters has no reason to care.
   */
  hostApiRange: string | null;
}

export class PackError extends Error {}

interface Version {
  major: number;
  minor: number;
  patch: number;
}

/**
 * `1`, `1.2` and `1.2.3` all parse. A bare major is what a comparator usually
 * carries - `<2` is the ordinary way to say "before the next breaking change" -
 * and refusing it would make the most common range unreadable.
 */
function parseVersion(value: string): Version | null {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(value.trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
  };
}

function compare(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Whether this host satisfies a pack's declared range.
 *
 * A deliberately small grammar rather than a semver dependency: `1.x`, `1.2.x`,
 * an exact version, and space-separated comparators (`>=1.2 <2`). A range this
 * cannot parse is refused rather than assumed compatible — a pack that asked
 * for something and got silence has been misread, and §18 wants that visible.
 */
export function satisfiesHost(range: string | null, host = HOST_API_VERSION): string | null {
  if (range === null || range.trim() === "") return null;
  const current = parseVersion(host);
  if (current === null) return "This install has no readable API version.";

  for (const term of range.trim().split(/\s+/)) {
    const problem = checkTerm(term, current, range);
    if (problem !== null) return problem;
  }
  return null;
}

function checkTerm(term: string, current: Version, range: string): string | null {
  const refused = `This pack asks for a host in the range ${range}, and this one is ${HOST_API_VERSION}.`;

  // `1.x` and `1.2.x` — a wildcard tail.
  const wildcard = /^(\d+)(?:\.(\d+))?\.[xX*]$/.exec(term);
  if (wildcard !== null) {
    if (Number(wildcard[1]) !== current.major) return refused;
    if (wildcard[2] !== undefined && Number(wildcard[2]) !== current.minor) return refused;
    return null;
  }

  const comparator = /^(>=|<=|>|<|=)?(.+)$/.exec(term);
  const wanted = comparator === null ? null : parseVersion(comparator[2] ?? "");
  if (comparator === null || wanted === null) {
    return `This pack's host range (${range}) is not one this app can read.`;
  }

  const order = compare(current, wanted);
  switch (comparator[1] ?? "=") {
    case ">=":
      return order >= 0 ? null : refused;
    case "<=":
      return order <= 0 ? null : refused;
    case ">":
      return order > 0 ? null : refused;
    case "<":
      return order < 0 ? null : refused;
    default:
      return order === 0 ? null : refused;
  }
}

function stringField(source: Record<string, unknown>, key: string, max = 400): string {
  const value = source[key];
  return typeof value === "string" ? value.slice(0, max).trim() : "";
}

/**
 * Read a manifest, refusing one that could not identify what it installed.
 *
 * Name and version are required because uninstall is by identity: a pack with
 * no name is one the user cannot find again to remove.
 */
export function readManifest(json: string): PackManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return refuse("That pack's manifest is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    return refuse("That pack's manifest is not an object.");
  }
  const source = parsed as Record<string, unknown>;

  const name = stringField(source, "name", 120);
  if (name === "") return refuse("That pack's manifest has no name.");
  const version = stringField(source, "version", 40);
  if (version === "") return refuse("That pack's manifest has no version.");

  const rawRange = source["host_api_range"] ?? source["hostApiRange"];
  return {
    name,
    version,
    author: stringField(source, "author", 120),
    description: stringField(source, "description", 2_000),
    hostApiRange: typeof rawRange === "string" && rawRange.trim() !== "" ? rawRange.trim() : null,
  };
}

function refuse(message: string): never {
  throw new PackError(message);
}

/** The manifest as it is written into an archive, in the spec's snake_case. */
export function writeManifest(manifest: PackManifest): string {
  return JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      description: manifest.description,
      host_api_range: manifest.hostApiRange,
    },
    null,
    2,
  );
}
