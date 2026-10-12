# ADR-0091 — Cloudflare Pages is the static plane for exported sites

**Status:** Accepted (refines ADR-0049 decision 2 and ADR-0083 §1 for a site's public files; supersedes the cutover runbook's choice between GitHub Pages and the platform's static plane)
**Date:** 2026-10-12

## Context

A WordPress site's public face is a static export of `live` (ADR-0083): a content-addressed release
of files, crawled from a sandbox. ADR-0049 made Cloudflare the data plane (R2, the CDN) without
naming how a site's files are served. The server's `FsStaticPlane` (`crates/server/src/releases.rs`)
serves releases from its own disk under `/sites/{company}/`, which suits development and self-hosting
but not a public domain. The cutover runbook (`docs/runbooks/cinqueterre-cutover.md`, step 4) left the
static plane for cinqueterre.travel open: GitHub Pages fed by the release, or the platform's static
plane (not built for custom domains).

The owner decided on 2026-10-12 how the gate before the cinqueterre.travel switch is cleared, and
chose **Cloudflare Pages** for hosting: the site repo's deploy workflow uploads the export's files
with wrangler, using secrets the owner sets in the site repo, and preview deploys give the owner a
URL to read before the domain moves. The same decisions put a live weather forecast on the weather
pages, fetched from Open-Meteo when the site is exported and refreshed by a daily rebuild, so the
site stays fully static.

## Decision

1. **Cloudflare Pages serves an exported site's files.** The upload is the release's files as
   `export/files/` (one file per URL path, `Release::file_path`), deployed with `wrangler pages
   deploy` (`cloudflare/wrangler-action`). Pages' own rules files travel with them, written by the
   export from the release (`site_export::cloudflare_pages`): `_redirects` holds the release's
   redirects (301) and a rewrite (200) for each directory index that is not HTML (`/feed/` →
   `/feed/index.xml`, which Pages would not find); `_headers` sets `nosniff` and a referrer policy.
   WordPress's not-found page is exported as `404.html`, which Pages answers unknown paths with
   (without one, Pages would serve the home with status 200 for every unknown path).
2. **For cinqueterre.travel, the site repo deploys.** Its workflow (template:
   `templates/site-repo/.github/workflows/deploy.yml`) fills the forecast blocks, checks the export
   and deploys: a push to `main` is production, any other branch a preview with its own URL, and a
   daily schedule refreshes the forecast. Credentials are the site repo's secrets
   (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) that the owner sets; swarm.press never holds or
   handles their values. The custom domain is attached to the Pages project at the switch, not
   before.
3. **Build-time data is fetched by the export, outside WordPress and outside the sim.** The forecast
   block is a marker in the content (`site_export::forecast`); `swarmpress-wp-migrate export` and
   `forecast` fetch Open-Meteo for the places the pages name and write the forecast into the pages
   as static HTML. A fetch that fails fails the deploy, and the last deployment stays live. The
   native CLI fetches directly, as it already fetches the live site for the comparison; an export
   running in the browser would go through the server's fetch proxy (`/web/request`), which is not
   built yet.
4. **The platform's own static plane stays behind the `StaticPlane` trait.** The filesystem plane
   keeps serving development and self-hosted installs; a Cloudflare Pages plane in the server (the
   server deploys a company's release through the Pages API with platform credentials, ADR-0049's
   managed path) is the next implementation, for players' sites. Until then a player's public site
   is the site repo's workflow, as for cinqueterre.travel.

## Consequences

- The export is the only thing deployed: no build runs on Cloudflare, nothing of WordPress or PHP is
  uploaded, and the GPL line (rule 16) is unchanged.
- Previews are free and per branch, so the owner reads the exported site at a `*.pages.dev` URL before
  the domain moves; production rollback is Pages' own (redeploy an earlier deployment), and the
  switch itself is reversible by moving the domain back (runbook, step 4).
- The release stays content-addressed: a forecast fill changes the weather pages' bytes, so the
  release id changes daily; `release.json` is rewritten with the filled files' digests.
- **Negatives:**
  - **Pages' limits:** 20,000 files per deployment, 25 MiB per file, 2,000 static redirect rules
    (the export refuses more rather than cutting the list). cinqueterre.travel is about 900 files.
    These limits are from Cloudflare's documentation as of 2026 and must be checked before players'
    sites depend on them.
  - **A vendor for the public face:** the site depends on a Cloudflare account and a token the owner
    manages; a self-hosted install serves releases from the filesystem plane or any static host.
  - **The daily rebuild needs the swarmpress CLI** in the site repo's CI (built from a pinned commit,
    cached), a few minutes on a cold cache.
  - **The forecast is as fresh as the last deploy:** a day whose fetch fails keeps yesterday's
    forecast (with its date shown) until the next run succeeds.
  - **Open-Meteo's free API is for non-commercial use** (CC BY 4.0 data, attribution shown on every
    filled block). If the site counts as commercial, its terms require the paid API; the owner checks
    before the switch.
- **Alternatives:**
  - **Workers static assets** (a Worker with the export as its assets): the same CDN with a
    programmable edge, but a Worker to deploy and maintain for a site that needs no code at the edge;
    previews are less direct than Pages' branch aliases. The natural next step if forms or redirects
    ever need logic at the edge.
  - **R2 plus a Worker:** the release's blobs in R2 by digest (deduplicated across releases), a Worker
    mapping paths to blobs: the best fit for the platform's managed plane at scale, but a Worker, a
    manifest lookup and cache rules to build before the cutover.
  - **GitHub Pages** (the runbook's first option): free and already serving the live site, but no
    per-branch previews, a single site per repo, and no `_redirects` (redirects as HTML pages);
    keeping the domain where it is would not move the site onto the plane ADR-0049 chose.
  - **The platform's filesystem plane on a public domain:** one server's disk as the public site's
    only copy, with no CDN; fine for development, not for the owner's live site.
