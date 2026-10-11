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
  - crates/content-import-wp/src/compare.rs
  - crates/content-import-wp/src/tests.rs
  - crates/content-import-wp/src/bin/swarmpress-wp-migrate.rs
  - packages/runner/src/wordpress.ts
  - packages/runner/test/wordpress.test.ts
  - packages/runner/test/fixtures/migrate-site/content/site.json
  - docs/runbooks/cinqueterre-cutover.md
adrs:
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
- **Verified:** the crate's tests (routes, mapping, plan, comparison, and the live site's content
  when it is checked out), and `test/wordpress.test.ts` in the runner (a fixture site migrated into
  a fresh Node WordPress: every URL, its text, SEO title, language and links).

## Not built yet

- **Parity** (2026-10-11): 631 of 663 URLs pass, no status or title differs, the median page keeps
  998‰ of its live content. The 32 others are in the runbook's table: the home pages and the village
  template (the frozen theme's own sections, to be composed in the Studio), eight article URLs the
  live site renders as `[object Object]` (fixed by the export), and the weather and team pages'
  theme labels.
- **The switch** (plan M8 step 4) and the retirement of the legacy path: the owner's decision.
