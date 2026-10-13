---
id: FEAT-114
title: "Site design from Claude Design (bundles, the semantic site design, reconciliation, theme data)"
status: in-progress
importance: high
paths:
  - "crates/site-design/**"
  - crates/server/src/site_designs.rs
  - crates/server/src/db/designs.rs
  - crates/server/migrations/0009_site_designs.sql
  - crates/server/tests/site_designs.rs
  - crates/content-import-wp/src/theme_data.rs
adrs:
  - ADR-0093
  - ADR-0080
  - ADR-0072
---

# Site design from Claude Design

A design made in Claude Design is the original of a site's design (ADR-0093). This feature keeps a
site's designs as write-once versions, interprets each into an engine-neutral **site design**,
reconciles versions, and defines the WordPress rendering's data shape (**theme data**) that the
importer writes and the web designer will generate.

## Built

- **`crates/site-design`** (pure, wasm-compatible; html5ever and its plain DOM, flate2's pure-Rust
  backend and base64, all MIT or Apache-2.0):
  - **`DesignBundle`**: files by plain relative path, only html, css, svg, png, jpg, webp, woff2 and
    json (never scripts), at most 512 files and 20 MB; a hash of the files only (`swarmpress:
    design-bundle:v1`), computable from the manifest; the source (upload, connector, a Claude Design
    URL) and the time are passed in.
  - **Claude Design's standalone export, unpacked natively** (`export`): the root manifest (uuid →
    base64, gzip when compressed), the page order, the board's titles, each page's own nested bundle;
    pages become `pages/NN-title.html`, fonts and images (manifest resources and `data:` URIs)
    become `assets/<sha256 prefix>.<ext>` deduplicated by content, the runtime and React are dropped,
    `design.json` lists the pages in order.
  - **Claude Design's page runtime, read without running it** (`dc`): `renderVals()`'s returned
    object is read as a JavaScript literal (strings, numbers, arrays, objects, `const` strings and `+`
    between strings; calls and functions are left out); `<sc-for>` loops expand over literal lists
    or repeat `hint-placeholder-count` times, `<sc-if>` and `{{…}}` substitute. The static page this
    gives was checked against the pages rendered headless; no browser is needed.
  - **`SiteDesign`** (`model`, `interpret`): the pages' roles (template, listings sheet, design-system
    sheet); tokens (colours with roles, tints, computed and stated WCAG contrast; dark schemes; fonts
    with their files and stacks; the fluid type scale; spacing, radii, elevations, motion,
    breakpoints, the grid, image ratios; `:root` custom properties classified); templates with
    ordered sections (FEAT-093's rules ported, plus content queries, the entry, components, image
    bands, the band's background as a colour token); parts and menus (the header's `<nav>`, the
    footer's labelled groups, links resolved to templates); languages from the language switch;
    patterns; components from numbered sheet parts with their notes; design rules (principles,
    "observed → fix", rules of use) with a closed list of checks.
  - **`diff` and `merge`**: per template, sections aligned by what fills them (same, changed with
    notes, added, removed); token, part, component, menu and rule changes; a later design of some
    templates replaces only those.
  - **`wordpress::ThemeData`** with `validate_shape()`: global styles (`theme.json` v3 settings and
    styles, custom CSS), templates, template parts, patterns, navigation per menu and language,
    fonts with their files as asset references; the template names for each kind.
- **Server design store** (`crates/server/src/site_designs.rs`, migration 0009): `POST
  /api/sites/{id}/designs` (lease, own site; JSON files as base64; a Claude Design export unpacked;
  422 with issues, 413 over 20 MB; files in the object store like assets; 201 new, 200 the same
  bundle's version), `GET …/designs`, `GET …/designs/{version}` (manifest and interpretation),
  `GET …/designs/{version}/files/{*path}` (a sandboxing CSP, `nosniff`).

## Tests

- `crates/site-design/tests/interpret.rs`: the handmade multi-page bundle `coast-journal` (home,
  article, archive, 404; header, nav, footer; `:root` tokens, `@font-face`, `@media`) and a trimmed
  Claude Design export of the owner's style guide (the Color sheet and the applied homepage,
  re-bundled small as the real export is built), each against a snapshot
  (`tests/fixtures/*.design.json`, `UPDATE_SNAPSHOTS=1` rewrites); the bundle rules.
- `crates/site-design/tests/reconcile.rs`: no differences for the same design; section, heading,
  item and token changes named; a later design of one template replaces only it.
- `crates/site-design/tests/claude_export.rs`: the full export (5.6 MB, the owner's Downloads
  folder) interprets when it is on the machine; skipped elsewhere.
- Unit tests in the crate's modules: the DOM's sanitising, the literal reader and the loops, the
  export's unpacking (a packed export with nested pages, deduplicated fonts, no scripts), the CSS
  reader, number counting, colour roles, contrast, the rule checks, the theme data's shape rules.
- `crates/server/tests/site_designs.rs`: the routes (fencing, write-once versions, refusals, read
  back, the files' headers).

## Next

- **design-import.ts on the crate.** FEAT-093's `apps/game/src/blueprint/design-import.ts` keeps its
  own copy of the section rules for the Blueprint panel (synchronous, `DOMParser`). Calling the crate
  instead needs a `crates/site-design-wasm` facade (`cargo xtask wasm` entry like `kit-wasm`) and an
  async load in the panel, with design-import.test.ts moved onto the built module. Not done here: the
  panel's import is synchronous and its tests run without the wasm build.
- cinqueterre.travel's **design v1** (the "Salt & Pigment" style guide, kept in the site's repo) sent
  to the store once the site repo carries it.
- The web designer's job (`ThemeData` from a `SiteDesign`, checks, visual comparison,
  `ThemeApproval`) is FEAT-115. The importer's `ThemeData` is this crate's
  (`content_import_wp::theme_data` re-exports `site_design::wordpress`), and the importer checks
  `validate_shape()` before it writes. The connector (`/mcp`, OAuth) follows ADR-0093.
