import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { completeSetup, createHarness, type TestHarness } from "./helpers.ts";
import type { UpdateStatusDto } from "../shared/types.ts";

/**
 * The self-updater through the real system (SPEC §17).
 *
 * Everything runs against local git fixtures — a bare origin, a seed checkout
 * that pushes to it, and the clone the app believes it is — so the network is
 * never touched, but `git fetch`, the dirty-tree refusal and a real fast-forward
 * pull are all exercised as a user's deployment would hit them.
 */

function gitSync(dir: string, args: string[]): string {
  const proc = Bun.spawnSync(
    ["git", "-c", "user.email=onsen@test", "-c", "user.name=Onsen Test", ...args],
    { cwd: dir, stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString().trim();
}

/** A bare origin with one commit, and a clone of it for the app to be. */
function makeDeployment(base: string): { origin: string; seed: string; clone: string } {
  const origin = join(base, "origin.git");
  const seed = join(base, "seed");
  const clone = join(base, "clone");
  gitSync(base, ["init", "--bare", "-b", "main", origin]);
  gitSync(base, ["init", "-b", "main", seed]);
  writeFileSync(join(seed, "version.txt"), "one\n");
  gitSync(seed, ["add", "."]);
  gitSync(seed, ["commit", "-m", "first"]);
  gitSync(seed, ["remote", "add", "origin", origin]);
  gitSync(seed, ["push", "-u", "origin", "main"]);
  gitSync(base, ["clone", origin, clone]);
  return { origin, seed, clone };
}

/** Push another commit to the origin, so the clone falls behind. */
function pushCommit(seed: string, message: string, content: string): void {
  writeFileSync(join(seed, "version.txt"), content);
  gitSync(seed, ["add", "."]);
  gitSync(seed, ["commit", "-m", message]);
  gitSync(seed, ["push", "origin", "main"]);
}

let harness: TestHarness | null = null;
let base: string | null = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
  if (base !== null) rmSync(base, { recursive: true, force: true });
  base = null;
});

async function json<T>(t: TestHarness, method: string, path: string): Promise<{ status: number; body: T }> {
  const response = await t.fetch(path, { method });
  return { status: response.status, body: (await response.json()) as T };
}

async function signedIn(repoDir: string): Promise<TestHarness> {
  harness = createHarness({ repoDir });
  await completeSetup(harness);
  return harness;
}

describe("self-update (SPEC §17)", () => {
  test("requires a session", async () => {
    const t = createHarness();
    const { status } = await json(t, "GET", "/api/system/update");
    expect(status).toBe(401);
  });

  test("a fresh clone is clean and level", async () => {
    base = mkdtempSync(join(tmpdir(), "onsen-update-"));
    const { clone } = makeDeployment(base);
    const t = await signedIn(clone);

    const { status, body } = await json<UpdateStatusDto>(t, "GET", "/api/system/update");
    expect(status).toBe(200);
    expect(body.mode).toBe("git");
    expect(body.branch).toBe("main");
    expect(body.subject).toBe("first");
    expect(body.dirty).toBe(false);
    // Level against the remote the clone was made from — clone sets the
    // upstream, so even before any check the counts are known.
    expect(body.behind).toBe(0);
    expect(body.ahead).toBe(0);
    expect(body.restartRequired).toBe(false);
  });

  test("the remote moves without a check noticing", async () => {
    base = mkdtempSync(join(tmpdir(), "onsen-update-"));
    const { seed, clone } = makeDeployment(base);
    const t = await signedIn(clone);
    pushCommit(seed, "second", "two\n");

    const stale = await json<UpdateStatusDto>(t, "GET", "/api/system/update");
    // The GET is local facts by design (§17) — it must not silently hit the
    // network on every settings screen load.
    expect(stale.body.behind).toBe(0);

    const checked = await json<UpdateStatusDto>(t, "POST", "/api/system/update/check");
    expect(checked.status).toBe(200);
    expect(checked.body.behind).toBe(1);
    expect(checked.body.ahead).toBe(0);
    expect(checked.body.lastCheckedAt).not.toBeNull();
  });

  test("a check that cannot reach the remote still reports the local half", async () => {
    base = mkdtempSync(join(tmpdir(), "onsen-update-"));
    const { clone } = makeDeployment(base);
    gitSync(clone, ["remote", "set-url", "origin", join(base, "not-there.git")]);
    const t = await signedIn(clone);

    const { status, body } = await json<UpdateStatusDto>(t, "POST", "/api/system/update/check");
    expect(status).toBe(200);
    expect(body.error).not.toBeNull();
    expect(body.subject).toBe("first");
  });

  test("a dirty tree is refused, untracked files are not dirt", async () => {
    base = mkdtempSync(join(tmpdir(), "onsen-update-"));
    const { seed, clone } = makeDeployment(base);
    const t = await signedIn(clone);
    pushCommit(seed, "second", "two\n");

    // An untracked directory — the shape of `data/` in a real checkout — must
    // not count as a local change, or no deployment could ever update.
    mkdirSync(join(clone, "data"));
    writeFileSync(join(clone, "data", "onsen.db"), "");
    const clean = await json<UpdateStatusDto>(t, "GET", "/api/system/update");
    expect(clean.body.dirty).toBe(false);

    writeFileSync(join(clone, "version.txt"), "local edit\n");
    const dirty = await json<UpdateStatusDto>(t, "GET", "/api/system/update");
    expect(dirty.body.dirty).toBe(true);

    const refused = await json<{ error: { code: string; message: string } }>(
      t,
      "POST",
      "/api/system/update/apply",
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("update_refused");
  });

  test("an apply pulls, lands the commits, and wants a restart", async () => {
    base = mkdtempSync(join(tmpdir(), "onsen-update-"));
    const { seed, clone } = makeDeployment(base);
    const t = await signedIn(clone);
    pushCommit(seed, "second", "two\n");
    await json<UpdateStatusDto>(t, "POST", "/api/system/update/check");

    const { status, body } = await json<UpdateStatusDto>(t, "POST", "/api/system/update/apply");
    expect(status).toBe(200);
    expect(body.behind).toBe(0);
    expect(body.subject).toBe("second");
    expect(body.restartRequired).toBe(true);
    // The working tree really moved.
    expect(await Bun.file(join(clone, "version.txt")).text()).toBe("two\n");

    // The note survives a fresh read: only replacing the process clears it.
    const again = await json<UpdateStatusDto>(t, "GET", "/api/system/update");
    expect(again.body.restartRequired).toBe(true);
    expect(again.body.behind).toBe(0);
  });

  test("a directory with no checkout says so", async () => {
    base = mkdtempSync(join(tmpdir(), "onsen-update-"));
    const empty = join(base, "empty");
    mkdirSync(empty);
    const t = await signedIn(empty);

    const { body } = await json<UpdateStatusDto>(t, "GET", "/api/system/update");
    expect(body.mode).toBe("not_a_repo");

    const refused = await json<{ error: { code: string } }>(t, "POST", "/api/system/update/apply");
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("update_refused");
  });
});
