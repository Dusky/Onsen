import { describe, expect, test } from "bun:test";
import {
  chooseSpeaker,
  type DirectorCandidate,
  type DirectorHistoryEntry,
} from "../server/generation/director.ts";

/**
 * The turn director's rules (SPEC §6).
 *
 * Three rules apply to every strategy: never let the same character speak twice
 * consecutively unless requested, respect an explicit user target over the
 * strategy, and expose the decision. The third is why every test here checks
 * the reason as well as the choice — a decision nobody can read is the
 * arbitrary dice roll this is meant to replace.
 */

function cast(...names: string[]): DirectorCandidate[] {
  return names.map((name, index) => ({
    id: name.toLowerCase(),
    name,
    isActive: true,
    displayOrder: index,
  }));
}

function said(characterId: string | null, content = "…"): DirectorHistoryEntry {
  return { characterId, content };
}

describe("rules that apply to every strategy", () => {
  test("an explicit pick always wins over the strategy", () => {
    for (const strategy of ["manual", "round_robin", "mention", "classifier"] as const) {
      const decision = chooseSpeaker({
        strategy,
        cast: cast("Bell", "Mira", "Aldan"),
        history: [said("bell")],
        requested: "aldan",
      });
      expect(decision).toMatchObject({ characterId: "aldan", source: "user" });
      expect(decision!.reason).toContain("Your pick");
    }
  });

  test("an explicit pick may repeat the character who just spoke", () => {
    // "Never twice consecutively unless requested" — this is the unless.
    const decision = chooseSpeaker({
      strategy: "round_robin",
      cast: cast("Bell", "Mira"),
      history: [said("bell")],
      requested: "bell",
    });
    expect(decision!.characterId).toBe("bell");
  });

  test("a pick naming somebody outside the cast falls back to the strategy", () => {
    const decision = chooseSpeaker({
      strategy: "round_robin",
      cast: cast("Bell", "Mira"),
      history: [said("bell")],
      requested: "a-stranger",
    });
    expect(decision).toMatchObject({ characterId: "mira", source: "director" });
  });

  test("never chooses the character who just spoke", () => {
    for (const strategy of ["manual", "round_robin", "mention", "classifier"] as const) {
      const decision = chooseSpeaker({
        strategy,
        cast: cast("Bell", "Mira", "Aldan"),
        history: [said("mira"), said(null), said("bell")],
      });
      expect(decision!.characterId).not.toBe("bell");
    }
  });

  test("a solo cast may speak twice, because there is nobody else", () => {
    const decision = chooseSpeaker({
      strategy: "manual",
      cast: cast("Bell"),
      history: [said("bell")],
    });
    expect(decision!.characterId).toBe("bell");
  });

  test("every decision carries a reason worth reading", () => {
    for (const strategy of ["manual", "round_robin", "mention", "classifier"] as const) {
      const decision = chooseSpeaker({
        strategy,
        cast: cast("Bell", "Mira"),
        history: [said("bell")],
      });
      expect(decision!.reason.length).toBeGreaterThan(8);
      // A reason is prose for a person, not a code to be parsed.
      expect(decision!.reason).not.toMatch(/^[a-z_]+$/);
    }
  });

  test("returns nothing when there is nobody to choose", () => {
    expect(chooseSpeaker({ strategy: "round_robin", cast: [], history: [] })).toBeNull();
    expect(
      chooseSpeaker({
        strategy: "round_robin",
        cast: cast("Bell").map((member) => ({ ...member, isActive: false })),
        history: [],
      }),
    ).toBeNull();
  });
});

describe("round robin", () => {
  test("cycles through active members in display order", () => {
    const members = cast("Bell", "Mira", "Aldan");
    const history: DirectorHistoryEntry[] = [];
    const order: string[] = [];

    for (let turn = 0; turn < 6; turn++) {
      const decision = chooseSpeaker({ strategy: "round_robin", cast: members, history })!;
      order.push(decision.characterId);
      history.push(said(decision.characterId));
    }

    expect(order).toEqual(["bell", "mira", "aldan", "bell", "mira", "aldan"]);
  });

  test("skips a benched member", () => {
    const members = cast("Bell", "Mira", "Aldan");
    members[1]!.isActive = false;

    const decision = chooseSpeaker({
      strategy: "round_robin",
      cast: members,
      history: [said("bell")],
    });
    expect(decision!.characterId).toBe("aldan");
  });

  test("names who it came after, so the cycle is legible", () => {
    const decision = chooseSpeaker({
      strategy: "round_robin",
      cast: cast("Bell", "Mira"),
      history: [said("bell")],
    });
    expect(decision!.reason).toBe("Round robin — after Bell");
  });

  test("restarts the cycle when whoever spoke last has been benched", () => {
    const members = cast("Bell", "Mira", "Aldan");
    members[0]!.isActive = false;
    const decision = chooseSpeaker({
      strategy: "round_robin",
      cast: members,
      history: [said("bell")],
    });
    expect(decision!.characterId).toBe("mira");
  });

  test("ignores user and narration turns when working out who went last", () => {
    const decision = chooseSpeaker({
      strategy: "round_robin",
      cast: cast("Bell", "Mira", "Aldan"),
      history: [said("bell"), said(null, "the user speaks"), said(null, "narration")],
    });
    expect(decision!.characterId).toBe("mira");
  });

  test("uses display order, not the order characters were added", () => {
    const members: DirectorCandidate[] = [
      { id: "aldan", name: "Aldan", isActive: true, displayOrder: 2 },
      { id: "bell", name: "Bell", isActive: true, displayOrder: 0 },
      { id: "mira", name: "Mira", isActive: true, displayOrder: 1 },
    ];
    const decision = chooseSpeaker({ strategy: "round_robin", cast: members, history: [] });
    expect(decision!.characterId).toBe("bell");
  });
});

describe("manual", () => {
  test("suggests whoever has been quiet longest", () => {
    const decision = chooseSpeaker({
      strategy: "manual",
      cast: cast("Bell", "Mira", "Aldan"),
      // Aldan has never spoken; Mira spoke a while ago; Bell just did.
      history: [said("mira"), said("bell")],
    });
    expect(decision!.characterId).toBe("aldan");
    expect(decision!.reason).toContain("has not spoken yet");
  });

  test("counts the silence it is reasoning from", () => {
    const decision = chooseSpeaker({
      strategy: "manual",
      cast: cast("Bell", "Mira"),
      history: [said("mira"), said(null), said(null), said("bell")],
    });
    expect(decision!.characterId).toBe("mira");
    expect(decision!.reason).toBe("Suggested — silent 3 turns");
  });

  test("says a turn rather than 1 turns", () => {
    const decision = chooseSpeaker({
      strategy: "manual",
      cast: cast("Bell", "Mira"),
      history: [said("mira"), said("bell")],
    });
    expect(decision!.reason).toBe("Suggested — silent 1 turn");
  });

  test("stops counting past a point and just says it has been a while", () => {
    const history = [said("mira"), ...Array.from({ length: 20 }, () => said(null)), said("bell")];
    const decision = chooseSpeaker({ strategy: "manual", cast: cast("Bell", "Mira"), history });
    expect(decision!.reason).toContain("a long while");
  });

  test("invites a choice when the scene has not started", () => {
    const decision = chooseSpeaker({ strategy: "manual", cast: cast("Bell", "Mira"), history: [] });
    expect(decision!.reason).toContain("tap anyone to change");
  });
});

describe("mention (SPEC §6)", () => {
  function mention(content: string, members = cast("Bell", "Mira", "Ana")) {
    return chooseSpeaker({ strategy: "mention", cast: members, history: [said(null, content)] });
  }

  test("a name in the last message hands over the turn", () => {
    const decision = mention("Mira, what do you make of it?");
    expect(decision).toMatchObject({ characterId: "mira", source: "director" });
    expect(decision!.reason).toBe("Named in the last message");
  });

  test("a configured keyword does too, and the reason quotes it", () => {
    const members = cast("Bell", "Mira");
    members[1]!.mentionKeywords = ["the captain"];
    const decision = mention("I asked the captain already.", members);
    expect(decision).toMatchObject({ characterId: "mira" });
    expect(decision!.reason).toContain("the captain");
  });

  test("matching is whole-word — \"already\" does not name Al", () => {
    const members = cast("Al", "Bell");
    const decision = mention("She had already gone.", members);
    // Nobody was named, so it falls back rather than electing Al on a fragment.
    expect(decision!.reason).toContain("round robin");
  });

  test("the later of two names wins — the sentence is addressed to them", () => {
    const decision = mention("Ana, ask Mira about the key.");
    expect(decision).toMatchObject({ characterId: "mira" });
  });

  test("a benched member is never named into the turn", () => {
    const members = cast("Bell", "Mira");
    members[1]!.isActive = false;
    const decision = mention("Mira?", members);
    expect(decision).toMatchObject({ characterId: "bell" });
  });

  test("the previous speaker is not eligible, even named", () => {
    // Never twice consecutively unless *requested* — a name in the prose is not
    // a request, which is the explicit pick handled elsewhere.
    const decision = chooseSpeaker({
      strategy: "mention",
      cast: cast("Bell", "Mira"),
      history: [said("bell", "…"), said(null, "Bell, again?")],
    });
    expect(decision).toMatchObject({ characterId: "mira" });
    expect(decision!.reason).toContain("round robin");
  });

  test("a first name names them — cards carry \"Mira Vance\", readers type \"Mira\"", () => {
    const members = cast("Sister Bell", "Mira Vance");
    const decision = mention("Mira, how short are we?", members);
    expect(decision).toMatchObject({ characterId: "mira vance" });
    // Still the name, so the reason does not quote it back as a keyword.
    expect(decision!.reason).toBe("Named in the last message");
  });

  test("a name is matched case-insensitively", () => {
    expect(mention("mira?")).toMatchObject({ characterId: "mira" });
  });

  test("nobody named falls back to round robin and says so", () => {
    const decision = chooseSpeaker({
      strategy: "mention",
      cast: cast("Bell", "Mira"),
      history: [said("bell")],
    });
    expect(decision).toMatchObject({ characterId: "mira" });
    expect(decision!.reason).toContain("round robin");
  });

  test("a name with punctuation in it is not a regex", () => {
    const members = cast("Dr. J", "Bell");
    // "DrXJ" would match if "." compiled to "any character".
    expect(mention("DrXJ is late.", members)!.reason).toContain("round robin");
    expect(mention("Dr. J is late.", members)).toMatchObject({ characterId: "dr. j" });
  });
});

describe("strategies that do not decide here", () => {
  test("fall back to round robin and say which fallback they took", () => {
    // The classifier is a model call, which a pure function called on every
    // read of a scene cannot make. What it returns is the fallback that stands
    // if the call fails, said out loud as provisional rather than decided.
    const classifier = chooseSpeaker({
      strategy: "classifier",
      cast: cast("Bell", "Mira"),
      history: [said("bell")],
    });
    expect(classifier).toMatchObject({ characterId: "mira" });
    expect(classifier!.reason).toBe("The classifier decides when you send");
  });
});
