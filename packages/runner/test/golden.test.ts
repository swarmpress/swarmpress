import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { simulate } from "../src/engine.ts";
import { loadSim } from "../src/wasm.ts";

/**
 * Determinism evidence (ADR-0042: browser hash = Bun hash = native hash).
 * The same fixture is asserted natively and under wasm-bindgen-test by
 * crates/client-wasm/tests/runner_golden.rs.
 */
const golden = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "golden.json"), "utf8")) as {
  steps_per_day: number;
  cases: Array<{ world: "demo" | "empty"; seed: string; days: number; hash: string }>;
};

describe("golden hashes under the Bun runner", () => {
  for (const c of golden.cases) {
    test(`${c.world} seed ${c.seed} after ${c.days} day(s) = ${c.hash}`, async () => {
      const r = await simulate({ seed: BigInt(c.seed), days: c.days, world: c.world });
      expect(r.stepsPerDay).toBe(golden.steps_per_day);
      expect(r.final.step).toBe(c.days * golden.steps_per_day);
      expect(r.final.hash).toBe(c.hash);
    });
  }

  test("per-day hashes are a prefix of longer runs (fast-forward is chunk-independent)", async () => {
    const three = await simulate({ seed: 42n, days: 3 });
    const one = await simulate({ seed: 42n, days: 1 });
    expect(three.days[0]).toEqual(one.days[0]);
    const g1 = golden.cases.find((c) => c.world === "demo" && c.seed === "42" && c.days === 1)!;
    const g3 = golden.cases.find((c) => c.world === "demo" && c.seed === "42" && c.days === 3)!;
    expect(three.days[0].hash).toBe(g1.hash);
    expect(three.days[2].hash).toBe(g3.hash);
  });

  test("the runner loads the proto version the SDK speaks", async () => {
    expect((await loadSim()).version()).toMatch(/proto v3$/);
  });
});
