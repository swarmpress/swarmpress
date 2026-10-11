/**
 * WordPress for the headless runner (ADR-0079, plan M1): the GPL sandbox's Node entry and the
 * native storage API (`swarmpress-storage`, crates/storage-api) as two separate processes,
 * reached only by loopback HTTP. Nothing of the sandbox is imported here (CLAUDE.md rule 16): the
 * pinned release is fetched by `cargo xtask sandbox-fetch --node` into vendor/wp-sandbox/.
 *
 *   request  HTTP to the sandbox's port, served by WordPress
 *   repo     POST /repo on the storage service: the governed API
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export class WordPressUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WordPressUnavailableError";
  }
}

/** The verified, unpacked sandbox release under `root`/vendor/wp-sandbox/, or null. */
export function sandboxRelease(root: string): string | null {
  const vendor = join(root, "vendor/wp-sandbox");
  if (!existsSync(vendor)) return null;
  const pin = readFileSync(join(root, "config/wp-sandbox.toml"), "utf8").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const dir = pin ? join(vendor, `wp-sandbox-${pin}`) : null;
  return dir && existsSync(join(dir, ".verified")) ? dir : null;
}

/** The built `swarmpress-storage` binary (release first, then debug), or null. */
export function storageBinary(root: string): string | null {
  for (const p of ["target/release/swarmpress-storage", "target/debug/swarmpress-storage"]) if (existsSync(join(root, p))) return join(root, p);
  return null;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(url: string, child: ChildProcess, what: string, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null) throw new WordPressUnavailableError(`${what} exited with ${child.exitCode} before it answered`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > until) throw new WordPressUnavailableError(`${what} did not answer ${url} within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export interface NodeWordPressOptions {
  /** The swarm.press checkout (for vendor/, config/ and target/). */
  root: string;
  /** Where the storage service keeps the repository; default: a new temporary directory, removed on stop. */
  dataDir?: string;
  port?: number;
  storagePort?: number;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export interface NodeWordPress {
  url: string;
  storageUrl: string;
  request(path: string, init?: RequestInit): Promise<Response>;
  repo<T = unknown>(msg: Record<string, unknown>): Promise<T>;
  stop(): Promise<void>;
}

export async function startNodeWordPress(opts: NodeWordPressOptions): Promise<NodeWordPress> {
  const release = sandboxRelease(opts.root);
  if (!release) throw new WordPressUnavailableError("the sandbox release is not fetched: cargo xtask sandbox-fetch --node");
  if (!existsSync(join(release, "node_modules/@php-wasm/node"))) throw new WordPressUnavailableError("the sandbox's Node entry has no dependencies: cargo xtask sandbox-fetch --node");
  const bin = storageBinary(opts.root);
  if (!bin) throw new WordPressUnavailableError("swarmpress-storage is not built: cargo build -p storage-api --bin swarmpress-storage");
  const temp = opts.dataDir ? null : mkdtempSync(join(tmpdir(), "swarmpress-storage-"));
  const data = opts.dataDir ?? temp!;
  const port = opts.port ?? (await freePort());
  const storagePort = opts.storagePort ?? (await freePort());
  const url = `http://127.0.0.1:${port}`;
  const storageUrl = `http://127.0.0.1:${storagePort}`;
  const log = opts.log ?? (() => {});
  const timeout = opts.timeoutMs ?? 120_000;

  const children: ChildProcess[] = [];
  const stop = async () => {
    for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
    await Promise.all(children.map((c) => (c.exitCode !== null ? null : new Promise((r) => c.once("exit", r)))));
    if (temp) rmSync(temp, { recursive: true, force: true });
  };
  const pipe = (c: ChildProcess, name: string) => {
    c.stderr?.on("data", (d) => log(`${name}: ${String(d).trimEnd()}`));
    c.stdout?.on("data", (d) => log(`${name}: ${String(d).trimEnd()}`));
  };
  try {
    const storage = spawn(bin, ["--listen", `127.0.0.1:${storagePort}`, "--data", data], { stdio: ["ignore", "pipe", "pipe"] });
    children.push(storage);
    pipe(storage, "storage");
    await waitFor(`${storageUrl}/health`, storage, "swarmpress-storage", timeout);
    const sandbox = spawn("node", [join(release, "node/server.mjs"), "--port", String(port), "--storage", `${storageUrl}/storage`, "--url", url], {
      cwd: release,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(sandbox);
    pipe(sandbox, "sandbox");
    await waitFor(`${url}/__sandbox/health`, sandbox, "the sandbox's Node entry", timeout);
  } catch (e) {
    await stop();
    throw e;
  }
  return {
    url,
    storageUrl,
    request: (path, init) => fetch(url + path, { redirect: "manual", ...init }),
    async repo<T>(msg: Record<string, unknown>) {
      const r = await fetch(`${storageUrl}/repo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg) });
      return (await r.json()) as T;
    },
    stop,
  };
}

/**
 * The sandbox's conformance suite (ADR-0079) against a fresh Node WordPress: its own runner,
 * shipped in the release, writes JUnit and a benchmark document. Returns the suite's exit code.
 */
export async function runConformance(opts: NodeWordPressOptions & { junit: string; bench: string }): Promise<number> {
  const wp = await startNodeWordPress(opts);
  const raw = join(mkdtempSync(join(tmpdir(), "wp-bench-")), "bench.json");
  try {
    const release = sandboxRelease(opts.root)!;
    const child = spawn(
      "node",
      [join(release, "conformance/run.mjs"), "--sandbox", wp.url, "--repo", `${wp.storageUrl}/repo`, "--junit", opts.junit, "--bench", raw, "--backend", "php-wasm-node"],
      { stdio: "inherit" },
    );
    const code = await new Promise<number>((resolve) => child.once("exit", (c) => resolve(c ?? 1)));
    if (existsSync(raw)) {
      mkdirSync(dirname(opts.bench), { recursive: true });
      writeFileSync(opts.bench, JSON.stringify(benchmarkDoc(JSON.parse(readFileSync(raw, "utf8")), opts.root), null, 2) + "\n");
    }
    return code;
  } finally {
    await wp.stop();
    rmSync(dirname(raw), { recursive: true, force: true });
  }
}

/** The sandbox's raw numbers as a Cockpit benchmark document (`cockpit.benchmark.v1`, evidence `bench/wp-seam`). */
export function benchmarkDoc(raw: { backend: string; channel?: { messages: number; p50_us: number; p95_us: number; p99_us: number } | null; pages_ms?: Record<string, { n: number; median: number }> }, root: string) {
  const git = (...a: string[]) => {
    const r = spawnSync("git", a, { cwd: root, encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : "";
  };
  const m = (name: string, subject: string, unit: string, value: number, extra: Record<string, unknown> = {}) => ({
    name,
    subject,
    unit,
    value: Math.round(value),
    determinism: "environment-sensitive",
    direction: "lower_is_better",
    status: "pass",
    ...extra,
  });
  const subject = "Node sandbox → swarmpress-storage over loopback HTTP, per message";
  const c = raw.channel;
  return {
    schema: "cockpit.benchmark.v1",
    name: "wp-seam-sandbox-node",
    feature_ids: ["FEAT-105", "FEAT-107"],
    component: "content",
    provenance: {
      commit: git("rev-parse", "HEAD"),
      branch: git("rev-parse", "--abbrev-ref", "HEAD"),
      dirty: git("status", "--porcelain") !== "",
      generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      tool: { name: "swarmpress wp-conformance", version: "1" },
    },
    build: { profile: "release-artifact" },
    machine: { os: process.platform === "darwin" ? "macos" : process.platform, arch: process.arch === "arm64" ? "aarch64" : process.arch, runner: process.env.CI ? "ci" : "local" },
    workload: { backend: raw.backend, flows: "the conformance suite: install, front page x5, REST create, refused write on live, upload, merge, single post", messages: c?.messages ?? 0 },
    metrics: [
      ...(c
        ? [
            m("boundary.p50_us", subject, "us", c.p50_us),
            m("boundary.p95_us", subject, "us", c.p95_us, { reason: "go criterion: p95 < 2000 µs (M0)", status: c.p95_us < 2000 ? "pass" : "fail" }),
            m("boundary.p99_us", subject, "us", c.p99_us),
          ]
        : []),
      ...Object.entries(raw.pages_ms ?? {}).map(([page, v]) => m(`page.${page.replace(/\s+/g, "_")}_ms`, `${page} (median of ${v.n})`, "ms", v.median)),
    ],
  };
}

/** Releases the runner found, for `swarmpress wp-conformance`'s error message. */
export function describeSandbox(root: string): string {
  const vendor = join(root, "vendor/wp-sandbox");
  return existsSync(vendor) ? readdirSync(vendor).join(", ") || "(empty)" : "(no vendor/wp-sandbox)";
}
