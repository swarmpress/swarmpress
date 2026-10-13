---
id: FEAT-112
title: "cinqueterre.travel moved onto WordPress (import, theme, URL-by-URL comparison)"
status: in-progress
importance: high
paths:
  - crates/content-import-wp/src/lib.rs
  - crates/content-import-wp/src/routes.rs
  - crates/content-import-wp/src/markup.rs
  - crates/content-import-wp/src/plan.rs
  - crates/content-import-wp/src/compose.rs
  - crates/content-import-wp/src/compare.rs
  - crates/content-import-wp/src/tests.rs
  - crates/content-import-wp/src/bin/swarmpress-wp-migrate.rs
  - packages/runner/src/wordpress.ts
  - packages/runner/test/wordpress.test.ts
  - packages/runner/test/fixtures/migrate-site/content/site.json
  - packages/runner/test/fixtures/migrate-site/content/pages/weather.json
  - "packages/runner/test/fixtures/open-meteo/**"
  - crates/site-export/src/forecast.rs
  - crates/site-export/src/forecast/tests.rs
  - templates/site-repo/.github/workflows/deploy.yml
  - docs/runbooks/cinqueterre-cutover.md
adrs:
  - ADR-0092
  - ADR-0091
  - ADR-0083
  - ADR-0082
  - ADR-0078
---

# cinqueterre.travel moved onto WordPress

Milestone M8 of [the build plan](../../design/wordpress-site-engine.md) (ADR-0083 §5): the owner's
live site, today built by the frozen Astro theme (rule 9), imported into a company's WordPress,
rendered by a block theme, exported, and compared with the live site URL by URL. The deploy switch
is the owner's decision and is **not** made here: [the runbook](../../runbooks/cinqueterre-cutover.md)
says what stands between the comparison and the switch.

## Built

- **`crates/content-import-wp`** (MIT, sans-IO):
  - **routes:** every URL the live site serves and the JSON it renders, by the frozen theme's
    routing rules (hubs, villages and their sections with their fallbacks, pages at their own slugs,
    the later of two pages with one slug). Checked against a CI-like build of the frozen theme: the
    same 663 URLs.
  - **the block mapping:** every JSON block as core blocks inside a `ct-{kind}` group (headings,
    paragraphs, images, quotes, lists, details for FAQs, buttons), every string kept, inline
    Markdown turned into HTML, site links given the page's language. The site's custom blocks are
    core blocks with classes rather than a custom block set: WordPress's editor opens them as
    ordinary blocks and the theme styles the kinds.
  - **the plan:** one post or page per URL (blog articles are posts), with its route, language,
    SEO title and description and source as meta; categories and tags; one menu per language; the
    village intro from the villages' own content; a report of what cannot be carried (blocks the
    frozen theme draws from its own code).
  - **the comparison:** status, title, content (the share of the live page's word trigrams the
    export has) and links, with what more than half the live pages repeat (the theme's chrome) left
    out, and the live site's own broken links counted, not required.
- **`swarmpress-wp-migrate`** (feature `cli`): `plan`, `apply` (REST on an `import-site` branch as
  the CEO, site images uploaded as media, a change request merged into live, a release), `export`
  (site-export's crawler over HTTP), `compare` (live pages fetched politely, cached).
- **`swarmpress wp-migrate <content>`** (the runner): a fresh Node WordPress, installed, the plan
  applied, exported, compared.
- **In the GPL sandbox** (`swarmpress/wp-sandbox`): the routes plugin (a post's public path as
  meta: requests, permalinks, the sitemap and the export follow it; the SEO title, description and
  language; the theme switched through the API; a menu per language; no shortlinks, no guessed
  redirects) and **Coast**, the block theme (the frozen theme's palette, display serif and editorial
  sections).
- **The theme** (ADR-0092): `cinqueterre` in the sandbox (wp-sandbox 0.7.0, and 0.7.1: a named
  menu the site does not have renders nothing), the frozen theme's
  design carried into a block theme, a child of Coast: `theme.json` (Playfair Display and Inter,
  self-hosted, OFL; the ink-on-white palette and the villages' colours), templates, the
  coastal-spine header and the footer as parts, patterns, and a stylesheet for the import's
  sections. The import activates it for this site (`plan::theme_for`), writes the coastal spine as
  the main menu and the wordmark, the header's button and the footer as named menus per language
  (`sp-menu-{name}` → `{name}-{lang}`, the routes plugin), gives each text field's paragraph its
  class (`ct-{field}`), keeps the HTML some strings carry (paragraphs, bold, links), places a
  collection's interludes after the item they name, and leaves presentation fields out. The export
  names the site's own files root-relative, so the Cloudflare preview serves the theme; canonical
  and alternate links, sitemaps and feeds keep the public origin.
- **The gate's compositions** (the owner's decisions of 2026-10-12, `compose.rs`):
  - **the home** (`/`, `/{lang}/`): a hero (`core/cover`), the editors' picks (the stories the owner
    curated for the blog index, in the page's language), the five villages, the places to stay (the
    accommodations collection's featured stays), the latest stories as a `core/query`
    block of the posts in the page's language (every article carries its language as a tag; the
    import resolves the block's term reference to the tag's id when it applies the plan), and,
    only with `compose::Options::newsletter`, the newsletter form, which the export sends to the
    platform's `/f/{company}`;
  - **the village overview** (`/{lang}/village/`): the five villages with links to their sections;
  - **the weather pages**: the content's sample forecast is left out and a live forecast block takes
    its place (the five villages on the general pages, the village on its own weather page).
- **The newsletter, hidden** (the owner's decision of 2026-10-13): without the option the plan has no
  form, no `#subscribe` section, no header button (`cta` menu), no footer link and no blog-index
  invitation, in every language; `swarmpress wp-migrate --forms-endpoint <url>` turns it on
  (`plan --newsletter`). Tested both ways: `the_newsletter_is_hidden_unless_a_form_endpoint_answers_it`,
  `cinqueterre_gets_its_own_theme_and_the_frozen_themes_menus`, and the runner's migration test with
  an endpoint (the form sent to the platform).
- **The live forecast** (`site_export::forecast`, owner's decision 3): a marker the import writes, filled
  at export from Open-Meteo (fetched by `swarmpress-wp-migrate export`, or again in place by
  `swarmpress-wp-migrate forecast` for the daily rebuild; recorded answers with `--forecasts`), in four
  languages, with Open-Meteo's attribution; a missing forecast fails the export. The free API stays:
  the owner counts the site as non-commercial (2026-10-13).
- **Cloudflare Pages** (ADR-0091): the export writes `404.html`, `_redirects` and `_headers`; the site
  repo's deploy workflow is the template `templates/site-repo/.github/workflows/deploy.yml` (fill the
  forecast, check, `wrangler pages deploy`; previews per branch; a daily rebuild).
- **Verified:** the crate's tests (routes, mapping, plan, comparison, and the live site's content
  when it is checked out), and `test/wordpress.test.ts` in the runner (a fixture site migrated into
  a fresh Node WordPress: every URL, its text, SEO title, language and links; the composed home's
  query listing the posts of its language and its form sent to the platform; the weather pages'
  forecast filled from recorded Open-Meteo answers; `404.html`, `_redirects` and `_headers`; the
  site's own files root-relative, the canonical link absolute). The forecast's own tests
  (`site-export`, `forecast::tests`) never reach the network; `references_to_the_site_are_root_relative`
  covers the export's references. The crate's tests cover the theme's activation, the spine and
  named menus (every link of them a page of the live site's plan), the home's picks and stays, and
  the interludes. The sandbox's conformance suite renders the theme (its parts, named menus, fonts
  and 404, and no menu the site does not have), run locally (2026-10-13: 8/8 on 0.7.0 and on 0.7.1;
  WordPress's PHPUnit groups 2116 tests on 0.7.0).
- **The look** (2026-10-13): side-by-side screenshots of the live site and the export, at 1440 and
  390 px (homes en/de, an article, a village, the village overview, a weather page, a 404). The
  differences that remain are listed in the runbook.

## Not built yet

- **The owner's review** (2026-10-13, the `cinqueterre` theme in the preview): 635 of 663 URLs pass, no status differs, the median page keeps
  998‰ of its live content. The 28 others are composed or replaced by the owner's decisions (the 9
  home and village-overview pages, the 11 weather pages) or fixed by the export (8 article URLs the
  live site renders as `[object Object]`); the composed pages and the forecast wait for the owner's
  review in a Cloudflare Pages preview (the runbook's step 4). With the newsletter hidden (2026-10-13,
  sandbox 0.7.1) 631 pass: the 4 blog indexes keep 803‰, their newsletter invitation left out by
  decision; no exported file has a form.
- **The newsletter's endpoint** (the central server's public `/f/{company}`), its privacy line and
  double opt-in; until then the newsletter is hidden (runbook, 2026-10-13).
- **The switch** (plan M8 step 4): approved by the owner on 2026-10-13 (with the theme's GPL licence
  accepted), not yet made; then the retirement of the legacy path.
