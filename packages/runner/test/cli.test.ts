import { describe, expect, test } from "bun:test";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATE_KINDS } from "../src/templates.ts";
import { CLI, EXAMPLES, swarmpress, tempDir } from "./helpers.ts";

const EXAMPLE_DIRS = ["harvest-season", "fact-checker", "coffee-machine-rule", "ligurian-ferries", "ghost-publisher"];

describe("examples pass check and test", () => {
  for (const ex of EXAMPLE_DIRS) {
    test(`swarmpress check examples/extensions/${ex}`, async () => {
      const r = await swarmpress("check", join(EXAMPLES, ex));
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(r.out).toContain("✓ press.swarm.examples.");
    });
    test(`swarmpress test examples/extensions/${ex}`, async () => {
      const r = await swarmpress("test", join(EXAMPLES, ex));
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/(\d+)\/\1 scenario\(s\) passed/);
    });
  }
});

describe("swarmpress run", () => {
  test("prints a per-day hash summary", async () => {
    const r = await swarmpress("run", "--seed", "42", "--days", "2");
    expect(r.code).toBe(0);
    expect(r.out).toContain("day   1  step    12000");
    expect(r.out).toMatch(/final hash 0x[0-9a-f]{16} \(step 24000, day 2\)/);
  });

  test("--json drives every extension kind through the sandbox", async () => {
    const exts = EXAMPLE_DIRS.flatMap((e) => ["--ext", join(EXAMPLES, e)]);
    const r = await swarmpress("run", "--days", "1", "--json", ...exts);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out);
    expect(report.sim.days).toHaveLength(1);
    expect(report.sim.commands.length).toBeGreaterThan(0);
    expect(report.sim.commands.every((c: { status: string }) => c.status === "proposed")).toBe(true);
    const by = Object.fromEntries(report.extensions.map((e: { id: string }) => [e.id.split(".").pop(), e]));
    expect(by["harvest-season"].content.personas).toEqual(["Rosa"]);
    expect(by["fact-checker"].jobs[0].digest).toMatchObject({ ok: true, score: 10, qa_defects: 0 });
    expect(by["ligurian-ferries"].polls[0].facts[0].kind).toBe("transport");
    expect(by["ligurian-ferries"].polls[0].happenings[0].title).toContain("Vernazza");
    expect(by["ghost-publisher"].publish.status.state).toBe("deployed");
  });

  test("bad flags are usage errors (exit 2)", async () => {
    expect((await swarmpress("run", "--seed", "-1")).code).toBe(2);
    expect((await swarmpress("run", "--days", "x")).code).toBe(2);
    expect((await swarmpress("run", "--web", "maybe")).code).toBe(2);
    expect((await swarmpress("frobnicate")).code).toBe(2);
    expect((await swarmpress()).code).toBe(2);
    expect((await swarmpress("help")).code).toBe(0);
  });

  test("a missing client-wasm build tells you to run cargo xtask wasm", () => {
    const r = Bun.spawnSync([process.execPath, CLI, "run", "--days", "0"], {
      env: { ...process.env, SWARMPRESS_WASM_PKG: "/nonexistent/pkg" },
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("cargo xtask wasm");
  });
});

describe("swarmpress new", () => {
  for (const kind of TEMPLATE_KINDS) {
    test(`a ${kind} scaffold passes check and test outside the monorepo`, async () => {
      const dir = join(tempDir(), `my-${kind}`);
      expect((await swarmpress("new", kind, dir)).code).toBe(0);
      const c = await swarmpress("check", dir);
      expect(c.err).toBe("");
      expect(c.code).toBe(0);
      const t = await swarmpress("test", dir);
      expect(t.err).toBe("");
      expect(t.code).toBe(0);
    });
  }

  test("refuses unknown kinds and non-empty folders", async () => {
    expect((await swarmpress("new", "theme", tempDir())).code).toBe(2);
    const dir = tempDir();
    writeFileSync(join(dir, "x"), "");
    expect((await swarmpress("new", "skill", dir)).code).toBe(1);
  });
});

describe("swarmpress check failures", () => {
  const copy = (ex: string) => {
    const dir = join(tempDir(), ex);
    cpSync(join(EXAMPLES, ex), dir, { recursive: true, filter: (p) => !p.includes("node_modules") && !p.includes("/dist") });
    return dir;
  };
  const edit = (dir: string, f: (m: any) => void) => {
    const p = join(dir, "swarmpress.ext.json");
    const m = JSON.parse(readFileSync(p, "utf8"));
    f(m);
    writeFileSync(p, JSON.stringify(m));
  };

  test("the runner refuses a mismatched sdk range", async () => {
    const dir = copy("harvest-season");
    edit(dir, (m) => (m.sdk = "^2.0.0"));
    const r = await swarmpress("check", dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain('sdk range "^2.0.0" does not accept');
  });

  test("schema errors in content files are reported per file", async () => {
    const dir = copy("harvest-season");
    const p = join(dir, "content", "happenings", "grape-harvest.json");
    const h = JSON.parse(readFileSync(p, "utf8"));
    h.primitives.push({ type: "cash", cents: 100000 });
    writeFileSync(p, JSON.stringify(h));
    const r = await swarmpress("check", dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain("content/happenings/grape-harvest.json: primitives.");
  });

  test("a missing content file and a missing manifest are errors", async () => {
    const dir = copy("harvest-season");
    edit(dir, (m) => m.entry.content.personas.push("content/personas/ghost.json"));
    expect((await swarmpress("check", dir)).err).toContain("ghost.json does not exist");
    expect((await swarmpress("check", tempDir())).err).toContain("no swarmpress.ext.json");
  });

  test("a bundle that does not export what its kind needs fails check", async () => {
    const dir = copy("fact-checker");
    writeFileSync(join(dir, "src", "index.ts"), "export default { hello() { return 1; } };\n");
    const r = await swarmpress("check", dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain("kind skill needs export runJob");
  });

  test("a sim rule that proposes floats fails check", async () => {
    const dir = copy("coffee-machine-rule");
    writeFileSync(
      join(dir, "src", "index.ts"),
      'import { defineRule } from "@swarm-press/sdk/runtime";\nexport default defineRule({ onDayStart: () => [{ type: "MoodBeat", delta: Math.random() }] });\n',
    );
    const r = await swarmpress("check", dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain("integers only");
  });

  test("swarmpress test reports a failing scenario and exits 1", async () => {
    const dir = copy("fact-checker");
    const p = join(dir, "test", "fact-check.scenario.json");
    const s = JSON.parse(readFileSync(p, "utf8"));
    s.jobs[0].expect.digest.score = 9;
    writeFileSync(p, JSON.stringify(s));
    const r = await swarmpress("test", dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain("does not match");
  });
});
