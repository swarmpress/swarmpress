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
  - ADR-0047
---

# Onboarding: found a company

Sign in → found company → install the GitHub App on the player's own account → repo from the
starter template in that account (ADR-0047) → first deploy → live site → first staff.

Decisions: [ADR-0009](../../adr/0009-site-repo-canonical-github-app.md), [ADR-0019](../../adr/0019-auth-github-oauth-cookie-sessions.md).

## Acceptance criteria

- [ ] Sandbox org end-to-end: new company reaches a live HTTP 200 site (nightly live E2E).
- [ ] Failure at any step leaves a resumable state and a ticket.

## Evidence

- `server/nextest`
- live E2E (nightly)
