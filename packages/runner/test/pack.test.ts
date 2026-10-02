import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzip, untar } from "../src/tar.ts";
import { EXAMPLES, swarmpress, tempDir } from "./helpers.ts";

const sha256 = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");

describe("swarmpress pack", () => {
  test("writes a tar.gz with the manifest, the bundle and a sha256 integrity file", async () => {
    const out = join(tempDir(), "fc.swarmpress.tgz");
    const r = await swarmpress("pack", join(EXAMPLES, "fact-checker"), "--out", out);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const files = untar(await gunzip(new Uint8Array(readFileSync(out))));
    expect([...files.keys()]).toContain("swarmpress.ext.json");
    expect([...files.keys()]).toContain("dist/ext.bundle.js");
    expect([...files.keys()]).toContain("src/index.ts");
    expect([...files.keys()].some((k) => k.includes("node_modules"))).toBe(false);
    const integrity = JSON.parse(new TextDecoder().decode(files.get("swarmpress.integrity.json")!));
    expect(integrity).toMatchObject({ algorithm: "sha256", id: "press.swarm.examples.fact-checker", version: "0.1.0", bundle: "dist/ext.bundle.js" });
    for (const [path, digest] of Object.entries<string>(integrity.files)) expect(sha256(files.get(path)!)).toBe(digest);
    expect(Object.keys(integrity.files).sort()).toEqual([...files.keys()].filter((k) => k !== "swarmpress.integrity.json").sort());
  });

  test("packing is reproducible", async () => {
    const a = join(tempDir(), "a.tgz");
    const b = join(tempDir(), "b.tgz");
    await swarmpress("pack", join(EXAMPLES, "harvest-season"), "--out", a);
    await swarmpress("pack", join(EXAMPLES, "harvest-season"), "--out", b);
    const ta = untar(await gunzip(new Uint8Array(readFileSync(a))));
    const tb = untar(await gunzip(new Uint8Array(readFileSync(b))));
    expect([...ta.entries()].map(([k, v]) => [k, sha256(v)])).toEqual([...tb.entries()].map(([k, v]) => [k, sha256(v)]));
  });

  test("refuses an extension that fails check", async () => {
    const r = await swarmpress("pack", tempDir());
    expect(r.code).toBe(1);
    expect(r.err).toContain("pack refuses");
  });
});
