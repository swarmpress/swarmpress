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
  - apps/game/src/php/wp-site-engine.ts
  - apps/game/src/session/wordpress-site.ts
  - apps/game/e2e/wp-publish.spec.ts
adrs:
  - ADR-0083
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

## Not built yet

- A Cloudflare Pages or R2 plane (the filesystem plane serves one server).
- Forms and comments to platform endpoints; previews in the review UI.
