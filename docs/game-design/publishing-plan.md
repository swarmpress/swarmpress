# The media & publishing plan: the company's shared workspace

> Status: design contract (2026-10-01). Decision: [ADR-0031](../adr/0031-the-publishing-plan-is-the-shared-workspace-for-ceo-and-agents.md).
> Builds on the legacy agentic editorial planning spec (`git show 15998d0:specs/agentic_editorial_planning_spec.md`)
> and on [organization.md](organization.md).

Every real publishing house runs on a plan: what we publish, when, why, who
does it, and what's blocking it. In SimPress the **media & publishing plan** is:

- **the CEO's main instrument**: you steer the company by shaping the plan
  (goals, priorities, approvals) rather than by doing the work;
- **the agents' only shared memory and coordination surface**, a blackboard.
  Agents don't message each other privately. They read the plan, do their part,
  and write back comments, handoffs, reviews, todos and proposals. Meetings
  happen *about* plan items and record their minutes *in* the plan;
- **the visible state of the company**: the 3D office shows people working;
  the plan shows what they work on and why.

## 1. Structure

```
Goals (company OKRs: "Grow cinqueterre.travel to 40k monthly readers by Q2")
 └─ Project (publication, ADR-0029)          e.g. cinqueterre.travel
     └─ Workstream (campaign / theme / epic)  e.g. "Autumn harvest season", "Village guides refresh",
     │                                              "Redesign v2", "Fix 147 broken links"
     └─ Work item (the unit of work)          article · page refresh · collection research · translation ·
         │                                    photo shoot · redesign · site change · SEO plan · newsletter ·
         │                                    ops task · audit · business case
         ├─ Phases (from the item's kind)     research → outline → draft → media → links/SEO → review → publish
         ├─ Todos (checklist)                 "Confirm Sciacchetrà harvest dates", "3 photos of Volastra terraces"
         └─ Thread (collaboration log)        comments · handoffs · reviews · questions · decisions · minutes
```

### Work item fields

| Field | Notes |
|---|---|
| `id`, `kind`, `title`, `brief` | The brief is the contract: angle, audience, must-cover points |
| `project`, `workstream`, `goal` | Where it belongs and why it exists |
| `status` | `backlog → planned → in-progress → in-review → approved → scheduled → published`, plus `blocked`, `cancelled`. Mirrors the content state machine (agents crate `state.rs`). |
| `priority` | `urgent / high / normal / low` |
| `owner` | Accountable person (usually the project lead or editor) |
| `phases[]` | Each phase has: assignee (role-checked against the project team), state, estimate (game minutes), progress |
| `reviewers` | Editor for content; Art Director for design; CEO only when escalated |
| `due`, `publish_date` | Game-time dates; the editorial calendar is the set of publish dates |
| `depends_on`, `blocks` | Dependencies (for example, translation depends on the EN publish) |
| `seo` | Primary and secondary keywords, cluster (SEO and marketing fill these in) |
| `targets` | Pages it creates or updates (closed-world page registry ids or new paths) |
| `links` | Required inbound and outbound internal links (from the linking policy) |
| `media` | Required images: count, style, entity match (from block metadata) |
| `artifacts` | PR URL, page path, mood board, screenshots, report: everything produced |
| `budget` | Expected Agency (Claude) fees, overtime; actuals filled in by the CFO's books |
| `tickets` | Linked Inbox tickets (escalations, approvals) |
| `followup` | For example "check audience after 14 days", which creates an update item later |

## 2. Collaboration: the thread is the protocol

Each work item has an append-only **thread** of typed posts. Every agent
action that matters is a post, and every post has an author (a person or the
CEO) and a timestamp in game time.

| Post type | Who | Effect |
|---|---|---|
| `comment` | anyone on the team | Free text; `@slug` mentions notify (the mentioned person reads it at their next job) |
| `handoff` | phase assignee | Closes their phase and hands to the next with notes ("draft done, needs 2 photos of the harvest") |
| `todo-add` / `todo-done` | team | Checklist management |
| `review` | reviewer | Verdict (`approve` / `changes` / `reject`), score 0–10, notes. The editor rubric approves at 7 or above. |
| `question` | anyone | Answered in-thread by a teammate, or escalated by the Secretary into an Inbox ticket |
| `decision` | owner, EiC or CEO (RBAC) | Records a call ("we cut the restaurant list to 8") |
| `status` | system | Phase and status transitions (written by the orchestrator, never by an LLM) |
| `minutes` | meeting moderator | Standup and board meeting outcomes that touch the item |
| `proposal` | strategist, anyone | Proposes a new work item or workstream (CEO or EiC accepts) |
| `artifact` | system | A PR was opened, a page merged, a deploy landed |

## 3. How agents use the plan (blackboard protocol)

1. **Context in.** A job for phase P of item W gets:
   - the item: brief, fields, todos;
   - the thread: recent posts first; older posts summarized by the Secretary when long;
   - linked items: dependencies, same-workstream siblings;
   - the relevant slices of the knowledge indexes (ADR-0013);
   - the person's persona.

   That is the agent's whole world.
2. **Work.** The agent produces its artifact (draft page JSON, review, mood
   board, report, …) as today.
3. **Plan ops out.** Alongside the artifact, the agent returns structured
   **plan operations**: `comment`, `handoff`, `todo-add`, `todo-done`,
   `question`, `review`, `proposal`, `request-help{role}`.
4. **The orchestrator validates and applies them.** Plan ops are checked
   against RBAC (a writer can't post a `decision` or approve; a role that isn't
   on the project team can't take a phase). Valid ops are applied, invalid ones
   are rejected back to the agent.
   - Transitions come first, side effects after (ADR-0011).
   - Status changes are made by the orchestrator, never by the model.
5. **Mentions and requests.** These become queued work for the mentioned
   person or role, in the sim as a small job at their desk, so collaboration
   shows up in the 3D office: someone walks to a colleague's desk, or a quick
   huddle forms.

## 4. Cadence: when the plan changes

| When | Ritual | Plan effect |
|---|---|---|
| Daily 09:00 | Project standup (team, lead moderates) | Minutes posted to the items discussed; blockers become `question` posts; new ideas become `proposal` posts |
| Monday 10:00 | Editorial board (strategist, EiC, SEO/marketing, CFO for cost) | Weekly plan: the strategist proposes items from the calendar, audits and analytics; the EiC schedules and assigns; big bets go to the CEO as tickets |
| Friday 16:00 | Finance review (CFO + CEO office) | Budget vs actual per workstream; CFO comments on expensive items |
| Continuous | Work | Phases progress, handoffs, reviews |
| On events | Audits, deploy failures, news | System or IT posts create `fix` items |

**Seed sources for the cinqueterre.travel plan:**
- `content/config/content-calendar.json`: seasonal workstreams and publish
  windows (for example the autumn wine harvest, 09-01 to 11-30, starting 4
  weeks ahead).
- `collection-research.json`: recurring research items (restaurants
  quarterly, hikes weekly, events daily).
- The knowledge audit: 147 broken internal links, 83 images missing from the
  index, 18 duplicate routes. Each becomes a "site health" workstream with fix
  items.
- The schema drift found by `knowledge` becomes migration items for the web dev.

## 5. The CEO's view

- **Calendar** (the media plan): publish dates by project and language, with seasonal windows.
- **Board:** a Kanban by status, filterable by project, workstream and person.
- **Timeline:** phases and dependencies (Gantt).
- **Workload:** who is on what this week against their allocation; overload is red.
- **Goals:** OKRs with metric progress from SiteAudit, the CFO's books and audience.
- **Item detail:** brief, phases, todos, the thread (the collaboration log),
  artifacts and costs. The CEO can comment, re-prioritize, reassign
  (role-checked), approve, cancel, or "send to Agency" (Claude).

Approvals and escalations still arrive as Inbox tickets (organization.md §7).
The ticket links to the item, and answering it posts a `decision` into the
item's thread.

## 6. Where the plan lives (data split)

| Part | Store | Why |
|---|---|---|
| Plan skeleton: items, kinds, status, phases with assignee, estimate and progress, priorities, dependencies, due/publish steps, todo ids and done flags | **sim-core** (`WorkItem`, deterministic) | Drives who works on what in the office, capacity, deadlines, overtime, morale. Same in every lockstep replica. |
| Plan text: titles, briefs, todo text, thread posts, minutes, artifacts | **Server Postgres** (`plan_items`, `plan_posts`, `plan_todos`), keyed by sim ids | Text never enters the sim hash (ADR-0030 pattern). Streamed to clients like meeting utterances. |
| Published outcome | Site repo | Content stays repo-canonical (ADR-0009). Merged PRs are linked as artifacts. |

The offline sandbox keeps plan text in the client (mock store), with the same
API as the server.

**Sim additions:**
- `WorkItem` (renamed from the pipeline `Project`) gains `project: ProjectId`,
  `workstream: Option<WorkstreamId>`, `goal`, `priority`, `owner`,
  `phases: Vec<Phase{kind, assignee, estimate_min, progress_pm, state}>`,
  `todos: Vec<Todo{id, assignee, done}>`, `depends_on`, `due_step`,
  `publish_step`.
- `Workstream { id, project, status }` and `Goal { id, metric, target, current }`.
- Commands:
  - `CreateWorkItem`, `UpdateWorkItem{priority|owner|due|status}`, `AssignPhase`;
  - `AddTodo`, `CompleteTodo`;
  - `CreateWorkstream`, `SetGoal`;
  - `AcceptProposal{post}`.
- Server-issued: `PlanOpsApplied{item, ops_digest}`.

**Server additions:**
- Plan tables.
- `/api/projects/:id/plan` (read) and plan-op endpoints for the CEO.
- WS frames `PlanPost{item, post}` streamed to clients.
- Validation of agent plan ops (RBAC and schema).

**Agents additions:**
- `PlanContext` (assembled from the item, its thread and links) and the
  `PlanOp` schema in every job's structured output.
- `ThreadSummary` (Secretary) for long threads.
- `WeeklyPlan` (strategist) and `PlanSchedule` (EiC) job kinds for the
  Monday board.

**UI:** a "Plan" panel (Calendar, Board, Timeline, Workload, Goals) and an item
detail view with the live thread. In the 3D office, clicking a working person
opens the item they're working on.

## 7. Wasm JSON contract (for the UI)

```jsonc
// Sim.plan_json(project_id?)  (skeleton; text is joined client-side from the plan store)
{ "goals": [ { "id": "goal-1", "metric": "audience", "target": 40000, "current": 12000 } ],
  "workstreams": [ { "id": "ws-1", "project": "project-1", "status": "active" } ],
  "items": [ { "id": "work-item-4", "project": "project-1", "workstream": "ws-1", "kind": "article",
               "status": "in-progress", "priority": "high", "owner": "staff-5",
               "phases": [ { "kind": "draft", "assignee": "staff-1", "state": "working", "progress": 0.4,
                             "estimateMinutes": 240 } ],
               "todos": [ { "id": "todo-9", "assignee": "staff-6", "done": false } ],
               "dependsOn": [], "dueDay": 12, "publishDay": 14, "tickets": ["ticket-3"] } ] }

// PlanStore (server REST or offline mock): text keyed by the same ids
{ "items": { "work-item-4": { "title": "Harvest week in Manarola", "brief": "…" } },
  "todos": { "todo-9": "Three photos of the Volastra terraces at golden hour" },
  "workstreams": { "ws-1": { "title": "Autumn harvest season", "description": "…" } },
  "goals": { "goal-1": { "title": "Grow cinqueterre.travel to 40k monthly readers" } },
  "posts": { "work-item-4": [ { "id": "post-31", "type": "handoff", "author": "staff-1", "day": 11,
                                 "minute": 960, "to": "staff-6", "text": "Draft is in; need 2 harvest photos." } ] } }
```
