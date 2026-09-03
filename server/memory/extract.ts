/**
 * Reading entities and relations out of a model's answer (SPEC §11 layer 3).
 *
 * The extraction is a background task: a small model at low temperature is
 * asked what changed, and this parses what comes back. Pure, because the
 * interesting failures are all in the parsing — a model that answers with
 * prose around its JSON, or invents a sixth kind, or scores salience as a
 * percentage — and none of them need a database to reproduce.
 *
 * Nothing here throws. §18's rule applies with force to a background task:
 * an extraction that could fail a turn would be worse than no memory at all,
 * so a reply this cannot read yields nothing and says so.
 */

import { combineSalience, type SalienceSignals } from "./salience.ts";

export const ENTITY_KINDS = ["person", "place", "object", "event", "fact"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface ExtractedEntity {
  kind: EntityKind;
  name: string;
  content: string;
  salience: number;
}

export interface ExtractedRelation {
  from: string;
  to: string;
  kind: string;
  content: string;
  salience: number;
}

export interface Extraction {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  /** What could not be read, named rather than swallowed. */
  problems: string[];
}

const EMPTY: Extraction = { entities: [], relations: [], problems: [] };

/**
 * A number from a model, which may be 0.8, "0.8", 80, or "80%".
 *
 * Normalised rather than rejected: a model that answered 80 meant the same
 * thing as one that answered 0.8, and refusing the first would throw away a
 * good extraction over a formatting habit.
 */
function score(value: unknown): number | null {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/%$/, "").trim())
        : Number.NaN;
  if (!Number.isFinite(raw)) return null;
  const normalised = raw > 1 ? raw / 100 : raw;
  return Math.min(1, Math.max(0, normalised));
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * The JSON out of a reply that may have prose around it.
 *
 * A small model at low temperature still says "Here is the JSON:" about a third
 * of the time, and that is not a failure worth discarding an extraction over.
 */
function jsonOf(reply: string): unknown {
  const trimmed = reply.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseExtraction(reply: string): Extraction {
  const parsed = jsonOf(reply);
  if (typeof parsed !== "object" || parsed === null) {
    return { ...EMPTY, problems: ["The reply was not a JSON object."] };
  }
  const source = parsed as Record<string, unknown>;
  const problems: string[] = [];

  const entities: ExtractedEntity[] = [];
  const rawEntities = Array.isArray(source["entities"]) ? source["entities"] : [];
  for (const item of rawEntities) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const name = text(row["name"], 120);
    if (name === "") continue;

    const kind = text(row["kind"], 20).toLowerCase();
    if (!(ENTITY_KINDS as readonly string[]).includes(kind)) {
      // Named, and dropped. A sixth kind is a model inventing a column, and
      // storing it would mean the CHECK constraint failing at the far end of a
      // background task where nobody is looking.
      problems.push(`${name}: "${kind}" is not a kind this app knows.`);
      continue;
    }

    entities.push({
      kind: kind as EntityKind,
      name,
      content: text(row["content"] ?? row["summary"], 2_000),
      salience: salienceOf(row),
    });
  }

  const relations: ExtractedRelation[] = [];
  const rawRelations = Array.isArray(source["relations"]) ? source["relations"] : [];
  for (const item of rawRelations) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const from = text(row["from"], 120);
    const to = text(row["to"], 120);
    const kind = text(row["kind"] ?? row["relation"], 80);
    if (from === "" || to === "" || kind === "") continue;
    // A relation from a thing to itself is an extraction mistake, and the
    // schema refuses it — so it is dropped here rather than at the insert,
    // where the failure would take the rest of the batch with it.
    if (from.toLowerCase() === to.toLowerCase()) continue;
    relations.push({ from, to, kind, content: text(row["content"], 1_000), salience: salienceOf(row) });
  }

  return { entities, relations, problems };
}

/**
 * A salience, however the model chose to express it.
 *
 * Three signals if it gave them, one number if it gave that, and 0.5 if it gave
 * neither — a default in the middle, because an extraction with no opinion
 * about importance should not outrank one that said "this matters" or be buried
 * under one that said "this does not".
 */
function salienceOf(row: Record<string, unknown>): number {
  const signals = row["salience"];
  if (typeof signals === "object" && signals !== null && !Array.isArray(signals)) {
    const parts = signals as Record<string, unknown>;
    const emotional = score(parts["emotional"]);
    const narrative = score(parts["narrative"]);
    const density = score(parts["density"]);
    if (emotional !== null || narrative !== null || density !== null) {
      return combineSalience({
        emotional: emotional ?? 0.5,
        narrative: narrative ?? 0.5,
        density: density ?? 0.5,
      } satisfies SalienceSignals);
    }
  }
  return score(signals) ?? score(row["importance"]) ?? 0.5;
}
