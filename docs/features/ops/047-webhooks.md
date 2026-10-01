---
id: FEAT-047
title: "Webhooks"
status: planned
importance: high
paths:
  - "crates/server/src/webhooks/**"
  - crates/github/src/webhooks.rs
adrs:
  - ADR-0009
---

# Webhooks

`pull_request`, `check_suite`/`check_run`, `deployment_status` and `push` webhooks, HMAC-verified
and deduplicated by delivery id, turned into `ServerCommand`s.

Decisions: [ADR-0009](../../adr/0009-site-repo-canonical-github-app.md).

## Acceptance criteria

- [ ] Bad HMAC is rejected; duplicate delivery is a no-op.
- [ ] `deployment_status: success` produces `Cmd::DeployLanded` exactly once.

## Evidence

- `github/nextest`
- `server/nextest`
