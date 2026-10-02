import { describe, expect, test } from "bun:test";
import { PollScheduler, poll } from "../src/engine.ts";
import { fixtureWeb } from "../src/fakes.ts";
import { ext, log } from "./helpers.ts";

describe("context providers", () => {
  const manifest = {
    kinds: ["context-provider"],
    capabilities: ["web"],
    entry: { bundle: "x.js" },
    poll: { cadenceMinutes: 30, regions: ["cinque-terre"] },
  };
  const fact = {
    kind: "weather",
    title: "Sirocco",
    summary: "Strong wind.",
    source_url: "https://w.example/",
    region: "cinque-terre",
    valid_from: "2026-10-01T06:00:00Z",
    expires_at: "2026-10-01T18:00:00Z",
  };
  const provider = (facts: unknown[]) => `globalThis.ext = { poll: async (i) => ({ cursor: i.now, facts: ${JSON.stringify(facts)}, happenings: [] }) }`;
  const input = { now: "2026-10-01T07:00:00Z", region: "cinque-terre", cursor: null };

  test("poll results are validated against the fact schema", async () => {
    const web = fixtureWeb({}, "/");
    expect((await poll(ext(manifest), provider([fact]), input, { web, log })).facts).toHaveLength(1);
    await expect(poll(ext(manifest), provider([{ ...fact, kind: "gossip" }]), input, { web, log })).rejects.toThrow("poll() result is invalid");
    await expect(poll(ext(manifest), provider([{ ...fact, region: "lake-como" }]), input, { web, log })).rejects.toThrow("is for region lake-como");
  });

  test("the host enforces the polling cadence", () => {
    const s = new PollScheduler(30);
    const t = Date.parse("2026-10-01T07:00:00Z");
    expect(s.allow("cinque-terre", t)).toBe(true);
    expect(s.allow("cinque-terre", t + 29 * 60_000)).toBe(false);
    expect(s.allow("lake-como", t + 60_000)).toBe(true);
    expect(s.allow("cinque-terre", t + 30 * 60_000)).toBe(true);
  });
});
