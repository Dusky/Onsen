/**
 * ULIDs are the external identifier for every record (HANDOFF conventions:
 * integer PKs internally, ULIDs externally). Written here rather than pulled in
 * as a dependency because the format is 40 lines and this keeps the dependency
 * surface at zero for a foundation concern.
 *
 * Layout: 48-bit big-endian millisecond timestamp + 80 bits of randomness,
 * rendered in Crockford base32 as 10 + 16 characters.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U
const ENCODING_LEN = 32;
const TIME_LEN = 10;
const RANDOM_LEN = 16;
const TIME_MAX = 281474976710655; // 2^48 - 1

export const ULID_LENGTH = TIME_LEN + RANDOM_LEN;

function encodeTime(now: number): string {
  if (!Number.isInteger(now) || now < 0 || now > TIME_MAX) {
    throw new RangeError(`ulid: timestamp out of range: ${now}`);
  }
  let out = "";
  let remaining = now;
  for (let i = 0; i < TIME_LEN; i++) {
    const mod = remaining % ENCODING_LEN;
    out = ENCODING[mod] + out;
    remaining = (remaining - mod) / ENCODING_LEN;
  }
  return out;
}

function randomChars(): string {
  const bytes = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i++) {
    // Modulo bias across a 32-symbol alphabet from a 256-value byte is exact
    // (256 = 8 * 32), so a plain mask is uniform here.
    out += ENCODING[bytes[i]! & 0x1f];
  }
  return out;
}

/**
 * Increment a random suffix in place, for monotonic generation within a
 * millisecond. Returns null when the suffix is all-Z and cannot be incremented,
 * which the caller resolves by waiting for the next millisecond.
 */
function incrementRandom(suffix: string): string | null {
  const chars = suffix.split("");
  for (let i = chars.length - 1; i >= 0; i--) {
    const index = ENCODING.indexOf(chars[i]!);
    if (index < ENCODING_LEN - 1) {
      chars[i] = ENCODING[index + 1]!;
      return chars.join("");
    }
    chars[i] = ENCODING[0]!;
  }
  return null;
}

/**
 * A monotonic ULID factory. Two ULIDs generated in the same millisecond still
 * sort in creation order, which matters because message and generation rows are
 * frequently ordered by id.
 */
export function createUlidFactory(clock: () => number = Date.now): () => string {
  let lastTime = -1;
  let lastRandom = "";

  return function ulid(): string {
    const now = clock();
    if (now > lastTime) {
      lastTime = now;
      lastRandom = randomChars();
    } else {
      // Either the same millisecond, or the clock moved backwards (an NTP
      // correction, say). Both are handled by holding the last timestamp and
      // incrementing the suffix: ids stay strictly ascending either way.
      const next = incrementRandom(lastRandom);
      if (next === null) {
        // 80 bits exhausted within one millisecond; step the timestamp forward
        // rather than emitting a duplicate.
        lastTime += 1;
        lastRandom = randomChars();
      } else {
        lastRandom = next;
      }
    }
    return encodeTime(lastTime) + lastRandom;
  };
}

export const ulid = createUlidFactory();

export function isUlid(value: string): boolean {
  if (value.length !== ULID_LENGTH) return false;
  for (const ch of value) {
    if (!ENCODING.includes(ch)) return false;
  }
  return true;
}

export function ulidTime(value: string): number {
  if (!isUlid(value)) throw new TypeError(`ulid: not a ULID: ${value}`);
  let time = 0;
  for (let i = 0; i < TIME_LEN; i++) {
    time = time * ENCODING_LEN + ENCODING.indexOf(value[i]!);
  }
  return time;
}
