# Runbook: cinqueterre.travel cutover

This runbook moves the live cinqueterre.travel site from "built from the swarmpress monorepo" to
"site-kit plus an agent-authored theme, operated by the game", **without the live site ever
breaking** ([ADR-0023](../adr/0023-cinqueterre-migration-and-cutover.md)). Feature: FEAT-050.

## Where we start

`swarmpress/cinqueterre.travel` `.github/workflows/deploy.yml` (on push to `main`, plus manual
dispatch) does this:
1. Checks out the content repo into `content/`.
2. Checks out **`swarmpress/swarmpress` at its default branch** into `swarmpress/`, with
   `token: ${{ secrets.MONOREPO_PAT }}`.
3. Runs `pnpm install` at the monorepo root (pnpm 9, Node 20).
4. Builds `swarmpress/packages/site-builder/src/themes/cinque-terre` with
   `CONTENT_DIR=$GITHUB_WORKSPACE/content/content/pages` into `dist/`.
5. Writes `CNAME` and `.nojekyll`, then verifies that the `de/en/fr/it` folders exist and there
   are at least 100 HTML pages.
6. Deploys with `actions/deploy-pages@v4`.

Consequence: **any change to swarmpress `main` changes the live site on its next deploy.** Until
step 0 is applied, the fresh tree must keep
`packages/site-builder/src/themes/cinque-terre/**`, its pnpm workspace glob and its lockfile
entries intact.

### Findings to verify before step 1

| Finding | How to verify | Status |
|---|---|---|
| `COLLECTIONS_DIR` / `BLOG_DIR` resolve to an empty gitlink in CI, so collections and `content/blog` may not render live | Compare the theme's content-path resolution with the CI checkout layout; fetch live collection URLs (e.g. `/en/riomaggiore/restaurants/`) and check for empty lists or 404s | to verify (M0) |
| `content/blog` (18 files) duplicates `content/pages/blog` (19, canonical; 2 differ) | `diff -r` of the two trees; list the URLs each produces in a local build | to verify |
| Languages and villages are hardcoded in the theme | grep the theme for `['en','de','fr','it']` and village slugs | known |
| Other repos check out `swarmpress/swarmpress` | `gh search code "repository: swarmpress/swarmpress" --owner swarmpress`, plus the org's workflow files | to verify before replacing `main` |

## Baseline crawl (taken in step 0, used by every gate)

- **URL set:** every URL in `sitemap.xml`, plus a crawl from `/` (internal links only), per
  language.
- **HTML snapshots** of about 40 representative URLs: home ×4 languages, each village ×2
  languages, collection indexes, 5 blog posts, 404, and the about and legal pages. Normalised by
  stripping build hashes and timestamps.
- **Screenshots** of the same 40 URLs at 375 and 1280 px.
- **Lighthouse** for home and one article, in en and de.

Store these as a CI artifact named `cutover-baseline`, plus a `cockpit.visual.v1` document for the
screenshots.

## Steps

Each step is **one PR on the site repo**, gated against the baseline. Merge only when the gate
holds. Each step is reverted with one revert commit.

### Step 0: decouple (one line)

1. Tag the current swarmpress `main` (`391d5de` at the time of writing) as **`legacy-final`**,
   and also as **`legacy-ts`**:

   ```sh
   git tag legacy-final origin/main && git tag legacy-ts origin/main
   git push origin legacy-final legacy-ts
   ```

2. Pin the monorepo checkout in the site repo's `.github/workflows/deploy.yml`:

   ```diff
          - name: Checkout monorepo (for theme)
            uses: actions/checkout@v4
            with:
              repository: swarmpress/swarmpress
   +          ref: legacy-final
              path: swarmpress
              token: ${{ secrets.MONOREPO_PAT }}
   ```

3. Run the workflow (`workflow_dispatch`) and capture the baseline crawl.

**Gate:**
- the deploy is green;
- the crawl is identical to the pre-change production crawl (URL set and normalised HTML).

**Rollback:** revert the one-line PR.

**After step 0,** swarmpress `main` can change freely, because the live site no longer follows
it. The fresh tree may then drop the frozen theme path, but it is only deleted after step 1
(M5).

> This session cannot push to `swarmpress/cinqueterre.travel`. Either install the Claude GitHub
> App on that repo, or have a maintainer apply the patch above.

### Step 1: vendor the theme

- Copy `packages/site-builder/src/themes/cinque-terre` at `legacy-final` into **`theme-legacy/`**
  in the site repo, with its own `package.json` and lockfile.
- Change `deploy.yml` to build in place, reproducing today's content-path behaviour exactly
  (including the empty-gitlink quirk, if confirmed).
- **Remove the monorepo checkout step and the `MONOREPO_PAT` secret.**

**Gate:** identical URL set and identical normalised HTML for the 40 URLs.

**Rollback:** revert. Step 0's pin still works, because the tag is immutable.

### Step 2: the intended fix

- Point the build at a real `CONTENT_ROOT`, so collections render.
- **Dedupe the blog:** `content/pages/blog` is canonical, with one route per URL. Resolve the 2
  differing files by human review, and delete `content/blog`.

**Gate:**
- **human review of new URLs**: this step is *meant* to add pages, so strict parity does not
  apply;
- no baseline URL disappears;
- the visual diff on unchanged URLs is ≤ 0.5%.

### Step 3: `site.manifest.json`

- Add the manifest with:
  - `languages`;
  - a brand/voice reference;
  - `regions` (villages: slug, name, order, colour, geo, entity ref);
  - `sections`;
  - `collections` (dir, schema, detail route, region field);
  - `routes`;
  - `screenshotPages`.
- Homepage blocks and navigation read the manifest instead of hardcoded lists.

**Gate:** visual diff ≤ 0.5% on all 40 URLs, and an identical URL set.

### Step 4: site-kit

- Extract `packages/site-kit` in swarmpress and publish `@swarm-press/site-kit` to npm
  ([ADR-0016](../adr/0016-site-kit-distribution-via-npm.md)).
- Restructure the site into `theme/` under `defineTheme`, and convert the Cinque Terre blocks to
  `x:` custom blocks.
- Add the platform-owned `site-ci.yml`, and slim `deploy.yml` down to "install, build with the
  kit, deploy".

**Gate:**
- URL-set parity;
- visual diff ≤ 0.5%;
- Lighthouse no worse than the baseline;
- `kit check --strict` green.

### Step 5: schema v2

- Text fields become localized (`string | Partial<Record<Lang,string>>`). Add a real
  `blog-article` block and `MediaRef`.
- Run `kit migrate` codemods over the content. Use a ratcheting `kit check --baseline`, so
  existing violations can only decrease.
- Regenerate the Rust `page.schema.json` from the same source (`pnpm schema:export`), and keep the
  shared fixtures green on both sides.

**Gate:**
- `kit check --baseline` green;
- visual ≤ 0.5%;
- conformance tests green in swarmpress.

### Step 6: import into the game

Run the `ImportSite` job against the repo at a SHA. Only **derived indexes** are created, and
content stays in the repo.

| Source | Target |
|---|---|
| `entity-index` | entities |
| `media-index` | closed media (338 images) |
| `sitemap-index` + crawl | page registry |
| `style-guide`, `linking-policy`, `writer-prompt`, `media-guidelines`, `blog-workflow` | house-style documents |
| `content-calendar` | pitch backlog |
| `collection-research` | research templates |

- **Staff:** Giulia, Isabella, Lorenzo, Sophia and Marco as Senior Writers, and Francesca as
  Senior MediaEditor. Then generate an EiC, an Editor, a QA, an Art Director and a Front-end Dev.
- The company starts as a **"Legacy publication"**: level 3, with reputation from the first
  SiteAudit.
- The repo is a **linked external repo**. It is **not** transferred into the platform org, because
  that would break the Pages custom domain.

**Gate:**
- re-running the import at the same SHA produces identical indexes;
- the SiteAudit page count matches the crawl.

### Step 7: shadow mode

- Set `autonomy = ApproveAll` for **2 weeks**: every pitch, merge and redesign is a CEO ticket.
- Limit design to **ThemeTweak** until **3 clean cycles** (merged, deployed, smoke green, no
  rollback).
- Then switch to `ApproveMajor`.

**Gate:**
- zero unreviewed merges during shadow mode;
- no rollback in the last 3 design cycles.

## After cutover (M5)

- Delete `packages/site-builder/src/themes/cinque-terre` and its pnpm workspace glob from
  swarmpress.
- Replace swarmpress `main` with the fresh tree by a **normal merge commit**, never a force-push.
  Do this only after the search for other repos that check out swarmpress comes back clean.
- Keep the `legacy-final` tag forever, since step 0's history references it.
