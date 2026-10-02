import { describe, expect, test } from "bun:test";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATE_KINDS } from "../src/templates.ts";
import { CLI, EXAMPLES, simpress, tempDir } from "./helpers.ts";

const EXAMPLE_DIRS = ["harvest-season", "fact-checker", "coffee-machine-rule", "ligurian-ferries", "ghost-publisher"];

describe("examples pass check and test", () => {
  for (const ex of EXAMPLE_DIRS) {
    test(`simpress check examples/extensions/${ex}`, async () => {
      const r = await simpress("check", join(EXAMPLES, ex));
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(r.out).toContain("✓ dev.simpress.examples.");
    });
    test(`simpress test examples/extensions/${ex}`, async () => {
      const r = await simpress("test", join(EXAMPLES, ex));
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/(\d+)\/\1 scenario\(s\) passed/);
    });
  }
});

describe("simpress run", () => {
  test("prints a per-day hash summary", async () => {
    const r = await simpress("run", "--seed", "42", "--days", "2");
    expect(r.code).toBe(0);
    expect(r.out).toContain("day   1  step    12000");
    expect(r.out).toMatch(/final hash 0x[0-9a-f]{16} \(step 24000, day 2\)/);
  });

  test("--json drives every extension kind through the sandbox", async () => {
    const exts = EXAMPLE_DIRS.flatMap((e) => ["--ext", join(EXAMPLES, e)]);
    const r = await simpress("run", "--days", "1", "--json", ...exts);
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
    expect((await simpress("run", "--seed", "-1")).code).toBe(2);
    expect((await simpress("run", "--days", "x")).code).toBe(2);
    expect((await simpress("run", "--web", "maybe")).code).toBe(2);
    expect((await simpress("frobnicate")).code).toBe(2);
    expect((await simpress()).code).toBe(2);
    expect((await simpress("help")).code).toBe(0);
  });

  test("a missing client-wasm build tells you to run cargo xtask wasm", () => {
    const r = Bun.spawnSync([process.execPath, CLI, "run", "--days", "0"], {
      env: { ...process.env, SIMPRESS_WASM_PKG: "/nonexistent/pkg" },
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("cargo xtask wasm");
  });
});

describe("simpress new", () => {
  for (const kind of TEMPLATE_KINDS) {
    test(`a ${kind} scaffold passes check and test outside the monorepo`, async () => {
      const dir = join(tempDir(), `my-${kind}`);
      expect((await simpress("new", kind, dir)).code).toBe(0);
      const c = await simpress("check", dir);
      expect(c.err).toBe("");
      expect(c.code).toBe(0);
      const t = await simpress("test", dir);
      expect(t.err).toBe("");
      expect(t.code).toBe(0);
    });
  }

  test("refuses unknown kinds and non-empty folders", async () => {
    expect((await simpress("new", "theme", tempDir())).code).toBe(2);
    const dir = tempDir();
    writeFileSync(join(dir, "x"), "");
    expect((await simpress("new", "skill", dir)).code).toBe(1);
  });
});

describe("simpress check failures", () => {
  const copy = (ex: string) => {
    const dir = join(tempDir(), ex);
    cpSync(join(EXAMPLES, ex), dir, { recursive: true, filter: (p) => !p.includes("node_modules") && !p.includes("/dist") });
    return dir;
  };
  const edit = (dir: string, f: (m: any) => void) => {
    const p = join(dir, "simpress.ext.json");
    const m = JSON.parse(readFileSync(p, "utf8"));
    f(m);
    writeFileSync(p, JSON.stringify(m));
  };

  test("the runner refuses a mismatched sdk range", async () => {
    const dir = copy("harvest-season");
    edit(dir, (m) => (m.sdk = "^2.0.0"));
    const r = await simpress("check", dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain('sdk range "^2.0.0" does not accept');
  });

  test("schema errors in content files are reported per file", async () => {
    const dir = copy("harvest-season");
    const p = join(dir, "content", "happenings", "grape-harvest.json");
    const h = JSON.parse(readFileSync(p, "utf8"));
    h.primitives.push({ type: "cash", cents: 100000 });
    writeFileSync(p, JSON.stringify(h));
    const r = await simpress("check", dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain("content/happenings/grape-harvest.json: primitives.");
  });

  test("a missing content file and a missing manifest are errors", async () => {
    const dir = copy("harvest-season");
    edit(dir, (m) => m.entry.content.personas.push("content/personas/ghost.json"));
    expect((await simpress("check", dir)).err).toContain("ghost.json does not exist");
    expect((await simpress("check", tempDir())).err).toContain("no simpress.ext.json");
  });

  test("a bundle that does not export what its kind needs fails check", async () => {
    const dir = copy("fact-checker");
    writeFileSync(join(dir, "src", "index.ts"), "export default { hello() { return 1; } };\n");
    const r = await simpress("check", dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain("kind skill needs export runJob");
  });

  test("a sim rule that proposes floats fails check", async () => {
    const dir = copy("coffee-machine-rule");
    writeFileSync(
      join(dir, "src", "index.ts"),
      'import { defineRule } from "@simpress/sdk/runtime";\nexport default defineRule({ onDayStart: () => [{ type: "MoodBeat", delta: Math.random() }] });\n',
    );
    const r = await simpress("check", dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain("integers only");
  });

  test("simpress test reports a failing scenario and exits 1", async () => {
    const dir = copy("fact-checker");
    const p = join(dir, "test", "fact-check.scenario.json");
    const s = JSON.parse(readFileSync(p, "utf8"));
    s.jobs[0].expect.digest.score = 9;
    writeFileSync(p, JSON.stringify(s));
    const r = await simpress("test", dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain("does not match");
  });
});
