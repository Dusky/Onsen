import { join, normalize, resolve, sep } from "node:path";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./context.ts";

/**
 * A client bundle compiled into the executable: url path -> the embedded file's
 * runtime path. Populated by the standalone build (scripts/build-standalone.ts)
 * so `bun build --compile` yields a single file with the frontend inside
 * (SPEC §1). Empty in a normal `bun run`, where files come off disk.
 */
let embeddedClient: Readonly<Record<string, string>> = {};

export function setEmbeddedClient(manifest: Readonly<Record<string, string>>): void {
  embeddedClient = manifest;
}

export function hasEmbeddedClient(): boolean {
  return Object.keys(embeddedClient).length > 0;
}

function cacheControlFor(pathname: string): string {
  // Vite emits content-hashed filenames under /assets, so those are safe to
  // cache indefinitely. Everything else revalidates.
  return pathname.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

/**
 * Serve the built SPA from the same origin as the API (SPEC §1 — no CORS
 * anywhere) with a history fallback, so a deep link reaches the client router
 * instead of a 404.
 */
export function spaStatic(clientDir: string): MiddlewareHandler<AppEnv> {
  const root = resolve(clientDir);
  const indexPath = join(root, "index.html");

  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();

    const pathname = decodeURIComponent(new URL(c.req.url).pathname);

    if (hasEmbeddedClient()) {
      const embedded = embeddedClient[pathname];
      if (embedded !== undefined) {
        const file = Bun.file(embedded);
        c.header("Cache-Control", cacheControlFor(pathname));
        return c.body(file.stream(), 200, { "Content-Type": file.type });
      }
      const index = embeddedClient["/index.html"];
      if (index !== undefined) {
        c.header("Cache-Control", "no-cache");
        return c.body(Bun.file(index).stream(), 200, {
          "Content-Type": "text/html; charset=utf-8",
        });
      }
    }

    // Normalise before joining: a path containing ../ must not escape the
    // build directory.
    const candidate = resolve(join(root, normalize(pathname)));
    const withinRoot = candidate === root || candidate.startsWith(root + sep);

    if (withinRoot && pathname !== "/") {
      const file = Bun.file(candidate);
      if (await file.exists()) {
        c.header("Cache-Control", cacheControlFor(pathname));
        return c.body(file.stream(), 200, { "Content-Type": file.type });
      }
    }

    const index = Bun.file(indexPath);
    if (!(await index.exists())) {
      return c.text(
        "The client bundle is missing. Run `bun run build`, or use `bun run dev` for development.",
        503,
      );
    }
    c.header("Cache-Control", "no-cache");
    return c.body(index.stream(), 200, { "Content-Type": "text/html; charset=utf-8" });
  };
}
