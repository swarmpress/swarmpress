import { describe, expect, test } from "bun:test";
import { artifactSha } from "@simpress/sdk";
import { runJob } from "../src/engine.ts";
import { ext, log } from "./helpers.ts";

const skillManifest = { kinds: ["skill"], capabilities: ["llm:low"], entry: { bundle: "x.js" } };

describe("skills: artifacts and digests, never transitions", () => {
  const artifact = { kind: "x", content: { a: 1 } };
  const sha = artifactSha(artifact);
  const bundle = (result: unknown) => `globalThis.ext = { runJob: async () => (${JSON.stringify(result)}) }`;

  test("a valid result passes", async () => {
    const r = await runJob(ext(skillManifest), bundle({ artifact, digest: { ok: true, score: 8, words: 0, qa_defects: 0, artifact_sha: sha } }), { kind: "x" }, { log });
    expect(r.result.digest.score).toBe(8);
  });

  test("a result that also returns a stage is rejected", async () => {
    const res = { artifact, digest: { ok: true, score: 8, words: 0, qa_defects: 0, artifact_sha: sha }, stage: "Published" };
    await expect(runJob(ext(skillManifest), bundle(res), { kind: "x" }, { log })).rejects.toThrow("never a transition");
  });

  test("a digest whose artifact_sha does not match the artifact is rejected", async () => {
    const res = { artifact, digest: { ok: true, score: 8, words: 0, qa_defects: 0, artifact_sha: "0".repeat(64) } };
    await expect(runJob(ext(skillManifest), bundle(res), { kind: "x" }, { log })).rejects.toThrow("artifact_sha");
  });
});
