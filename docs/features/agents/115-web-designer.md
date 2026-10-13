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
  with its fonts (for `swarmpress wp-migrate --theme-data`), a report and the bundle. The visual
  comparison (`apps/game/e2e/theme-visual.mts`) screenshots design pages and the exported site at
  375 and 1280 px and scores them with `visualSimilarity` (`apps/game/src/site-design/visual.ts`,
  pure): colour and edge structure per cell, a length term, the worst cells by position.

## Tests

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

## Next

- The browser executor does not run the job yet: its gateways have no `site_design` and its
  `WpSiteEngine` no `put_theme_data` (they fail loudly). The host that logs `DesignReceived` (the
  design store's upload, later the connector) and these two come with step 6.
- The visual score is a runner step, not part of the digest.
- The site's collections are the host's: the CLI offers cinqueterre.travel's posts (latest, the
  editors' picks); the villages and the stays are composed content, with no query yet.
