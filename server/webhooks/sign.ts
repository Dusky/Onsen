import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signing an outbound webhook (SPEC §15).
 *
 * The scheme is the one every receiver already knows how to verify, because
 * Stripe made it the convention: a header carrying a timestamp and an HMAC of
 * `timestamp.body`, and a receiver that recomputes it and compares. Inventing a
 * different shape would mean every integration author writing something new
 * for one app.
 *
 * The timestamp is inside the signed material, not beside it. A signature over
 * the body alone is replayable forever — anyone who captured one delivery could
 * send it again, and the receiver would have no way to tell.
 */

export const SIGNATURE_HEADER = "X-Onsen-Signature";
export const EVENT_HEADER = "X-Onsen-Event";
export const DELIVERY_HEADER = "X-Onsen-Delivery";

/** How far apart a delivery's clock and a receiver's may be. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, body: string, timestampSeconds: number): string {
  const mac = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}

/**
 * Verify a signature the way a receiver would.
 *
 * Shipped rather than merely documented: it is what the app's own tests check
 * against, and a scheme whose only implementation is the sender is one nobody
 * can be sure they have implemented correctly.
 */
export function verifySignature(
  secret: string,
  body: string,
  header: string,
  now: number,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): boolean {
  const parts = new Map(
    header.split(",").map((piece) => {
      const [key, ...rest] = piece.trim().split("=");
      return [key ?? "", rest.join("=")] as const;
    }),
  );
  const timestamp = Number(parts.get("t"));
  const claimed = parts.get("v1");
  if (!Number.isFinite(timestamp) || claimed === undefined || claimed === "") return false;
  if (Math.abs(Math.floor(now / 1000) - timestamp) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(claimed, "hex");
  } catch {
    return false;
  }
  // Compared in constant time, and only once the lengths match — timingSafeEqual
  // throws on a length mismatch, which would itself be a signal.
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
