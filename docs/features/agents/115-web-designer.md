---
id: FEAT-115
title: "The web designer: the site's theme from its Claude Design design"
status: in-progress
importance: high
paths:
  - "crates/theme-designer/**"
  - "crates/agents/src/design/**"
  - "crates/agents/prompts/web_designer.md"
  - "crates/agents/personas/serena.toml"
  - "crates/orchestrator/src/site_theme.rs"
  - "crates/orchestrator/src/bin/swarmpress-site-theme.rs"
  - "crates/orchestrator/tests/site_theme.rs"
  - "crates/sim-core/src/site_theme.rs"
  - "crates/sim-core/tests/site_theme.rs"
  - "apps/game/src/site-design/**"
  - "apps/game/src/ui/theme-approval.test.tsx"
  - "apps/game/e2e/theme-visual.mts"
  - "apps/game/src/php/wp-site-engine.test.ts"
  - "apps/game/src/orchestration/loop.test.ts"
  - crates/content-import-wp/src/design.rs
  - crates/content-import-wp/src/parity.rs
  - crates/site-export/src/essentials.rs
  - crates/site-export/src/labels.rs
  - crates/site-export/src/tests.rs
  - crates/site-design/src/enhance.js
  - "packages/runner/test/fixtures/open-meteo/**"
adrs:
  - ADR-0093
  - ADR-0080
  - ADR-0082
  - ADR-0059
  - ADR-0067
---

# The web designer: the site's theme from its Claude Design design

A design version that arrives in the site's design store (FEAT-114) becomes the site's WordPress
theme **as site data** (ADR-0093), made by a staff member, checked deterministically, applied on a
branch of its own and merged only at the CEO's word.

## Built

- **`crates/theme-designer`** (pure, wasm-compatible): the deterministic part and the checks.
  - `plan(design, manifest, site)`: global styles from the tokens (`theme.json` v3: the palette
    with its roles in `settings.custom.roles`, font families, fluid font sizes from the tokens'
    `clamp()`, spacing, shadows from the elevations, the layout's wide size from the grid's
    container and its content size eight columns; custom CSS only for motion, the type tokens'
    line height, tracking and case on their size classes, and focus); fonts from the bundle's
    files (one Latin face per weight and style, an `AssetRef` with the bundle's SHA-256); the
    design's menus per site language with their links resolved by label against the site's pages
    (never `#`), and a language switch; one task per template (the design's, by
    `template_slug`, plus `index`, `single`, `page`, `404`, `archive`, `front-page` when the design
    has no page for them) and per part (`header`, `footer` with their menus); query sections bound
    to the site's collections by source and words, a section no collection fits left out with a
    note (rule 5).
  - `check_template`: a block-comment parser (strict: names, one JSON object of attributes,
    nesting, nothing outside blocks), allowed core blocks only, every section by its class
    (`sp-{id}`), the entry, the parts and the menus present, every preset reference resolving and
    no raw colour, WCAG AA contrast for each text block on its (inherited) background, no script,
    iframe, object, embed, handler or `javascript:`, no `#` link and links only to the site's
    pages, queries only from the task, and the design's enforceable rules (one rating scale with
    its decimals, one h1 without the site's name and `core/site-title` at level 0, alt text, the
    category on listed stories, the price scale). Messages name the line and what would pass.
  - `check_theme`: the shape (`ThemeData::validate_shape`), the required templates, the fonts'
    licences (an allowlist of SIL OFL families, checked before any model call too), the presets and
    the contrast of the pairs the global styles use, every template and part again.
  - `next_step`: Done, Repair (at most `MAX_REPAIR_ROUNDS` = 3 per task) or GiveUp (also at once
    for a font or shape issue, which no markup can fix). `sketch`: the reference markup of a task;
    `fake`: the fake designer (reads the task from the prompt; one raw colour on the front page's
    first answer, removed by its fix).
- **Agents**: the role `web-designer` (Serena Pastorino, `serena`, in the hiring pool), the job
  kind `web-design` (`config/roles.toml`), the prompt `web_designer.md` 1.0.0,
  `agents::design` (the `web design template` call and its `fix`, `TEMPLATE_ANSWER` 8,192 and
  `TEMPLATE_REASONING` 4,096 tokens), the fake in `fake_writer`.
- **The design's forms** (2026-10-14, ADR-0093 addendum):
  - **component styles** (`components.rs`): a vocabulary of `ds-…` classes for the forms editorial
    designs repeat (the grid's container and margins, section heads with their rule, the mono
    eyebrow, pill buttons and the arrow link, the hero, the image band bleeding right, pigment
    tiles with numerals, the feature-and-rows list, cards with a place chip and a rating out of
    ten, story rows, the dark band and its ledger, the masthead and the village dots, the footer's
    columns and colophon, a listing's bar, entries with a fact row, restaurants with their price
    and "know before you go", portraits, a page's head and prose), its CSS filled from the
    design's tokens and appended to the global styles; a place's pigment on `sp_place-{slug}` and
    the villages menu's dots by position;
  - **the task** carries each section's **shape** (`hero`, `image-band`, `tiles`, `feature`,
    `cards`, `rows`, `band`, `bar`, `entries`, `restaurants`, `people`), its **design markup**
    (`Section.html`, cut to 7,000 characters), its entries' **fields** (bindings) and its **links**
    as one-item menus per language (`link-{label}`: a template serves every language), and the
    site's picture for an image band; a listing template gets the page's title first and its own
    text after the entries; the theme carries the front page again as `page-front` for the other
    languages' homes;
  - **the draft**: `sketch` renders every shape in the vocabulary (the hero's lines and italic
    word, the ledger's items, bindings, link menus), and every template call carries it with the
    vocabulary (prompt 1.1.0); the fake answers it;
  - **checks** added: bindings only from `core/post-meta` and only the section's fields; the
    design's placeholders (`[°]`, `[CREDIT]`) refused; a listing's title (`core/post-title`) and
    text (`core/post-content`); an image's or cover's `url` is a picture, not a link.
- **The visual check in the job** (`theme_designer::visual`, `Gateway::visual_check`): after the
  checks the executor renders the theme on a branch and compares it with the design region by
  region (`apps/game/e2e/theme-visual.mts`: the design's static pages from
  `site_design::render::static_pages` with `data-sp-section`/`-part`/`-component` marks against the
  site's `sp-{id}` and parts; pictures masked on both sides; each region cropped from full-page
  screenshots, scaled to 256 px across and scored by `visualSimilarity`; a page's score is
  `pageScore`, the regions weighted by the design region's height, a missing region 0; a sheet
  with a fixed width is compared at that width only). A page below `VISUAL_THRESHOLD` (800) gets
  up to `MAX_VISUAL_ROUNDS` (2) repair rounds (`web design template fix` with its three worst
  regions: score per width, the design's markup, the rendered markup); a fix is kept when it passes
  the checks and its page does not score worse. The digest's score is the visual mean (0–10), the
  record keeps the report (without markup); an executor without a renderer answers `None` and the
  record says "not measured". The CLI renders on a Node WordPress that has the site
  (`--wordpress URL --repo URL`; `swarmpress-wp-migrate theme` writes the theme on
  `design-v{n}-look-{round}` and shows it to visitors).
- **The browser executor** runs the job: orchestrator-wasm's site engine bridges
  `siteDesign(version)` and `putThemeData(branch, dataJson, attributionJson)` (and the plain
  gateway `siteDesign`), `themeDataCalls(dataJson)` gives the importer's REST calls
  (`content_import_wp::theme::calls_json`), and `WpSiteEngine.putThemeData` runs them in the
  browser's WordPress (fonts uploaded from the design store's assets). The server's design upload
  publishes `DesignReceived {version}` to the company's inbox, and the orchestration loop logs
  `ServerCommand::DesignReceived{version}` at the next step boundary (persisted until then; an
  older version is dropped). The browser cannot render a theme, so its themes are not compared.
- **Orchestrator** (`site_theme.rs`): the `SiteTheme` job reads the design version
  (`Gateway::site_design`), plans, runs one call per task with the checks and repairs, checks the
  whole theme, keeps a `SiteThemeRecord` (the theme data, per-task outcomes, notes) as the item's
  artifact, writes the data on `design-v{version}` (`Gateway::put_theme_data`; on WordPress
  `EngineGateway` over `SiteEngine::put_theme_data` and a change request) and completes with a
  digest (score: the share of tasks right first time; words: tasks; qa_defects: issues repaired;
  the theme data's hash). Its Publish job merges the change request (`Gateway::merge_as`). Model
  failures and themes that never pass fail the job (rule 11).
- **Sim** (`site_theme.rs`): `ServerCommand::DesignReceived{version}` (newer versions only) makes a
  `SiteTheme` item (Draft by the web designer, or waiting with a `MissingRole` ticket); a newer
  design supersedes a theme in the works; the Draft's result parks the item at a `ThemeApproval`
  ticket (CEO-only, High, three days; `Approve`, `Reject` the default: the current theme stays);
  Approve's Publish merges and the version becomes `Plan.designs.live`. World format 15.
- **Inbox**: the `theme-approval` ticket with its design version and branch.
- **Runner step** (`swarmpress-site-theme`, feature `cli`): the job on a design file or bundle and a
  site's content, with the fake or GPT-6-Luna through the central server, writing the theme data
  with its fonts (for `swarmpress wp-migrate --theme-data`), a report, the bundle and the design's
  static pages (`*.static.html`). With `--wordpress URL --repo URL` it runs the visual check above
  (`visualSimilarity` in `apps/game/src/site-design/visual.ts`, pure: colour and edge structure per
  cell, a length term, the worst cells).

## Built (2026-10-14, second): every menu entry, every component, every page type

ADR-0093's second addendum, after the owner rejected the first preview (no submenus, the design's
components hardly used):

- **The source site's navigation** (`theme_designer::navigation`): `SiteContext.menus` are the
  import's source menus (`content_import_wp::plan::source_menus`), nested, per language; each design
  menu takes the source menu or column its items name (its area first; one design menu per source
  entry), what none takes becomes the header's main menu, the wordmark or a footer column. The main
  menu's places get the design's panel (4.1): a head item (number, name, the place's line) and the
  place's newest story as a featured card; a language row for the phone's sheet (4.20). The header
  renders it as `core/navigation` with `overlayMenu: "mobile"` and hover submenus, styled as the
  design's mega-menu (the place's tint, two numbered columns, the featured card; 120 ms intent;
  drop and fade; reduced motion: fade only) and phone sheet (64 px rows, italic names, pigment dots,
  numbers; a place's pages open in place). `check_navigation` fails the theme for any source entry
  (with its parent) the theme data lacks, unless `SiteContext.retired` lists it with a reason.
- **The catalogue** (`theme_designer::catalog`): `CONTENT_FUNCTIONS` maps the content model's
  classes to component functions; `block_styles` gives each (component, variant) the content
  classes it renders; `coverage` reports every component (where used: templates, parts, block
  styles and the pages with that content; or why unused) and every page type (its template, its
  components) and fails for a component the site has content for that nothing uses and for a page
  type without its own template.
- **The forms** (`theme_designer::forms`): CSS for every component the catalogue can place, from
  the tokens: the masthead's tide, the mega-menu and phone sheet, the breadcrumb with the place's
  dot, the page header, badges, the contents rail with the reading progress (a CSS scroll
  timeline), pagination, the search overlay, the essentials ticker, the week ahead (icon and
  word, the fixed 10–30° bar, rain ≥ 20 % marked), filter chips, Notte at night; per block style
  the accordion, the Trail Ledger (four cells, a grade's four-step bar and word), the mode table,
  the itinerary timeline (roman discs in the place's pigment, the rule drawing down), the page
  hero, the three callouts (pull quote with the hanging mark, local wisdom on Calce with the pin,
  the notice on Ink; never a left border), editor profiles, season cards on the design's season
  grounds, entries, the contents list, the byline, continue reading, tags; the icon set as CSS
  masks (`.ds-i-{id}`, `.ct-wx-{sky}`, `.ct-mode-{mode}`); the motion tokens as `--ds-…`; the
  twelve micro-interactions, each with its reduced-motion fallback. The CSS keeps out backslashes
  and almost all single quotes (the governed storage rebuilds such strings from pieces).
- **Page-type templates** (`plan`): one task per page type the design has no page for
  (`page-{type}`, or `single` for stories): the page header (`core/breadcrumbs`, the title as the
  h1; a story's category and lede), then the content (a story's in the contents-rail grid with the
  progress bar); `search` joins the required templates. Components each section, part and menu is
  are listed on the task and must carry `ds-c-{slug}` (a check). The hero's essentials box is a
  ticker the export fills (`EssentialsSpec`).
- **Files**: the icon sprite `icons.svg` and the audited `ds.js` (ADR-0093's second addendum,
  decision 7) in `ThemeData.files`; the export publishes them and loads the script on every page.
- **The import with a design** (`content_import_wp::design`): page types (`_swarmpress_page_type`)
  and one template per type; items' classes (`ct-items-{type}`, `ct-mode-{mode}`, `ct-place-…`);
  facts from practical lines (`ct-facts`, a grade's step); stories as the design's article (byline,
  dateline, lede, picture, anchored headings and a contents list, tags, the author's line; the
  older flat story shape too) and what to read next; a story without a category takes its hero's
  badge (a content gap); pages under their parents (the breadcrumb); block styles applied; content
  gaps reported. The weather pages get essentials markers.
- **The export** (`site_export::essentials`, the migrate CLI): tickers filled from Open-Meteo (the
  forecast API's air and sunset, the marine API's sea surface temperature; recorded answers
  `essentials-{lat},{lng}.json` for tests), refilled by the daily `forecast` run; the theme's files
  added, `/ds.js` on every page; `design-check` (`content_import_wp::parity`): the live menus'
  every entry on the export (nested under its parent, its link working), every source page on a
  template of its type, no "Uncategorized", the content gaps.
- **Visual report per component and page type** (`visual::coverage_pages`, the CLI's
  `--report-export DIR --theme-data FILE`): each used component's instance against its specimen,
  each page type against the design's closest composition, at 375 and 1280 px.
- Prompt `web_designer.md` 1.2.0: the main menu's overlay, the component markers, page types.

## Tests

- `crates/theme-designer/tests/coverage.rs`: the navigation from source menus (nested, panels,
  featured, wordmark) passing its check; a lost and a flattened entry failing, a retired one
  noted; components serving content and template functions with every unused one's reason; one
  failing fixture per coverage check (a missing block style, a missing marker, a page type
  without its template), a template without its marker failing `check_template`; the CSS within
  the storage layer's limits; seeded mutations (a source entry dropped, a marker dropped) all
  caught.
- `crates/content-import-wp/src/design.rs` (facts and grades, block styles reaching attributes and
  HTML idempotently, page types and templates), `parity.rs` (nested entries, a lost, flattened or
  broken entry failing and a retired one spared; templates and "Uncategorized").
- `crates/site-export/src/essentials.rs` (values parsed, filled in the page's language, refilled;
  no place or no values failing), the forecast's tests (icons and words, no emoji, the bar, rain
  marked).
- `packages/runner/test/wordpress.test.ts`: the essentials ticker filled from recorded answers on a
  design's weather page; no emoji in the forecast.

- `crates/theme-designer`: unit tests (parser, scanners, styles, the repair driver);
  `tests/plan.rs` (the trimmed style guide's plan, bindings, every reference rendering passing,
  same bytes twice, the full export when present, the fake's slip and fix); `tests/checks.rs` (one
  failing fixture per check); `tests/mutation.rs` (seeded random mutations of passing markup: every
  one caught).
- `crates/sim-core/tests/site_theme.rs`: the item, the gate, Approve and the merge, Reject and the
  default, the Secretary never answering, waiting for a web designer, a newer design, versions only
  forward, a failure's escalation and Retry, the same world twice; the golden script receives a
  design (the hash history in `tests/golden.rs`).
- `crates/orchestrator/tests/site_theme.rs`: the fake theme with one repair round (calls, budget,
  artifact, branch, attribution, thread, a run again without calls), a theme that never passes, a
  model failure, an unlicensed font before any call, an unknown version, the sim around the jobs
  (approve and merge, the same world twice; reject never merges), and the WordPress engine's
  gateway (branch, change request, merge into live).
- `apps/game/src/site-design/visual.test.ts`, `apps/game/src/ui/theme-approval.test.tsx`.

## Results on cinqueterre.travel (2026-10-14)

Design v1 ("Salt & Pigment"), GPT-6-Luna through the central server, rendered on a Node WordPress
with the site imported (sandbox 0.9.0), pictures masked, region by region:

| Template | 375 px | 1280 px | 1440 px (the listing sheet's width) |
|---|---|---|---|
| front-page (`/`) | 865 | 856 | |
| page-front (`/de/`) | 858 | 848 | |
| archive-activity (`/en/corniglia/things-to-do/`) | | | 825 |
| archive-restaurant (`/en/corniglia/culinary/`) | | | 791 |
| archive-editor (`/en/team/`) | | | 825 |
| archive-weather (`/en/corniglia/weather/`, the bar only) | | | 794 |

Before (the previous run, whole page, no masks): 573–657 on the home, about 530 on the listings.
The weather listing's bar went from 775 to 794 in two visual repair rounds; the restaurant entry
stays at 791 (the design shows one entry with two external ratings side by side and a fourth
"ask for" fact the data does not have). The final run: 17 calls, $0.026; all runs of the day: 95
calls, $0.131. The theme is on the site repo's preview (`wordpress-export`), not in production.

## Results on cinqueterre.travel (2026-10-14, second)

GPT-6-Luna through the central server, 48 tasks (47 templates, 2 parts; 47 right first time, 9
issues repaired), 53 calls, $0.054; the job's own visual check: front page 843/822, `page-front`
830/821 (375/1280 px), listings 776–825 at 1440 px. The migration with its theme data: gate
**631/663**; `design-check`: 544 live menu entries on the export (400 nested), 0 missing, 0 broken;
0 pages on the generic template; 0 "Uncategorized"; preview `wordpress-export` at `5d18c86`.

Coverage (`coverage.json`, no errors): every component used except 4.12 form controls (no form:
the newsletter is hidden), 4.16 gallery (no set of pictures in the content) and 4.18 feedback (no
page places it, no status content). Visual, each component on a page that shows it against its
specimen (1440 px: the sheets are laid out at that width): masthead and village panel 853, editor
profile 826, accordion 754, itinerary timeline 749, dateline 714, activity entry 705, listing bar
703, tags 701, continue reading 681, page header 676, restaurant entry 652, mode table 638, Trail
Ledger 628, phone sheet 623, callouts 603, week ahead 582, search 533, cards 505, buttons 284
(one header button against the sheet's row of variants), essentials 229; the contents rail is
not compared (its specimen's progress bar is 3 px high). Page types against the closest design
composition: the listings 776–826 (1440 px), the others 485–626 at 375 and 1280 px (only the
parts and their shared components are regions; most types' content has no page in the design).

After the review of the side-by-sides (the owner's coordinator's notes included), fixed for every
site, each with a check or a test:
- **One byline, the real author:** a story whose content carries its byline gets a template that
  must not use `core/post-date`, `core/post-time-to-read` or `core/post-author-name`
  (`TemplateTask.forbid`, checked); WordPress's author is whoever imported the story.
- **The page header's order** (4.9: breadcrumb, eyebrow, title, lede) is a check.
- **Never an empty picture frame:** a story's picture is its article's, else its hero's; a stay
  carries its first picture; an entry without one shows its text-only variant (CSS), and the
  content gaps list it.
- **The hero** keeps the essentials ticker beside the headline at the top, its values unclipped.
- **A wrap inside a wrap** is not narrowed again; a band's ground runs the page's full width.
- **A story's measure** is 64ch at body-l, its section heads at the type sheet's h2.
- **Forms:** an editor's note is the pull quote (its author and role in mono below), a story's tags
  are 4.3 tags, a tag keeps its own width, a collection of ways to arrive is the mode table (one
  block style per block, the most specific).

The second review (on `94de781`), fixed for every site, each with a check or a test:
- **Ways to arrive are one mode table (4.14):** a collection whose items carry a mode is one
  compact table, a row per mode (its icon, its name, a note, its time in the display face with
  "Typical" under it) that opens to the rest of the item; its interludes follow the table. A row
  without a time is a content gap; a page with ways to arrive not in a mode table fails the
  design check.
- **The design's words in every language (labels):** every word a theme shows that is not content
  (its templates' own texts, the stylesheet's `Village`, `Featured`, `Typical` and callout names,
  the ticker's `Today on the coast`, `On this page`, `More in`, the script's search words,
  WordPress's skip link, the names of a page's facts) is a label. The `web design labels` call
  writes every label in every site language; the job refuses a table with a gap or a language left
  in English; the table travels in `ThemeData.labels`. The stylesheet reads its labels from
  `--ds-l-css-…` variables set per `:lang()`; the import and the export put the others in a page's
  language where one stands alone (`site_export::labels`). The design check fails a page that
  still shows one in English.
- **The phone's sheet (4.20)** opens with the wordmark beside its close button (the main menu's
  first item, `ds-sheet-brand`, shown only in the open sheet).
- **The home's headline:** fluid type sizes are the design's own `clamp()` (WordPress's fluid
  formula gave 157 px where the design has 145 px at 1280 px), and the opening's columns take the
  homepage sheet's flex values (`hero_columns`).
- **A story's author** closes it as the design's editor profile (7.5): initials, name, role, bio.
- **Author archives** are exported only for the authors the content names; WordPress's archive of
  the importing user (`/author/admin/`) leaves the release with its sitemap entries.

## Tests added on 2026-10-14

- `crates/theme-designer/tests/design_forms.rs`: the component styles from the tokens and the
  places' pigments; the sections' shapes, markup, fields, link menus and picture; bindings and
  placeholders refused; the visual repairs (which tasks, the worst regions first, missing ones
  before low ones) and the score.
- `crates/orchestrator/tests/site_theme.rs`: a far region repaired and compared again (the digest's
  score the visual one), a fix that looks worse undone, an executor without a renderer.
- `apps/game/src/php/wp-site-engine.test.ts` (`putThemeData`), `apps/game/src/orchestration/loop.test.ts`
  (`DesignReceived`), `apps/game/src/site-design/visual.test.ts` (`pageScore`),
  `crates/server/tests/site_designs.rs` (the upload's event).

## Next

- **A browser renderer**: the in-game job cannot screenshot its own WordPress, so its themes are
  not compared; the runner's step and the CLI compare.
- **An e2e of the in-game job** (design upload → `DesignReceived` → the job with the fake model →
  `putThemeData` in the browser's WordPress → `ThemeApproval`): the parts are tested one by one
  (vitest, the orchestrator's tests); the whole flow on the real page is not yet.
- The design's listing sheet has no phone layout (it is 1440 px wide), so listings are compared at
  1440 px only; the weather listing compares only its bar (the forecast table is the export's).
- The hero's "Today on the coast" box has no data on the site (the design shows placeholders), so
  it is left out.
- **The template's own copy is the design's, in English, in every language** (the hero's headline,
  the section heads); the entries, menus and links are in the page's language. Per-language copy
  (a pattern or a one-item menu per language) is next.
- Model variance: two runs of the same job scored the home 824 and 865 at 375 px; the visual
  rounds only repair what is below 800.