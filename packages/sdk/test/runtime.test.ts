import { describe, expect, test } from "bun:test";
import { artifactSha, canonicalJson, countWords, defineRule, defineSkill, jobResult, sha256Hex } from "../src/runtime.ts";

const webCrypto = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("runtime helpers (sandbox-safe, pure JS)", () => {
  const inputs = ["", "abc", "Vernazza ⛵ Sciacchetrà", "😀".repeat(40), "x".repeat(55), "x".repeat(56), "x".repeat(64), "y".repeat(1000)];
  for (const s of inputs) {
    test(`sha256Hex equals WebCrypto for a ${s.length}-char string`, async () => expect(sha256Hex(s)).toBe(await webCrypto(s)));
  }

  test("canonicalJson sorts keys at every depth and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
  });

  test("countWords counts every string in a JSON value", () => {
    expect(countWords({ title: "Getting to Vernazza", body: [{ text: "  By train.  " }, { n: 4 }] })).toBe(5);
    expect(countWords("")).toBe(0);
  });

  test("jobResult computes words and the artifact sha", () => {
    const artifact = { kind: "summary", content: { text: "one two three" } };
    const r = jobResult(artifact, { ok: true, score: 8 });
    expect(r.digest).toEqual({ ok: true, score: 8, words: 3, qa_defects: 0, artifact_sha: artifactSha(artifact) });
    expect(Object.keys(r).sort()).toEqual(["artifact", "digest"]);
  });

  test("defineSkill exposes runJob/runTool/describe and dispatches by kind", async () => {
    const skill = defineSkill({
      tools: { echo: { description: "echo", input: {}, run: (i: unknown) => i } },
      jobs: { j: { description: "j", handler: ({ job }) => jobResult({ kind: "k", content: job.input }, { ok: true, score: 7 }) } },
    });
    expect(skill.kind).toBe("skill");
    expect(skill.describe().jobs.j.description).toBe("j");
    expect(await skill.runTool({ tool: "echo", input: { a: 1 } })).toEqual({ a: 1 });
    const r = await skill.runJob({ job: { job_id: "1", kind: "j", revision: 0, input: "hello world" } });
    expect(r.digest.words).toBe(2);
    await expect(skill.runJob({ job: { job_id: "1", kind: "nope", revision: 0, input: null } })).rejects.toThrow("no job handler");
  });

  test("defineRule tags the export", () => {
    expect(defineRule({ onDayStart: () => [] }).kind).toBe("sim-rule");
  });
});
