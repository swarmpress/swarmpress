/**
 * The runner's WordPress (FEAT-105, plan M1): the sandbox's Node entry and swarmpress-storage as
 * separate processes on loopback HTTP. Skipped without the fetched release
 * (`cargo xtask sandbox-fetch --node`) or the storage binary.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { REPO_ROOT, sandboxRelease, startNodeWordPress, storageBinary } from "../src/index.ts";
import { migrateBinary, runMigration } from "../src/wordpress.ts";

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
      let path = "";
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
          const saved = (await created.json()) as { id: number; link: string };
          post = saved.id;
          // Pretty permalinks (the sandbox sets them at install): the post's own path.
          path = new URL(saved.link).pathname;
          await a.repo({ op: "session.set", branch: "wi-2", user_id: 0, author: { kind: "system", id: "visitor" } });
          page = await (await a.request(path)).text();
          expect(page).toContain("Byte for byte.");
        } finally {
          await a.stop();
        }
        const b = await startNodeWordPress({ root: REPO_ROOT, dataDir: data, port });
        try {
          await b.repo({ op: "session.set", branch: "wi-2", user_id: 0, author: { kind: "system", id: "visitor" } });
          const again = await b.request(path);
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

// The migration (FEAT-112, plan M8): a JSON-block site onto a fresh Node WordPress, exported.
describe.skipIf(!ready || !migrateBinary(REPO_ROOT))("a site moved onto WordPress (swarmpress wp-migrate)", () => {
  test(
    "keeps every URL, its text, its SEO title and its language links",
    async () => {
      const out = mkdtempSync(join(tmpdir(), "swarmpress-migrate-"));
      try {
        const code = await runMigration({
          root: REPO_ROOT,
          content: join(import.meta.dir, "fixtures/migrate-site/content"),
          out,
          publicOrigin: "https://coast.example",
          formsEndpoint: "https://platform.example/f/coast",
          // Recorded Open-Meteo answers: the test never reaches the network.
          forecasts: join(import.meta.dir, "fixtures/open-meteo"),
        });
        expect(code).toBe(0);
        const release = JSON.parse(readFileSync(join(out, "export/release.json"), "utf8")) as { files: Record<string, { content_type: string }> };
        const page = (p: string) => readFileSync(join(out, "export/files", p.slice(1), "index.html"), "utf8");
        // One URL per page and language, as the live site has them; the blog article a post.
        for (const p of ["/", "/en/", "/de/sights/", "/en/vernazza/restaurants/", "/it/blog/harbour-days/", "/de/blog/hafentage/", "/fr/vernazza/", "/en/manarola/sights/"]) {
          expect(release.files[p]?.content_type ?? `missing ${p}`).toContain("text/html");
        }
        const de = page("/de/sights/");
        expect(de).toContain("Der Hafen ist der Marktplatz.");
        expect(de).toContain("<title>Sehenswürdigkeiten | Coast</title>");
        expect(de).toContain('lang="de"');
        // A site link takes the page's language, and points at the public origin.
        expect(page("/en/sights/")).toContain('href="/en/blog/harbour-days/"');
        expect(page("/en/vernazza/restaurants/")).toContain("<summary>Do I need to book?</summary>");
        expect(page("/en/vernazza/")).toContain("Where the towers meet the sea.");
        // The language switch links the page's translations.
        expect(de).toContain('hreflang="fr"');
        expect(existsSync(join(out, "plan.json"))).toBe(true);
        // The composed home (the owner's decision of 2026-10-12): the latest stories in its own
        // language, rendered by WordPress's query block; the villages; the newsletter form, sent
        // to the platform by the export.
        const home = page("/de/");
        // References to the site are root-relative (ADR-0092): a preview host serves the export
        // whole, its theme's files included; the canonical link keeps the public origin.
        expect(home).toContain('href="/de/blog/hafentage/"');
        expect(home).toContain("href='/wp-content/themes/coast/style.css");
        expect(home).toContain('rel="canonical" href="https://coast.example/de/"');
        expect(home).not.toContain("/en/blog/harbour-days/");
        expect(home).toContain('href="/de/vernazza/"');
        expect(home).toContain('action="https://platform.example/f/coast?to=/wp-admin/admin-post.php"');
        expect(home).toContain("Fünf Dörfer");
        // The weather pages: the live forecast filled at export, the sample data gone.
        const weather = page("/de/wetter/");
        expect(weather).toContain("Vorhersage vom 12. Oktober 2026");
        expect(weather).toContain("Monterosso al Mare");
        expect(weather).toContain("Open-Meteo.com");
        expect(weather).not.toContain("Sample cloud");
        const village = page("/en/vernazza/weather/");
        expect(village).toContain('<th scope="row">Mon 12</th>');
        expect(village).not.toContain("Monterosso");
        // What Cloudflare Pages needs beside the pages (ADR-0091).
        for (const f of ["404.html", "_redirects", "_headers"]) expect(existsSync(join(out, "export/files", f))).toBe(true);
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    },
    600_000,
  );

  // The site's design as data on canvas (ADR-0093): written over REST on the import branch.
  test(
    "with theme data the site is imported onto canvas, and the export carries its templates, styles and fonts",
    async () => {
      const out = mkdtempSync(join(tmpdir(), "swarmpress-migrate-theme-"));
      try {
        const code = await runMigration({
          root: REPO_ROOT,
          content: join(import.meta.dir, "fixtures/migrate-site/content"),
          out,
          publicOrigin: "https://coast.example",
          forecasts: join(import.meta.dir, "fixtures/open-meteo"),
          themeData: join(import.meta.dir, "fixtures/theme-data/theme-data.json"),
        });
        expect(code).toBe(0);
        const plan = JSON.parse(readFileSync(join(out, "plan.json"), "utf8")) as { theme: string; theme_data?: unknown };
        expect(plan.theme).toBe("canvas");
        expect(plan.theme_data).toBeTruthy();
        const release = JSON.parse(readFileSync(join(out, "export/release.json"), "utf8")) as { files: Record<string, { content_type: string }> };
        const page = (p: string) => readFileSync(join(out, "export/files", p.slice(1), "index.html"), "utf8");
        // The front page through the data's template, its pattern by slug, its parts.
        const home = page("/");
        expect(home).toContain("td-front");
        expect(home).toContain("Boats at dawn");
        expect(home).toContain("td-header");
        expect(home).toContain("td-footer");
        // The other languages' homes are the design's front page too (`page-front`); WordPress's
        // own first post is not the site's.
        expect(page("/de/")).toContain("td-front");
        expect(release.files["/hello-world/index.html"]).toBeUndefined();
        // A page through the data's `page` template, with its own text and the menus by language.
        const de = page("/de/sights/");
        expect(de).toContain("td-page");
        expect(de).toContain("Der Hafen ist der Marktplatz.");
        expect(page("/en/sights/")).toContain('href="/en/sights/"');
        expect(page("/en/sights/")).toContain("About the harbour");
        // Global styles: the palette, the custom CSS, the font face with its file.
        expect(home).toContain("--wp--preset--color--harbour: #0b5394");
        expect(home).toContain(".td-hero{letter-spacing:.02em}");
        expect(home).toContain("--wp--preset--font-family--harbour-serif");
        expect(home).toContain("/wp-content/uploads/fonts/harbour-serif-400-normal.woff2");
        // No theme folder's design: canvas has none, and Coast is not active.
        expect(home).not.toContain("themes/coast/style.css");
        // The font file itself is in the export (the crawler follows the @font-face url()).
        // The design's essentials ticker beside the live conditions, filled at export (recorded
        // Open-Meteo answers: the sea, the air, the sunset), in the page's language.
        const weather = page("/de/wetter/");
        expect(weather).toContain("Sonnenuntergang");
        expect(weather).toContain('<span class="ds-count">21°</span><span class="ds-meta">Meer</span>');
        expect(weather).not.toContain("sp-forecast-pending");
        // The forecast's sky is an icon class and a word, never an emoji.
        expect(weather).toContain("ct-wx ct-wx-");
        expect(weather).not.toMatch(/[☀⛅🌧⛈☁]/u);
        const font = "/wp-content/uploads/fonts/harbour-serif-400-normal.woff2";
        expect(release.files[font]?.content_type ?? `missing ${font}`).toContain("font/woff2");
        expect(readFileSync(join(out, "export/files", font.slice(1))).subarray(0, 4).toString()).toBe("wOF2");
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    },
    600_000,
  );
});
