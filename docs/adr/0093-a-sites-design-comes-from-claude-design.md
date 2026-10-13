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
