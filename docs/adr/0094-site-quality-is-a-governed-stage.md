# ADR-0094 — Site quality is a governed stage

**Status:** Accepted (amends ADR-0093 decisions 6 and 7: the theme's checks include the rendered site, and the CEO approves an audited theme; amends ADR-0080: a commit carries notes)
**Date:** 2026-10-16

## Context

swarm.press's staff produce real websites; cinqueterre.travel is the first. On 2026-10-16 the owner
opened one preview page (`/en/vernazza/things-to-do/` on the `wordpress-export` preview) after
several rounds of "it's ready" and found:

- empty image frames, buttons to `#`, the page's SEO title as alt text;
- a half-empty 760 px column on a 1280 px page, and the page's own hero buried below a 12-card listing;
- mangled callouts, raw lowercase slugs (`church`, `harbor`) as filter chips;
- WordPress's emoji script loaded from the production host;
- wrong photos.

None of it was caught, for five reasons:

1. **The checks guarded the wrong thing.** They validated our intermediate theme data (the block
   grammar, the tokens, coverage). Nothing looked at the page a reader sees, and every defect above is
   visible only there.
2. **The builder graded itself.** The agent that made the theme also chose the screenshots and
   declared them good: 8 pages, mostly the top of each.
3. **Fixes went instance by instance.** A person found a defect, it was patched, then the next one,
   with no rule standing behind each fix.
4. **Nobody owns content quality.** The wrong photos, the missing alt texts, the `#` buttons and the
   restaurants filed as things to do were already in the source, and no role is accountable for them.
5. **The design covered too little.** The design gives a style guide, a homepage and listings. The
   other 40 page types were improvised by the model with no design reference, and nothing marks them
   as ungoverned.

The owner's verdict: if quality cannot be done by swarm.press's own agents in a governed, consistent,
accurate way, the core idea fails. A person auditing pages is not the answer.

## Decision

1. **A versioned site standard.** `site-standard v1` is data in the repository
   (`crates/site-quality/standard/v1.json`), the same for every site. Its rules sit in eight
   dimensions (layout, links, media, accessibility, SEO, content, design, performance), and each rule
   is one of two kinds:
   - **Deterministic**, judged on facts of the rendered page. v1 has 25: the page renders; no empty
     picture frame; every picture loads; alt text present and never the page's, SEO or site title; no
     link to `#`, no broken internal link, no missing anchor; no failed request and none to the
     production host; no WordPress emoji runtime in the export; no overflow at 390 px; no block under
     75% of its container at 1280 px with nothing beside it (a story's measure is exempt); exactly one
     h1, the page's own; headings in order; the authored hero first; no slug as a label; none of the
     design's words left in English on a page in another language; a title and a meta description of
     sane length; a canonical on the public origin; hreflang versions that exist and list each other;
     a sitemap with every indexable page; no duplicate titles.
   - **Judged by a model** against a fixed rubric (the picture matches its section, the copy holds the
     editorial bar, a page type looks like its design family). These give scores with thresholds,
     never yes or no. They are listed in v1 and not enforced until the owner has spot-checked a
     calibration sample and the thresholds are frozen into the standard (decision 7); until then the
     report says they were not judged.
   A new rule or threshold is a new version of the standard, and every report names the version and
   digest it was judged against.

2. **The browser observes; one judge decides.** A collector renders every page of a branch's export at
   the standard's widths (1280 and 390 px) and records only facts: boxes, pictures, links, requests,
   headings, labels and the head (`site_quality::PageFacts`). Today the collector is the runner's
   Playwright script (`apps/game/e2e/page-audit.mts`); later it is the browser executor. The rules
   are judged in one place, the pure, wasm-compatible crate `crates/site-quality`, so the runner, the
   CLI and the browser share one implementation. Each deterministic rule has a failing fixture and a
   mutation test.

3. **The QA stage runs on every release, and the orchestrator owns the gate (rule 3).** A release is
   a merge of a design, theme or import branch into `live`. Its branch is exported, every page is
   audited, and the report is built (`site_quality::build`):
   - the gate **blocks** on any deterministic finding outside a listed content gap, on pages that did
     not render, on an audit at the wrong widths, and, once calibrated, on a judged score below its
     threshold;
   - findings are **clustered by rule × page type × owner**. Pages come from templates, so one repair
     per class repairs every page of the type, and the work is O(page types), not O(pages).
   - the web designer's job runs the stage after writing its theme branch, before the CEO's
     `ThemeApproval`; the Publish job runs it again on the head it merges (or reuses the passing report
     of that same commit) and never merges a blocked release.
   - an executor that cannot audit cannot pass the gate (`Gateway::site_audit` answers `None`): the
     Publish job fails loudly (rule 11).

4. **Findings route by class to roles.**
   - **Design and layout classes** (templates, parts, the theme's styles and labels) go into the web
     designer's repair loop: the class's evidence (the rule, the page type, example pages and
     details) is the repair message for the template that renders the type, at most `MAX_QA_ROUNDS`
     rounds, each fix checked by `check_template` and kept only if it passes.
   - **Content classes** become typed work orders for content roles: pictures, alt sources and empty
     frames in authored content go to a **photo editor**; videos and media gaps to a **researcher**
     (the media desk); copy, labels and the links in it to the **editor**; meta, titles and internal
     links to an **SEO** role. Those roles come in step 4 (below). Until they exist, the routing hook
     answers that the role is not staffed and the release stays blocked: it never fakes a pass.
   - **Platform classes** (the importer, the export, the engine) are swarm.press's own defects: they
     block and are fixed in code, never by a staff member and never excepted.
   - After the rounds allowed, a blocked gate fails the job (`JobFailed{QualityGate}`): the item is
     Blocked and the CEO gets the Escalation ticket (rules 10 and 11).

5. **Exceptions are listed content gaps, never silent.** A finding passes the gate only when a listed
   exception names its rule and page, its reason starts with `content gap:` and says what the content
   lacks, and its owner is a content role. An exception for a designer's or the platform's rule is
   refused, and the report lists exceptions that matched nothing.

6. **The report is governed; only the digest enters the sim.** The QA report (`site-qa-report/1`:
   findings, exceptions, classes, scores, the gate) is kept as a **note on the audited commit** in
   the content repository (ADR-0080 is amended: a commit carries notes, objects attached without
   changing its tree; `note.put` and `note.get` in the storage protocol). The sim gets
   `ServerCommand::SiteQuality{job_id, quality}`: the standard's version, pages, audits, open findings,
   listed gaps, open classes, whether the gate passed, and a score per dimension in permille (rule 2).
   The digest of the release that went live is `Plan.designs.live_quality`. The Performance view and
   the leaderboard read it later; the leaderboard can trust it because it is audited from the site.

7. **Design coverage is derived until approved.** Every page type is either backed by a page of the
   site's Claude Design design or derived from its style guide and marked **derived** until the CEO
   approves that type once. The web designer can ask for a missing design through the connector or a
   ticket. Nothing stays silently improvised.

8. **The build order.** Step 1 is this ADR. Step 2 is the standard and the audit. Step 3 is the gate in
   the orchestrator and the routing of design classes into the web designer's repair loop. Step 4 is
   the content roles (a photo editor with vision on hosted GPT-6-Luna and image search, a researcher,
   SEO checks) whose work orders go through the existing draft and review pipeline and the CEO's
   publish gate. Step 5 is the judged rules, calibrated with the owner's spot checks, then frozen.
   Step 6 is design-coverage governance and visual baselines per page type.

## Consequences

- Quality is measured on the page a reader sees, on every page, by a stage separate from the builder;
  the builder never grades its own output.
- A defect found once becomes a rule and stays found on every site: the fix is generic or it does not
  pass.
- The CEO sees a score per dimension and the few decisions that are theirs (content gaps, roles to
  hire), not ninety findings.
- The first baseline of cinqueterre.travel's preview (882 pages at two widths) had 14,557 deterministic
  findings in 288 classes; most were a handful of platform and template classes repeated on every
  page of their type.
- **Negatives and costs:**
  - **Time.** Every release renders every page twice: about six minutes for cinqueterre on one
    machine. Incremental audits (only the page types a change touches) are a later optimisation.
  - **Rule drift.** A rule can be wrong in a way that blocks good pages (a measure that should be
    exempt, a label that is a real lowercase word). The remedy is a new version of the standard,
    never an exception for a designer's rule, so a wrong rule costs a release until it is fixed.
  - **Blocked until staffed.** Until the content roles exist, a site whose source has content gaps can
    only pass by listing each gap with its reason. That list is honest work for the owner, and it is
    expected to shrink as the photo editor and the SEO role arrive.
  - **Browser dependence.** The facts come from one engine (Chromium in Playwright). Another engine
    may lay out differently; the standard's widths and thresholds are fixed to keep reports comparable.
  - **One more format.** The world format moves to 16 (the digest and the failure reason), and the
    goldens move with it.

## Alternatives considered

- **A person audits pages before release.** Rejected by the owner: it is the failure mode itself, it
  does not scale to every player's site, and it is not governed.
- **More checks on the theme data.** Necessary but not sufficient: every defect the owner found was
  invisible in the data and visible only in the rendered page.
- **The rules written in the browser script.** Rejected: two implementations (the runner and the
  browser executor) would drift, and the rules could not be tested with fixtures and mutations in
  Rust. The browser only observes.
- **A model judging everything.** Rejected for v1: deterministic rules are cheaper, reproducible and
  never argue. Models judge only what cannot be measured, with rubrics and calibrated thresholds.
- **Sampling pages.** Rejected: the owner's defects were on a page nobody sampled. Every page is
  audited; classes keep the repair work small.
