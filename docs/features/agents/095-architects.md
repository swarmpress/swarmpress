---
id: FEAT-095
title: "The architects: the Information Architect proposes blueprints, the Web Developer builds tools"
status: planned
importance: normal
paths:
  - "crates/agents/prompts/information_architect.md"
  - "crates/agents/src/jobs/architect.rs"
  - "crates/agents/src/jobs/tool_build.rs"
  - "crates/orchestrator/src/structure.rs"
adrs:
  - ADR-0072
  - ADR-0058
  - ADR-0059
---

# The architects: the Information Architect proposes blueprints, the Web Developer builds tools

After the MVP. A new Information Architect role in the strategy department runs the `Architect` job.
The Web Developer runs the `ToolBuild` job. Both work the same way:
- a request (from the canvas's "ask the architect" box, or from the board) gives a structured output
  against the blueprint or tool schema;
- the checker runs, with one repair turn;
- the result is a semantic diff, applied only through a `StructureApproval` ticket whose default never
  applies it.

Connector choice and schema inference are stages of `ToolBuild`, not separate agents.

Design: [`docs/design/construction-kits.md`](../../design/construction-kits.md) §5.2, §5.3, §9.

Depends on: FEAT-090, FEAT-091, FEAT-032 (staged jobs), FEAT-079 (approval tickets).

## Acceptance criteria

- [ ] On the fake model, "add an author page type" yields a valid diff; unknown block ids come back
      as issues for repair.
- [ ] Nothing changes in the repo before the CEO approves; the ticket's default leaves it unchanged.

## Evidence

- `agents/nextest`
