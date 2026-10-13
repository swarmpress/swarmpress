# ADR-0092 — The Astro site is the source; its design is carried into a WordPress block theme

**Status:** Accepted (refines ADR-0083 §5 for cinqueterre.travel's theme; amends ADR-0091 decision 1 for how an export names its own files)
**Date:** 2026-10-13

## Context

cinqueterre.travel moves onto WordPress (ADR-0078 to ADR-0084, plan M8, FEAT-112): its JSON pages are
imported into a company's governed repository, `live` is exported as static files, and the export is
compared with the live Astro site URL by URL (`docs/runbooks/cinqueterre-cutover.md`). The import
already treats the Astro site as the source of the content and the URLs: the frozen theme's routing
rules give the URL set, its JSON blocks become core blocks in `ct-{kind}` groups.

The design did not travel. The export was rendered by Coast, the sandbox's generic editorial theme
(teal, Cormorant), and the preview at `wordpress-export.cinqueterre-travel.pages.dev` showed none of
it either: the export wrote every reference to the site with the public origin, so the preview loaded
its stylesheets from `cinqueterre.travel`, where the Astro site answers 404. The owner, who wrote the
Astro theme (`packages/site-builder/src/themes/cinque-terre`, frozen by rule 9), asked for its design
to be carried into WordPress so the switch keeps the site recognisable.

Two constraints shape how. Rule 16 (ADR-0078, ADR-0084) keeps every WordPress theme inside the GPL
sandbox (`swarmpress/wp-sandbox`), reached only through APIs; nothing in swarm.press may import or
bundle it. And ADR-0086/ADR-0087 want what the office's staff build to be data they can change
through the Studio, which for a block theme means `theme.json`, templates, parts and patterns rather
than PHP.

## Decision

1. **The Astro site is the source of content and URLs, not of code.** The import keeps reading the
   site repo's JSON and the frozen theme's routing rules (FEAT-112). No Astro, React or Tailwind code
   is ported or run; the design is re-specified.
2. **Its design is a block theme in the GPL sandbox:** `cinqueterre` in `swarmpress/wp-sandbox`
   (`config/themes/cinqueterre`, released from 0.7.0), a child of Coast. It is `theme.json` (the
   palette: ink on white, the neutral greys, the five villages' colours; Playfair Display and Inter,
   self-hosted from the OFL-licensed Fontsource files; sizes, radii, buttons), templates (front page,
   page, single, archive, index, 404), parts (the coastal-spine header, the four-column footer),
   patterns (editorial hero, editorial intro, interlude, closing note, section head) and one
   stylesheet. It has no PHP of its own: the language switch and the stylesheet's loading are
   Coast's. The stylesheet styles the import's markup: each block kind's group (`ct-{kind}`) and,
   from now on, each text field's paragraph (`ct-{field}`), so a theme can place a field without
   parsing it.
3. **The import activates it for cinqueterre.travel** (`plan::theme_for`, by `site.json`'s `id`;
   every other site keeps Coast), and composes what the frozen theme drew from its own code as
   content in each language:
   - the header's **coastal spine**: the five villages along the coast, each with the ten sections
     the frozen theme listed, as the main menu (`nav-{lang}`);
   - **named menus** for the wordmark, the header's button and the footer (`brand-`, `cta-`,
     `footer-{lang}`). The sandbox's routes plugin shows the navigation `{name}-{lang}` in a
     navigation block with the class `sp-menu-{name}`, so one template part serves every language.
     The footer links the pages the site has instead of the frozen theme's placeholder links;
   - the home's sections **only from content**: the editors' picks are the stories the owner
     curated for the blog index (`pages/blog-index.json`, its lead first, each in its article's
     language); the places to stay are the accommodations collection's featured, published stays
     (one per village first); the villages, the latest stories (a `core/query`) and the newsletter
     as before. The frozen theme's sections with nothing behind them (trending, the sample hotels and
     restaurants, audio guides, the "about" card) have no composition.
   - a collection's interludes stand after the item their `afterIndex` names, as the live page shows
     them; presentation fields (`height`, `align`, `limit`, `imagePosition`) are no longer imported as
     text; an article's heading is its own title, without the site's name its document title keeps.
4. **An export names its own files root-relative.** In pages and stylesheets, references to the site
   (links, images, stylesheets, scripts, fonts in `url()`) are written as `/path`, so one export is
   served whole from any host: the preview loads its own theme. What names the site to the outside
   keeps the public origin: `<link rel="canonical|alternate|…">`, `<meta>` tags, sitemaps, feeds,
   robots.txt and text in scripts and JSON.
5. **After the switch, the Astro path retires for every company.** When cinqueterre.travel is served
   from the export (runbook step 4) and rule 9 ends: the frozen theme is deleted with its workspace
   glob and lockfile entries, and `@swarm-press/site-kit`, `themes/starter`, `packages/site-builder`
   and the legacy site path's modules retire with it (ADR-0083 §5's list). A company's site is
   WordPress with Coast or a theme of its own in the sandbox; a design a player brings is carried
   the same way, as a block theme.

## Consequences

- The owner's design survives the switch: the coastal-spine header with the villages' colours, the
  dark editorial heroes, the centred editorial intros, the collections with their interludes, the
  dark closing notes, the article layout and the composed home look like the Astro site (the side by
  side screenshots are FEAT-112's evidence). The theme is data the Studio can change later.
- The preview shows what production will show, from the same files; the switch changes no byte of
  the export.
- The sandbox carries a second theme to maintain, released with the sandbox (0.7.0 and on).
- **Negatives:**
  - **The ported design is GPL-licensed.** The theme lives in the GPL sandbox (rule 16) and is
    distributed under GPL-2.0-or-later with it: anyone who receives the sandbox may reuse the
    stylesheet, templates and patterns that recreate the owner's design. The Astro theme keeps its
    own terms until it is deleted, and the content (texts, images, the site repo) is not affected.
    The fonts keep the SIL Open Font License (Playfair Display carries the reserved font name
    "Playfair Display": the files are shipped unmodified).
  - **A child of Coast:** a change to Coast's PHP, templates or `theme.json` reaches cinqueterre
    (Coast's language switch, its fallback templates, the styles the child does not override). The
    sandbox's conformance suite renders the child to catch that.
  - **The stylesheet is coupled to the import's class names.** Renaming a JSON field renames its
    class and loses its styling; the fields of a group arrive in alphabetical order (the import's JSON
    maps are sorted), so the stylesheet places them with flexbox and grid `order`, which works for
    sighted readers but leaves the reading order of assistive technology in the source's order.
  - **Not pixel-identical:** cards without photographs where the content has none (the latest
    stories' query, the places to stay); the language switch is four links instead of a dropdown;
    no search button (the static site has no search page yet); the "Essential information" sidebar
    with a map becomes chips under the item; the editors' picks and places to stay are new on the
    homes, chosen from content rather than hard-coded; `:has()` hides a page's title when its first
    block is a hero (browsers from 2023 on; older ones show the title twice).
  - **Root-relative references need the site at the host's root.** An export copied under a
    subpath would break; serving releases under `/sites/{company}/` (the server's filesystem plane)
    needs a `<base>` or a rewrite there.
  - The theme's fonts add about 0.5 MB to the sandbox and are downloaded by visitors (latin and
    latin-ext subsets, by unicode range).
- **Alternatives:**
  - **A style variation of Coast** (`styles/*.json`): tokens only; the header, footer, home sections
    and layouts differ too much to be a variation.
  - **A classic PHP theme** mirroring the Astro components: closer markup, but PHP the staff cannot
    change through the Studio, and more GPL code to review.
  - **A block library mirroring the Astro components** (custom blocks): the editor would show the
    site's own blocks, but it needs a JavaScript build and a plugin in the sandbox, and the import
    would have to target it; core blocks with classes keep the content portable.
  - **Keeping Astro as the renderer** of WordPress content (site-kit reading the export): two
    engines to run for one site, against ADR-0078.
  - **A theme generated by the staff** from the Astro theme's tokens: the intended path for players'
    sites later; for the owner's own site, a hand-built port the owner can review was the faster and
    safer step before the switch.
  - **Exporting the preview with its own origin** (`--public-origin https://…pages.dev`): the preview
    would show the theme, but the export merged into `main` at the switch would point at the preview
    host; root-relative references make one export right for both.
