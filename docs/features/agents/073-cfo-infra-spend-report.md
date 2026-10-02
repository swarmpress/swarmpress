---
id: FEAT-073
title: "CFO infrastructure spend report and unit-tagged numbers validator"
status: planned
importance: high
paths:
  - crates/agents/prompts/cfo.md
  - crates/agents/src/jobs/numbers.rs
  - crates/agents/src/jobs/office.rs
  - config/roles.toml
adrs:
  - ADR-0052
  - ADR-0011
---

# CFO infrastructure spend report and unit-tagged numbers validator

Increment B8. The CFO model comments on real spend and never controls it (rule 3).

- New job `infra-spend-report`: its input holds only real figures, each supplied by deterministic
  code in both display forms (`spent_credits`, `spent_eur`). `finance-report` stays game-only.
  No job input mixes the two currencies.
- The CFO also writes the note on a spend-approval ticket, the cost note at extension install,
  and the narration of a budget proposal that a deterministic allocator produced.
- Forecasts are computed centrally as integers: month-end projection, recurring commitments and
  days of balance left.
- `numbers.rs` gains unit tags: a number is valid only with the unit of the input field it came
  from.
- "Approves within delegated authority" is the deterministic policy (FEAT-070), shown in fiction
  as the CFO's standing limit. Enforcement does not depend on a CFO being employed.

Depends on: FEAT-070, FEAT-071.

## Acceptance criteria

- [ ] An output that puts € beside a number sourced only from a credits field is rejected.
- [ ] An output with a number not present in the input is rejected, as today.
- [ ] The report job against a fake model passes with figures from a fixture ledger.
- [ ] The CFO prompt still forbids approving, allocating or changing anything.

## Evidence

- `agents/nextest`
