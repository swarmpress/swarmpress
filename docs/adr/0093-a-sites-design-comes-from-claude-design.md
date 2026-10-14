# ADR-0093 — A site's design comes from Claude Design

**Status:** Accepted (supersedes ADR-0092 decision 5's last sentence, "a design a player brings is carried the same way, as a block theme"; amends ADR-0080 decision 1's list of governed objects)
**Date:** 2026-10-13

## Context

cinqueterre.travel runs on WordPress with the `cinqueterre` block theme, a hand port of the old Astro
theme into the GPL sandbox (ADR-0092). That port was the fast and safe step before the switch; it is
not a way every company can get its own design. Each new design would be another theme folder in the
sandbox, written by hand, released with the sandbox and licensed with it.

The owner wants one generic way. **A design made in Claude Design is always the original of a site's
design and UX**, and the site is generated from it. Claude Design already sends designs to connected
systems with "Send to" (Adobe Experience Manager is one such destination, through a directory
connector); swarm.press should be one too. In the owner's words, templates are designed in Claude
Design and integrated directly into the site. So the unit is the **template**: each page of a design
(home, article, village, archive, 404, a listing) becomes a template of the site, its shared parts
become parts, its repeated sections become patterns, its styles become global styles. A later design
of one template replaces only that template.

The owner does not mind which engine renders the result: WordPress today (ADR-0078 to ADR-0084),
Astro before it, something else later. The design is the source; the engine is an implementation
detail.

On 2026-10-13 the owner exported a style guide from Claude Design, *Cinque Terre Dispatch — "Salt &
Pigment"*: a cover with four principles and six "observed on the live site → fix" rules; colour (ink,
paper, two working accents, the five villages' pigments with tints, the "Notte" dark scheme, stated
contrasts); typography (Bodoni Moda, Schibsted Grotesk, IBM Plex Mono, fluid sizes from `display-xl`
to `stat`); iconography; grid, space and shape (12 columns, a 4px spacing scale, radii, elevations,
image ratios, breakpoints); two sheets of components (masthead, cards, the Trail Ledger, …); motion;
the applied homepage; and listing templates (activities, restaurants, weather, the team). **The owner
decided that this style guide is cinqueterre.travel's new style.** It replaces the Astro-derived
`cinqueterre` theme as the design target and is **design version 1 of the site `cinqueterre-travel`**.
The exported bundle is kept in the site's own repository, not in swarm.press's.

What exists: the concept already makes Claude Design a first-class source with three modes (file
import, connected source, roundtrip) and semantic reconciliation (`docs/reference/construction-kits.md`
§5); the blueprint import (FEAT-093, `apps/game/src/blueprint/design-import.ts`) reads HTML and ZIP
exports into page types by fixed rules; the Paint shop writes `wp_global_styles` over REST on a branch
(FEAT-104); templates, parts, global styles, navigation and fonts are WordPress posts, which the
storage API governs (ADR-0080, ADR-0084).

## Decision

1. **The design is the durable truth of a site's look and structure; an engine renders it.** A
   design is kept twice, and both are versioned per site:
   - the **design bundle**: the files as sent (pages, stylesheets, images, fonts, JSON; never
     scripts), checked (plain relative paths, allowed types, at most 512 files and 20 MB) and
     identified by a content hash of its files only;
   - the **site design**: the bundle interpreted into an engine-neutral semantic model (below).
   WordPress is one renderer of the site design (today the only one); its rendering is the **theme
   data** (decision 5). Nothing in the bundle or the site design names an engine's concept.
2. **swarm.press becomes a Claude connector.** A remote MCP server on the central server, behind
   OAuth on the existing login, offers the tools Claude Design's "Send to" needs: list the player's
   sites, send a design to a site, report a design's status (the web designer's checks, the preview),
   and read a site's design for a roundtrip (Mode C). Until the connector is public and listed, a
   player uploads a design file (Mode A); a design sent through the connector arrives the same way.
3. **Designs are write-once versions per site.** `POST /api/sites/{id}/designs` (company lease)
   stores the bundle's files in object storage by digest (like assets, ADR-0050) and its manifest as
   a version; the same bundle sent twice is the same version. A Claude Design standalone export (one
   HTML file with nested page bundles) is unpacked natively into pages and assets. Versions are read
   back with their interpretation and their files, which are served so that nothing in them runs.
4. **The interpretation is deterministic** (`crates/site-design`, pure, wasm-compatible). It ports
   FEAT-093's section rules and adds:
   - **pages:** a page with the site's header or footer, or a title that names a page, is a
     **template**; a listings sheet's numbered parts are listing templates; every other page is a
     **design-system sheet**;
   - **tokens:** colours with roles and computed WCAG contrast (and the design's stated contrast),
     alternative schemes (dark), font families with their files, a fluid type scale, spacing, radii,
     elevations, motion, breakpoints, the grid and image ratios, read from stylesheets and from
     Claude Design's page data (read as literals, never executed);
   - **templates:** one per template page, with ordered sections, each a catalogue block, a content
     query (latest, featured, a collection, the template's own list), the page's own entry, or a
     component; shared **parts** (header, footer) with their **menus**; **patterns** for what more
     than one template uses; **components** from the numbered parts of a components sheet;
   - **design rules:** principles, "observed → fix" rules and rules of use. Some map by fixed
     wording to a closed list of checks (one rating scale, the H1 without the site's name, no `#`
     links, one image per story, a required component, required fields, a price scale), which the
     web designer's checks and later content checks enforce.
   Every derived item carries the rule that produced it.
5. **The unit is the template; a design becomes site data, not theme files.** On WordPress the
   mapping is fixed:
   - each template of the design → a `wp_template` (home → `front-page`, single → `single`, page →
     `page`, archive → `archive`, a listing → `archive-{slug}`, 404 → `404`, a page type of its own →
     `page-{slug}`); `index`, `single`, `page` and `404` always exist;
   - parts → `wp_template_part` (header, footer);
   - patterns → `wp_block` patterns;
   - tokens → the user's global styles (`wp_global_styles`: `theme.json` v3 settings and styles,
     plus custom CSS for what `theme.json` cannot say);
   - menus → `wp_navigation`, one per menu and language (`{name}-{lang}`, ADR-0092);
   - fonts → `wp_font_family` / `wp_font_face`, the files as uploads.
   This is `site_design::wordpress::ThemeData`. It is written over WordPress's REST API on a
   `design-…` branch of the governed repository and merged through a change request, like an import.
   It sits on **one neutral base theme** in the sandbox (`canvas`: parts, `index`, a minimal
   `theme.json`, no design of its own). A later design of one template replaces only that template's
   data; the other templates, and tokens the later design does not name, stay
   (`site_design::merge`), and the CEO sees the semantic diff (`site_design::diff`).
6. **A staff web designer generates the theme data.** A job takes a design version (the site design,
   the catalogue and the content model) and returns `ThemeData` built from core blocks only. It is
   checked deterministically (the data's shape, the block grammar, allowed blocks, every template
   covered, tokens referenced exist, contrast for text pairs, fonts licensed, no external scripts, the
   design's checkable rules) and visually (the design's pages and the rendered branch screenshotted
   at phone and desktop widths, scored per page). Failed checks go back to the model with their
   messages (a repair loop, like the office designer). Scores and defects enter the sim only as a
   digest (rule 2).
7. **The CEO approves a design with a ticket** (`ThemeApproval`): the default keeps the current
   theme, and it has a deadline (rule 10). Approval merges the branch into `live`, and the next
   release is exported and deployed.
8. **ADR-0080 is amended:** the governed objects include a site's design, as the version it was made
   from (its bundle hash), and its theme data, as the posts above. They are changed on branches and
   merged by change requests like content.

## Consequences

- One path for every company's design, from Claude Design or any static HTML export, without a
  theme folder per site in the GPL sandbox. Designs are versioned and diffable, and the CEO approves
  them like content.
- The owner's style guide is the first real input: the crate interprets the whole export (ten
  sheets, 27 files after unpacking, about 0.6 MB), and a trimmed copy of two sheets is its test
  fixture. cinqueterre.travel moves from the hand-ported theme to its theme data from design v1 once
  the web designer's output passes the checks and the owner approves it; the `cinqueterre` theme
  folder then retires from the sandbox.
- The design rules from the style guide become checks the staff run, not only prose.
- Another engine would add a renderer beside `site_design::wordpress`; the bundle and the site
  design stay.
- **Negatives:**
  - **Generation cost and drift.** Every design version costs a model job (hosted GPT-6-Luna,
    ADR-0067) and its repairs. The rendered site can drift from the design where core blocks cannot
    say what the design does (custom interactions, the mega-menu, motion). The visual score makes the
    drift visible; it does not remove it.
  - **A base theme is still needed.** WordPress renders block templates through an active theme, so
    the sandbox keeps one neutral theme (`canvas`) and its PHP, released with the sandbox.
  - **"Send to swarm.press" depends on Anthropic.** A directory listing and a Send-to destination
    are submissions to Anthropic's connector programme, and the central server needs a public HTTPS
    address first. Until then, upload (Mode A) and a custom connector by URL are the ways in.
  - **The licensing question moves.** Theme data written into WordPress is content stored by the
    governed layer and served through the GPL program; whether templates and patterns written as
    data are affected by the GPL is part of the legal review ADR-0078 and ADR-0084 already require
    before release. It is listed there, not settled here.
  - **Heuristics.** The interpretation reads structure and wording; a design laid out unusually can
    be misread (a section as the wrong block, a rule without its check). The web designer and the
    CEO's review are the backstop, and every derived item names its rule.
  - **Two importers until the TypeScript one is retired.** FEAT-093's `design-import.ts` keeps its
    rules in the browser until it calls the crate through wasm.
- **Alternatives:**
  - **Theme files per site** (a block theme folder in the sandbox per company, as ADR-0092 did for
    cinqueterre): exact, but every design is GPL-distributed code in the sandbox, released with it,
    and a player's design would need a sandbox release.
  - **A deterministic converter only** (design → theme data by rules, no model): predictable and
    cheap, but a design's components and layouts are too varied for fixed rules to produce good block
    markup; the rules are kept for the interpretation, where they are reliable.
  - **Manual porting** by people for each design: the quality of ADR-0092, at a cost no player's
    company can pay.
  - **Engine-specific design import** (a Claude Design design read straight into WordPress
    templates, without an engine-neutral model): less code now, but the design would be tied to
    WordPress, and the owner wants the engine to stay replaceable; reconciliation and the design
    rules would have to be rebuilt for the next engine.
  - **Keeping the Astro-derived `cinqueterre` theme** as cinqueterre.travel's design: superseded by
    the owner's decision for "Salt & Pigment".

## Addendum (2026-10-14): what running cinqueterre.travel on its design decided

Building step 6 of the plan (cinqueterre.travel rendered from "Salt & Pigment" on the Cloudflare
Pages preview) settled five things this ADR left open. The decisions above stand; these add to them.

1. **A design's lists run on the site's structured entries, which are content types as data.** The
   design lists villages, stays, restaurants, activities and the team, which the live site keeps
   as collections and renders as prose. The import now writes them as entries of content types the
   sandbox registers from data (`POST /swarmpress/v1/content-types`, wp-sandbox 0.9.0): one entry
   per item and language, with its fields as public meta (shown by block bindings, `core/post-meta`),
   its place (`sp_place`), the page it stands for, and no URL of its own. ADR-0080's governed
   objects gain the option that names the types (an option, governed like the others). A theme
   reads entries only through `core/query` and bindings; `core/html` stays out (decision 6).
2. **Queries are scoped by the page they are on.** One template serves every language: a query on
   a page with a language lists entries in that language, and with `"place":"current"` only the
   page's place (the sandbox's `query_loop_block_query_vars` filter). So the homes `/` and `/{lang}/`
   are the design's front page (a page may take only a custom template, so the theme carries the
   front page again as `page-front`), and the importer composes no home of its own for a site with
   a design. Listing pages take the design's listing template (`archive-{listing}`) with the page's
   own text after the entries.
3. **The theme carries the design's recurring forms as a small vocabulary of classes, styled from
   its tokens** (`theme_designer::components`: the grid's container, section heads with their
   rule, the mono eyebrow, pill buttons, pigment tiles with numerals, cards with a place chip and a
   rating, rows, the dark band and its ledger, the masthead, the footer, a listing's bar and
   entries). This is custom CSS in the global styles, deterministic and checked like the rest;
   it does what `theme.json` cannot. The model composes core blocks with these classes, and each
   call starts from a deterministic draft in them (`theme_designer::sketch`), with the design's own
   markup of every section in its task.
4. **The visual check is part of the job.** The executor that can render (today the runner's CLI
   with a Node WordPress) writes the theme on a branch, screenshots the design's static pages and
   the site's at 375 and 1280 px (a sheet laid out at a fixed width at that width), pictures
   masked on both sides, and scores **region by region** (sections by `sp-{id}`, the parts, a
   listing's components; weighted by the design region's height). A page below 800 gets up to two
   repair rounds that name its worst regions with both markups; a fix that scores worse is undone.
   The digest's score is the visual score; an executor that cannot render says so in the record.
5. **The design's placeholders are not content.** `[°]`, `[CREDIT]`, `[Excerpt — …]` and notes about
   the design are refused by the checks; a section with no data on the site is left out.

**Negatives:** the vocabulary is a fixed set of editorial forms (a design far from them gets less
from the deterministic part and more from the model); the browser executor cannot render, so a
theme made there is not compared; content types are another thing the import writes and the
sandbox registers; a design's components sheet with a fixed width has no phone layout to compare.

## Addendum (2026-10-14, second): every menu entry, every component, every page type

The owner rejected the first preview of "Salt & Pigment": the old site's submenus were gone (the
five villages' ten sections each, the footer's columns) and the design's components were hardly
used (the web designer made only the design's own pages; every other page type fell back to a
generic page). Both are now the pipeline's guarantees, for any site and any design. The decisions
above stand; these add to them.

1. **The source site's navigation is the navigation.** The import says what the source site's
   menus are (`content_import_wp::plan::source_menus`: a ported theme's own header and footer, else
   `site.json`'s menu), nested, per language. The web designer puts every entry where the design
   has a menu for it (`theme_designer::navigation`): each design menu takes the source menu or
   column its items name (its area first; a source entry goes to one menu only); what no design
   menu takes becomes the header's main menu, the wordmark, or a footer column of its own. The
   header's main menu carries the design's panel per place (4.1: its number, name and line as a
   first item, the place's newest story as a last one) and opens on hover and focus (CSS, a 120 ms
   intent); on a phone it is the design's sheet (4.20) on core's overlay. **An entry may be lost
   only when the site lists it as retired, with a reason.** Two checks fail the job otherwise:
   `check_navigation` (every source entry with its parent in the theme data) and the export's
   `design-check` (every entry of the live site's `<nav>`s, nested ones under their parents, on
   the exported page of the same path, its link working).
2. **Components are first-class.** `site_design::Component` gains the functions it serves (a
   closed list, `COMPONENT_FUNCTIONS`, read from its name and subtitle), its variants, its states
   and the sheet's style rules for its classes; a design's icon sets and place marks
   (`SiteDesign.icons`, read from the sheet's data: a `const` arrow function of plain arithmetic is
   evaluated exactly, nothing else runs) and its micro-interactions with their reduced-motion
   fallbacks (`SiteDesign.interactions`).
3. **Content is mapped to components by a fixed table, the model fills the rest.**
   `theme_designer::catalog::CONTENT_FUNCTIONS` maps the content model's classes to functions
   (questions and answers → `faq`, a route's facts → `trail-stats`, an editor's comment → a
   `callout`, a story's contents → `contents`, …). The design's component for a function renders
   that content as a **block style**: `ThemeData.block_styles` names it with the content classes
   it applies to, the importer adds `is-style-{name}` to those blocks, and the theme's CSS
   (`theme_designer::forms`) gives the class the component's form, from the tokens. Functions a
   template carries itself (the masthead, the page header, the contents rail, the listing bar,
   pagination, search) are placed by the plan, each instance marked `ds-c-{component}`; the checks
   require the marker. The import gives the content the structure the components need, from the
   content's own data and only with a design (a practical line of `Label: value` facts as a row of
   facts with a grade's step; a story's byline, dateline, anchored headings with a contents list,
   and what to read next — the same place first, then the same category; a way to arrive its mode;
   a day of an itinerary its place).
4. **Every page type has a template composed from the components.** The import classifies every
   page (`home`, `article`, `village`, `village-{section}`, else its content's `page_type`) and
   gives each type one template (its listing's when the design has one, else `page-{type}`); the
   web designer composes a template for each type the design has no page for (the page header with
   `core/breadcrumbs` over WordPress's page parents, the content, a story's contents rail and
   reading progress). The export's `design-check` fails for a source page that renders with the
   generic `page` template, unless it is listed as an exception.
5. **The coverage report is part of the job.** `catalog::coverage` lists every component of the
   design with where it is used (templates, parts, block styles and the pages whose content they
   style) or why not (no content of its kind, no form on the site, nothing loads after the page,
   no page of the design places it). A component the site has content for that nothing uses, and
   a page type without a template of its own, fail the job. The visual check compares each used
   component's instance with its specimen on the design's sheet, and each page type with the
   design's closest composition (the template that shares most of its components), at 375 and
   1280 px (`theme_designer::visual::coverage_pages`).
6. **Live values are filled at export, never written.** The essentials ticker (4.6, the home's
   "today on the coast") is a marker the export fills from Open-Meteo (the marine API's sea surface
   temperature, the air now, today's sunset; a failed fetch fails the export, like the forecast).
   The forecast's sky is the design's stroke icon and its word, never an emoji; low and high sit on
   a fixed 10–30° bar; rain of 20 % or more is marked.
7. **One audited first-party script.** The theme's own markup stays without scripts (decision 6),
   but a static site cannot open a search, hide a masthead on scroll, count up a value or filter a
   listing with CSS. So a site's theme may publish exactly one script: swarm.press's own
   (`site_design::wordpress::ENHANCEMENT_SCRIPT`, `crates/site-design/src/enhance.js`), the same
   bytes for every site, never written or changed by a model, served by the static export as
   `/ds.js` (deferred, on every page). `ThemeData::validate_shape` refuses any other script and any
   change to this one. It is progressive enhancement only (the site works without it), reads only
   the page and the export's `/search-index.json`, sends nothing, stores nothing but a
   sessionStorage flag, uses no `eval`, and honours `prefers-reduced-motion`. It does: the masthead's
   tide (5), the phone sheet's places opening in place (4.20), the essentials count-up (9), the
   contents rail's current entry (4.10) and the progress bar where CSS scroll timelines are missing
   (10), the image wipe-in (8), the listing's filter chips (7.1, 11), Notte at night on the pages
   the scheme names, and the search overlay (4.11: "/" opens it; results grouped villages ·
   stories · stays; the match marked; ↑↓ and Enter; Esc closes; focus kept in it). The theme's
   icons are CSS masks of the design's paths and one sprite file, `/icons.svg`.
8. **Uncategorized never shows.** A story without a category takes its hero's badge (reported as
   a content gap); the export's `design-check` fails on any page that shows WordPress's default
   category.

**Alternatives:** CSS only and the search, the masthead's tide, the count-up and the filters
reported unused (simpler, no code to audit, but four of the design's behaviours missing); a
script per site written by the web designer (rejected: code from a model on every page); a search
endpoint on the central server (the static site would depend on a service).

**Negatives:** one template per page type (47 for cinqueterre.travel) is one model call each and a
longer job; the theme's CSS is about 100 KB; labels the design writes in its sheets in English
("Village", "Featured", "Local wisdom") stay English on every language's pages; the script is
code swarm.press ships to every visitor, and its audit is ours; the search is a substring match
over the export's index (no ranking, no stemming); a place's featured story is chosen by its name
in the story's title or tags; content the design asks for that the site lacks (an activity's
cost, a restaurant's "ask for", a rating's source) stays missing and is reported, never filled in.
