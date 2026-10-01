---
id: FEAT-031
title: "Organisation, roles, personas and prompt layering"
status: planned
importance: high
paths:
  - "crates/agents/src/org/**"
  - "crates/agents/src/prompts/**"
  - "crates/agents/src/personas/**"
  - config/roles.toml
adrs:
  - ADR-0010
  - ADR-0014
---

# Organisation, roles, personas and prompt layering

Departments, roles and RBAC; personas (Giulia, Isabella, Lorenzo, Sophia, Marco, Francesca and
generated staff); 3-level prompt layering (company → site → persona) with the style guide, banned
phrases and schema-generated block docs.

Decisions: [ADR-0010](../../adr/0010-claude-over-raw-http.md), [ADR-0014](../../adr/0014-content-model-json-blocks-localizedstring.md).

## Acceptance criteria

- [ ] Prompt resolution snapshots per role and persona (insta).
- [ ] Block docs in prompts are generated from the schema registry, never hand-written.
- [ ] Roles map to models per `config/roles.toml`, overridden by seniority.

## Evidence

- `agents/nextest`
