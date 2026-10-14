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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/** The built `swarmpress-storage` binary, the newer of the release and debug builds, or null. */
export function storageBinary(root: string): string | null {
  const built = ["target/release/swarmpress-storage", "target/debug/swarmpress-storage"].map((p) => join(root, p)).filter((p) => existsSync(p));
  built.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return built[0] ?? null;
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
  // A second, fresh site (its own sandbox and storage): the theme as data stays with its site (ADR-0093).
  let second: NodeWordPress | null = null;
  try {
    second = await startNodeWordPress({ ...opts, dataDir: undefined, port: undefined, storagePort: undefined });
    const release = sandboxRelease(opts.root)!;
    const child = spawn(
      "node",
      [
        join(release, "conformance/run.mjs"), "--sandbox", wp.url, "--repo", `${wp.storageUrl}/repo`, "--junit", opts.junit, "--bench", raw, "--backend", "php-wasm-node",
        "--sandbox2", second.url, "--repo2", `${second.storageUrl}/repo`,
      ],
      { stdio: "inherit" },
    );
    let code = await new Promise<number>((resolve) => child.once("exit", (c) => resolve(c ?? 1)));
    await second.stop();
    second = null;
    // Storage messages per kind of page (ADR-0084 §4), on a fresh site of their own.
    const queries = join(dirname(raw), "queries.json");
    const fresh = await startNodeWordPress({ ...opts, dataDir: undefined, port: undefined, storagePort: undefined });
    try {
      const q = spawn("node", [join(release, "conformance/queries.mjs"), "--sandbox", fresh.url, "--repo", `${fresh.storageUrl}/repo`, "--out", queries], { stdio: "inherit" });
      const qc = await new Promise<number>((resolve) => q.once("exit", (c) => resolve(c ?? 1)));
      if (qc !== 0) code = qc;
    } finally {
      await fresh.stop();
    }
    if (existsSync(raw)) {
      const counts = existsSync(queries) ? (JSON.parse(readFileSync(queries, "utf8")) as Record<string, number>) : {};
      const doc = benchmarkDoc(JSON.parse(readFileSync(raw, "utf8")), opts.root, counts);
      mkdirSync(dirname(opts.bench), { recursive: true });
      writeFileSync(opts.bench, JSON.stringify(doc, null, 2) + "\n");
      if (doc.metrics.some((m) => m.status === "fail")) code = code || 1;
    }
    return code;
  } finally {
    await second?.stop();
    await wp.stop();
    rmSync(dirname(raw), { recursive: true, force: true });
  }
}

/** The sandbox's raw numbers as a Cockpit benchmark document (`cockpit.benchmark.v1`, evidence `bench/wp-seam`). */
/**
 * Storage messages a page may cost (ADR-0084 §4, Generation 2): measured on 2026-10-11 (front page
 * 15, single post 22, category archive 19, tag archive 17, REST posts 13) plus 20%.
 */
export const MESSAGE_BUDGETS: Record<string, number> = { "front page": 18, "single post": 27, "category archive": 23, "tag archive": 21, "REST posts": 16 };

export function benchmarkDoc(raw: { backend: string; channel?: { messages: number; p50_us: number; p95_us: number; p99_us: number } | null; pages_ms?: Record<string, { n: number; median: number }> }, root: string, messages: Record<string, number> = {}) {
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
      ...Object.entries(messages).map(([page, n]) => {
        const max = MESSAGE_BUDGETS[page];
        return m(`messages.${page.replace(/\s+/g, "_")}`, `storage messages for one ${page}`, "count", n, {
          determinism: "deterministic",
          ...(max ? { budget: { max }, status: n <= max ? "pass" : "fail" } : {}),
        });
      }),
    ],
  };
}

/** Releases the runner found, for `swarmpress wp-conformance`'s error message. */
export function describeSandbox(root: string): string {
  const vendor = join(root, "vendor/wp-sandbox");
  return existsSync(vendor) ? readdirSync(vendor).join(", ") || "(empty)" : "(no vendor/wp-sandbox)";
}

/** The built `swarmpress-wp-migrate` CLI (content-import-wp, feature `cli`), the newer build, or null. */
export function migrateBinary(root: string): string | null {
  const built = ["target/release/swarmpress-wp-migrate", "target/debug/swarmpress-wp-migrate"].map((p) => join(root, p)).filter((p) => existsSync(p));
  return built.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

export interface MigrationOptions extends NodeWordPressOptions {
  /** The site repo's `content/` directory. */
  content: string;
  /** Where the plan, the export and the comparison go. */
  out: string;
  /** The live site's origin (the export's public origin, and what is compared against). */
  publicOrigin: string;
  /** A build of the frozen theme: its `index.html` files are the URLs compared. Without it, no comparison. */
  reference?: string;
  /** Live pages fetched once, kept here. */
  cache?: string;
  /** The site's own images the pages name by path (`/giulia_rossi.png`), uploaded as media. */
  assets?: string;
  /**
   * Where the export's forms post instead of WordPress (the platform's `/f/{company}`). Only with
   * it does the import compose the newsletter (the home's form, the header's button, the footer's
   * link): without an endpoint that answers, the site has no form (the owner's decision of 2026-10-13).
   */
  formsEndpoint?: string;
  /** Recorded Open-Meteo answers (`{lat},{lng}.json`) for the forecast blocks, instead of the network. */
  forecasts?: string;
  /**
   * The site's design as data (a `ThemeData` JSON file, ADR-0093; its font files relative to it):
   * the site is imported onto the neutral theme `canvas` and the data written over REST. Without
   * it, the fallback theme folder (Coast, or cinqueterre.travel's own).
   */
  themeData?: string;
}

/**
 * A JSON-block site moved onto a fresh Node WordPress (plan M8): WordPress installed, the import
 * plan applied on a branch and merged into live, live exported, and (with a reference build) the
 * export compared with the live site URL by URL. Returns the exit code of the first failing step.
 */
export async function runMigration(opts: MigrationOptions): Promise<number> {
  const bin = migrateBinary(opts.root);
  if (!bin) throw new WordPressUnavailableError("swarmpress-wp-migrate is not built: cargo build -p content-import-wp --features cli --release");
  mkdirSync(opts.out, { recursive: true });
  const run = (args: string[]) =>
    new Promise<number>((resolve) => spawn(bin, args, { stdio: "inherit" }).once("exit", (c) => resolve(c ?? 1)));
  const planFile = join(opts.out, "plan.json");
  let code = await run([
    "plan", "--content", opts.content, "--out", planFile,
    ...(opts.formsEndpoint ? ["--newsletter"] : []),
    ...(opts.themeData ? ["--theme-data", opts.themeData] : []),
  ]);
  if (code !== 0) return code;
  // The site's data outlives one PHP: the export runs on a fresh sandbox (php-wasm's memory grows
  // over the thousands of requests an import makes).
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), "swarmpress-migrate-"));
  let wp = await startNodeWordPress({ ...opts, dataDir, timeoutMs: opts.timeoutMs ?? 300_000 });
  try {
    const install = await wp.request("/wp-admin/install.php?step=2", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "weblog_title=Import&user_name=admin&admin_password=import-pass-1&admin_password2=import-pass-1&pw_weak=on&admin_email=ceo%40example.org&blog_public=1&Submit=Install",
    });
    const text = await install.text();
    if (install.status !== 200 || !text.includes("Success")) throw new Error(`install: ${install.status} ${text.slice(0, 200)}`);
    await wp.repo({ op: "import.finish" });
    code = await run(["apply", "--plan", planFile, "--sandbox", wp.url, "--repo", `${wp.storageUrl}/repo`, "--branch", "import-site", ...(opts.assets ? ["--assets", opts.assets] : [])]);
    if (code !== 0) return code;
    await wp.stop();
    // The same address: WordPress keeps the URL it was installed at.
    const at = new URL(wp.url);
    const storageAt = new URL(wp.storageUrl);
    wp = await startNodeWordPress({ ...opts, dataDir, port: Number(at.port), storagePort: Number(storageAt.port), timeoutMs: opts.timeoutMs ?? 300_000 });
    rmSync(join(opts.out, "export"), { recursive: true, force: true });
    code = await run([
      "export", "--sandbox", wp.url, "--repo", `${wp.storageUrl}/repo`, "--public-origin", opts.publicOrigin, "--out", join(opts.out, "export"),
      ...(opts.formsEndpoint ? ["--forms-endpoint", opts.formsEndpoint] : []),
      ...(opts.forecasts ? ["--forecasts", opts.forecasts] : []),
    ]);
    if (code !== 0) return code;
  } finally {
    await wp.stop();
    if (!opts.dataDir) rmSync(dataDir, { recursive: true, force: true });
  }
  if (!opts.reference) return 0;
  return run([
    "compare",
    "--reference", opts.reference,
    "--live", opts.publicOrigin,
    "--export", join(opts.out, "export"),
    "--out", join(opts.out, "compare.json"),
    "--plan", planFile,
    "--skip", "/test-", "--skip", "/template-",
    ...(opts.cache ? ["--cache", opts.cache] : []),
  ]);
}
