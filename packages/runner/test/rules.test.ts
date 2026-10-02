import { describe, expect, test } from "bun:test";
import { logger, simulate, startRule } from "../src/engine.ts";
import { ext } from "./helpers.ts";

describe("sim rules", () => {
  const manifest = { kinds: ["sim-rule"], entry: { bundle: "x.js" }, rule: { stepInterval: 6000 } };

  test("rules see an integer world view and their commands are logged as proposed", async () => {
    const bundle = `globalThis.ext = { onStep: (v) => [{ type: "Seen", step: v.step, minute: v.minute, staff: Array.isArray(v.staff) ? 1 : 0, now: Date.now() }] }`;
    const r = await startRule(ext(manifest), bundle, logger(), 42n);
    try {
      const sim = await simulate({ seed: 42n, days: 1, rules: [r] });
      expect(sim.commands.map((c) => c.command)).toEqual([
        { type: "Seen", step: 6000, minute: 1140, staff: 1, now: Date.UTC(2026, 0, 1) + 1140 * 60_000 },
        { type: "Seen", step: 12000, minute: 420, staff: 1, now: Date.UTC(2026, 0, 2) + 420 * 60_000 },
      ]);
      expect(sim.commands.every((c) => c.status === "proposed")).toBe(true);
    } finally {
      r.sandbox.dispose();
    }
  });

  test("rules cannot reach the network even if they ask for nothing", async () => {
    const r = await startRule(ext(manifest), `globalThis.ext = { onDayStart: () => [{ type: "T", f: typeof fetch === "undefined" ? 1 : 0 }] }`, logger(), 1n);
    try {
      const sim = await simulate({ seed: 1n, days: 1, rules: [r] });
      expect(sim.commands[0].command).toEqual({ type: "T", f: 1 });
    } finally {
      r.sandbox.dispose();
    }
  });
});
