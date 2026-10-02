/**
 * `@simpress/sandbox`: runs one extension bundle in QuickJS compiled to wasm
 * (ADR-0042), with a Bun-compatible API subset and nothing else.
 *
 * The same code runs in the browser (in a Worker) and under Bun/Node (the
 * `simpress` runner), so an extension behaves identically in both.
 *
 * Globals inside the VM:
 * - `Bun.file(path).text()/json()/exists()`, `Bun.write(path, string)`: mapped to
 *   `host.store`, scoped to `store/<table>/…` (needs `store:<table>`) and
 *   read-only `pack/…` (the extension's own files);
 * - `Bun.env`: always `{}`;
 * - `fetch`: only with the `web` capability (and only to `origins`, when given);
 * - `simpress.llm.complete`: only with an `llm:<tier>` capability;
 * - `console.*`: routed to `host.log`;
 * - nothing else: no `process`, `require`, timers, filesystem or network.
 *
 * Deterministic mode (sim rules, challenges): `Math.random` is seeded,
 * `Date`/`Date.now()` are pinned, and `fetch`, `simpress.llm` and store
 * writes are unavailable.
 */
import { newQuickJSWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from "quickjs-emscripten-core";
import releaseSync from "@jitl/quickjs-wasmfile-release-sync";

// ---------------------------------------------------------------- errors

/** The extension threw, or returned something that is not JSON. */
export class SandboxError extends Error {
  readonly guestStack?: string;
  constructor(message: string, guestStack?: string) {
    super(message);
    this.name = "SandboxError";
    this.guestStack = guestStack;
  }
}

export type LimitKind = "memory" | "ops" | "wall" | "stack";

/** A memory, interrupt (ops), wall-time or stack limit was breached. */
export class SandboxLimitError extends SandboxError {
  readonly limit: LimitKind;
  constructor(limit: LimitKind, message: string) {
    super(message);
    this.name = "SandboxLimitError";
    this.limit = limit;
  }
}

/** The extension used something its capabilities do not grant. */
export class CapabilityError extends SandboxError {
  readonly capability: string;
  constructor(capability: string, message: string) {
    super(message);
    this.name = "CapabilityError";
    this.capability = capability;
  }
}

// ---------------------------------------------------------------- host interfaces

export interface HostStore {
  /** `null` when the path does not exist. */
  read(path: string): Promise<string | null>;
  write(path: string, data: string): Promise<void>;
}

export interface HostWebRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface HostWebResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  url?: string;
}

export type HostWeb = (req: HostWebRequest) => Promise<HostWebResponse>;
export type HostLlm = (req: { tier: string; system?: string; prompt: string; max_tokens?: number }) => Promise<{ text: string; [k: string]: unknown }>;
export type HostLog = (level: "debug" | "info" | "warn" | "error", message: string) => void;

export interface SandboxLimits {
  /** QuickJS heap limit in bytes. Default 32 MiB. */
  memoryBytes: number;
  /**
   * Approximate bytecode operations per call (QuickJS polls the interrupt
   * handler about every 10,000 ops, so the budget is enforced at that grain).
   * Default 100,000,000.
   */
  interruptOps: number;
  /** Wall-clock budget per call (including host I/O it awaits). Default 5,000 ms. */
  wallMs: number;
  /** Max native stack for the VM. Default 512 KiB. */
  stackBytes?: number;
}

export interface SandboxOptions {
  /** Granted capabilities: `web`, `credits`, `ui`, `llm:<tier>`, `store:<table>`. */
  capabilities: readonly string[];
  limits?: Partial<SandboxLimits>;
  /** Deterministic mode (sim rules): seeded `Math.random`, pinned `Date`, no async I/O. */
  deterministic?: { seed: number | bigint | string; nowMs: number };
  /** When set, `fetch` may only reach these origins (`https://host[:port]`). */
  origins?: readonly string[];
  host: { store?: HostStore; web?: HostWeb; llm?: HostLlm; log?: HostLog };
  /**
   * A QuickJS module to use instead of a fresh, memory-capped instance per
   * sandbox (then `memoryBytes` is only QuickJS's soft limit).
   */
  quickjs?: QuickJSWASMModule;
}

export interface CallOptions {
  /** Deterministic mode: reseed `Math.random` and re-pin `Date` for this call. */
  seed?: number | bigint | string;
  nowMs?: number;
}

export interface Sandbox {
  /** Evaluates a bundle; it must assign `globalThis.ext`. */
  load(bundleJs: string, fileName?: string): Promise<void>;
  /** Calls `ext.<exportPath>(arg)` (dot path), awaits it, returns its JSON result. */
  call<T = unknown>(exportPath: string, arg?: unknown, opts?: CallOptions): Promise<T>;
  /** Names of the functions `ext` exports (dot paths, one level deep into objects). */
  exports(): Promise<string[]>;
  dispose(): void;
}

export const DEFAULT_LIMITS: Required<SandboxLimits> = {
  memoryBytes: 32 * 1024 * 1024,
  interruptOps: 100_000_000,
  wallMs: 5_000,
  stackBytes: 512 * 1024,
};

/** QuickJS calls the interrupt handler about once per this many ops. */
const OPS_PER_POLL = 10_000;

// ---------------------------------------------------------------- QuickJS loading

const PAGE = 65536;
/** The release-sync build's own initial heap (256 pages); the memory cap is on top of it. */
const BASE_PAGES = 256;
/** The module's declared maximum (2 GiB). */
const MAX_PAGES = 32768;

let compiled: Promise<WebAssembly.Module> | undefined;
let cached: Promise<QuickJSWASMModule> | undefined;

/**
 * Where the QuickJS wasm comes from. Under Bun/Node it is read from
 * `@jitl/quickjs-wasmfile-release-sync`; a browser bundle passes the bytes (or a
 * compiled module) before creating sandboxes.
 */
export function configureQuickJS(opts: { wasmBinary?: ArrayBuffer; wasmModule?: WebAssembly.Module }): void {
  if (opts.wasmModule) compiled = Promise.resolve(opts.wasmModule);
  else if (opts.wasmBinary) compiled = WebAssembly.compile(opts.wasmBinary);
  cached = undefined;
}

async function defaultWasmBytes(): Promise<ArrayBuffer> {
  const meta = import.meta as ImportMeta & { resolve?: (s: string) => string };
  if (typeof meta.resolve !== "function") throw new SandboxError("call configureQuickJS({ wasmBinary }) before creating sandboxes in this environment");
  const url = new URL(meta.resolve("@jitl/quickjs-wasmfile-release-sync/wasm"));
  const bun = (globalThis as { Bun?: { file(u: URL): { arrayBuffer(): Promise<ArrayBuffer> } } }).Bun;
  if (bun) return bun.file(url).arrayBuffer();
  const fsName = "node:fs/promises";
  const fs = (await import(/* @vite-ignore */ fsName)) as { readFile(u: URL): Promise<Uint8Array> };
  const b = await fs.readFile(url);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function compiledModule(): Promise<WebAssembly.Module> {
  compiled ??= defaultWasmBytes()
    .then((b) => WebAssembly.compile(b))
    .catch((e) => {
      compiled = undefined;
      throw e;
    });
  return compiled;
}

/**
 * A fresh QuickJS instance whose wasm memory cannot grow past
 * `memoryBytes` above the base heap: the hard memory cap. (QuickJS's own
 * `setMemoryLimit` under-counts large blocks in this build, because
 * emscripten has no `malloc_usable_size`.) Instantiating from the cached
 * compiled module takes a few milliseconds.
 */
export async function instantiateQuickJS(memoryBytes: number): Promise<QuickJSWASMModule> {
  const wasmModule = await compiledModule();
  const maximum = Math.min(MAX_PAGES, BASE_PAGES + Math.ceil(memoryBytes / PAGE));
  const wasmMemory = new WebAssembly.Memory({ initial: BASE_PAGES, maximum });
  return newQuickJSWASMModuleFromVariant(newVariant(releaseSync, { wasmModule, wasmMemory }));
}

/** One shared QuickJS instance (no hard memory cap); sandboxes normally get their own. */
export function loadQuickJS(): Promise<QuickJSWASMModule> {
  cached ??= compiledModule().then((wasmModule) => newQuickJSWASMModuleFromVariant(newVariant(releaseSync, { wasmModule })));
  return cached;
}

// ---------------------------------------------------------------- helpers

/** FNV-1a 32-bit over the decimal/string form: folds any seed to a u32. */
export function foldSeed(seed: number | bigint | string): number {
  const s = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const PATH_RE = /^[A-Za-z0-9._@-]+(\/[A-Za-z0-9._@-]+)*$/;

/** In-memory `HostStore` (tests, the runner). `pack/…` entries are the extension's files. */
export class MemoryStore implements HostStore {
  readonly files = new Map<string, string>();
  constructor(initial?: Record<string, string>) {
    for (const [k, v] of Object.entries(initial ?? {})) this.files.set(k, v);
  }
  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }
  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
}

// The code that runs first inside every VM. It captures the raw host
// functions in a closure, deletes them from the global object, installs the
// Bun-compatible facade and returns the internal {call, reseed, exports}
// functions to the host.
const PRELUDE = String.raw`(function (H, CAPS, DET) {
  "use strict";
  var fmt = function (a) {
    if (typeof a === "string") return a;
    if (a instanceof Error) return a.name + ": " + a.message;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  };
  var mk = function (lvl) { return function () { H.log(lvl, Array.prototype.map.call(arguments, fmt).join(" ")); }; };
  globalThis.console = Object.freeze({ log: mk("info"), info: mk("info"), debug: mk("debug"), warn: mk("warn"), error: mk("error") });

  var file = function (path) {
    path = String(path);
    var text = function () {
      return H.read(path).then(function (t) {
        if (t === null) { var e = new Error("ENOENT: no such file or directory, open '" + path + "'"); e.code = "ENOENT"; throw e; }
        return t;
      });
    };
    return Object.freeze({
      name: path,
      text: text,
      json: function () { return text().then(function (t) { return JSON.parse(t); }); },
      exists: function () { return H.read(path).then(function (t) { return t !== null; }); },
    });
  };
  var write = function (path, data) {
    if (typeof data !== "string") return Promise.reject(new TypeError("Bun.write: the SimPress sandbox accepts string data only"));
    return H.write(String(path), data);
  };
  globalThis.Bun = Object.freeze({ file: file, write: write, env: Object.freeze({}) });

  if (H.fetch) {
    globalThis.fetch = function (url, init) {
      init = init || {};
      var headers = {};
      var src = init.headers || {};
      Object.keys(src).forEach(function (k) { headers[k] = String(src[k]); });
      var req = { method: String(init.method || "GET").toUpperCase(), headers: headers, body: init.body == null ? null : String(init.body) };
      return H.fetch(String(url), JSON.stringify(req)).then(function (raw) {
        var r = JSON.parse(raw);
        var lower = {};
        Object.keys(r.headers || {}).forEach(function (k) { lower[k.toLowerCase()] = r.headers[k]; });
        var h = Object.freeze({
          get: function (n) { var v = lower[String(n).toLowerCase()]; return v === undefined ? null : v; },
          has: function (n) { return lower[String(n).toLowerCase()] !== undefined; },
          forEach: function (cb) { Object.keys(lower).forEach(function (k) { cb(lower[k], k); }); },
        });
        return Object.freeze({
          status: r.status, ok: r.status >= 200 && r.status < 300, url: r.url || String(url), headers: h,
          text: function () { return Promise.resolve(r.body); },
          json: function () { return Promise.resolve().then(function () { return JSON.parse(r.body); }); },
        });
      });
    };
  }
  if (H.llm) {
    globalThis.simpress = Object.freeze({
      llm: Object.freeze({ complete: function (req) { return H.llm(JSON.stringify(req)).then(function (t) { return JSON.parse(t); }); } }),
    });
  }

  var state = 0, NOW = 0;
  var reseed = function (seed, now) { state = seed | 0; NOW = now; };
  if (DET) {
    reseed(DET.seed, DET.nowMs);
    Math.random = function () {
      state = (state + 0x6d2b79f5) | 0;
      var t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    var RealDate = Date;
    var PinnedDate = function Date() {
      var a = Array.prototype.slice.call(arguments);
      if (!new.target) return new RealDate(NOW).toString();
      return a.length ? new (Function.prototype.bind.apply(RealDate, [null].concat(a)))() : new RealDate(NOW);
    };
    PinnedDate.prototype = RealDate.prototype;
    PinnedDate.now = function () { return NOW; };
    PinnedDate.UTC = RealDate.UTC;
    PinnedDate.parse = RealDate.parse;
    globalThis.Date = PinnedDate;
  }

  var resolve = function (path) {
    var ext = globalThis.ext;
    if (ext == null || (typeof ext !== "object" && typeof ext !== "function")) throw new TypeError("the bundle did not assign globalThis.ext");
    var parts = String(path).split(".");
    var self = ext, fn = ext;
    for (var i = 0; i < parts.length; i++) {
      self = fn;
      fn = fn == null ? undefined : fn[parts[i]];
    }
    if (typeof fn !== "function") throw new TypeError("ext." + path + " is not a function");
    return { self: self, fn: fn };
  };
  var call = function (path, argJson) {
    return Promise.resolve().then(function () {
      var r = resolve(path);
      return r.fn.call(r.self, JSON.parse(argJson));
    }).then(function (v) {
      return JSON.stringify(v === undefined ? null : v);
    });
  };
  var exportsOf = function () {
    var ext = globalThis.ext, out = [];
    if (ext == null) return "[]";
    Object.keys(ext).sort().forEach(function (k) {
      if (typeof ext[k] === "function") out.push(k);
      else if (ext[k] && typeof ext[k] === "object" && !Array.isArray(ext[k]))
        Object.keys(ext[k]).sort().forEach(function (j) { if (typeof ext[k][j] === "function") out.push(k + "." + j); });
    });
    return JSON.stringify(out);
  };
  return { call: call, reseed: reseed, exports: exportsOf };
})`;

// ---------------------------------------------------------------- the sandbox

export async function createSandbox(opts: SandboxOptions): Promise<Sandbox> {
  const limits: Required<SandboxLimits> = { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) } as Required<SandboxLimits>;
  const caps = new Set(opts.capabilities);
  const det = opts.deterministic;
  const qjs = opts.quickjs ?? (await instantiateQuickJS(limits.memoryBytes));
  const rt: QuickJSRuntime = qjs.newRuntime();
  rt.setMemoryLimit(limits.memoryBytes);
  rt.setMaxStackSize(limits.stackBytes);
  const vm: QuickJSContext = rt.newContext();
  const log: HostLog = opts.host.log ?? (() => {});
  let alive = true;
  /** Set after a limit breach or an unsettled call: the runtime may hold live objects. */
  let poisoned: string | null = null;

  // budget for the current load/call
  let polls = 0;
  let deadline = Infinity;
  let tripped: LimitKind | null = null;
  const maxPolls = Math.max(1, Math.ceil(limits.interruptOps / OPS_PER_POLL));
  rt.setInterruptHandler(() => {
    polls++;
    if (polls > maxPolls) tripped ??= "ops";
    else if (Date.now() > deadline) tripped ??= "wall";
    return tripped !== null;
  });
  const begin = () => {
    polls = 0;
    tripped = null;
    deadline = Date.now() + limits.wallMs;
  };

  // async plumbing
  let pending = 0;
  let jobError: unknown = null;
  let wake: (() => void) | null = null;
  let generation = 0;
  const pump = () => {
    if (!alive) return;
    const r = rt.executePendingJobs();
    if (r.error) {
      jobError ??= dumpError(r.error);
      r.error.dispose();
    }
  };
  const notify = () => {
    generation++;
    const w = wake;
    wake = null;
    w?.();
  };

  const dumpError = (h: QuickJSHandle): unknown => {
    try {
      return vm.dump(h);
    } catch {
      return { name: "InternalError", message: "out of memory" };
    }
  };

  const toError = (raw: unknown): Error => {
    const e = classify(raw);
    if (e instanceof SandboxLimitError) poisoned ??= e.message;
    return e;
  };
  const classify = (raw: unknown): Error => {
    if (tripped === "ops")
      return new SandboxLimitError("ops", `extension exceeded its interrupt budget (~${limits.interruptOps} ops)`);
    if (tripped === "wall") return new SandboxLimitError("wall", `extension exceeded its wall-time budget (${limits.wallMs} ms)`);
    const e = (raw ?? {}) as { name?: string; message?: string; stack?: string; capability?: string };
    const name = e.name ?? "Error";
    const message = e.message ?? String(raw);
    if (name === "CapabilityError") return new CapabilityError(e.capability ?? "unknown", message);
    if (/out of memory/i.test(message) || raw === null)
      return new SandboxLimitError("memory", `extension exceeded its memory limit (${limits.memoryBytes} bytes)`);
    if (/stack overflow/i.test(message)) return new SandboxLimitError("stack", "extension overflowed its stack");
    return new SandboxError(`${name}: ${message}`, e.stack);
  };

  const guestError = (err: unknown): QuickJSHandle => {
    const e = err as { name?: string; message?: string; capability?: string };
    const h = vm.newError({ name: e?.name ?? "Error", message: e?.message ?? String(err) });
    if (e?.capability) vm.setProp(h, "capability", vm.newString(e.capability));
    return h;
  };

  /** A host function returning a guest promise that settles when `impl` does. */
  const asyncFn = (name: string, impl: (...args: any[]) => Promise<string | number | null>) =>
    vm.newFunction(name, (...argHandles) => {
      const args = argHandles.map((h) => vm.dump(h));
      const deferred = vm.newPromise();
      pending++;
      let p: Promise<string | number | null>;
      try {
        p = impl(...args);
      } catch (e) {
        p = Promise.reject(e);
      }
      p.then(
        (v) => {
          if (!alive) return;
          const h = v === null ? vm.null : typeof v === "number" ? vm.newNumber(v) : vm.newString(v);
          deferred.resolve(h);
          if (h !== vm.null) h.dispose();
        },
        (err) => {
          if (!alive) return;
          const h = guestError(err);
          deferred.reject(h);
          h.dispose();
        },
      ).finally(() => {
        pending--;
        pump();
        notify();
      });
      return deferred.handle;
    });

  // ---- capability checks (the real enforcement lives here, host-side)
  const storeTables = new Set([...caps].filter((c) => c.startsWith("store:")).map((c) => c.slice(6)));
  const checkPath = (path: string, write: boolean): void => {
    if (!PATH_RE.test(path) || path.split("/").some((s) => s === "." || s === ".."))
      throw new CapabilityError("store", `path ${JSON.stringify(path)} is not a relative store path`);
    const [root, table, ...rest] = path.split("/");
    if (root === "pack" && table !== undefined) {
      if (write) throw new CapabilityError("store", `pack files are read-only: ${path}`);
      return;
    }
    if (root === "store" && table !== undefined && rest.length > 0) {
      if (!storeTables.has(table)) throw new CapabilityError(`store:${table}`, `capability not granted: store:${table} (path ${path})`);
      if (write && det) throw new CapabilityError(`store:${table}`, "store writes are not available in deterministic mode");
      return;
    }
    throw new CapabilityError("store", `path ${JSON.stringify(path)} is outside store/<table>/… and pack/…`);
  };
  const store = opts.host.store;
  const origins = opts.origins ? new Set(opts.origins) : null;
  const llmTiers = new Set([...caps].filter((c) => c.startsWith("llm:")).map((c) => c.slice(4)));

  const H = vm.newObject();
  const install = (name: string, fn: QuickJSHandle) => {
    vm.setProp(H, name, fn);
    fn.dispose();
  };
  install(
    "log",
    vm.newFunction("log", (lvl, msg) => {
      log(vm.getString(lvl) as "info", vm.getString(msg));
    }),
  );
  install(
    "read",
    asyncFn("read", async (path: string) => {
      checkPath(path, false);
      if (!store) throw new CapabilityError("store", "this host has no store");
      return store.read(path);
    }),
  );
  install(
    "write",
    asyncFn("write", async (path: string, data: string) => {
      checkPath(path, true);
      if (!store) throw new CapabilityError("store", "this host has no store");
      await store.write(path, data);
      return data.length;
    }),
  );
  if (caps.has("web") && !det && opts.host.web) {
    const web = opts.host.web;
    install(
      "fetch",
      asyncFn("fetch", async (url: string, initJson: string) => {
        let u: URL;
        try {
          u = new URL(url);
        } catch {
          throw new TypeError(`fetch: invalid URL ${JSON.stringify(url)}`);
        }
        if (u.protocol !== "https:" && u.protocol !== "http:") throw new CapabilityError("web", `fetch: scheme ${u.protocol} is not allowed`);
        if (origins && !origins.has(u.origin))
          throw new CapabilityError("web", `fetch: origin ${u.origin} is not in the manifest's origins`);
        const init = JSON.parse(initJson) as { method: string; headers: Record<string, string>; body: string | null };
        const res = await web({ url: u.toString(), method: init.method, headers: init.headers, body: init.body });
        return JSON.stringify({ status: res.status, headers: res.headers ?? {}, body: res.body ?? "", url: res.url ?? u.toString() });
      }),
    );
  }
  if (llmTiers.size > 0 && !det && opts.host.llm) {
    const llm = opts.host.llm;
    install(
      "llm",
      asyncFn("llm", async (reqJson: string) => {
        const req = JSON.parse(reqJson);
        if (!llmTiers.has(String(req?.tier))) throw new CapabilityError(`llm:${req?.tier}`, `capability not granted: llm:${req?.tier}`);
        return JSON.stringify(await llm(req));
      }),
    );
  }

  // ---- prelude
  begin();
  const preludeFn = vm.unwrapResult(vm.evalCode(PRELUDE, "simpress-prelude.js"));
  const capsH = vm.unwrapResult(vm.evalCode(JSON.stringify([...caps].sort())));
  const detH = det
    ? vm.unwrapResult(vm.evalCode(`(${JSON.stringify({ seed: foldSeed(det.seed), nowMs: det.nowMs })})`))
    : vm.null;
  const internals = vm.unwrapResult(vm.callFunction(preludeFn, vm.undefined, H, capsH, detH));
  preludeFn.dispose();
  capsH.dispose();
  if (detH !== vm.null) detH.dispose();
  H.dispose();
  const callFn = vm.getProp(internals, "call");
  const reseedFn = vm.getProp(internals, "reseed");
  const exportsFn = vm.getProp(internals, "exports");
  internals.dispose();

  /** Awaits a guest promise handle, pumping jobs and host I/O, within the call budget. */
  const settle = async (promiseH: QuickJSHandle): Promise<string> => {
    const native = vm.resolvePromise(promiseH);
    promiseH.dispose();
    let done = false;
    native.then(
      () => (done = true),
      () => (done = true),
    );
    jobError = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((r) => {
      timer = setTimeout(() => r("timeout"), Math.max(0, deadline - Date.now()));
    });
    try {
      pump();
      for (;;) {
        const gen = generation;
        await Promise.resolve();
        await Promise.resolve();
        if (done) break;
        if (jobError !== null || tripped) throw toError(jobError);
        if (rt.hasPendingJob()) {
          pump();
          continue;
        }
        if (pending === 0) {
          // one more turn for resolvePromise's callbacks, then give up
          await new Promise((r) => setTimeout(r, 0));
          if (done) break;
          throw new SandboxError("the call returned a promise that never settles");
        }
        if (gen !== generation) continue;
        const w = new Promise<void>((r) => (wake = r));
        const r = await Promise.race([w, timeout]);
        if (r === "timeout") {
          tripped = "wall";
          throw toError(null);
        }
      }
    } catch (e) {
      poisoned = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const result = await native;
    if (result.error) {
      const raw = dumpError(result.error);
      result.error.dispose();
      throw toError(raw);
    }
    const s = vm.typeof(result.value) === "string" ? vm.getString(result.value) : "null";
    result.value.dispose();
    return s;
  };

  const ensure = () => {
    if (!alive) throw new SandboxError("sandbox disposed");
    if (poisoned) throw new SandboxError(`sandbox is unusable after: ${poisoned}; create a new one`);
  };

  return {
    async load(bundleJs: string, fileName = "extension.js") {
      ensure();
      begin();
      const r = vm.evalCode(bundleJs, fileName);
      if (r.error) {
        const raw = dumpError(r.error);
        r.error.dispose();
        throw toError(raw);
      }
      r.value.dispose();
      pump();
      if (jobError) throw toError(jobError);
      const t = vm.unwrapResult(vm.evalCode("typeof globalThis.ext"));
      const ty = vm.getString(t);
      t.dispose();
      if (ty !== "object" && ty !== "function") throw new SandboxError("the bundle did not assign globalThis.ext");
    },

    async call<T>(exportPath: string, arg?: unknown, callOpts?: CallOptions): Promise<T> {
      ensure();
      begin();
      if (det && (callOpts?.seed !== undefined || callOpts?.nowMs !== undefined)) {
        const s = vm.newNumber(foldSeed(callOpts.seed ?? det.seed));
        const n = vm.newNumber(callOpts.nowMs ?? det.nowMs);
        vm.unwrapResult(vm.callFunction(reseedFn, vm.undefined, s, n)).dispose();
        s.dispose();
        n.dispose();
      }
      let argJson: string;
      try {
        argJson = JSON.stringify(arg ?? null);
      } catch (e) {
        throw new SandboxError(`argument is not JSON: ${(e as Error).message}`);
      }
      const pathH = vm.newString(exportPath);
      const argH = vm.newString(argJson);
      const r = vm.callFunction(callFn, vm.undefined, pathH, argH);
      pathH.dispose();
      argH.dispose();
      if (r.error) {
        const raw = dumpError(r.error);
        r.error.dispose();
        throw toError(raw);
      }
      const json = await settle(r.value);
      return JSON.parse(json) as T;
    },

    async exports() {
      ensure();
      begin();
      const r = vm.unwrapResult(vm.callFunction(exportsFn, vm.undefined));
      const s = vm.getString(r);
      r.dispose();
      return JSON.parse(s) as string[];
    },

    dispose() {
      if (!alive) return;
      alive = false;
      if (poisoned || pending > 0) {
        // The runtime may still reference guest objects (an unsettled call, a
        // breached limit); freeing it could abort the wasm instance. Each
        // sandbox has its own instance, so drop it and let the GC take it.
        return;
      }
      try {
        callFn.dispose();
        reseedFn.dispose();
        exportsFn.dispose();
        vm.dispose();
        rt.dispose();
      } catch {
        // same: an instance that cannot be freed cleanly is simply dropped
      }
    },
  };
}
