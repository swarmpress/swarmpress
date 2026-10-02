# ADR-0031 — The publishing plan is the shared workspace for CEO and agents

**Status:** Accepted; amended by ADR-0059
**Date:** 2026-10-01

## Context

The company needs one place where work is defined and coordinated: projects, workstreams,
tasks and todos. The product owner named it as the central plane of the game, the media and
publishing plan, and also the place where agents collaborate.

Legacy swarm.press had an editorial planning spec (content tasks with phases, dependencies, SEO
and link requirements, goals), but agents coordinated implicitly through workflow code. Its
documented failure modes include agents holding hidden state, isolated generation without shared
context, and LLMs driving transitions.

## Decision

- The **media and publishing plan** is a first-class domain:

  Goals → Projects → Workstreams → Work items (with phases, todos and dependencies) → Threads.

  Full model in docs/game-design/publishing-plan.md.
- **Blackboard architecture.** Agents coordinate *only* through the plan:
  - a job's context is assembled from its work item, the item's thread and linked items;
  - a job's output is an artifact plus typed **plan operations** (comment, handoff, todo,
    review, question, proposal, request-help);
  - the orchestrator validates plan ops against RBAC and the project team, then applies them;
  - status transitions remain orchestrator-owned (ADR-0011).

  There are no private agent-to-agent channels.
- **Meetings record their minutes into the plan.** Standups, the weekly editorial board and the
  finance review all write to it.
- **The CEO steers through the plan**: priorities, assignments, approvals, cancellations and
  "send to Agency". Escalations still arrive as Inbox tickets linked to items.
- **Data split:**
  - The plan's skeleton (items, phases, assignees, status, dependencies, dates, todo flags) is
    deterministic sim state (`WorkItem`, renamed from the pipeline "Project"), so the office
    reflects it in lockstep.
  - Text (titles, briefs, todos, threads) lives in server Postgres keyed by sim ids and is
    streamed to clients.
  - Published outcomes stay repo-canonical.

## Consequences

- Collaboration is observable and auditable. The thread *is* the story of how an article was
  made, which doubles as gameplay content and as debugging evidence.
- Agent context is bounded and explicit, so it is cacheable and testable. Long threads need
  Secretary summaries (`ThreadSummary`).
- Every job kind's structured output grows a plan-ops section. RBAC validation of plan ops
  becomes a security-relevant surface, with tests that enumerate role × op.
- The UI gains its most important screen (the Plan: calendar, board, timeline, workload, goals),
  and clicking a person in the 3D office links to what they're working on.
