---
id: FEAT-016
title: "Auth: GitHub OAuth and cookie sessions"
status: planned
importance: high
paths:
  - "crates/server/src/auth/**"
  - "crates/server/tests/auth*.rs"
  - crates/testkit/src/fake_oauth.rs
adrs:
  - ADR-0019
---

# Auth: GitHub OAuth and cookie sessions

GitHub OAuth sign-in, opaque server-side sessions in an HttpOnly Secure SameSite=Lax cookie, CSRF on
state-changing REST, Origin check on WS upgrade, per-company authorisation.

Decisions: [ADR-0019](../../adr/0019-auth-github-oauth-cookie-sessions.md).

## Acceptance criteria

- [ ] Fake OAuth provider flow logs in and rotates the session id.
- [ ] A session can command only its own companies.
- [ ] Cross-origin WS upgrade is rejected.

## Evidence

- `server/nextest`
