# ADR-0028 — Organization model: CEO, executive office and departments

**Status:** Accepted
**Date:** 2026-10-01

## Context

The player is the CEO of a publishing house. Legacy swarm.press had seven departments on paper
(Editorial, Writers Room, SEO & Analytics, Media & Design, Engineering, Distribution, Governance)
but only populated writers and an editor. It had a "CEO Assistant" prompt with no tools, and no
finance at all. The game needs an organization the player can *run*: people with homes and
disciplines, someone who keeps the books, and someone the CEO can delegate to. Otherwise every
decision lands on the player and the company has no texture.

## Decision

- **Departments**, each person in exactly one, mirroring a real publishing house:
  - Strategy
  - Editorial
  - Photo & Video
  - Web Development
  - IT & Operations
  - SEO & Marketing
- **Roles** map 1:1 to a department (`Role::department()`): strategist, analyst, editor-in-chief,
  editor, writer, translator, fact-checker, photo editor, photographer, video producer, art
  director, web developer, UX designer, IT engineer, DevOps, SEO specialist, marketing manager,
  social media manager.
- **Executive Office** with two named roles that change the game's rules:
  - **CFO**: deterministic bookkeeping (company and per-project ledgers, month close, runway)
    is always sim code. The CFO adds alerts as tickets and LLM-written reports. Without a CFO
    the books still balance, but the player gets no warnings.
  - **Executive Secretary**: the front door of the Inbox. Triages and summarizes every ticket,
    can answer Low/Medium ones under a CEO delegation policy, and runs delegated tasks
    (briefings, meetings, draft replies, hiring requests).
- **The CEO stays the final authority.** High-priority and over-threshold financial tickets
  always reach the player; delegation never covers them.
- The legacy RACI and escalation rules are kept, extended to the new roles
  (docs/game-design/organization.md §2).

## Consequences

- The player's job becomes orchestration: hiring, staffing, budgets, approvals and delegation,
  which is what makes it a management game rather than a content tool.
- More roles mean more prompt templates and job kinds. Every role needs a reason to exist in the
  sim (a job kind, a room, a ticket), or it is cut.
- The secretary's auto-answers are a trust surface. They are always logged in the Inbox history
  with "answered by Secretary", and they are reversible where the sim allows.
- Departments are a stable axis for the org chart UI, rooms and skill growth; projects (ADR-0029)
  are the orthogonal axis for work.
