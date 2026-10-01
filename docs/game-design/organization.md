# The publishing house: organization, people, projects

> Status: design contract for M1/M4 game logic (2026-10-01). Decisions:
> [ADR-0028](../adr/0028-organization-model-executive-office-and-departments.md),
> [ADR-0029](../adr/0029-a-company-runs-several-projects-each-with-its-own-team.md),
> [ADR-0030](../adr/0030-personas-are-a-data-catalog-with-cv-hobbies-and-interests.md);
> the central plane is the [publishing plan](publishing-plan.md) ([ADR-0031](../adr/0031-the-publishing-plan-is-the-shared-workspace-for-ceo-and-agents.md)).

The player is the **CEO** of a publishing house. Like a real one, it has
departments full of individual people, an executive office that helps the CEO
run it, and a portfolio of **projects** (publications). Each project is a real
website, cinqueterre.travel being the first, with its own team. The CEO doesn't
write articles. The CEO hires, staffs projects, sets strategy and budgets,
approves what matters, and delegates the rest.

## 1. Org chart

```
                                  CEO (player)
                                      │
            ┌─────────────── Executive Office ───────────────┐
            │                                                 │
     CFO (finance)                                  Executive Secretary
            │                                                 │
 ───────────┴──────────── Departments ─────────────────────────────────────────
 Strategy · Editorial · Photo & Video · Web Development · IT & Operations · SEO & Marketing
 ──────────────────────────────────────────────────────────────────────────────
            │  people are members of ONE department and staffed on 0..n projects
 ───────────┴──────────── Projects (publications) ─────────────────────────────
 cinqueterre.travel (team: lead, writers, editor, photographer, web dev, SEO …)
 <next project> (unlocked by progression)
```

- **Department** is the person's home and discipline: who they report to,
  where their desk is, which skills grow.
- **Project** is what they work on. A person can be staffed on several projects
  with percentage allocations that add up to at most 100%. A project's team is
  just the people allocated to it.
- **Executive Office** is two named people with special powers, not a
  department you staff projects from.

## 2. Departments and roles

| Department | Roles (sim `Role`) | Typical rooms | What they produce |
|---|---|---|---|
| Executive Office | `Cfo`, `Secretary` | CEO office, Finance office | Budgets, forecasts, payroll, briefings, triage, scheduling |
| Strategy | `Strategist`, `Analyst` | Meeting room, Strategy room | Content strategy, editorial calendar, market/competitor analysis, project proposals |
| Editorial | `EditorInChief`, `Editor`, `Writer`, `Translator`, `FactChecker` | Newsroom, Editor office, Translation desk | Articles, pages, collections, reviews, translations |
| Photo & Video | `PhotoEditor`, `Photographer`, `VideoProducer` | Photo studio | Shoots (real assets later), photo selection from the media index, captions/alt text |
| Web Development | `ArtDirector`, `WebDeveloper`, `UxDesigner` | Design studio | Site theme, layouts, custom blocks (agent-authored themes, ADR-0015) |
| IT & Operations | `ItEngineer`, `DevOps` | Server room | Repo health, CI, deploys, uptime, broken-link fixes, security hygiene |
| SEO & Marketing | `SeoSpecialist`, `MarketingManager`, `SocialMediaManager` | SEO lab, Marketing room | Keyword plans, metadata, internal linking, newsletters, social campaigns |

The sim's `Role` maps every role to exactly one `Department`
(`Role::department()`). The legacy role set (Writer, Editor, EditorInChief,
MediaEditor, SeoSpecialist, Translator, ArtDirector, FrontendDev, QaAnalyst,
Researcher) maps as follows:

| Legacy role | New role |
|---|---|
| `MediaEditor` | `PhotoEditor` |
| `FrontendDev` | `WebDeveloper` |
| `QaAnalyst` | `FactChecker` |
| `Researcher` | `Analyst` |

### Responsibility matrix (RACI) on a project article

| Step | Strategist | Writer | Editor | Photo | Web dev | SEO/Mkt | IT | CEO |
|---|---|---|---|---|---|---|---|---|
| Pitch / calendar | R | C | C | I | I | C | I | A for big bets |
| Brief | C | I | R | I | I | C | I | I |
| Draft | I | R | C | C | I | I | I | I |
| Photos | I | C | I | R | I | I | I | I |
| Review | I | C | R | I | I | I | I | escalations |
| SEO & links | I | I | C | I | I | R | I | I |
| Layout / custom blocks | I | I | I | C | R | I | I | redesigns |
| Publish (merge + deploy) | I | I | A | I | C | I | R | I |

Rules carried over from swarm.press:
- CEO is the final authority.
- Exceptions go through tickets.
- Nobody bypasses their role.
- High-risk topics reach the CEO.

## 3. People: persona profiles (ADR-0030)

Every person, staff or hiring candidate, is a **persona**. Personas are data
in `crates/agents/personas/<slug>.toml`. The deterministic sim stores only
`PersonaId` and the numbers it needs (traits, seniority, salary). Everything
human lives in the catalog and is used by both the prompts and the UI.

```toml
slug = "giulia"                 # stable key, also the file name
id = 1                          # PersonaId (u16), unique across the catalog
name = "Giulia Rossi"
pronouns = "she/her"            # stated, never inferred from the name
age = 38
hometown = "La Spezia, Italy"
department = "editorial"
role = "writer"
title = "Food & Culture Writer"
seniority = "senior"            # junior | mid | senior | star
salary_eur_month = 4200         # asking salary; sim converts to cents/day
languages = ["it (native)", "en (C2)", "fr (B1)"]
pitch = "One line shown on hiring cards and the org chart."

bio = '''First-person paragraph: who they are, why they do this work.'''

[cv]
education = [
  { years = "2005–2008", what = "BSc Gastronomic Sciences", where = "University of Gastronomic Sciences, Pollenzo" },
]
experience = [
  { years = "2008–2018", role = "Floor manager", org = "Trattoria Rossi (family)", highlights = ["…"] },
  { years = "2018–2025", role = "Contributor", org = "Gambero Rosso", highlights = ["…"] },
]
skills = ["Ligurian cuisine", "restaurant reviews", "recipe writing"]
awards = ["…"]

[life]
hobbies = ["making pesto by hand", "open-water swimming"]
interests = ["Slow Food", "fishing traditions", "natural wine"]
quirks = ["Brings focaccia to Monday standups"]
likes = ["early markets", "honest kitchens"]
dislikes = ["'hidden gem'", "tourist menus"]
work_style = "Writes fast in the morning, edits slowly in the afternoon."

[traits]                         # 0–100, drive the sim (speed, error, morale curve)
rigor = 65
speed = 60
creativity = 80
sociability = 85
resilience = 60
ambition = 55

[writing_style]                  # writers/editors; optional for other roles
tone = "friendly"
# … (see existing personas)

[relationships]                  # optional, flavour for meetings and morale
friends = ["isabella"]
friction = ["lorenzo"]

[appearance]                     # drives the 3D character variant (M9)
palette = "#c0504d"
description = "Short dark hair, linen shirt, reading glasses on a cord."
```

The persona prompt is built from `bio`, `cv`, `life` (hobbies, interests and
quirks give the character in meetings), `writing_style` and `traits`. The UI
shows the same data as a **profile card** (photo or avatar, title, department,
projects, CV timeline, hobbies, current mood). The catalog also holds the
**hiring pool**: personas not yet employed. New candidates are generated by an
LLM job against this exact schema and validated before they enter the pool.

## 4. Projects and teams (ADR-0029)

```text
Project {
  id: ProjectId, slug: "cinqueterre-travel", name: "cinqueterre.travel",
  site: { repo: "swarmpress/cinqueterre.travel", domain: "cinqueterre.travel" },
  status: Proposed | Active | Paused | Archived,
  lead: Option<StaffId>,                     // usually an Editor-in-Chief or senior Editor
  team: BTreeMap<StaffId, ProjectRole { allocation_pct: u8 }>,
  budget: { monthly_cents: i64 },            // set by CEO, watched by CFO
  ledger: ProjectLedger,                     // see §6
  kpis: { live_pages, quality_avg, audience, reputation_pm },
}
```

- A company starts with one project (cinqueterre.travel for the user's company).
- New projects are proposed by Strategy (`ProjectProposal`, a ticket with a
  business case), approved by the CEO, and then unlocked by company level:
  - level 3: 2 projects;
  - level 4: 3 projects;
  - level 5: 5 projects.
- **Staffing rule:** a person's allocations across projects can't exceed 100%.
  Unallocated capacity goes to "house work": training, internal tools, or
  idling with a morale penalty.
- **Work routing:** every project job, such as a draft for cinqueterre.travel,
  is assigned only to members of that project's team who have the right role.
  If the team has no one in that role, the job is blocked with a ticket like
  "cinqueterre.travel has no photographer". That makes staffing visible and
  consequential.
- Salaries are charged to projects by allocation; unallocated time is overhead.

## 5. The CEO's job: orchestration verbs

All of these are player `Command`s, validated deterministically.

| Verb | Command | Notes |
|---|---|---|
| Build | `BuyFloorSpace`, `PlaceRoom`, `PlaceEquipment`, `Demolish` | existing |
| Hire / fire | `Hire{candidate}`, `Fire{staff}` | CFO comments on affordability |
| Promote / pay | `Promote{staff}`, `SetSalary{staff, cents_per_day}` | morale effects |
| Staff projects | `AssignToProject{staff, project, allocation_pct}`, `RemoveFromProject{staff, project}`, `SetProjectLead{project, staff}` | 100% rule |
| Portfolio | `CreateProject{proposal}`, `SetProjectStatus{project, status}` | unlock gated |
| Budget | `SetProjectBudget{project, monthly_cents}` | CFO watches |
| Policies | `SetPolicy(...)` | existing (overtime, autonomy, quality bar) |
| Decide | `AnswerTicket{ticket, option}` | the Inbox |
| Delegate | `Delegate{task}` | to the Secretary (§7) |
| Praise | `Praise{staff}` | small morale boost, limited per day |

## 6. CFO: finances

The CFO is a person (persona, salary, desk in the Finance office).
**Bookkeeping is deterministic sim code.** The CFO agent writes the
commentary.

- **Ledger:** the existing daily company ledger, plus a `ProjectLedger` per
  project with:
  - revenue attributed from its site;
  - allocated salaries;
  - direct costs (Claude/Agency jobs as in-game fees, stock photos later);
  - a share of rent and upkeep by headcount.
- **Month close** (every 30 game days): a P&L per project and for the
  company, budget vs actual, runway = cash ÷ average daily burn.
- **CFO alerts** become tickets routed through the Secretary:
  - a project over budget more than 10%;
  - runway under 30 days;
  - a payroll increase over 15% from a single hire;
  - cash below 0, which brings a loan offer.
- **CFO jobs (LLM):**
  - `FinanceReport`: a monthly narrative and recommendations from the numbers;
  - `HiringAffordability`: attached to hire tickets;
  - `ProjectBusinessCase`: a review of Strategy's proposals.
- **Without a CFO** (fired, or not yet hired), there are no alerts and no
  reports; the CEO flies blind, and the HUD shows "books not kept". You can
  run the company without one, but you'll feel it.

## 7. Executive Secretary: delegation

The Secretary is the CEO's force multiplier and the front door of the Inbox.

- **Triage:** every ticket goes to the Secretary first. The Secretary sets
  priority (High: legal, financial, high-risk, critical blockers; Medium:
  strategy and resourcing; Low: informational), writes a one-paragraph
  summary, and proposes an option.
- **Delegation policy:** a CEO setting with three levels:
  - `Off`: the CEO answers everything;
  - `Low`: the Secretary answers Low tickets with the proposed option;
  - `LowAndMedium`: the Secretary also answers Medium ones.

  High-priority tickets and anything financial over the threshold always
  reach the CEO.
- **`Delegate{task}` kinds:**
  - `TriageInbox`;
  - `ScheduleMeeting{attendees, agenda, project?}`;
  - `PrepareBriefing{project?}`: a morning brief of what happened, decisions due and budget status;
  - `DraftReply{ticket}`;
  - `ArrangeHiring{role, project?}`: asks HR/Strategy for 3 candidates;
  - `FollowUp{staff, topic}`.

  Each delegated task is a `SecretaryTask` in the sim with a duration and
  (for text) an LLM job. Results come back as tickets or briefings.
- **Without a Secretary:** tickets arrive untriaged and unsummarized, and
  delegation is unavailable.

## 8. Daily rhythm (sim)

| Time | What happens |
|---|---|
| 08:30 | Secretary prepares the CEO briefing (if delegated). |
| 09:00 | Project standups, one per active project with its team. Each project's lead moderates; the strategist pitches. |
| 09:30–18:00 | Project work, routed to team members (§4). Department rituals: weekly Monday 10:00 "editorial board" for strategy, Friday 16:00 CFO finance review. |
| 18:00+ | Overtime per policy. |
| 00:00 | Settlement (company and per-project ledgers); month close every 30 days. |

## 9. Data contracts

**Sim (Rust, deterministic):**

New types and fields:
- `Department` enum and `Role::department()`.
- `ProjectId` and `Project` (§4).
- `Staff.projects: BTreeMap<ProjectId, u8>` (allocation %).
- `ExecutiveOffice { cfo: Option<StaffId>, secretary: Option<StaffId> }`.
- `SecretaryTask` queue.
- `ProjectLedger` and month-close records.
- `Ticket { id, kind, priority, project?, from, summary_ref, options, default_option, deadline_step, routed_via_secretary, resolved_by: Ceo|Secretary|Default }`.

**wasm JSON for the UI** (metres and euros at the boundary, ids as strings):

```jsonc
// Sim.org_json()
{ "ceo": { "name": "You" },
  "executive": { "cfo": "staff-7" | null, "secretary": "staff-8" | null, "delegation": "low" },
  "departments": [ { "id": "editorial", "name": "Editorial", "head": "staff-5" | null,
                     "members": ["staff-1", "staff-2"] } ],
  "staff": [ { "id": "staff-1", "persona": "giulia", "role": "writer", "department": "editorial",
               "seniority": "senior", "salaryEurMonth": 4200, "morale": 0.71, "fatigue": 0.16,
               "activity": "working", "projects": [ { "project": "project-1", "allocation": 80 } ] } ],
  "projects": [ { "id": "project-1", "slug": "cinqueterre-travel", "name": "cinqueterre.travel",
                  "domain": "cinqueterre.travel", "status": "active", "lead": "staff-5",
                  "team": [ { "staff": "staff-1", "allocation": 80 } ],
                  "budgetEurMonth": 60000, "missingRoles": ["photographer"] } ] }

// Sim.finance_json()
{ "cashEur": 92900.09, "runwayDays": 61, "dailyBurnEur": 1520.4, "month": 1,
  "company": { "revenueEur": 0, "salariesEur": 0, "rentEur": 0, "upkeepEur": 0, "agencyEur": 0 },
  "projects": [ { "id": "project-1", "budgetEurMonth": 60000, "spentEurMonth": 41200,
                  "revenueEurMonth": 0, "overBudget": false } ],
  "alerts": [ { "kind": "runway-low", "project": null, "ticket": "ticket-3" } ] }

// Sim.inbox_json()
{ "delegation": "low",
  "tickets": [ { "id": "ticket-3", "kind": "budget-overrun", "priority": "high", "project": "project-1",
                 "from": "staff-7", "status": "open", "routedViaSecretary": true,
                 "options": ["approve-overrun", "cut-scope"], "defaultOption": "cut-scope",
                 "deadlineMinute": 1440 } ],
  "secretaryQueue": [ { "id": "task-2", "kind": "prepare-briefing", "status": "working" } ] }
```

**Persona catalog for the UI:** the client loads
`crates/agents/personas/*.toml` (bundled at build time through Vite
`import.meta.glob(..., { query: '?raw' })` and parsed with `smol-toml`).
The server serves the same files.

**Agents (LLM job kinds added):**
- `StrategyPitch`, `ProjectBusinessCase`
- `PhotoSelection`, `PhotoBrief`
- `SiteChange` (web dev)
- `OpsCheck` (IT)
- `SeoPlan`, `MarketingPlan`, `Newsletter`
- `FinanceReport`, `HiringAffordability`
- `SecretaryTriage`, `CeoBriefing`, `DraftReply`
- `CandidateGeneration`

Executors follow ADR-0024:
- Browser: chatter, triage, briefings, drafts.
- Claude: business cases, site changes, research with web search.

## 10. The cinqueterre.travel starting company

| Department | People |
|---|---|
| Executive Office | **CFO** Elena Marchetti (new) · **Secretary** Paolo Bianchi (new) |
| Strategy | Chiara Galli, content strategist (new) |
| Editorial | **EiC** Sophia (legacy "editorial leader"), **Editor** Marco (legacy senior editor), **Writers** Giulia (food), Isabella (outdoors), Lorenzo (history/culture) |
| Photo & Video | Francesca (photographer, legacy) |
| Web Development | Luca Moretti, web developer (new; the legacy name "Luca" was the linker) |
| IT & Operations | Davide Conti, IT engineer (new) |
| SEO & Marketing | Alessia Ferri, SEO & marketing specialist (new) |

Everyone is staffed 100% on cinqueterre.travel, except the CFO, the
Secretary and the strategist (0% project, company-wide). The legacy writer
routing (`agent-page-mapping.ts`) becomes **topic affinities** in each
persona. Within a project team, page types go to the writer whose affinities
match (food → Giulia, hiking → Isabella, history → Lorenzo, hotels → Sophia,
practical → Marco, photography → Francesca).
