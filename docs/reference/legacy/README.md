# Legacy concepts: the agentic website framework

> **Status:** reference. Two of the owner's earlier concept documents, kept as they were written,
> and how their ideas fit swarm.press (owner decisions of 2026-10-06).

- [`agentic_editor_spec.md`](agentic_editor_spec.md): the **Agentic Website Framework editor**. A
  visual graph editor (React Flow) for the sitemap, internal links, page blueprints and an atomic
  content model; agents propose GitHub PRs; freshness scoring; an analytics feedback loop.
- [`agentic_editorial_planning_spec.md`](agentic_editorial_planning_spec.md): the **editorial
  planning system**. `editorial-plan.yaml` in the site repository; content tasks with types,
  statuses, priorities, languages, SEO, events and seasons; phased timelines with dependencies;
  goals with metrics; analytics follow-ups; GitHub issues; Kanban, Gantt and graph views; SEO,
  media, linking, analytics, localization and distribution agents.

## How the ideas fit

The player is the CEO of an AI publishing house, not its editor: they steer and the staff do the
work (`docs/game-design/overview.md`). The legacy ideas become the company's back office, run by
the staff, shown in the brick office and steered through the plan and the Inbox.

| Idea | In swarm.press |
|---|---|
| Editorial plan: goals, projects, workstreams, work items, phases, due and publish dates, dependencies, follow-ups | **Absorbed by design**: ADR-0031 and [`publishing-plan.md`](../../game-design/publishing-plan.md) build on this spec. The Plan panel has its Calendar, Board, Timeline, Workload and Goals views. Running today: the daily standup and articles only. The weekly editorial board is the next increment (ADR-0069). |
| Weekly planning by the editor-in-chief from the calendar, SEO and analytics | Designed (`publishing-plan.md` §4); the jobs are typed in `crates/agents/src/jobs/strategy.rs`; built from ADR-0069 on. |
| Seasons and events | The standup reads `content/config/content-calendar.json`; the board reads all of it (ADR-0069). |
| Research before writing | Built: web research with cited evidence before every draft, pitch checks (ADR-0068). |
| Kanban, Gantt and graph views | Kanban and Gantt are Plan panel views and brick-office surfaces (the whiteboard, ADR-0063). The **sitemap and link graphs become brick-office surfaces** (the library shelves and others), not a CEO editing tool (owner decision). |
| Internal-linking intelligence, 404s, orphans, link equity | Closed-world link shortlists and checks are built (ADR-0013, ADR-0061); broken-link counts exist in the site audit (`crates/knowledge`). Not yet: the nightly audit (FEAT-049), orphan detection, link equity, reading `linking-policy.json`. Planned as the increment after the board. |
| Freshness, content decay, page updates | Designed (`docs/game-design/economy.md` freshness, the PageRefresh kind); article paths are create-only today (ADR-0061 §5): updating pages needs an ADR. |
| Analytics feedback loop | The tracker collects (ADR-0032); signals into the sim and the +14-day performance review are designed, not built. |
| Localization, media, distribution agents | Roles and job schemas exist (`config/roles.toml`, `crates/agents/src/jobs`); translation, media and newsletter work items come later. |
| Page blueprints, atomic content model builder | The content model is JSON blocks with a schema (ADR-0014) and themes in the site-kit; blueprints only as agent-authored theme work (ADR-0015). |
| `editorial-plan.yaml` in the site repo, GitHub issues per task | Decided differently: the plan's state is the sim's, its text lives in the company's chain and store (rule 6, ADR-0056); one PR per draft through the gateway (ADR-0047). |
| React, shadcn, Zustand, React Flow, DuckDB WASM, MCP agents | Decided differently: Preact overlay (ADR-0018), Turso or SQLite in the browser (ADR-0041), the orchestrator runs the agents (rule 3); models on GPT-6-Luna through the server (ADR-0067). |
| Keyword rankings, traffic overlays on the sitemap, social snippets | Not designed yet. |

**Order (owner decision, 2026-10-06):** the weekly editorial board (ADR-0069); then site
integrity and page refresh; then the analytics loop; then translations and distribution. The
GPT-6-Luna story director (the [migration document](../gpt-6-luna-simulation-migration.md))
follows the board.
