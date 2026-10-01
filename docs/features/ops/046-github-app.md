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
---

# GitHub App client and site repos

App auth (JWT → installation tokens), repo-from-template, contents/branches/PRs/checks via the Git
Data API, merges by the orchestrator.

Decisions: [ADR-0009](../../adr/0009-site-repo-canonical-github-app.md).

## Acceptance criteria

- [ ] FakeGitHub in-memory repos, PRs and checks drive agent tests.
- [ ] wiremock contract tests against recorded GitHub API responses.
- [ ] One commit per PR update (tree API), never one per file.

## Evidence

- `github/nextest`
