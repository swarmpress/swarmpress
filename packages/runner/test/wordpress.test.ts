/**
 * The runner's WordPress (FEAT-105, plan M1): the sandbox's Node entry and swarmpress-storage as
 * separate processes on loopback HTTP. Skipped without the fetched release
 * (`cargo xtask sandbox-fetch --node`) or the storage binary.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { REPO_ROOT, sandboxRelease, startNodeWordPress, storageBinary } from "../src/index.ts";

const ready = !!sandboxRelease(REPO_ROOT) && !!storageBinary(REPO_ROOT);

describe.skipIf(!ready)("WordPress on the runner (Node entry + swarmpress-storage)", () => {
  test(
    "installs onto live through the storage service and answers REST on a work branch",
    async () => {
      const wp = await startNodeWordPress({ root: REPO_ROOT });
      try {
        const done = await wp.request("/wp-admin/install.php?step=2", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "weblog_title=Runner&user_name=admin&admin_password=runner-pass-1&admin_password2=runner-pass-1&pw_weak=on&admin_email=runner%40example.org&blog_public=0&Submit=Install",
        });
        expect(done.status).toBe(200);
        expect(await done.text()).toContain("Success");
        const live = await wp.repo<{ author: { id: string } }[]>({ op: "log", branch: "live" });
        expect(live.map((c) => c.author.id)).toEqual(["install"]);
        await wp.repo({ op: "import.finish" });
        await wp.repo({ op: "branch.create", name: "wi-1" });
        await wp.repo({ op: "session.set", branch: "wi-1", user_id: 1, author: { kind: "agent", id: "writer-1", job: "runner-1", model: "scripted" } });
        const created = await wp.request("/?rest_route=/wp/v2/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "From the runner", status: "publish" }),
        });
        expect(created.status).toBe(201);
        const [head] = await wp.repo<{ author: { id: string } }[]>({ op: "log", branch: "wi-1", limit: 1 });
        expect(head.author.id).toBe("writer-1");
      } finally {
        await wp.stop();
      }
    },
    180_000,
  );

  test(
    "a branch switch is a fresh boot: a new sandbox on the same repository serves the same pages",
    async () => {
      const data = mkdtempSync(join(tmpdir(), "swarmpress-branch-"));
      const agent = { kind: "agent", id: "writer-1", job: "runner-2", model: "scripted" };
      let page = "";
      let post = 0;
      let port = 0;
      try {
        const a = await startNodeWordPress({ root: REPO_ROOT, dataDir: data });
        // The site's URL is part of its content (siteurl): the fresh boot serves it at the same address.
        port = Number(new URL(a.url).port);
        try {
          await a.request("/wp-admin/install.php?step=2", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: "weblog_title=Switch&user_name=admin&admin_password=switch-pass-1&admin_password2=switch-pass-1&pw_weak=on&admin_email=switch%40example.org&blog_public=0&Submit=Install",
          });
          await a.repo({ op: "import.finish" });
          await a.repo({ op: "branch.create", name: "wi-2" });
          await a.repo({ op: "session.set", branch: "wi-2", user_id: 1, author: agent });
          const created = await a.request("/?rest_route=/wp/v2/posts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Same on every boot", status: "publish", content: "<!-- wp:paragraph -->\n<p>Byte for byte.</p>\n<!-- /wp:paragraph -->" }),
          });
          post = ((await created.json()) as { id: number }).id;
          await a.repo({ op: "session.set", branch: "wi-2", user_id: 0, author: { kind: "system", id: "visitor" } });
          page = await (await a.request(`/?p=${post}`)).text();
          expect(page).toContain("Byte for byte.");
        } finally {
          await a.stop();
        }
        const b = await startNodeWordPress({ root: REPO_ROOT, dataDir: data, port });
        try {
          await b.repo({ op: "session.set", branch: "wi-2", user_id: 0, author: { kind: "system", id: "visitor" } });
          const again = await b.request(`/?p=${post}`);
          expect(`${again.status} ${again.headers.get("location") ?? ""}`).toBe("200 ");
          expect(await again.text()).toBe(page);
        } finally {
          await b.stop();
        }
      } finally {
        rmSync(data, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
