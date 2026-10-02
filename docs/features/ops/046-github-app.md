---
id: FEAT-046
title: "GitHub App client and site repos"
status: planned
importance: critical
paths:
  - "crates/github/**"
  - "crates/testkit/src/fake_github*.rs"
adrs:
  - ADR-0009
  - ADR-0047
---

# GitHub App client and site repos

App auth (JWT → installation tokens), repo-from-template, contents/branches/PRs/checks via the Git
Data API, merges by the orchestrator.

Decisions: [ADR-0009](../../adr/0009-site-repo-canonical-github-app.md).

Player-owned repositories (ADR-0047, superseding the platform org of ADR-0009): the App is
installed on the player's own account or organisation, and the site repository (and the optional
state repository, FEAT-066) lives there. The server stores the installation link per company and
mints installation tokens scoped to that company's repositories. Rate limits and Actions minutes
are then per player. The platform org remains only as a sandbox for tests.

## Acceptance criteria

- [ ] FakeGitHub in-memory repos, PRs and checks drive agent tests.
- [ ] wiremock contract tests against recorded GitHub API responses.
- [ ] One commit per PR update (tree API), never one per file.
- [ ] An installation token is scoped to the company's own repositories and to nothing else.
- [ ] An uninstall or a revoked repository leaves the company playable and raises a ticket.

## Evidence

- `github/nextest`
