import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CapabilityError,
  MemoryStore,
  SandboxError,
  SandboxLimitError,
  createSandbox,
  type HostWeb,
  type SandboxOptions,
} from "../src/index.ts";
import { buildExample } from "./build-fixtures.ts";
import { runParity } from "./parity.ts";

async function withSandbox<T>(opts: Partial<SandboxOptions>, bundle: string, fn: (call: (p: string, a?: unknown) => Promise<any>) => Promise<T>) {
  const sb = await createSandbox({ capabilities: [], host: {}, ...opts });
  try {
    await sb.load(bundle);
    return await fn((p, a) => sb.call(p, a));
  } finally {
    sb.dispose();
  }
}

const okWeb: HostWeb = async (req) => ({ status: 200, headers: { "X-Echo": req.method }, body: JSON.stringify({ url: req.url, h: req.headers }) });

describe("capabilities", () => {
  test("only Bun, fetch (with web), console and simpress (with llm) are granted", async () => {
    const probe = `globalThis.ext = { probe: () => ({
      fetch: typeof fetch, process: typeof process, require: typeof require, simpress: typeof simpress,
      setTimeout: typeof setTimeout, env: Object.keys(Bun.env).length, bunKeys: Object.keys(Bun).sort(), std: typeof std, os: typeof os,
    }) }`;
    const none = await withSandbox({}, probe, (call) => call("probe"));
    expect(none).toEqual({
      fetch: "undefined",
      process: "undefined",
      require: "undefined",
      simpress: "undefined",
      setTimeout: "undefined",
      env: 0,
      bunKeys: ["env", "file", "write"],
      std: "undefined",
      os: "undefined",
    });
    const all = await withSandbox(
      { capabilities: ["web", "llm:low"], host: { web: okWeb, llm: async () => ({ text: "x" }) } },
      probe,
      (call) => call("probe"),
    );
    expect(all.fetch).toBe("function");
    expect(all.simpress).toBe("object");
  });

  test("fetch outside the declared origins is a CapabilityError", async () => {
    const b = `globalThis.ext = { get: async (u) => (await fetch(u)).json() }`;
    await withSandbox({ capabilities: ["web"], origins: ["https://allowed.example"], host: { web: okWeb } }, b, async (call) => {
      expect((await call("get", "https://allowed.example/a")).url).toBe("https://allowed.example/a");
      const e = await call("get", "https://evil.example/steal").catch((x) => x);
      expect(e).toBeInstanceOf(CapabilityError);
      expect(e.message).toContain("not in the manifest's origins");
      expect(await call("get", "file:///etc/passwd").catch((x) => x)).toBeInstanceOf(CapabilityError);
    });
  });

  test("an LLM tier that was not granted is denied", async () => {
    const b = `globalThis.ext = { ask: (tier) => simpress.llm.complete({ tier, prompt: "hi" }) }`;
    await withSandbox({ capabilities: ["llm:low"], host: { llm: async (r) => ({ text: `ok ${r.tier}` }) } }, b, async (call) => {
      expect((await call("ask", "low")).text).toBe("ok low");
      const e = await call("ask", "high").catch((x) => x);
      expect(e).toBeInstanceOf(CapabilityError);
      expect(e.capability).toBe("llm:high");
    });
  });
});

describe("store path scoping (Bun.file / Bun.write)", () => {
  const b = `globalThis.ext = {
    write: (a) => Bun.write(a.path, a.data),
    read: (p) => Bun.file(p).text(),
    json: (p) => Bun.file(p).json(),
    exists: (p) => Bun.file(p).exists(),
  }`;
  test("granted tables are read/write, pack files read-only, everything else denied", async () => {
    const store = new MemoryStore({ "pack/content/a.json": '{"a":1}' });
    await withSandbox({ capabilities: ["store:notes"], host: { store } }, b, async (call) => {
      expect(await call("write", { path: "store/notes/x.json", data: "{\"n\":1}" })).toBe(7);
      expect(await call("json", "store/notes/x.json")).toEqual({ n: 1 });
      expect(await call("json", "pack/content/a.json")).toEqual({ a: 1 });
      expect(await call("exists", "store/notes/missing.json")).toBe(false);
      expect(await call("read", "store/notes/missing.json").catch((e) => e.message)).toContain("ENOENT");
      for (const p of ["store/secrets/x.json", "store/notes/../secrets/x", "/etc/passwd", "../x", "store/notes", "pack/../store/notes/x.json"]) {
        const e = await call("read", p).catch((x) => x);
        expect(e).toBeInstanceOf(CapabilityError);
      }
      expect(await call("write", { path: "pack/content/a.json", data: "{}" }).catch((x) => x)).toBeInstanceOf(CapabilityError);
      expect(await call("write", { path: "store/notes/y", data: { not: "a string" } }).catch((x) => x.message)).toContain("string data only");
    });
    expect(store.files.get("store/notes/x.json")).toBe('{"n":1}');
    expect(store.files.get("pack/content/a.json")).toBe('{"a":1}');
  });
});

describe("limits", () => {
  test("an endless loop hits the interrupt budget", async () => {
    await withSandbox({ limits: { interruptOps: 1_000_000 } }, "globalThis.ext = { spin() { for (;;) {} } }", async (call) => {
      const e = await call("spin").catch((x) => x);
      expect(e).toBeInstanceOf(SandboxLimitError);
      expect(e.limit).toBe("ops");
    });
  });

  test("a busy call hits the wall-time budget", async () => {
    await withSandbox({ limits: { wallMs: 50, interruptOps: 1e12 } }, "globalThis.ext = { spin() { for (;;) {} } }", async (call) => {
      const t = Date.now();
      const e = await call("spin").catch((x) => x);
      expect(e).toBeInstanceOf(SandboxLimitError);
      expect(e.limit).toBe("wall");
      expect(Date.now() - t).toBeLessThan(2000);
    });
  });

  test("waiting on slow host I/O also counts against wall time", async () => {
    const slow: HostWeb = () => new Promise((r) => setTimeout(() => r({ status: 200, headers: {}, body: "" }), 500));
    await withSandbox(
      { capabilities: ["web"], limits: { wallMs: 50 }, host: { web: slow } },
      "globalThis.ext = { get: () => fetch('https://x.example/') }",
      async (call) => {
        const e = await call("get").catch((x) => x);
        expect(e).toBeInstanceOf(SandboxLimitError);
        expect(e.limit).toBe("wall");
      },
    );
  });

  test("allocating past the memory limit fails the call", async () => {
    const b = "globalThis.ext = { hog() { const a = []; for (;;) a.push('x'.repeat(1 << 16) + a.length); } }";
    await withSandbox({ limits: { memoryBytes: 8 * 1024 * 1024 } }, b, async (call) => {
      const e = await call("hog").catch((x) => x);
      expect(e).toBeInstanceOf(SandboxLimitError);
      expect(e.limit).toBe("memory");
    });
  });

  test("a promise that never settles fails instead of hanging", async () => {
    await withSandbox({}, "globalThis.ext = { hang: () => new Promise(() => {}) }", async (call) => {
      expect((await call("hang").catch((x) => x)).message).toContain("never settles");
    });
  });

  test("guest errors surface as SandboxError with the guest message", async () => {
    await withSandbox({}, "globalThis.ext = { boom() { throw new RangeError('nope') } }", async (call) => {
      const e = await call("boom").catch((x) => x);
      expect(e).toBeInstanceOf(SandboxError);
      expect(e.message).toBe("RangeError: nope");
    });
    const sb = await createSandbox({ capabilities: [], host: {} });
    expect(await sb.load("const x = 1;").catch((e) => e.message)).toContain("did not assign globalThis.ext");
    sb.dispose();
  });
});

describe("deterministic mode", () => {
  const b = `globalThis.ext = {
    probe: () => ({ r: [Math.random(), Math.random(), Math.random()], now: Date.now(), d: new Date().toISOString(),
                    explicit: new Date(0).toISOString(), fetch: typeof fetch, simpress: typeof simpress }),
    write: () => Bun.write("store/notes/x", "1"),
  }`;
  const run = (seed: number | string, nowMs = 1_767_225_600_000) =>
    withSandbox(
      {
        capabilities: ["web", "llm:low", "store:notes"],
        deterministic: { seed, nowMs },
        host: { web: okWeb, llm: async () => ({ text: "" }), store: new MemoryStore() },
      },
      b,
      (call) => call("probe"),
    );

  test("same seed, same output; Date pinned; no fetch or llm", async () => {
    const a = await run(42);
    const again = await run(42);
    expect(again).toEqual(a);
    expect(a.now).toBe(1_767_225_600_000);
    expect(a.d).toBe("2026-01-01T00:00:00.000Z");
    expect(a.explicit).toBe("1970-01-01T00:00:00.000Z");
    expect(a.fetch).toBe("undefined");
    expect(a.simpress).toBe("undefined");
    expect((await run(43)).r).not.toEqual(a.r);
  });

  test("per-call reseeding makes each call independent of call history", async () => {
    const sb = await createSandbox({ capabilities: [], deterministic: { seed: 1, nowMs: 0 }, host: {} });
    await sb.load(b);
    const x = await sb.call<any>("probe", null, { seed: "s:1", nowMs: 5 });
    await sb.call("probe");
    const y = await sb.call<any>("probe", null, { seed: "s:1", nowMs: 5 });
    expect(y.r).toEqual(x.r);
    expect(y.now).toBe(5);
    sb.dispose();
  });

  test("store writes are refused in deterministic mode", async () => {
    await withSandbox({ capabilities: ["store:notes"], deterministic: { seed: 1, nowMs: 0 }, host: { store: new MemoryStore() } }, b, async (call) => {
      expect(await call("write").catch((x) => x)).toBeInstanceOf(CapabilityError);
    });
  });
});

describe("async host functions", () => {
  test("chained awaits over delayed host I/O resolve in order", async () => {
    const delayed: HostWeb = (req) =>
      new Promise((r) => setTimeout(() => r({ status: 200, headers: {}, body: req.url.slice(-1) }), 5 + Math.random() * 10));
    const b = `globalThis.ext = { async seq() {
      const out = [];
      for (const n of [1, 2, 3]) out.push(await (await fetch('https://x.example/' + n)).text());
      const par = await Promise.all([4, 5, 6].map(async (n) => (await fetch('https://x.example/' + n)).text()));
      return out.concat(par);
    } }`;
    await withSandbox({ capabilities: ["web"], host: { web: delayed } }, b, async (call) => {
      expect(await call("seq")).toEqual(["1", "2", "3", "4", "5", "6"]);
    });
  });

  test("host rejections become guest exceptions that the guest can catch", async () => {
    const failing: HostWeb = async () => {
      throw new Error("proxy down");
    };
    const b = `globalThis.ext = { async get() { try { await fetch('https://x.example/'); return 'no'; } catch (e) { return e.message; } } }`;
    await withSandbox({ capabilities: ["web"], host: { web: failing } }, b, async (call) => expect(await call("get")).toBe("proxy down"));
  });

  test("console goes to the host log", async () => {
    const lines: string[] = [];
    await withSandbox({ host: { log: (l, m) => lines.push(`${l} ${m}`) } }, "globalThis.ext = { hi() { console.log('a', {b: 1}); console.warn(new Error('w')); } }", (call) =>
      call("hi"),
    );
    expect(lines).toEqual(['info a {"b":1}', "warn Error: w"]);
  });
});

describe("browser parity fixture", () => {
  test("the example bundles give the pinned result under Bun", async () => {
    const result = await runParity(createSandbox, MemoryStore, {
      factChecker: await buildExample("fact-checker"),
      coffee: await buildExample("coffee-machine-rule"),
    });
    const expected = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "parity.expected.json"), "utf8"));
    expect(JSON.parse(JSON.stringify(result))).toEqual(expected);
  });
});
