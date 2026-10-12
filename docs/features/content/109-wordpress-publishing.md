---
id: FEAT-109
title: "Publishing a WordPress site as a static export"
status: in-progress
importance: high
paths:
  - crates/site-export/src/lib.rs
  - crates/site-export/src/tests.rs
  - crates/site-export/Cargo.toml
  - crates/server/src/releases.rs
  - crates/server/tests/releases.rs
  - crates/server/src/forms.rs
  - crates/server/tests/forms.rs
  - apps/game/src/php/wp-site-engine.ts
  - apps/game/src/session/wordpress-site.ts
  - apps/game/e2e/wp-publish.spec.ts
adrs:
  - ADR-0083
  - ADR-0091
---

# Publishing a WordPress site as a static export

Milestone M5 of [the build plan](../../design/wordpress-site-engine.md). The public site is `live`
crawled over HTTP and written as a content-addressed release; no WordPress is ever public
(ADR-0083).

## Built

- **`crates/site-export`**, sans-IO (the same crawler natively and in wasm, where every request goes
  through the sandbox's MessagePort):
  - crawls the seeds (home, the sitemap, the feeds, robots.txt) and every same-origin page, image,
    stylesheet and script they reference; never `/wp-admin/`, `/wp-login.php`, `/wp-json/`,
    `xmlrpc.php`, `wp-cron.php` or comment posting; a page with a query string is reported, an
    asset drops WordPress's `?ver=`;
  - rewrites the sandbox's origin to the public one in text bodies (JSON-escaped forms too);
  - the release: each file's SHA-256, type and size by URL path, redirects, and an id over the
    manifest (`swarmpress:release:v1`): the same site gives the same release;
  - a static search index (`/search-index.json`);
  - incremental exports: the touched URLs, the seeds and the pages one link away from a touched
    page are fetched again, new links followed, the rest carried; a touched page that is gone
    leaves the release.

- **After a merge** (`apps/game/src/session/wordpress-site.ts`): `live` is crawled through the
  sandbox (orchestrator-wasm's `ExportCrawler`), incrementally from the release this device last
  deployed with the touched permalinks; the new files' bytes go to object storage, then the
  release to the server.
- **The deploy** (`crates/server/src/releases.rs`): `PUT /api/releases/{id}` under the lease, only
  with the manifest's own id and every file's bytes uploaded; the release is written to the static
  data plane (a directory per release, the `current` pointer moved last), served under
  `/sites/{company}/`, and `DeployLanded` (`source: export`) reaches the sim; a failure to write is
  `DeployFailed`.
- **The sandbox** (`wp-sandbox` 0.3.x) installs public sites with pretty permalinks: a URL with a
  query string cannot be a static page.

- **Forms and comments** (`crates/server/src/forms.rs`): the export sends forms that post to
  WordPress (`wp-comments-post.php`, `admin-post.php`, `admin-ajax.php`) to `POST /f/{company}`, a
  public, rate-limited endpoint that records each submission as a `FormSubmitted` event in the
  company's inbox and sends the visitor back to the page.
- **Previews:** the review UI shows a WordPress company's draft as its sandbox renders the item's
  branch, in an inert frame; readers' sessions commit nothing.

- **For a static host** (ADR-0091, 2026-10-12): WordPress's not-found page is exported as
  `/404.html` (`Crawler::feed_not_found`; without it Cloudflare Pages would answer every unknown
  path with the home and status 200), and `cloudflare_pages` writes Pages' `_redirects` (the
  release's redirects, and rewrites for directory indexes that are not HTML, `/feed/` →
  `/feed/index.xml`; more than Pages' 2,000 rules is an error) and `_headers`.
- **Build-time data** (`site_export::forecast`): a forecast marker in a page is filled at export with
  forecasts the caller fetched (`Export::fill_forecasts`, `fill_release` for a release on disk); see
  FEAT-112.

## Not built yet

- A Cloudflare Pages plane in the server (the server deploys a company's release through the Pages
  API, ADR-0091 §4); today the filesystem plane serves one server, and cinqueterre.travel deploys from
  its site repo's workflow.
- The forecast fill in the browser's export after a merge (it would fetch through the server's
  `/web/request`); only the native CLI fills forecasts today.
- A search page over the static index (the index is in every release).
