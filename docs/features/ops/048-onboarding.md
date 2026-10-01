---
id: FEAT-048
title: "Onboarding: found a company"
status: planned
importance: high
paths:
  - "crates/server/src/onboarding/**"
  - "themes/starter/**"
  - "apps/game/src/ui/onboarding/**"
adrs:
  - ADR-0009
  - ADR-0019
---

# Onboarding: found a company

Sign in → found company → repo from the starter template in the platform org → first deploy → live
site → first staff.

Decisions: [ADR-0009](../../adr/0009-site-repo-canonical-github-app.md), [ADR-0019](../../adr/0019-auth-github-oauth-cookie-sessions.md).

## Acceptance criteria

- [ ] Sandbox org end-to-end: new company reaches a live HTTP 200 site (nightly live E2E).
- [ ] Failure at any step leaves a resumable state and a ticket.

## Evidence

- `server/nextest`
- live E2E (nightly)
