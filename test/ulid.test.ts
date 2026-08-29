import { describe, expect, test } from "bun:test";
import { createUlidFactory, isUlid, ulid, ulidTime, ULID_LENGTH } from "../server/lib/ulid.ts";

describe("ulid", () => {
  test("is 26 Crockford base32 characters", () => {
    const value = ulid();
    expect(value).toHaveLength(ULID_LENGTH);
    expect(isUlid(value)).toBe(true);
    expect(value).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test("encodes the generation time in the first ten characters", () => {
    const at = 1_700_000_000_000;
    const value = createUlidFactory(() => at)();
    expect(ulidTime(value)).toBe(at);
  });

  test("sorts in creation order across milliseconds", () => {
    let now = 1_700_000_000_000;
    const next = createUlidFactory(() => now);
    const first = next();
    now += 1;
    const second = next();
    expect(first < second).toBe(true);
  });

  test("stays monotonic within a single millisecond", () => {
    const next = createUlidFactory(() => 1_700_000_000_000);
    const values = Array.from({ length: 500 }, () => next());
    const sorted = [...values].sort();
    expect(values).toEqual(sorted);
    expect(new Set(values).size).toBe(values.length);
  });

  test("does not emit ids that sort backwards when the clock does", () => {
    let now = 1_700_000_000_000;
    const next = createUlidFactory(() => now);
    const first = next();
    now -= 5_000; // clock steps back, e.g. an NTP correction
    const second = next();
    expect(second > first).toBe(true);
  });

  test("rejects values that are not ULIDs", () => {
    expect(isUlid("")).toBe(false);
    expect(isUlid("not-a-ulid")).toBe(false);
    // I, L, O and U are excluded from the alphabet.
    expect(isUlid("I".repeat(ULID_LENGTH))).toBe(false);
    expect(() => ulidTime("nope")).toThrow();
  });
});
