---
id: FEAT-109
title: "Publishing a WordPress site as a static export"
status: in-progress
importance: high
paths:
  - crates/site-export/src/lib.rs
  - crates/site-export/src/tests.rs
  - crates/site-export/Cargo.toml
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

## Not built yet

- Running the export after a merge, the deploy to the static data plane, and `DeployLanded`.
- Forms and comments to platform endpoints; previews in the review UI.
