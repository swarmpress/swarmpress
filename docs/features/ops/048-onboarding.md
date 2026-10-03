---
id: FEAT-048
title: "Onboarding: found a company"
status: planned
importance: high
paths:
  - "crates/server/src/onboarding/**"
  - "themes/starter/**"
  - "apps/game/src/ui/onboarding/**"
  - crates/server/src/companies.rs
  - apps/game/src/ui/site-binding.ts
  - apps/game/src/ui/site-binding.test.tsx
adrs:
  - ADR-0009
  - ADR-0019
  - ADR-0047
---

# Onboarding: found a company

Sign in → found company → install the GitHub App on the player's own account → repo from the
starter template in that account (ADR-0047) → first deploy → live site → first staff.

Decisions: [ADR-0009](../../adr/0009-site-repo-canonical-github-app.md), [ADR-0019](../../adr/0019-auth-github-oauth-cookie-sessions.md).

## What exists (increment G2)

Founding binds the company to a repository deliberately, before any of the onboarding above
exists:

- `GET /api/me` returns `default_binding`, the repository and base branch the server's owner
  configured (`SWARMPRESS_DEFAULT_SITE_REPO`, `SWARMPRESS_DEFAULT_BASE_BRANCH`); the session
  passes it explicitly to `POST /api/companies` (`companyFor` in `apps/game/src/net/central.ts`).
  A write target never comes from the URL.
- The server refuses a repository outside `SWARMPRESS_ALLOWED_SITE_REPOS` (403).
- The game shows the binding read-only: on the boot screen as soon as the company is known, then
  in the HUD (`apps/game/src/ui/site-binding.ts`), marked when the server's default has moved
  elsewhere since the company was founded.
- An existing company is moved with `PATCH /api/companies/me` (FEAT-046).

There is no check yet that the player owns the repository (the App installation of ADR-0047
decision 5, a later increment).

## Acceptance criteria

- [ ] Sandbox org end-to-end: new company reaches a live HTTP 200 site (nightly live E2E).
- [ ] Failure at any step leaves a resumable state and a ticket.

## Evidence

- `server/nextest`
- `game/vitest`
- live E2E (nightly)
