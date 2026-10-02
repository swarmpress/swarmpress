import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hex, loadSim } from "../src/wasm.ts";

/**
 * World snapshots under Bun (FEAT-060, ADR-0046): a sim rebuilt from its
 * snapshot is the same sim. The expected hashes are the shared golden fixture,
 * so this is the Bun leg of "native = wasm = Bun" with a snapshot in the
 * middle; crates/client-wasm/tests/snapshot_wasm.rs asserts the same file
 * natively and under wasm-bindgen-test.
 */
const golden = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "golden.json"), "utf8")) as {
  steps_per_day: number;
  cases: Array<{ world: "demo" | "empty"; seed: string; days: number; hash: string }>;
};

describe("world snapshots under the Bun runner", () => {
  for (const c of golden.cases) {
    test(`${c.world} seed ${c.seed}: a snapshot and restore after each of ${c.days} day(s) still gives ${c.hash}`, async () => {
      const m = await loadSim();
      let sim = c.world === "demo" ? m.demo(BigInt(c.seed)) : m.empty(BigInt(c.seed));
      for (let day = 0; day < c.days; day++) {
        sim.advance(golden.steps_per_day);
        const at = { step: sim.step(), hash: sim.hash() };
        const bytes = sim.snapshot();
        sim.free();
        sim = m.fromSnapshot(bytes);
        expect({ step: sim.step(), hash: sim.hash() }).toEqual(at);
        expect(sim.seed()).toBe(BigInt(c.seed));
      }
      expect(hex(sim.hash())).toBe(c.hash);
      sim.free();
    });
  }

  test("a snapshot is a few kilobytes and byte-identical for the same run", async () => {
    const m = await loadSim();
    const run = () => {
      const sim = m.demo(42n);
      sim.advance(golden.steps_per_day);
      const bytes = sim.snapshot();
      sim.free();
      return bytes;
    };
    const a = run();
    expect(Array.from(run())).toEqual(Array.from(a));
    expect(new TextDecoder().decode(a.subarray(0, 4))).toBe("SPWS");
    expect(a.length).toBeGreaterThan(1000);
    expect(a.length).toBeLessThan(16 * 1024);
  });

  test("a restored idle sim has no job to re-issue", async () => {
    const m = await loadSim();
    const sim = m.empty(1n);
    sim.advance(100);
    const back = m.fromSnapshot(sim.snapshot());
    expect(back.reissue_pending_jobs()).toBe(0);
    sim.free();
    back.free();
  });

  test("anything that is not an intact snapshot of this build throws", async () => {
    const m = await loadSim();
    const sim = m.demo(7n);
    sim.advance(500);
    const good = sim.snapshot();
    sim.free();
    expect(() => m.fromSnapshot(new Uint8Array())).toThrow(/bad snapshot: the snapshot is truncated/);
    expect(() => m.fromSnapshot(new TextEncoder().encode(JSON.stringify({ format: "swarmpress.checkpoint.v1", step: 1, hash: "2" })))).toThrow(/bad magic/);
    const otherBuild = good.slice();
    otherBuild[6] += 1;
    expect(() => m.fromSnapshot(otherBuild)).toThrow(/written by sim build \d+, this is sim build \d+/);
    const damaged = good.slice();
    damaged[damaged.length - 1] ^= 0x04;
    expect(() => m.fromSnapshot(damaged)).toThrow(/corrupt/);
    m.fromSnapshot(good).free();
  });
});
