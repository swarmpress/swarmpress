---
id: FEAT-079
title: "CEO publish gate and failure commands"
status: planned
importance: critical
paths:
  - crates/sim-core/src/plan.rs
  - crates/sim-core/src/inbox.rs
  - crates/sim-core/src/commands.rs
  - crates/sim-core/src/validate.rs
  - crates/sim-core/src/world.rs
  - crates/sim-core/src/render_state.rs
  - crates/sim-core/src/scenarios.rs
  - crates/sim-core/tests/publish_gate.rs
  - crates/sim-core/tests/golden.rs
  - crates/client-wasm/src/lib.rs
  - crates/client-wasm/src/json.rs
  - packages/runner/test/fixtures/golden.json
adrs:
  - ADR-0059
  - ADR-0011
  - ADR-0028
  - ADR-0031
---

# CEO publish gate and failure commands

Increment S of `docs/mvp.md`: one sim increment with one deliberate golden re-baseline. Design:
[`docs/design/mvp-pipeline.md`](../../design/mvp-pipeline.md) section 5.

Today nothing asks the CEO before a merge: `AutonomyPolicy` is stored (default `ApproveAll`) and
read nowhere. A failed standup looks like a quiet day, and a deploy that never lands leaves the
item `Scheduled` forever.

- **Gate:** after an editor approval, `advance_work` consults the autonomy policy. Under
  `ApproveAll` the item becomes `Approved` and a `PublishApproval` ticket is raised (High priority;
  options Publish, SendBack, Kill, Defer; default Defer, re-raised the next morning). `ApproveMajor`
  publishes automatically only at score 9 or above with no revision. `Autonomous` behaves as today.
- **Parked items** count toward a work-in-progress limit.
- **Commands:** `ServerCommand::JobFailed{job_id, reason}` and `DeployFailed{work_item}`.
- **Tickets:** `PublishApproval`, `StandupFailed`, `DeployFailed`, `NeedsMedia`, `NeedsPage`; the
  standup timeout raises a ticket. `apply_option` dispatches on the ticket kind.
- **Escalation default:** Retry for an item's first escalation, Kill for later ones.
- **Invariants:** one active draft per writer; open items never exceed the limit.
- **Views:** `Sim::next_due_step()`, meeting `speak_from`/`speak_chars`, render-state `bubbles`,
  `busy_with` and the work item in staff render state.
- The world snapshot's `WORLD_FORMAT` constant (FEAT-060) is bumped with the goldens.

Depends on: FEAT-060 (land the snapshot first). The Inbox UI is FEAT-027 (U1).

## Acceptance criteria

- [ ] Under `ApproveAll`, no `RequestJob(Publish)` exists before a `Publish` answer.
- [ ] An expired `PublishApproval` ticket never publishes and is re-raised at the next 08:30.
- [ ] The Secretary cannot answer the ticket under any delegation policy.
- [ ] `SendBack` restarts Draft with the revision incremented; `Autonomous` behaves as before.
- [ ] A failed or timed-out standup raises `StandupFailed`; `Retry` requests the job again.
- [ ] `DeployFailed` blocks the item and raises a ticket.
- [ ] Goldens are re-baselined once, natively, in wasm and in the runner fixture.

## Evidence

- `sim-core/nextest`
- `sim-core/wasm-bindgen-test`
- `runner/bun-test`
