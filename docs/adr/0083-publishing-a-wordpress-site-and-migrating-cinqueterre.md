# ADR-0083 — Publishing a WordPress site, and migrating cinqueterre.travel

**Status:** Accepted (re-targets the deploy path of ADR-0061 and ADR-0062 and the cutover runbook; keeps the frozen-theme rule 9 until the migration lands; the static data plane of ADR-0049 stays)
**Date:** 2026-10-10

## Context

A player's WordPress runs in a sandbox on the executor (ADR-0079): in the browser, or in the runner. The public site cannot depend on that. A browser tab is not a web server, and the visitors' site must stay up while the CEO's tab is closed.

Today sites are static builds on GitHub Actions and Cloudflare (ADR-0049, ADR-0061), and the live cinqueterre.travel is built by the frozen cinque-terre theme (rule 9).

## Decision

1. **The public site is a static export of `live`.** When a change request merges into `live` (ADR-0080 §3):
   - the governed layer checks `live` out into a sandbox;
   - it **crawls WordPress through HTTP** (ADR-0078 §3): every published URL, the sitemap, feeds, and the assets the pages reference;
   - it writes a **release**: a content-addressed set of files, tagged in the repository (ADR-0080 §4);
   - the server deploys the release to the static data plane (Cloudflare, ADR-0049) and reports `DeployLanded` or `DeployFailed` to the sim as today.
2. **Incremental releases.** An export renders only the URLs the merged change touches, plus the pages that list them (archives, home, feeds, sitemap), computed from the semantic diff. A full export runs on a theme or plugin change and on a schedule.
3. **What a static site cannot do:** comments, search, forms and logins are not part of the export.
   - **Search** is a static index built in the export.
   - **Forms and comments** go to the platform's endpoints (the tracker's origin, ADR-0049) as events into the inbox, never into a WordPress the public reaches.
   - **No WordPress is public.** No request from the internet ever reaches a sandbox.
4. **Previews.** Reviews and the CEO see a branch rendered by its own sandbox on the executor, inside the sandbox's origin, as a preview that is never published.
5. **Migrating cinqueterre.travel.** The live site stays on its frozen Astro theme (rule 9) until the migration's steps pass, run as their own work items:
   1. Import the site's JSON pages into the repository as WordPress objects (pages, posts, terms, menus, media sidecars), mapping its blocks to Gutenberg blocks with a block set for the site's custom blocks.
   2. Build a block theme that renders them, its look taken from the frozen theme. It is reviewed in the Studio's Paint shop and Building workbench.
   3. Export, compare with the live site URL by URL (content, links, status codes; `docs/runbooks/cinqueterre-cutover.md` is rewritten for this), and fix until equal.
   4. Switch the deploy to the WordPress export. Only then does rule 9 end and the frozen theme path retire.

## Consequences

- **The public site stays static, fast and cheap to host.** The sandbox's GPL code never runs for visitors; the visitors get HTML that WordPress produced, which is output, not the program.
- **The publish gate keeps its meaning:** what the CEO approves is merged, exported and deployed, and the release can be rolled back (ADR-0080 §4).
- **Negatives:**
  - **Export time:** every publish costs an export run, seconds to minutes depending on the site, but incremental.
  - **Dynamic features:** WordPress features that need a server (comments, membership, e-commerce checkout) need platform equivalents or are out of scope.
  - **Two paths during migration:** until the cutover the old deploy path and the export run side by side.
- **Alternatives:**
  - **Hosting WordPress publicly** (a sandbox on a server per site): GPL code serving visitors is fine licence-wise, but it means operating a PHP fleet, its security and its uptime, against ADR-0049.
  - **A headless WordPress feeding an Astro front end:** keeps our front end but loses WordPress themes, which the owner wants.
