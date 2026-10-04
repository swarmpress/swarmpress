---
id: FEAT-016
title: "Auth: GitHub OAuth and cookie sessions"
status: in-progress
importance: high
paths:
  - crates/server/src/auth.rs
  - crates/server/src/db/accounts.rs
  - crates/server/tests/http.rs
  - crates/testkit/src/lib.rs
  - crates/server/tests/runner_tokens.rs
adrs:
  - ADR-0019
  - ADR-0045
---

# Auth: GitHub OAuth and cookie sessions

GitHub OAuth sign-in, opaque server-side sessions in an HttpOnly Secure SameSite=Lax cookie, CSRF on
state-changing REST, Origin check on WS upgrade, per-company authorisation.

Decisions: [ADR-0019](../../adr/0019-auth-github-oauth-cookie-sessions.md).

> **Status note (2026-10-04):** The OAuth web flow, cookie sessions, logout, expiry and dev login
> are built (`crates/server/src/auth.rs`) and tested (`crates/server/tests/http.rs`). Runner tokens
> are not built yet; `crates/server/tests/runner_tokens.rs` is their planned test file.

Runner tokens (increment A6, FEAT-063): a non-browser executor authenticates with
`Authorization: Bearer <token>`. `runner_tokens` stores only the hash; a token is scoped to one
company (and, for managed runs, one run) and can be revoked.

## Acceptance criteria

- [ ] Fake OAuth provider flow logs in and rotates the session id.
- [ ] A session can command only its own companies.
- [ ] Cross-origin WS upgrade is rejected.
- [ ] A runner token works only for its company, and not after revocation.

## Evidence

- `server/nextest`
