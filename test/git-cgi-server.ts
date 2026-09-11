/**
 * A standalone smart-HTTP git server for `packs.test.ts`'s "install from a
 * repository URL" fixture, run as a genuinely separate process.
 *
 * It has to be a separate process rather than an in-process `Bun.serve`: the
 * route under test calls `Bun.spawnSync(["git", "clone", ...])`, which blocks
 * the test's own event loop until the clone finishes — so a server living in
 * that same process could never run its `fetch` handler to answer the clone
 * it is itself waiting on. Shelling out to git's own `http-backend` CGI
 * program is simpler and more faithful than reimplementing the smart-HTTP
 * wire protocol, and it is the only backend that supports `--depth 1`
 * (plain static-file serving only speaks the older "dumb" protocol, which
 * git refuses to shallow-clone from).
 *
 * Usage: `bun run git-cgi-server.ts <repo-dir>` — prints `READY <port>` to
 * stdout once listening, then serves until killed.
 */
import { spawn } from "node:child_process";

const dir = process.argv[2];
if (dir === undefined) {
  console.error("usage: git-cgi-server.ts <repo-dir>");
  process.exit(1);
}

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const child = spawn("git", ["http-backend"], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: dir,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method,
        CONTENT_TYPE: request.headers.get("content-type") ?? "",
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    child.stdin.end(request.method === "POST" ? Buffer.from(await request.arrayBuffer()) : undefined);
    const chunks: Buffer[] = [];
    for await (const chunk of child.stdout) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const split = raw.indexOf("\r\n\r\n");
    const headers = new Headers();
    let status = 200;
    for (const line of raw.subarray(0, split).toString().split("\r\n")) {
      const at = line.indexOf(":");
      if (at < 0) continue;
      const key = line.slice(0, at).trim();
      const value = line.slice(at + 1).trim();
      if (key.toLowerCase() === "status") status = parseInt(value, 10) || 200;
      else headers.set(key, value);
    }
    return new Response(raw.subarray(split + 4), { status, headers });
  },
});

console.log(`READY ${server.port}`);
