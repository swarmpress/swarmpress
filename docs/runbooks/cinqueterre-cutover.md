# Runbook: cinqueterre.travel cutover (onto WordPress)

This runbook moves the live cinqueterre.travel from "built by the frozen Astro theme" to "a static
export of the company's WordPress", **without the live site ever breaking**
([ADR-0083 §5](../adr/0083-publishing-a-wordpress-site-and-migrating-cinqueterre.md); plan M8 in
[the WordPress site engine](../design/wordpress-site-engine.md); feature FEAT-112). It replaces the
site-kit runbook of ADR-0023, whose steps 1 to 7 are superseded by ADR-0078 to ADR-0084 (they are in
this file's history). Step 0 below was applied under that runbook and stays.

**The switch (step 4) is the owner's decision.** Everything before it runs beside the live site and
changes nothing a visitor sees.

## Where we start

`swarmpress/cinqueterre.travel` `.github/workflows/deploy.yml` (on push to `main`, plus manual
dispatch) checks out the content repo, checks out swarmpress **pinned at `391d5de` (`legacy-final`)**,
builds `packages/site-builder/src/themes/cinque-terre` with
`CONTENT_DIR=$GITHUB_WORKSPACE/content/content/pages`, and deploys `dist/` to GitHub Pages.

### Step 0: decouple (applied 2026-10-04)

The monorepo checkout is pinned to `legacy-final`
([cinqueterre.travel#7](https://github.com/swarmpress/cinqueterre.travel/pull/7), `914f867`); the
deploy went green and a crawl before and after was identical. swarmpress `main` changes freely since;
the frozen theme path stays byte-identical in swarmpress until step 4 (CLAUDE.md rule 9).

### What the live build really does (verified 2026-10-11)

| Finding | Evidence |
|---|---|
| The theme resolves `content/blog`, `collections/` and `config/villages/` relative to a checkout layout CI does not have, so **none of them render live** | A build with those paths missing (below) gives exactly the live URL set; `/de/blog/5-hidden-gelaterias-you-need-to-try/` is a 404 live; village intros show the theme's default stories |
| Blog articles live are the files of `content/pages/blog/`, served at their slugs | the URL set |
| 18 slugs are claimed by two files; the later file in the theme's walk wins (`things-to-do.json` over `cinque-terre/things-to-do-editorial.json` for `/de/aktivitaeten/`) | live titles |
| Live bugs: two articles render `[object Object]` (8 URLs), titles show a literal `<br/>`, content links without a language (`/itinerary`, `/village`, …) are 404s | the comparison's `live_broken_links` |
| The home pages (`/`, `/{lang}/`) and the `/{lang}/village/` template render sections the theme keeps in its own code (hero, carousels, trending, newsletter…), not content | the import's report of blocks without fields |

## The migration (repeatable, local)

```sh
# 1. a reference build of the frozen theme as CI builds it: from a copy (the build writes
#    .astro/ inside the theme, which rule 9 forbids), with the paths CI cannot resolve missing.
#    node_modules is a real directory of absolute links, so Vite's and Astro's caches land in the
#    copy, never in the frozen theme's node_modules
T=packages/site-builder/src/themes/cinque-terre; R=$(mktemp -d)
rsync -a --exclude node_modules --exclude .astro $T/ $R/theme/ && mkdir $R/theme/node_modules
(cd $T/node_modules && for e in [!@]* @*/*; do [ -e "$e" ] && mkdir -p "$R/theme/node_modules/$(dirname $e)" \
   && ln -s "$(realpath $e)" "$R/theme/node_modules/$e"; done)
(cd $R/theme && CONTENT_DIR=$OLDPWD/cinqueterre.travel/content/pages CONTENT_ROOT=/nonexistent \
   VILLAGE_CONFIG_DIR=/nonexistent node node_modules/astro/astro.js build --outDir $R/reference)

# 2. the import, the export and the comparison (a fresh Node WordPress; see FEAT-112)
cargo xtask sandbox-fetch --node
cargo build --release -p storage-api --bin swarmpress-storage
cargo build --release -p content-import-wp --features cli
pnpm swarmpress wp-migrate cinqueterre.travel/content --out reports/wp-migrate \
   --reference $R/reference --cache reports/wp-migrate/live \
   --assets $T/public [--forms-endpoint https://<the server>/f/<company>]
```

(The reference build's `CONTENT_DIR` must be an absolute path to the site repo's `content/pages`.)

What it does:
1. **Import** (`content-import-wp`): one WordPress post or page per live URL, by the frozen theme's
   routing rules (the plan's URL set must equal the reference build's: it does, 663 URLs), each with
   its route, language, SEO title and description as meta; the JSON blocks as core blocks; blog
   articles as posts with categories and tags; one menu per language; the theme's two local images
   uploaded as media. Written through the REST API on the branch `import-site` as the CEO, merged
   into `live` by one change request, release `import`.
2. **Theme:** `cinqueterre`, the frozen theme's design carried into a block theme in the GPL sandbox
   ([ADR-0092](../adr/0092-the-astro-design-carried-into-a-wordpress-block-theme.md), wp-sandbox
   0.7.0, a child of Coast), activated by the import for this site (`plan::fallback_theme_for`:
   the import's fallback when it has no theme data). Since wp-sandbox 0.8.0 a site's design can be
   data on the neutral theme `canvas` (theme as data on canvas, ADR-0093: `--theme-data`).
   **cinqueterre.travel moves to its design on canvas** (2026-10-14, below: "Salt & Pigment", design
   v1, its theme made by the web designer): the **preview** runs on it; **production** stays on the
   `cinqueterre` theme folder until the owner approves the design (the `ThemeApproval`). With
   `--theme-data` the homes are the design's front page and the composed home below is not used;
   without it, everything in this paragraph holds as it was. The pages
   the frozen theme drew from its own code are **composed** (the owner's decisions of 2026-10-12,
   `crates/content-import-wp/src/compose.rs`): the home, the village overview, a live forecast block
   on the weather pages (below), and the theme's menus (the coastal spine, the wordmark, the
   header's button and the footer, per language).
3. **Export:** `live` crawled into a content-addressed release (`export/release.json`, `export/files/`;
   the site's own files referenced root-relative, so a preview host serves the theme too),
   with WordPress's not-found page as `404.html`, Cloudflare Pages' `_redirects` and `_headers`
   (ADR-0091), forms sent to `--forms-endpoint`, and the forecast blocks filled from Open-Meteo.
4. **Comparison** (`compare.json`): every URL of the reference build, fetched from the live site
   (4 at a time, cached), against the export.

## The design on canvas (2026-10-14)

cinqueterre.travel's new style is the owner's Claude Design export "Salt & Pigment"
([ADR-0093](../adr/0093-a-sites-design-comes-from-claude-design.md)), design version 1, kept in the
site repo as the unpacked bundle `design/v1/` (on `wordpress-export`, with the preview). Its theme is
the web designer's job (FEAT-115), run with GPT-6-Luna through the central server, checked, and
compared with the design on a Node WordPress that has the site:

```sh
# a WordPress with the site (the migration above, sandbox 0.9.0), left running on :8440/:18440, then
cargo build -p orchestrator --features cli --bin swarmpress-site-theme
cargo build --release -p content-import-wp --features cli
target/debug/swarmpress-site-theme --design "<Cinque Terre Dispatch Style Guide.html>" \
   --content cinqueterre.travel/content --out <dir> --llm hosted --server http://127.0.0.1:8081 \
   --wordpress http://127.0.0.1:8440 --repo http://127.0.0.1:18440/repo
# then the migration with the job's theme data
pnpm swarmpress wp-migrate cinqueterre.travel/content --theme-data <dir>/theme-data.json \
   --reference $R/reference --cache reports/wp-migrate/live --assets $T/public --out reports/wp-migrate
```

What the design on data changes (wp-sandbox 0.9.0, the import with `--theme-data`):
- **the site's entries:** the villages, places to stay (rating out of 10, fix-01), restaurants (€ out
  of 4, fix-10), things to do (time, cost, best time, fix-08) and the editors are entries of content
  types (`content_import_wp::entries`), in every language, at most 12 per village and type;
- **the homes** `/` and `/{lang}/` are the design's front page with queries in the page's language
  (the five villages, the editors' picks as sticky posts, places to stay, the latest stories), not
  the composed home; the listing pages (things to do and sights, restaurants and food, weather, the
  team) take the design's listing templates, their own text after the entries; every other page the
  design's page template;
- **the design's rules on the pages:** every headline without "| Cinque Terre Dispatch" (fix-02;
  the document title keeps it), every image with alt text (fix-06, fix-12: the page's title where the
  content has none), WordPress's "Hello world!" and "Sample Page" deleted by the import;
- the fonts are the design's (Bodoni Moda, Schibsted Grotesk, IBM Plex Mono, OFL), self-hosted.

**Result, 2026-10-14** (sandbox 0.9.0, design v1 on canvas; the site repo's `wordpress-export`,
commit `48175b0`, previewed at <https://wordpress-export.cinqueterre-travel.pages.dev>):

| | |
|---|---|
| URLs compared | 663 |
| pass | **631** (as on 2026-10-13, the same rows) |
| status mismatches | 0 |
| content below 900‰ | 32: the same rows as before (below); the homes keep 45–57‰ (was 19–96‰), the weather pages 10‰ less (650–752‰), their headline without the site's name |
| missing links to live pages | 124 (was 122): the homes' (9 and 14 each) |
| pages only in the export | 222 (WordPress's "Hello world!" and "Sample Page" are gone) |
| files in the export | 982 |
| the design, region by region | the homes 865/856 (375/1280 px), the listings 791–825 (FEAT-115) |

### Every menu entry, every component, every page type (2026-10-14, second)

The owner rejected the first preview: no submenus, the design's components hardly used. The fix
is the pipeline's (ADR-0093's second addendum, FEAT-115), and the preview was made again:

```sh
target/debug/swarmpress-site-theme --design "<Cinque Terre Dispatch Style Guide.html>" \
   --content cinqueterre.travel/content --out <dir> --llm hosted --server http://127.0.0.1:8081 \
   --wordpress http://127.0.0.1:8440 --repo http://127.0.0.1:18440/repo
pnpm swarmpress wp-migrate cinqueterre.travel/content --theme-data <dir>/theme-data.json \
   --reference $R/reference --cache reports/wp-migrate/live --assets $T/public --out reports/wp-migrate
#   … export --theme-data <dir>/theme-data.json (the sprite and /ds.js), then
#   swarmpress-wp-migrate design-check --export <out>/export --plan <out>/plan.json \
#      --live https://cinqueterre.travel --out <out>/design-check.json [--retired F] [--exceptions F]
# the components' and page types' visual report on the export:
target/debug/swarmpress-site-theme --design … --content … --out <dir> \
   --report-export <out>/export --theme-data <dir>/theme-data.json
```

- **Navigation:** the live site's menus (the five villages with their ten sections each, the
  footer's four columns, the wordmark) are the theme's, in every language; the header shows each
  village's panel (its tint, the sections numbered in two columns, its newest story) on hover,
  and the phone's sheet opens a village's pages in place. `design-check`: **544 live menu entries
  found on the export (400 nested under their village), 0 missing, 0 broken, 0 retired** (8 pages
  compared: each language's home and a village section page).
- **Templates:** 47 templates (one per page type: the village and its sections, FAQ, itinerary,
  getting here, transportation, team, …) and 2 parts; `design-check`: **0 source pages on the
  generic page template** (40 templates in use).
- **Content for the components:** practical lines of facts as the Trail Ledger, questions as the
  accordion, editors' comments as "local wisdom", interludes and intros as pull quotes, stories
  with byline, dateline, contents rail and "continue reading", the week ahead with stroke icons,
  the fixed 10–30° bar and rain ≥ 20 % marked, season cards; the essentials ticker (sea, air,
  sunset from Open-Meteo, filled at export) on the homes and the weather pages (145 pages).
- **No "Uncategorized"** (0 pages): the two stories of the older flat shape now keep their
  category; the one story without a category takes its hero's badge ("On the Trail"), a content gap.
- **Content gaps** (reported, not filled): restaurants' "ask for" and "menu" (240 entries), the
  source of a restaurant's rating (236), activities' cost (48) and best time (28), 68 restaurants
  without a closing day, 4 without booking, 4 activities without a time, 1 story without a category.
- **Forms:** the only form is the search (`role="search"`, GET), which `/ds.js` opens as the
  design's overlay over the export's `/search-index.json`; the newsletter stays hidden.

| | |
|---|---|
| URLs compared | 663 |
| pass | **631** (as before) |
| status mismatches | 0 |
| files in the export | 999 (the sprite `icons.svg` and `ds.js` among them) |
| the job | GPT-6-Luna, 48 tasks (47 right first time, 9 issues repaired), 53 calls, $0.054 |

The site repo's `wordpress-export` is at `5d18c86` (the preview redeployed); `main` is untouched.
The fixes from the review of the screenshots (FEAT-115: one byline with the real author, the page
header's order, pictures on every card that has one and never an empty frame, the hero's ticker
beside the headline, bands at full width, the story's measure, pull quotes, tags, the mode table)
are in the preview at `94de781` (swarmpress `d11777d`; GPT-6-Luna: 48 of 48 tasks right first time,
52 calls, $0.052; the job's visual check: front page 867/845, `page-front` 859/841 at 375/1280 px;
the gate 631/663; navigation 544 entries, 0 missing; 0 generic pages; 0 "Uncategorized").
The second review's fixes (FEAT-115: the mode table, the design's words in every language, the
wordmark in the phone's sheet, the home's headline at the design's size, the author's profile, no
author archive without content) are in the next preview (GPT-6-Luna: 47 of 48 right first time,
55 calls with the labels call, $0.057; front page 857/851, `page-front` 843/850; the gate 631/663;
`design-check`: 0 words left in English, 0 author archives without content, 0 ways to arrive
outside a mode table). `design-check` fails a page on any of these, as on the navigation.
Side-by-side screenshots (preview, live, design: the home, a village, Manarola's hiking page, an
article, the FAQ, weather, getting here, the itinerary, the open village panel, the phone's menu)
are FEAT-115's evidence.

The owner reviews the preview against the design: side-by-side screenshots (the homes in English and
German, a listing, an article, a village, a weather page and the 404, at 375 and 1280 px) are
FEAT-115's evidence. **Production is not switched**: it stays on the `cinqueterre` theme folder
until the owner approves the design (the `ThemeApproval`); then `main` gets the export with the
design, and the `cinqueterre` theme folder retires from the sandbox.

## The gate

A URL passes when:
- its **status** equals the live one;
- its **content** keeps at least 900‰ of the live page's word trigrams (within a text block, so the
  order of fields does not count; what more live pages repeat than any one source is published on,
  24, is the theme's chrome and does not count);
- it **lacks no link** to a page the live site serves (links to live 404s are counted, not required).

The title is reported, not required.

### The owner's decisions (2026-10-12)

1. **The home pages** (`/`, `/{en,de,fr,it}/`) are composed in the Studio's terms, as core blocks:
   the latest stories as a query block, the villages, the newsletter form to `/f/`. The owner
   reviews them in the preview before the switch.
2. **The village template URLs** (`/{lang}/village/`, 4) are composed as real village overview pages
   per language, not redirects.
3. **The weather pages** (11) get a live forecast block before the switch: the forecast comes from
   **Open-Meteo** (free, no key) when the export publishes, a daily rebuild keeps it fresh, and the
   site stays fully static. The fetch happens in the export (`swarmpress-wp-migrate`), outside the sim
   and outside any GPL code; the villages' coordinates are fixed in the import
   (`compose::COORDINATES`).
4. **Hosting is Cloudflare Pages** (ADR-0091): the site repo's workflow uploads `export/files/` with
   wrangler, with the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` that the owner sets;
   preview deploys give the owner a URL to read. This replaces the earlier choice between GitHub Pages
   and the platform's static plane.

### What is built for them (2026-10-12)

- **The home** (`compose::home`): a hero (the site's name, its line, Vernazza's hero image, a button
  to the villages), the five villages (each its hero image, name linking its page and line, in a
  grid by WordPress's layout support), **Latest Stories** as a `core/query` block (the 6 newest posts
  tagged with the page's language, so `/de/` lists German articles; every article now carries its
  language as a tag, `English`, `Deutsch`, `Français`, `Italiano`) with a link to `/{lang}/blog/`,
  and the newsletter form (`email`, the page's language), which posts to WordPress's
  `admin-post.php` in the content and to the platform's `/f/{company}` in the export. The index's own
  blocks with content follow (none today).
- **The village overview** (`compose::village_overview`): a line on the five villages, then each
  village's card with links to its things to do, restaurants, hotels, hiking, getting here and
  weather. Its title is "The Five Villages" / "Die fünf Dörfer" / "Les cinq villages" / "I cinque
  borghi".
- **The forecast block** (`site_export::forecast`): a marker in a `core/html` block names the places;
  the export fetches each place's 7-day forecast from Open-Meteo and writes a table into the page
  (five villages × seven days on the general weather pages, one row per day on a village's own weather
  page), with the date it starts and Open-Meteo's attribution (CC BY 4.0). The sample forecast of the
  weather blocks (`currentWeather`, `current`, `forecast`) is no longer published: it was fixed
  December data. `swarmpress-wp-migrate forecast --export DIR` fills an export again in place (the
  daily rebuild); a failed fetch fails the deploy and yesterday's site stays.
- **The deploy workflow** for the site repo: `templates/site-repo/.github/workflows/deploy.yml`
  (below).

Before the compositions (2026-10-11) the same 635 URLs passed, with 141 missing links on the home and
village-template pages and the weather pages at 770–865‰ (their sample forecast imported as text).

**Result, 2026-10-12** (the live site against the export of sandbox 0.6.0 with the compositions and the
forecast; the import took 3½ minutes, the export 10 with the forecast):

| | |
|---|---|
| URLs compared | 663 |
| pass | **635** |
| status mismatches | 0 |
| content below 900‰ | 28 (median 998‰), all composed or replaced by decision (below) |
| missing links to live pages | 138 (all on the 9 home and village-overview pages: stories the theme's carousels list) |
| titles that differ | 4 (the village overview's new titles) |
| live links to live 404s (fixed by the import) | 345 |
| pages only in the export (archives, feeds, the language tags' archives, `404.html`) | 227 |
| pages with a forecast | 31 (the 11 weather pages and the 20 village weather pages) |

**Result, 2026-10-13** (the export of sandbox 0.7.0, rendered by the `cinqueterre` theme; ADR-0092):

| | |
|---|---|
| URLs compared | 663 |
| pass | **635** (as on 2026-10-12) |
| status mismatches | 0 |
| content below 900‰ | 28 (median 998‰), the same rows (below) |
| missing links to live pages | 122 (was 138; all on the 9 home and village-overview pages) |
| titles that differ | 4 (the village overview's titles) |
| pages only in the export | 224 |
| files in the export | 1004 (the theme's stylesheet and fonts now among them) |

**Result, 2026-10-13, the newsletter hidden** (sandbox 0.7.1, no `--forms-endpoint`; the export on
the site repo's `wordpress-export` branch):

| | |
|---|---|
| URLs compared | 663 |
| pass | **631** (635 before; the 4 blog indexes below, by the owner's decision) |
| status mismatches | 0 |
| content below 900‰ | 32 (median 998‰): the 28 rows below, and `/{en,de,fr,it}/blog/` at 803‰ |
| missing links to live pages | 122 |
| titles that differ | 4 |
| files in the export | 1004; none has a `<form`, a "Subscribe" link or `#subscribe` |

The blog indexes (`/{lang}/blog/`) keep 803‰: the live page's invitation to the newsletter ("Get the
Dispatch in Your Inbox", "By subscribing, you agree…") is left out with the newsletter, so the pages
do not invite to a form that is not there. It comes back with `--forms-endpoint`.

The homes keep 21–99‰ of the live text (was 2–55‰) and miss 8–14 links (was 13–16): the editors'
picks are the stories the owner curated for the blog index. Side-by-side screenshots of the live
site and the export (homes in English and German, an article, a village, the village overview, a
weather page and a 404, at 1440 and 390 px) are FEAT-112's evidence of the look.

**What the theme shows differently from the Astro site** (ADR-0092): the homes' sections come only
from content (the editors' picks from the blog index, the featured stays of the accommodations
collection; no trending, audio guides, sample hotels or "about" card); the latest stories and the
stays are cards without photographs (posts have no featured images); the language switch is four
links, not a dropdown; there is no search button; an item's "essential information" is chips under
its text, not a sidebar with a map; the 404 is the site's own page (the live one is GitHub's).

**The gate's rows:**

| URLs | What | Status (2026-10-12) |
|---|---|---|
| `/`, `/{en,de,fr,it}/` (5) | the frozen theme's own sections (hero, carousels, trending, places to stay, latest stories, newsletter) | **composed** (decision 1); 21–99‰ of the live text and 8–14 missing links each (2026-10-13), by design: the live page's text and links are the theme's carousels (on `/de/`, `/fr/`, `/it/` partly English articles); the composition shows the editors' picks the owner curated, the villages, the featured stays, the 6 newest stories in the page's language and links all stories. **Waits for the owner's review in the preview** |
| `/{lang}/village/` (4) | the village template: the theme's default stories | **composed** as the village overview (decision 2); 0–3‰ and 13–17 missing links each, the same carousels. **Waits for the owner's review** |
| two articles × 4 languages (8) | **live renders `[object Object]`** (a live bug); the export has the whole article | nothing: the export fixes it |
| `/{lang}/blog/` (4) at 803‰ | the newsletter's invitation, left out while the newsletter is hidden (2026-10-13) | **by decision**; back with `--forms-endpoint` |
| the weather pages (11: `/weather`, `/wetter`, `/meteo`, `/cinque-terre/…`) at 660–762‰ | the frozen theme's weather blocks print sample data; the content's own sample forecast is now left out | **the live forecast block is built** (decision 3); below 900‰ because the live page's sample forecast is not carried, by design. **Waits for the owner's review** |

Every other URL keeps its content (median 998‰), its links to live pages and its status. Images stay
where the live site has them (Unsplash and the site's R2 bucket, hot-linked); the theme's two local
images are uploaded as media.

### The owner's decisions (2026-10-13)

1. **The newsletter is hidden for now.** No newsletter form anywhere on the exported site until the
   central server has a public address, a privacy line and a double opt-in. The import leaves out
   the home's newsletter section (`#subscribe`), the header's "Subscribe" button (the `cta` menu),
   the footer's "Subscribe" link and the blog index's invitation ("Get the Dispatch in your
   inbox"), in every language (`compose::Options::newsletter`, off by default). The code path
   stays: `pnpm swarmpress wp-migrate … --forms-endpoint <url>` passes `--newsletter` to the plan
   and composes all of it again, with the form sent to that endpoint. A theme part that names a
   menu the site does not have (the header's `sp-menu-cta`) renders nothing, not WordPress's
   fallback menu (wp-sandbox 0.7.1).
2. **Open-Meteo stays on its free API**, with its attribution (CC BY 4.0) under every forecast:
   the owner counts cinqueterre.travel as **non-commercial**. Revisit if the site takes ads or
   affiliate links (Open-Meteo's paid API; its key would be a secret of the site repo).
3. **The `cinqueterre` theme's GPL licence is accepted** (ADR-0092's first negative): the ported
   design is distributed under GPL-2.0-or-later with the sandbox, and anyone who receives the
   sandbox may reuse it.
4. **The switch goes ahead** (step 4 below): the PR from `wordpress-export` into the site repo's
   `main`, then the domain.

**Still open (not before the switch):** the newsletter's endpoint (the central server's public
`/f/{company}`), its privacy line and double opt-in; the form then comes back with
`--forms-endpoint`.

## Step 4: the switch (owner's decision)

The static plane is **Cloudflare Pages** (ADR-0091). The workflow template is
`templates/site-repo/.github/workflows/deploy.yml` in swarmpress: on a push it fills the forecast
(`swarmpress-wp-migrate forecast`, built from a pinned swarmpress commit), checks the export (pages,
`404.html`, `_redirects`, `_headers`) and runs `wrangler pages deploy export/files`; `main` is
production, every other branch a preview with its own URL; a daily schedule (04:15 UTC) refreshes the
forecast and redeploys production.

**What the owner sets up** (nobody else handles the values):
1. A Cloudflare Pages project (Direct Upload), e.g. `cinqueterre-travel`, production branch `main`.
2. In `swarmpress/cinqueterre.travel` → Settings → Secrets and variables → Actions:
   - secrets `CLOUDFLARE_API_TOKEN` (an API token with *Account · Cloudflare Pages · Edit*) and
     `CLOUDFLARE_ACCOUNT_ID`; `MONOREPO_PAT` exists already;
   - variables `CLOUDFLARE_PAGES_PROJECT` (the project's name) and `SWARMPRESS_REF` (the swarmpress
     commit to build `swarmpress-wp-migrate` from: one that contains this runbook's step).

**1. The preview** (changes nothing a visitor sees):
1. Run the migration above (without `--forms-endpoint` while the newsletter is hidden) and check
   `compare.json`, that no page has a `<form` (`grep -rl '<form' export/files`) and no "Subscribe"
   link.
2. On a branch of the site repo, e.g. `wordpress-export`: commit the export as `export/`
   (`release.json`, `files/`) and the workflow as `.github/workflows/deploy-cloudflare.yml`. The
   Astro `deploy.yml` stays, and only runs on `main`.
3. The push deploys a preview; the run's summary has the URL
   (`https://wordpress-export.<project>.pages.dev`). The owner reads it: the homes, the village
   overviews, the weather pages, a sample of articles and village sections, a 404.
4. The owner accepts or sends back each of the gate's rows above.

**2. The switch** (one PR on the site repo, then the domain):
1. The PR from `wordpress-export` into `main` replaces `.github/workflows/deploy.yml` with the
   template (and removes `deploy-cloudflare.yml`): GitHub Pages stops being deployed, Pages deploys
   production at `<project>.pages.dev`.
2. Check production at `<project>.pages.dev`.
3. Attach `cinqueterre.travel` (and `www`) to the Pages project as custom domains and point DNS at
   Pages (with the zone on Cloudflare, Pages writes the records; otherwise a `CNAME` to
   `<project>.pages.dev`). Remove the GitHub Pages custom domain afterwards.
4. Check the live domain: status codes, a few URLs per language, a 404, `/feed/`, the forecast.

**Rollback:**
- a bad export after the switch: Pages → Deployments → *Rollback* to the previous production
  deployment (seconds), or revert the commit on `main`;
- back to the Astro site: point the domain's DNS back to GitHub Pages and revert the PR (the pinned
  Astro build still works, because the tag `legacy-final` is immutable; GitHub Pages keeps the last
  Astro deployment until it is rebuilt).

From the switch on, a publish is: the platform's export of `live` committed to `export/` on `main`
(today by running the migration's export; later by the platform), deployed by the workflow.

## The switch (done 2026-10-13)

- swarmpress/cinqueterre.travel PR #8 merged: `deploy.yml` deploys `export/files` (sandbox 0.7.1,
  the `cinqueterre` theme, newsletter hidden) to the Pages project `cinqueterre-travel`; GitHub Pages
  is no longer built and keeps the last Astro deployment for a rollback.
- The owner attached `cinqueterre.travel` and `www.cinqueterre.travel` to the Pages project
  (DNS on Cloudflare). Checked on both hosts: the homes in four languages, the blog, the village
  overview, a village page, a weather page and the feed answer 200, an unknown URL 404.
- Known content defect, older than the switch: the two images of
  `/en/blog/last-light-on-sentiero-azzurro/` live in an R2 bucket whose public `r2.dev` URL answers
  401; the Astro site had the same URLs.

## After the switch

- Rule 9 ends: delete `packages/site-builder/src/themes/cinque-terre`, its pnpm workspace glob and its
  lockfile entries.
- The legacy modules retire: `GithubGateway`, PathPolicy uses, `check_draft`, `finalize.rs`,
  `site-kit`, `themes/starter`.
- Keep the `legacy-final` tag forever: step 0 references it.
