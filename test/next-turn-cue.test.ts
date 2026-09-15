import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Who the send button names (§6, §20 phase 218).
 *
 * The composer shows the director's provisional pick, and for a while the send
 * button sent that pick back as `characterId`. The server reads any
 * `characterId` as a *user cue* and honours it over the strategy — so every
 * ordinary send froze the stale provisional choice, the mention strategy never
 * scanned the message just typed, and round robin ran one turn behind.
 *
 * The only cue that may travel is the reader's explicit choice. The source
 * string below is the seam: a pick the reader made arrives as `source: "user"`;
 * the director's suggestion is `source: "director"` and must stay on the
 * client.
 */

const OPS = readFileSync("client/screens/chat/useOps.tsx", "utf8");

describe("the composer cues only what the reader cued", () => {
  test("the payload attaches characterId only for a user pick", () => {
    // `source !== "user"` is the guard. A "director" suggestion is a forecast,
    // not a decision, and the server re-derives it from fresh history.
    expect(OPS).toContain('nextSpeaker.source !== "user"');
  });

  test("the provisional pick is never sent as a cue", () => {
    // The old shape sent `nextSpeaker.characterId` whenever the classifier was
    // not deciding — which is every non-classifier turn, stale or not. The
    // `decidesOnSend` gate that allowed it may not come back.
    expect(OPS).not.toContain("decidesOnSend");
  });
});
