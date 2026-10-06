import { describe, expect, test } from "bun:test";
import { ManifestSchema, formatIssues } from "@swarm-press/sdk";
import { originOf } from "../src/interpret.ts";
import { goldenManifests, tool } from "./helpers.ts";

/**
 * The manifest of a tool comes from Rust (`blueprint::tools::manifest`,
 * golden: crates/blueprint/tests/fixtures/site/manifests.golden.json). The
 * SDK must accept every one, and it must grant what the interpreter will use.
 */
describe("Rust-derived tool manifests", () => {
  const golden = goldenManifests();

  test("the golden file covers the three fixture tools", () => {
    expect(Object.keys(golden).sort()).toEqual(["ferry-times", "story-teaser", "weather"]);
  });

  for (const [id, m] of Object.entries(golden)) {
    test(`${id}: parses with the SDK's ManifestSchema as a skill with a bundle`, () => {
      const r = ManifestSchema.safeParse(m);
      if (!r.success) throw new Error(formatIssues(r.error).join("\n"));
      expect(r.data.kinds).toEqual(["skill"]);
      expect(r.data.entry.bundle).toBe("tool.js");
      expect(r.data.id).toBe(`press.swarm.tool.${id}`);
    });

    test(`${id}: grants exactly the origins and llm tier the graph uses`, () => {
      const g = tool(id);
      const origins = new Set<string>();
      const caps = new Set<string>();
      for (const n of g.nodes) {
        if (n.kind === "connector" && (n.connector === "http-get" || n.connector === "rss")) {
          caps.add("web");
          origins.add(originOf(n.url ?? "")!);
        }
        if (n.kind === "agent") caps.add(`llm:${n.tier}`);
      }
      expect([...caps].sort()).toEqual([...m.capabilities].sort());
      expect([...origins].sort()).toEqual(m.origins ?? []);
    });
  }
});
