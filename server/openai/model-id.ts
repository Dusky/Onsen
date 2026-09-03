/**
 * Addressable targets (SPEC §19).
 *
 * `/v1/models` enumerates what this install answers to, and a model id is the
 * whole addressing scheme: a scene, a scene with a forced speaker, an author
 * applied to whatever the client sends, or a raw proxy to a connection profile.
 *
 * Pure, and separate from the route, because "what does this id mean" is a
 * question worth being able to ask without a database - and because the same
 * parse has to agree with the list `/v1/models` produced.
 */

export type ModelTarget =
  | { kind: "scene"; slug: string; character: string | null }
  | { kind: "author"; slug: string }
  | { kind: "passthrough"; slug: string };

/**
 * A slug is lowercase, alphanumeric and hyphens. Deliberately narrow: this
 * string is typed by hand into other people's config files, and a slug that can
 * contain a slash would make `scene/<slug>/<character>` ambiguous.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseModelId(raw: string): ModelTarget | null {
  const parts = raw.trim().split("/");
  const [prefix, first, second, ...rest] = parts;
  if (rest.length > 0 || first === undefined || !SLUG.test(first)) return null;

  switch (prefix) {
    case "scene": {
      if (second === undefined) return { kind: "scene", slug: first, character: null };
      if (!SLUG.test(second)) return null;
      return { kind: "scene", slug: first, character: second };
    }
    case "author":
      return second === undefined ? { kind: "author", slug: first } : null;
    case "passthrough":
      return second === undefined ? { kind: "passthrough", slug: first } : null;
    default:
      return null;
  }
}

export function formatModelId(target: ModelTarget): string {
  switch (target.kind) {
    case "scene":
      return target.character === null
        ? `scene/${target.slug}`
        : `scene/${target.slug}/${target.character}`;
    case "author":
      return `author/${target.slug}`;
    case "passthrough":
      return `passthrough/${target.slug}`;
  }
}

/**
 * A name turned into a slug.
 *
 * Collisions are the caller's problem: it knows what is already taken, and a
 * function that could not see the table would have to guess.
 */
export function slugify(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return cleaned === "" ? "scene" : cleaned;
}
