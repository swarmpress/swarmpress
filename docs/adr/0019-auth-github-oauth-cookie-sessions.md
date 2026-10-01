# ADR-0019 — Auth: GitHub OAuth and cookie sessions

**Status:** Accepted
**Date:** 2026-10-01

## Context

Every player owns a company and one real website in a GitHub org. Players are developers and
creators who already have GitHub accounts, and their identity should map cleanly onto repo
collaborator rights.

The game client is a browser app talking to one origin over REST and WebSocket.

## Decision

- **Sign-in** uses the GitHub OAuth web flow, with the GitHub App's user-to-server OAuth.
  - Scope is minimal: identity and email only.
  - Repo writes always use the **App installation token**
    ([ADR-0009](0009-site-repo-canonical-github-app.md)), never the user token.
- **Sessions** are server-side rows in Postgres (`sessions`).
  - The browser holds an opaque, random session id in a cookie set `HttpOnly; Secure;
    SameSite=Lax; Path=/`.
  - Sessions rotate on login and expire after 30 days, sliding.
- **The WebSocket upgrade** authenticates with the same cookie, plus an `Origin` check.
  State-changing REST calls require a CSRF token (double submit).
- **Authorisation:** a session may command only companies it owns, or companies it has been
  invited to as a viewer.
- **Tests** use a fake OAuth provider in `crates/testkit`.

Alternatives considered:

- **JWT in localStorage.** Rejected. Readable by XSS, and hard to revoke.
- **Email/password or magic links.** Rejected. Credentials to store, and no mapping to GitHub
  identities.
- **A third-party auth provider (Auth0, Clerk).** Rejected. An extra dependency and cost for one
  identity provider we already need.

## Consequences

- Positive: simple, revocable sessions, with nothing sensitive in browser storage.
- Positive: the GitHub identity links naturally to the site repo and to collaborator invites.
- Negative: players without a GitHub account can't play. This is accepted for the target
  audience.
- Negative: the cookie setup requires the game and the API to share a site (same origin, or
  subdomains with an explicit cookie domain).
