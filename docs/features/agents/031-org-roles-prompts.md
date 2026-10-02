---
id: FEAT-031
title: "Organisation, roles, personas and prompt layering"
status: in-progress
importance: high
paths:
  - crates/agents/src/roles.rs
  - crates/agents/src/personas.rs
  - crates/agents/src/routing.rs
  - crates/agents/src/plan.rs
  - crates/agents/src/prompts.rs
  - crates/agents/src/house_style.rs
  - "crates/agents/src/jobs/**"
  - "crates/agents/personas/**"
  - "crates/agents/prompts/**"
  - crates/agents/examples/export_catalog.rs
  - crates/agents/tests/personas.rs
  - crates/agents/tests/organization.rs
  - crates/agents/tests/jobs.rs
  - crates/agents/tests/plan.rs
  - crates/agents/tests/prompts.rs
  - crates/agents/tests/config.rs
  - "crates/agents/tests/snapshots/personas__*.snap"
  - "crates/agents/tests/snapshots/plan__*.snap"
  - "crates/agents/tests/snapshots/prompts__*.snap"
  - config/roles.toml
adrs:
  - ADR-0010
  - ADR-0014
  - ADR-0028
  - ADR-0029
  - ADR-0030
  - ADR-0031
---

# Organisation, roles, personas and prompt layering

The people layer of `crates/agents` ([organization.md](../../game-design/organization.md)):

- **Departments and roles** (§2): 7 departments, 21 staff roles (kebab-case wire names shared with
  `sim-core`), salary bands, `config/roles.toml` (role → Claude model/effort, seniority override,
  one executor policy per `JobKind`).
- **Persona catalog v2** (§3, ADR-0030): 13 starting staff (ids 1–13) and an 18-person hiring
  pool (ids 100+) as TOML data in `crates/agents/personas/`, strictly validated (unknown fields,
  empty fields, id/slug uniqueness, relationship targets, salary within the role's band, CV
  depth, non-partisan `world`). Exported as camelCase JSON by `catalog_json()` and
  `cargo run -p agents --example export_catalog -- <out.json>`. The SDK pack schema
  (`packages/sdk`, FEAT-053) mirrors it, guarded by a drift test.
- **Organisation jobs** (§6–§9): structured outputs with validators for the CFO (finance report
  and hiring affordability: every figure must come from the input), the Executive Secretary
  (triage rubric, CEO briefing, draft reply), strategy, data science, photo, web, IT, SEO and
  marketing, and candidate generation (output must validate as a persona).
- **Publishing plan** (ADR-0031): `PlanContext` for prompts and `validate_plan_ops` (RBAC by role
  and op).
- **Work routing**: `best_writer_for(topic, team)` by affinities with the legacy fallbacks.
- **Prompt layering**: company → site → persona, with the persona block (CV highlights, hobbies,
  quirks, relationships, work style) snapshot-tested.

Decisions: [ADR-0010](../../adr/0010-claude-over-raw-http.md), [ADR-0014](../../adr/0014-content-model-json-blocks-localizedstring.md),
[ADR-0028](../../adr/0028-organization-model-executive-office-and-departments.md),
[ADR-0029](../../adr/0029-a-company-runs-several-projects-each-with-its-own-team.md),
[ADR-0030](../../adr/0030-personas-are-a-data-catalog-with-cv-hobbies-and-interests.md),
[ADR-0031](../../adr/0031-the-publishing-plan-is-the-shared-workspace-for-ceo-and-agents.md).

## Acceptance criteria

- [ ] Prompt resolution snapshots per role and persona (insta).
- [ ] Block docs in prompts are generated from the schema registry, never hand-written.
- [ ] Roles map to models per `config/roles.toml`, overridden by seniority.
- [ ] Every persona file loads and validates; schema violations are rejected with a reason.
- [ ] Every staff role has at least one person in the staff or the hiring pool.
- [ ] Every `JobKind` has a role, an executor policy and a prompt template.
- [ ] CFO and data-science outputs never contain a figure that is not in the input.
- [ ] Generated candidates validate as personas and get a fresh pool id.
- [ ] The SDK pack persona schema has the same keys and wire names as the Rust `Persona`.

## Evidence

- `agents/nextest`
