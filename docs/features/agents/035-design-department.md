---
id: FEAT-035
title: "Design department"
status: planned
importance: high
paths:
  - "crates/agents/src/design/**"
  - crates/sim-core/src/design.rs
adrs:
  - ADR-0015
  - ADR-0024
---

# Design department

Art Director (mood board with closed media references, vision), Front-end Dev (theme file artifacts,
writes limited to `theme/**`), QA designer (before/after vision review), Redesign/ThemeTweak
projects and the CEO approval ticket.

Decisions: [ADR-0015](../../adr/0015-agent-authored-themes-on-site-kit.md), [ADR-0024](../../adr/0024-hybrid-inference-browser-llms-and-claude.md).

## Acceptance criteria

- [ ] Repo tool refuses writes outside `theme/**`.
- [ ] Redesigns or diffs above 15% always produce a CEO ticket.
- [ ] Post-deploy smoke failure opens a revert PR and a Rollback event.

## Evidence

- `agents/nextest`
- `site-ci` evidence in site repos
