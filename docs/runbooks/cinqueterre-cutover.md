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
#    .astro/ inside the theme, which rule 9 forbids), with the paths CI cannot resolve missing
T=packages/site-builder/src/themes/cinque-terre; R=$(mktemp -d)
rsync -a --exclude node_modules --exclude .astro $T/ $R/theme/ && ln -s $PWD/$T/node_modules $R/theme/node_modules
(cd $R/theme && CONTENT_DIR=$PWD/../../cinqueterre.travel/content/pages CONTENT_ROOT=/nonexistent \
   VILLAGE_CONFIG_DIR=/nonexistent ./node_modules/.bin/astro build --outDir $R/reference)

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
2. **Theme:** Coast, the sandbox's editorial block theme (the frozen theme's palette and type).
   The pages the frozen theme drew from its own code are **composed** (the owner's decisions of
   2026-10-12, `crates/content-import-wp/src/compose.rs`): the home, the village overview, and a live
   forecast block on the weather pages (below).
3. **Export:** `live` crawled into a content-addressed release (`export/release.json`, `export/files/`),
   with WordPress's not-found page as `404.html`, Cloudflare Pages' `_redirects` and `_headers`
   (ADR-0091), forms sent to `--forms-endpoint`, and the forecast blocks filled from Open-Meteo.
4. **Comparison** (`compare.json`): every URL of the reference build, fetched from the live site
   (4 at a time, cached), against the export.

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

**The gate's rows:**

| URLs | What | Status (2026-10-12) |
|---|---|---|
| `/`, `/{en,de,fr,it}/` (5) | the frozen theme's own sections (hero, carousels, trending, places to stay, latest stories, newsletter) | **composed** (decision 1); 2–55‰ of the live text and 13–16 missing links each, by design: the live page's text and links are the theme's carousels (on `/de/`, `/fr/`, `/it/` partly English articles), the composition lists the 6 newest stories in the page's language and links all stories. **Waits for the owner's review in the preview** |
| `/{lang}/village/` (4) | the village template: the theme's default stories | **composed** as the village overview (decision 2); 0–3‰ and 13–17 missing links each, the same carousels. **Waits for the owner's review** |
| two articles × 4 languages (8) | **live renders `[object Object]`** (a live bug); the export has the whole article | nothing: the export fixes it |
| the weather pages (11: `/weather`, `/wetter`, `/meteo`, `/cinque-terre/…`) at 660–762‰ | the frozen theme's weather blocks print sample data; the content's own sample forecast is now left out | **the live forecast block is built** (decision 3); below 900‰ because the live page's sample forecast is not carried, by design. **Waits for the owner's review** |

Every other URL keeps its content (median 998‰), its links to live pages and its status. Images stay
where the live site has them (Unsplash and the site's R2 bucket, hot-linked); the theme's two local
images are uploaded as media.

**Open before the preview:**
- **The newsletter's endpoint:** the export needs `--forms-endpoint` set to the central server's
  public `/f/{company}` URL; without it the form posts to `admin-post.php`, which a static host does
  not answer. The production server's public URL is not decided yet.
- **Open-Meteo's terms:** the free API is for non-commercial use. If cinqueterre.travel counts as
  commercial (ads, affiliate links), the owner takes Open-Meteo's paid API (a key would then be a
  secret of the site repo) or accepts the risk.
- **The newsletter's consent:** the form records submissions in the company's inbox
  (`FormSubmitted`); a privacy line and a double opt-in are not part of it yet.

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
1. Run the migration above with `--forms-endpoint` (when decided) and check `compare.json`.
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

## After the switch

- Rule 9 ends: delete `packages/site-builder/src/themes/cinque-terre`, its pnpm workspace glob and its
  lockfile entries.
- The legacy modules retire: `GithubGateway`, PathPolicy uses, `check_draft`, `finalize.rs`,
  `site-kit`, `themes/starter`.
- Keep the `legacy-final` tag forever: step 0 references it.
