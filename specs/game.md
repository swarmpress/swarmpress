# swarm.press — The Game

> **Status:** Draft v0.1 (2026-10-01) — direction set by the product owner,
> mechanics open for review.
> **Supersedes:** the "Post-MVP Roadmap" in `CLAUDE.md` (multi-tenancy,
> CEO oversight dashboard). Extends `specs/specs.md`; where they conflict,
> this document wins for anything player-facing.

---

## 1. Vision

swarm.press becomes a **management game**. Every player is the CEO of their
own AI publishing house. The company — its staff, meetings, pitches,
conflicts, mistakes and wins — is the gameplay. The **real output is a real,
live website**, one per player, written, edited and deployed by the player's
agents.

Think *Game Dev Tycoon* or *Football Manager*, except the employees are real
AI agents doing real work, and the "product" is a site anyone on the
internet can visit.

### Product decisions (fixed)

| Question | Decision |
|---|---|
| Rebuild or repair? | **Repair** the existing monorepo in place. |
| What is the visible output? | **The company itself**, played as a game. The website is the scoreboard and the artifact. |
| Sites per player | **Exactly one.** |
| API / compute budget | **No platform-imposed limit.** Scarcity is an *in-game* mechanic, not a cost cap. |

---

## 2. Core loop

```
            ┌──────────────── one in-game day (a "tick") ────────────────┐
            │                                                            │
  Player ──►│ 1. Morning standup   Editor-in-chief reviews site + backlog,│
  (CEO)     │                      staff pitch ideas (agents talk)       │
            │ 2. Planning          Pitches → briefs; risky/expensive ones │
  decides ◄─┤                      become CEO decisions in the Inbox     │
            │ 3. Work              Writers draft, editors review, SEO /  │
            │                      media / linker improve (existing      │
            │                      workflows, PR per piece)              │
            │ 4. Publish           Approved PRs merge → site deploys     │
            │ 5. Events            Random + earned events (viral post,   │
            │                      burnout, critic review, competitor)   │
            │ 6. End of day        Metrics update, resources settle,     │
            │                      daily newsletter to the player        │
            └────────────────────────────────────────────────────────────┘
```

The company runs **without the player**. The player steers: they set the
strategy, hire and fire, approve or veto, answer escalations, and react to
events. A player who ignores the game still has a company that publishes,
just worse.

### What the player does

| Action | Existing building block |
|---|---|
| Found the company: name, niche/topic, language, tone | `companies`, `websites`, writer-prompt overrides |
| Hire / fire / promote staff from a candidate pool | `agents`, `agent-personas.ts` |
| Set editorial strategy (focus areas, cadence, quality vs. speed) | `website_schedules`, `blog-workflow.json` |
| Answer the Inbox: approve pitches, resolve escalations, settle disputes | `question_tickets` (backend router exists, no UI) |
| Read the newsroom feed: standups, debates, reviews, merges | `agent_activities`, `event_outbox` |
| Visit and judge their site | site repo + GitHub Pages |

---

## 3. Game state & mechanics

All game state lives in Postgres (operational metadata). Content stays
repo-canonical, unchanged from the current architecture.

### 3.1 Resources

| Resource | Meaning | Moves when |
|---|---|---|
| **Cash** (in-game €) | Pays salaries and commissions | Daily salaries out; revenue in from traffic/reputation |
| **Reputation** (0–100) | How good the publication is considered | Editor quality scores, QA failures, critic events, published corrections |
| **Audience** | Readers | Pages published × quality × reputation; real analytics later |
| **Morale** (per agent, 0–100) | Willingness and quality of work | Overwork, rejections, praise from the CEO, salary |

API spend is **not** a resource — per the "no limits" decision. Cash is a
game abstraction so that hiring, firing and pacing are real choices.

### 3.2 Staff

- Each agent is a **persona** (name, voice, strengths, weaknesses, salary,
  morale) generated from a candidate pool at hire time. The existing
  personas (Giulia, Isabella, Marco…) become the seed pool.
- Persona traits feed the system prompt (voice, rigor, speed) and the
  simulation (salary, morale curve).
- Roles map to existing agents: Writer, Editor, SEO, Media, Linker, QA,
  plus a new **Editor-in-Chief** that plans the day (see §5, Phase 3).

### 3.3 Time

- A **tick = one in-game day**, driven by a per-company Temporal Schedule.
- Default pace: 1 tick per real hour (configurable per game/server).
- All in-game timestamps derive from the tick counter, so workflows remain
  deterministic.

### 3.4 Events

Events are data (`game_events` table, JSON payload + effect), rolled at the
end of a tick or earned by outcomes: a post goes viral, a critic reviews the
site, a writer burns out, a fact-check scandal, a staff poaching offer.
Many events create an Inbox decision.

### 3.5 Score

Primary score = **the site** (pages live, quality scores, reputation,
audience). A public **leaderboard** ranks companies. Every company's site is
publicly visitable, so you can see the competition.

---

## 4. Architecture changes

| Area | Today | Target |
|---|---|---|
| Players | `users` global, no ownership; tRPC context ignores sessions and hard-codes a CEO bearer token | `companies.owner_user_id`; tRPC context resolves the session token → user → their company; every router scoped |
| Agents | No `company_id`; resolved via `findAll()` → first match | `agents.company_id`; resolution always scoped to the company |
| Tickets / activities | Global; `agent_activities` repository and schema disagree | `company_id` on both; repository aligned with the schema |
| Site creation | Human creates the repo by hand; `website.create` omits `company_id` | "Found company" creates the site repo from a template repo in the platform GitHub org, enables Pages (workflow source), sets the subdomain |
| Who decides what to write | Briefs are inserted manually | Editor-in-Chief agent writes briefs every tick |
| UI | Admin back-office (sitemap, kanban, blueprints…); dashboard is a mockup | **Game UI**: newsroom feed, Inbox, staff / org chart, site preview, leaderboard. Admin stays as the operator back-office |
| Models | Mixed, outdated IDs hard-coded (`claude-3-*`, `claude-sonnet-4-*`) | One config default, current models; per-role overrides |

New tables (appended after the `-- AUDIT TRAILER` marker in
`000_schema.sql`, per the schema rules): `game_state` (per company: tick,
cash, reputation, audience), `game_events`, `staff_traits` (or extend
`agents`), `leaderboard_snapshots`.

---

## 5. Repair plan (phased)

Each phase ends with something demoable. Phases 0–1 are pure repair; the
game layer starts in phase 2.

### Phase 0 — Make it build and run

Measured on 2026-10-01:
- `pnpm typecheck` / `pnpm build` **cannot run**: Turbo aborts on a
  dependency cycle `agents → workflows → backend → site-builder → backend`
  (and `agents → backend`, `backend → workflows`).
- Per-package `tsc --noEmit`: shared 0, event-bus 1, github-integration 4,
  backend 171, agents 220, workflows 108, site-builder 315 errors (many are
  cascades of the cycle / missing `dist`).
- `scripts/seed.ts` writes columns that don't exist.

Work:
1. Break the cycle: move shared DB repositories and types out of `backend`
   into a leaf package (e.g. `@swarm-press/db`), so that `backend`
   depends on `workflows`, not the other way round. Drop the deprecated
   site-builder generator's dependency on `backend`.
2. Typecheck green on all packages; add a CI workflow (install, typecheck,
   block-coverage test).
3. Fix the seed script, the `agent_activities` mismatch and `website.create`.
4. One command (`pnpm dev:game`) that starts the API, Temporal worker,
   outbox worker and event-trigger service against `docker compose`.
5. Single model default from config; remove hard-coded model IDs.

### Phase 1 — Players and tenancy

1. Real session auth in the tRPC context; delete the dev auto-CEO and the
   hard-coded bearer in the admin client; protect the public routers
   (notably `github.router`, which leaks access tokens).
2. `companies.owner_user_id` (unique: one company per player),
   `websites` unique per company, `company_id` on agents, tickets and
   activities; scope every router and agent resolution.

### Phase 2 — Found your company (onboarding)

1. Template site repo with the Cinque Terre theme deploy workflow.
2. "Found company" flow: name, niche, language, tone → create the repo
   from the template, enable Pages, seed `content/site.json` and the writer
   prompt override, hire a starter staff from the candidate pool, create
   the tick schedule.

### Phase 3 — Autonomous loop

1. Editor-in-Chief agent: reads the site (via `RepoClient`) and the
   backlog, holds the standup, produces briefs.
2. Tick workflow per company: standup → plan → run content production for
   the day's briefs → settle → events.
3. Escalations become Inbox items; answering an Inbox item signals the
   waiting workflow.

### Phase 4 — Game layer

Resources, morale, events, scoring, leaderboard (§3).

### Phase 5 — Game UI

A new player-facing app (or a stripped-down `apps/dashboard` rewrite):
newsroom feed (live), Inbox, staff, site preview, leaderboard. Reuse
`AgentActivityFeed.tsx`, the kanban and the agent pages from `apps/admin`.

---

## 6. Open questions

1. **Hosting of player sites:** platform-owned GitHub org + `{slug}.swarm.press`
   subdomains (assumed), or players bring their own GitHub account?
2. **Tick pace:** real-time hourly ticks (assumed), or a "fast-forward"
   button the player can press?
3. **Niche:** is any topic allowed, or does the game offer a list
   (travel, food, tech, local news…)?
4. **Multiplayer interaction:** only a leaderboard, or can companies poach
   staff, compete on topics, link to each other?
5. **Persona voice:** should standups and debates be shown as chat-style
   transcripts (agents genuinely talking to each other via the API)?
