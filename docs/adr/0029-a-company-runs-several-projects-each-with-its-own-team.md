# ADR-0029 — A company runs several projects, each with its own team

**Status:** Accepted (supersedes "exactly one site per player" in the plan)
**Date:** 2026-10-01

## Context

The plan fixed one website per player. The product owner then described the house as running
*projects* (publications such as cinqueterre.travel), each with a team of individual people. A
real publishing house runs a portfolio, and staffing that portfolio is the core management
tension: who works on what, at what cost.

## Decision

- A company owns **1..n projects**. Each project is one real site (one repo, one deploy) with a
  status (Proposed, Active, Paused, Archived), a lead, a monthly budget, KPIs and a ledger.
- People are staffed on projects with **allocation percentages**, summing to at most 100% per
  person. A project's team is the set of allocated people.
- **Project work is routed only to that project's team.** A missing role blocks the job and opens
  a ticket (for example "cinqueterre.travel has no photographer").
- Salaries are charged to projects by allocation. Rent and upkeep are shared by headcount.
  Unallocated time is overhead.
- Players start with one project. More unlock with company level: 2 projects at level 3, 3 at
  level 4, 5 at level 5. New projects start as a Strategy proposal with a business case
  (`ProjectBusinessCase` job) that the CEO approves.
- The leaderboard scores per company across its projects. Only SiteAudit-verified facts count
  (ADR-0021).

## Consequences

- The server, the GitHub layer and the site import key work by `ProjectId`, not just by company.
  `companies` keeps one row per player, and a new `projects` table holds repo and domain.
- More sites per player means more repos in the platform org; GitHub rate limits and
  repo-creation quotas need the governor (ADR-0009) sooner.
- The plan's "one site per player" statements in earlier ADRs are read as "per project".
