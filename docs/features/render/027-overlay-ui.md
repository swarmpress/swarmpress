---
id: FEAT-027
title: "Overlay UI (CEO management: Plan, Inbox, Org, Projects, Finance, Performance, Hiring, HUD)"
status: in-progress
importance: high
paths:
  - "apps/game/src/ui/**"
  - "apps/game/e2e/ui.spec.ts"
  - apps/game/src/ui/components/ArticlePreview.tsx
  - apps/game/src/ui/components/ArticleJudgement.tsx
  - apps/game/src/ui/article-preview.ts
  - apps/game/src/ui/article-checks.ts
  - apps/game/src/ui/hud.tsx
adrs:
  - ADR-0018
  - ADR-0059
  - ADR-0060
  - ADR-0068
---

# Overlay UI (CEO management)

Preact DOM overlay over the dollhouse (ADR-0018). The CEO's instruments:

- **Plan** (primary): board, calendar, timeline, workload and goals; work-item detail with brief,
  phases, todos and the live **thread** (posts of every type in publishing-plan.md §2, including
  the orchestrator's `minutes` / `artifact` / `handoff` / `review` / `status` posts with `payload`).
- **Inbox** (Secretary): tickets by priority with deadline countdowns and option buttons;
  delegation policy; secretary task queue; Delegate menu (disabled with a reason without a
  secretary).
- **Org chart** and **profile cards** (persona catalog, organization.md §3): praise, promote,
  salary, project allocation (100% rule, validated by the source), fire.
- **Projects**, **Finance** (CFO; explicit "No CFO — books not reviewed" state),
  **Performance** (KPIs, KPI report), **Hiring** (candidate pool).
- **HUD**: cash, runway, open/high tickets.

Data comes through the async `GameDataSource` interface (`apps/game/src/ui/data-source.ts`):
`MockDataSource` (fixtures + in-memory rules, `?ui=mock`) and `WasmDataSource`
(feature-detected `Sim.org_json/finance_json/inbox_json/plan_json/apply_command_json`, the default
now that client-wasm exports them; plan text from the CompanyStore via `planTextFromStore`).
Every action is a JSON command (`commands.ts`); nothing mutates the replica
directly. Frozen screenshot pages (`?t=`) don't mount the overlay unless `?ui=` is given, so the
visual baselines are unaffected.

Decisions: [ADR-0018](../../adr/0018-overlay-ui-in-preact.md).

## MVP increments (U1, U2; ADR-0059, ADR-0060)

Design: [`docs/design/mvp-pipeline.md`](../../design/mvp-pipeline.md) section 5 and
[`docs/design/mvp-gap-analysis.md`](../../design/mvp-gap-analysis.md) section C.

- **U1:** the `PublishApproval` ticket in the Inbox: title, dek, score, editor notes, measured
  checks shown apart from the editor's opinion, words against target, the pull-request link, and
  `ArticlePreview.tsx` rendering the page blocks in a sandboxed `srcdoc` iframe.
  How it is built:
  - Everything comes from the company's store, nothing from the sim. `GameDataSource.getArticle(item)`
    returns the orchestrator's latest `ArtifactRecord` (page JSON, review, pull request number,
    branch, head sha, revision) joined with its `BriefRecord` (brief, writer, editor). The brief is
    found by the record's `brief_ref`, a u64 read from the record's text (`topLevelNumber`) because
    `JSON.parse` would round it. `store.articleOf(item)` reads it like `check` does: synchronous for
    rendering, refreshed after every snapshot, and the same object while the record is unchanged.
  - The ticket (`ArticleJudgement.tsx`, for `publish-approval` and, where an article exists,
    `escalation`) shows title and dek (hero subtitle, else the SEO description), writer, editor and
    revisions, then two labelled groups (concept document §20): **Measured checks**
    (`article-checks.ts`: body words against the brief's `target_words` with a ±25% band, block
    count, exactly one hero and first, closing note present and last, links, media and media that
    are not https, unknown block types, banned-phrase hits) and **Editor's opinion** (score,
    decision, notes, issues, high-risk flags). The banned phrases are the site style guide's
    `vocabulary.avoid`, which the session binds (`SITE.style_guide`) and passes through
    `companyStoreOptions`; without a style guide the row is left out and the ticket says so. The
    pull request links to `company.site_repo`; the head sha it would merge is shown.
  - When the store has no article (a device that restored the sim without its plan text) the gate
    says so and points at the pull request; the options stay.
  - The preview (`ArticlePreview.tsx` over the pure `article-preview.ts`) is a dialog opened by
    "Read article" from the ticket and from a pull-request post of the work item's thread. The page
    is model output: every string is HTML-escaped; the two fields the theme prints as HTML
    (`editorial-hero.title`, `closing-note.content`) are decoded once for display and escaped
    again; images load only from `https:` URLs; links are named, not linked; an unknown block type
    is a labelled placeholder; the document has exactly one `<h1>` and its own
    Content-Security-Policy (`default-src 'none'; img-src https:; style-src 'unsafe-inline'`). It
    is shown in `<iframe sandbox="" srcdoc>`: no scripts, an opaque origin, no navigation.
  - Send back on a work item first opens a short note. The note is stored as a plan post through
    the store's post API (a `status` post with `payload.ui_type: 'send-back-note'`, as comments
    are) and only then is `AnswerTicket{send-back}` sent; a note that cannot be stored sends
    nothing. Publish, Kill and Defer answer at once, as before.
  - The mock company (`?ui=mock`) has a `publish-approval` ticket (`ticket-7`) on `work-item-1`
    whose article is the agents crate's golden article fixture.
- **U2:** fixes on live data: ticket text names the article; the false "no secretary" text goes;
  actions the sim lacks are disabled; CEO comments persist; pull-request and page links; empty Plan
  tabs and the Performance panel are hidden; Finance alert labels and a "revenue not modelled" note.
  How it is built:
  - A data source states what it can do (`GameDataSource.capabilities()`): the command variants it
    has (`SIM_COMMANDS` for the live sim, checked against the real sim in `wasm-live.test.tsx`),
    whether KPIs exist, and the site links. `store.can(name)` is the one capability check: `check`
    and `run` never validate or send a command the source lacks, and the Work item controls for it
    are disabled with the tooltip "Not available yet".
  - The Inbox ticket is data-driven: kind and option ids render from a label table with a generic
    fallback, so a ticket kind the UI has never heard of shows up and is answerable (the option id
    goes back verbatim). It names the work item (title from the plan text), the amount and the
    role, and shows the deadline as game day and time with the option that applies when it expires.
  - CEO comments go through the CompanyStore's post API (`ceoPostsToStore`). That API takes the
    orchestrator's post types only, so a comment is filed as a `status` post with its real type in
    `payload.ui_type` (`toStorePost` / `normalizePost` in `plan-wire.ts`).
  - Links (`links.ts`): the pull request and the merge commit link to `company.site_repo`. The
    published-page link is a hook: `SiteLinks.publicBaseUrl` is set by no source yet (the company
    row has no public address), so no page link renders until one provides it.
  - Plan views without data (`availableViews`) and the Performance panel without a KPI source are
    left out of the navigation; the fixtures (`?ui=mock`) have data for all of them.
  - The 1 s poll of `WasmDataSource` re-serialises the JSON views only when its change key (the sim
    step; in a session step plus the loop's command count) has moved.
- **T:** the HUD status chip (Running / Held / Resting / Model loading / Lease lost / Halted), pause
  and speed buttons, a boot screen (FEAT-080).

## Acceptance criteria

- Components tested with @testing-library/preact (`src/ui/*.test.tsx`).
- axe reports no violations on every panel (vitest + axe-core; colour contrast in Playwright).
- Every action produces a command through `GameDataSource.apply`; nothing mutates the replica directly.

## Evidence

- `game/vitest`
- `game/playwright-e2e`
