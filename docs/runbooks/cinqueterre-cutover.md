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
   --assets $T/public
```

What it does:
1. **Import** (`content-import-wp`): one WordPress post or page per live URL, by the frozen theme's
   routing rules (the plan's URL set must equal the reference build's: it does, 663 URLs), each with
   its route, language, SEO title and description as meta; the JSON blocks as core blocks; blog
   articles as posts with categories and tags; one menu per language; the theme's two local images
   uploaded as media. Written through the REST API on the branch `import-site` as the CEO, merged
   into `live` by one change request, release `import`.
2. **Theme:** Coast, the sandbox's editorial block theme (the frozen theme's palette and type).
3. **Export:** `live` crawled into a content-addressed release (`export/release.json`, `export/files/`).
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

**Result, 2026-10-11** (the live site against the export of sandbox 0.6.0; the import took 3 minutes,
the export 3½):

| | |
|---|---|
| URLs compared | 663 |
| pass | **631** |
| status mismatches | 0 |
| content below 900‰ | 32 (median 998‰) |
| missing links to live pages | 141 (all on the 9 home and village-template pages) |
| titles that differ | 0 |
| live links to live 404s (fixed by the import) | 345 |
| pages only in the export (category, tag and author archives, the sitemap's pages) | 218 |

**What fails, and what it needs before the switch:**

| URLs | What | Needs |
|---|---|---|
| `/`, `/{en,de,fr,it}/` (5) | the home renders the frozen theme's own sections (hero, carousels, trending, places to stay, latest stories, newsletter): none of it is content, so none of it imports | a home composed in the Studio (the latest stories as a query block, the villages, the newsletter form to `/f/`); the owner reviews it |
| `/{lang}/village/` (4) | the village template: the theme's default stories | decide: retire the URL (a redirect to `/{lang}/cinque-terre/`) or compose it |
| two articles × 4 languages (8) | **live renders `[object Object]`** (a live bug); the export has the whole article | nothing: the export fixes it |
| the weather pages (11: `/weather`, `/wetter`, `/meteo`, `/cinque-terre/…`) at 770–865‰ | the frozen theme prints the forecast as a table with labels of its own (days, `°`, "The Week Ahead") | style the forecast in Coast, or accept |
| `/{lang}/team/` (4) at 851‰ | the theme's labels around the editors' cards | accept, or label in Coast |

Every other URL keeps its content (median 998‰), its links to live pages and its status. Images stay
where the live site has them (Unsplash and the site's R2 bucket, hot-linked); the theme's two local
images are uploaded as media.

## Step 4: the switch (owner's decision)

Before it:
- the gate's failures above are resolved or accepted by the owner, one by one;
- the export is deployed somewhere public that is not the domain (a preview), and the owner has
  read it;
- the static plane for the domain is chosen: GitHub Pages fed by the release (the workflow uploads
  `export/files/` instead of building), or the platform's static plane (ADR-0049; not built for
  custom domains yet).

The switch is one PR on the site repo: `deploy.yml` stops building the Astro theme and deploys the
export of `live` (the release the platform publishes for the company). **Rollback:** revert that PR;
the pinned Astro build still works, because the tag is immutable.

## After the switch

- Rule 9 ends: delete `packages/site-builder/src/themes/cinque-terre`, its pnpm workspace glob and its
  lockfile entries.
- The legacy modules retire: `GithubGateway`, PathPolicy uses, `check_draft`, `finalize.rs`,
  `site-kit`, `themes/starter`.
- Keep the `legacy-final` tag forever: step 0 references it.
