import { existsSync } from "node:fs";
import { join } from "node:path";
import type { UpdateStatusDto } from "../shared/types.ts";

/**
 * Self-update for a git-checkout deployment (SPEC §17).
 *
 * Three deployment modes ship — `bun run`, Docker, and the standalone
 * executable — and only the first runs from a checkout the updater can touch.
 * So the updater is honest about what it is: a `git pull --ff-only` with the
 * two steps a source deployment needs afterwards (`bun install`, a client
 * build), reported plainly. Anything else — a dirty tree, a diverged branch, no
 * git at all — is refused with a reason rather than worked around, because an
 * update that silently discards local changes is a destructive act dressed as
 * a convenience.
 *
 * The process cannot restart itself, so an applied update sets
 * `restartRequired`, which stays true until the process is replaced — the
 * memory of it living exactly as long as the code that needs restarting.
 */

const FETCH_TIMEOUT_MS = 30_000;
const GIT_TIMEOUT_MS = 10_000;

/** Set by `applyUpdate`, read by every status until the process is replaced. */
const pendingRestarts = new Set<string>();

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

async function git(repoDir: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: repoDir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } finally {
    clearTimeout(timer);
  }
}

/** `bun …`, via the binary this process itself runs under. */
async function bun(repoDir: string, args: string[]): Promise<GitResult> {
  const proc = Bun.spawn([process.execPath, ...args], {
    cwd: repoDir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
}

function emptyStatus(mode: UpdateStatusDto["mode"]): UpdateStatusDto {
  return {
    mode,
    branch: null,
    commit: null,
    subject: null,
    remoteUrl: null,
    dirty: false,
    ahead: null,
    behind: null,
    lastCheckedAt: null,
    error: null,
    restartRequired: false,
  };
}

/** Local facts only — no network, safe on every settings screen load. */
export async function readUpdateStatus(repoDir: string): Promise<UpdateStatusDto> {
  let inside: GitResult;
  try {
    inside = await git(repoDir, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    // The git binary itself is missing — a container or a machine that only
    // ever runs the built artifact.
    return emptyStatus("no_git");
  }
  if (!inside.ok) return emptyStatus("not_a_repo");

  const [branch, commit, subject, remote, porcelain, counts] = await Promise.all([
    git(repoDir, ["branch", "--show-current"]),
    git(repoDir, ["rev-parse", "HEAD"]),
    git(repoDir, ["log", "-1", "--format=%s"]),
    git(repoDir, ["remote", "get-url", "origin"]),
    git(repoDir, ["status", "--porcelain", "--untracked-files=no"]),
    git(repoDir, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]),
  ]);

  // `N\tM`: N commits only the upstream has (behind), M only this checkout
  // (ahead). Unknown before the first fetch, so failure means null, not zero.
  let ahead: number | null = null;
  let behind: number | null = null;
  if (counts.ok) {
    const [left, right] = counts.stdout.split("\t");
    const parsedBehind = Number(left);
    const parsedAhead = Number(right);
    if (Number.isFinite(parsedBehind) && Number.isFinite(parsedAhead)) {
      behind = parsedBehind;
      ahead = parsedAhead;
    }
  }

  return {
    mode: "git",
    branch: branch.ok && branch.stdout !== "" ? branch.stdout : null,
    commit: commit.ok ? commit.stdout : null,
    subject: subject.ok ? subject.stdout : null,
    remoteUrl: remote.ok ? remote.stdout : null,
    dirty: porcelain.ok ? porcelain.stdout !== "" : false,
    ahead,
    behind,
    lastCheckedAt: null,
    error: null,
    restartRequired: pendingRestarts.has(repoDir),
  };
}

/** Refresh the remote's refs, then report against them. */
export async function checkForUpdates(repoDir: string): Promise<UpdateStatusDto> {
  const status = await readUpdateStatus(repoDir);
  if (status.mode !== "git") return status;

  const fetch = await git(repoDir, ["fetch", "--prune", "origin"], FETCH_TIMEOUT_MS);
  if (!fetch.ok) {
    return { ...status, error: fetch.stderr === "" ? "git fetch failed." : fetch.stderr };
  }
  return { ...(await readUpdateStatus(repoDir)), lastCheckedAt: new Date().toISOString() };
}

export type UpdateRefusal =
  | { applied: false; reason: "unavailable" | "dirty" | "conflict"; message: string }
  | { applied: true; status: UpdateStatusDto };

/**
 * Pull, then make the tree runnable: `bun install` when dependencies moved, a
 * client build so the SPA the same process serves is the one the new code
 * expects. A failure in those steps is reported, not hidden — the tree is
 * already new at that point, and the restart note is still the truth.
 */
export async function applyUpdate(repoDir: string): Promise<UpdateRefusal> {
  const status = await readUpdateStatus(repoDir);
  if (status.mode !== "git") {
    return {
      applied: false,
      reason: "unavailable",
      message: "This deployment is not a git checkout. Update it by redeploying.",
    };
  }
  if (status.dirty) {
    return {
      applied: false,
      reason: "dirty",
      message: "Tracked files have local changes. Commit or stash them before updating.",
    };
  }

  const pull = await git(repoDir, ["pull", "--ff-only"], FETCH_TIMEOUT_MS);
  if (!pull.ok) {
    return {
      applied: false,
      reason: "conflict",
      message: pull.stderr === "" ? "git pull --ff-only failed." : pull.stderr,
    };
  }

  let error: string | null = null;
  if (existsSync(join(repoDir, "package.json"))) {
    const install = await bun(repoDir, ["install"]);
    if (!install.ok) error = `bun install failed: ${install.stderr || install.stdout}`;
    else {
      const build = await bun(repoDir, ["run", "build"]);
      if (!build.ok) error = `bun run build failed: ${build.stderr || build.stdout}`;
    }
  }

  pendingRestarts.add(repoDir);
  return { applied: true, status: { ...(await readUpdateStatus(repoDir)), error, restartRequired: true } };
}
