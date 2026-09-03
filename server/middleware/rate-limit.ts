import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context.ts";

/**
 * A fixed-window counter, in memory, keyed by client address. SPEC §17 requires
 * auth attempts to be rate-limited; this is a single-user app behind a tunnel,
 * so the goal is to make online password guessing pointless, not to survive a
 * distributed attack.
 */
export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  /** Distinguishes buckets when several routes share a limiter module. */
  scope: string;
  now?: () => number;
  /**
   * What to count against, when the client address is the wrong answer.
   *
   * §19's outbound API is rate-limited *per key*: it is reached by machines
   * holding bearer tokens, and behind a tunnel every one of them arrives from
   * the same forwarded address — so per-address there would be one bucket for
   * every caller, and one busy client would lock out the rest.
   *
   * Returning null falls back to the address, which is what a request with no
   * identity of its own deserves.
   */
  identify?: (request: Request) => string | null;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  middleware: MiddlewareHandler<AppEnv>;
  /** Called after a successful login so a correct password clears the penalty. */
  reset(key: string): void;
  keyFor(request: Request, connectingAddress?: string): string;
}

/**
 * Bun's server object, when Hono is running on it. Probed defensively because
 * the same app is constructed directly in tests, where there is no server.
 */
interface MaybeBunServer {
  requestIP?: (request: Request) => { address: string } | null;
}

function peerAddress(env: unknown, request: Request): string | undefined {
  const server = (env as { server?: MaybeBunServer } | undefined)?.server;
  if (typeof server?.requestIP !== "function") return undefined;
  return server.requestIP(request)?.address;
}

function clientKey(request: Request, connectingAddress?: string): string {
  // Behind Tailscale or a Cloudflare Tunnel the peer address is the proxy, so
  // prefer the forwarded client when one is present.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return connectingAddress ?? "unknown";
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  function sweep(at: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= at) buckets.delete(key);
    }
  }

  const middleware: MiddlewareHandler<AppEnv> = async (c, next) => {
    const at = now();
    // Bounded by the number of distinct clients in one window, which for a
    // single-user app is tiny; sweeping on write keeps it that way.
    if (buckets.size > 1024) sweep(at);

    const identity = options.identify?.(c.req.raw) ?? null;
    const key = `${options.scope}:${identity ?? clientKey(c.req.raw, peerAddress(c.env, c.req.raw))}`;
    const existing = buckets.get(key);
    const bucket =
      existing && existing.resetAt > at ? existing : { count: 0, resetAt: at + options.windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > options.limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - at) / 1000));
      c.header("Retry-After", String(retryAfter));
      return c.json(
        {
          error: {
            code: "rate_limited",
            message: "Too many attempts. Wait before trying again.",
            retryAfter,
          },
        },
        429,
      );
    }

    await next();
  };

  return {
    middleware,
    reset(key: string) {
      buckets.delete(`${options.scope}:${key}`);
    },
    keyFor(request: Request, connectingAddress?: string) {
      return clientKey(request, connectingAddress);
    },
  };
}
