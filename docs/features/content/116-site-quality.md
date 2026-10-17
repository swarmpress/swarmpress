---
id: FEAT-116
title: "Site quality as a governed stage: the standard, the audit, the gate"
status: in-progress
importance: high
paths:
  - "crates/site-quality/**"
  - crates/content-import-wp/src/qa.rs
  - crates/site-export/src/hygiene.rs
  - apps/game/e2e/page-audit.mts
  - crates/orchestrator/src/quality.rs
  - crates/orchestrator/tests/quality.rs
  - crates/theme-designer/src/quality.rs
adrs:
  - ADR-0094
  - ADR-0093
  - ADR-0080
  - ADR-0059
---

# Site quality as a governed stage

Every release of a site (a design, theme or import branch merged into `live`) is audited page by
page in a real browser and held to a versioned, site-independent standard; the orchestrator blocks a
release that does not pass, and findings go by class to the role that repairs them (ADR-0094).

## Built

- **`crates/site-quality`** (pure, wasm-compatible): `site-standard v1` as data
  (`standard/v1.json`: 25 deterministic rules in eight dimensions, three judged rules listed and not
  enforced before calibration); `PageFacts` and `SiteFacts`, what a browser observes and what the
  release says; `rules::evaluate`, one implementation of the rules; `report::build`: listed content
  gaps (refused unless the reason is a content gap and the owner a content role), classes by rule ×
  page type × owner, scores per dimension (‰ of audits clean), the gate and the digest;
  `route::route`: design classes for the web designer, typed work orders for the photo editor, the
  researcher, the editor and the SEO role, platform classes for swarm.press. Tests: every rule has a
  failing fixture (`tests/fixtures/failing.json` over `clean.json`) and a mutation, each breaks exactly
  its rule, and without the rule in the standard the fixture passes; the same facts give the same
  report bytes.
- **The collector** (`apps/game/e2e/page-audit.mts`): every HTML page of an export at 1280 and 390 px,
  scrolled, observed (no rule in it), remote pictures checked once; writes `facts.jsonl`, optional
  screenshots of one page per page type, then runs the judge.
- **The judge** (`swarmpress-wp-migrate qa`): the facts against the standard with the release's site
  facts (`content_import_wp::qa`: its paths, its sitemap followed through the index, the site's
  languages and name, the design's words); `report.json`, `summary.json` (the table per rule and page
  type, the classes, the work orders), a `cockpit.benchmark.v1` document, and with `--repo` the report
  as a `qa` note on the audited commit.
- **Commit notes** in the governed repository (`content_repo::Repo::put_note`, `note.put`/`note.get`).
- **The export's platform rules** (`site_export::hygiene`, used by `swarmpress-wp-migrate export`):
  WordPress's emoji runtime left out, every page's canonical and its language versions from the
  import plan (`content_import_wp::plan::versions`), a sitemap of the pages the release serves named
  in `robots.txt`, and WordPress's home answered for a path that names no page left out of the release.
- **The gate in the orchestrator** (`orchestrator::quality`, `site_theme`): `Gateway::site_audit`
  (`None`: this executor cannot audit); the web designer's job audits its branch, repairs design
  classes in its loop (`theme_designer::quality`: the class's evidence as the template's fix
  message, `MAX_QA_ROUNDS`), writes and audits again, and fails with `QualityGate` when the gate
  stays shut, content classes routed by role to roles not staffed yet; the Publish job audits the
  head it merges (or reuses the passing report of that commit) and never merges a blocked or
  unaudited release. A job may start from an earlier theme (`context.start_from`, `labels`);
  `swarmpress-site-theme --revise-from --audit` runs it on a real WordPress. Tests:
  `crates/orchestrator/tests/quality.rs` (a defect found, repaired, audited again and merged, the
  same world twice; a content class blocks; publishing needs a passing audit of its head).
- **The import's gate** (`swarmpress-wp-migrate apply --hold`, `export --branch`, `release --cr`).
- **The sim's digest** (FEAT-115's item): `ServerCommand::SiteQuality`, `Plan.designs.quality` and
  `live_quality`, `JobFailure::QualityGate` (world format 16).

## Not built yet

- The browser executor's collector; the judged rules and their calibration (ADR-0094 step 5); the
  content roles (step 4); design-coverage governance and visual baselines (step 6).
