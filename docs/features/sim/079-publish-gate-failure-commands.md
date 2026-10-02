---
id: FEAT-079
title: "CEO publish gate and failure commands"
status: in-progress
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
  - crates/client-wasm/tests/golden_wasm.rs
  - crates/client-wasm/tests/runner_golden.rs
  - packages/runner/test/fixtures/golden.json
  - packages/runner/test/golden.test.ts
adrs:
  - ADR-0059
  - ADR-0060
  - ADR-0011
  - ADR-0028
  - ADR-0031
---

# CEO publish gate and failure commands

Increment S of `docs/mvp.md`: one sim increment with one deliberate golden re-baseline. Design:
[`docs/design/mvp-pipeline.md`](../../design/mvp-pipeline.md) section 5. Contract:
[sim.md "Job contract"](../../architecture/sim.md#job-contract-mvp) and
`crates/client-wasm/README.md`.

Built in the sim and its JSON boundary (the Inbox preview is FEAT-027, U1; the host's clock hold
is FEAT-080, T):

- **Gate:** after an editor approval, `advance_work` consults `company.policies.autonomy`. Under
  `ApproveAll` (the default) the item becomes `Approved`, its Publish phase stays `Pending`, no job
  is requested and a `PublishApproval` ticket is raised: High priority and CEO-only, options
  Publish, SendBack, Kill, Defer; default Defer, one game day. A deferred or expired ticket leaves
  the item parked and a fresh one is raised when the clock next crosses 08:30. `ApproveMajor`
  publishes unasked only at score 9 or above with revision 0. `Autonomous` behaves as before.
- **Work in progress:** a project has at most `WIP_LIMIT` (3) open items, parked ones included,
  and a writer at most one item in the writing loop. Both are checked where `MeetingOutcome`
  creates work items, so an absent CEO stops new commissions and loses nothing.
- **Commands:** `ServerCommand::JobFailed{job_id, reason: JobFailure}` and
  `DeployFailed{work_item}`. `JobCompleted{ok: false}` still works.
- **Tickets:** `PublishApproval`, `StandupFailed` (Retry/Skip, default Skip), `DeployFailed`
  (Retry/Acknowledge, default Acknowledge), `NeedsMedia` and `NeedsPage` (Retry/Kill, default
  Kill, two game days). A failed or timed-out standup raises `StandupFailed`. `apply_option`
  dispatches on the ticket kind. Tickets carry the failure reason (`Ticket.failure`).
- **Escalation default:** Retry for an item's first escalation, Kill for later ones.
- **Views:** `World::next_due_step()` / `Sim::next_due_step()` and `dueStep` per pending job in
  `plan_json`; `wip[]` in `plan_json`; meeting `speak_from`/`speak_chars`; render-state
  `bubbles`; the work item in staff render state, with the Type pose following it.
- The world snapshot's `WORLD_FORMAT` constant (FEAT-060) went from 1 to 2 with the goldens.

Decisions taken where the design was silent, all in `crates/sim-core`:

- The limit is per project and its value is 3 (the design's standup example speaks of three
  parked articles).
- "One active draft per writer" is enforced as "one item in the writing loop": an item keeps its
  writer until it is past the gate, because a failed review or a SendBack restarts Draft.
- `SendBack` is refused once the item has used its three revisions, so the revision cap stays an
  invariant.
- `Acknowledge` on a failed deploy puts the item back to `Scheduled`: the merge stands and the
  next deploy that carries it lands it.
- `Retry` on a failed standup opens a new standup at the current minute, for at most an hour.
- All five new kinds are High, so none is ever answered by the Secretary.

Not built here: the `Outcome::JobFailed` of the orchestrator and the host's use of it (P4, P6),
the server's `DeployFailed` event (G5), the approval preview in the Inbox (U1), the bubble layer
(U5) and the clock hold (T).

## Acceptance criteria

- [ ] Under `ApproveAll`, no `RequestJob(Publish)` exists before a `Publish` answer
      (`publish_gate::no_publish_job_exists_before_a_publish_answer`).
- [ ] An expired `PublishApproval` ticket never publishes and is re-raised at the next 08:30
      (`publish_gate::an_expired_approval_never_publishes_and_is_raised_again_at_0830`,
      `publish_gate::defer_never_publishes_and_is_raised_again_the_next_morning`).
- [ ] The Secretary cannot answer the ticket under any delegation policy
      (`publish_gate::the_secretary_cannot_answer_under_any_delegation_policy`).
- [ ] `SendBack` restarts Draft with the revision incremented; `Autonomous` behaves as before;
      `ApproveMajor` asks unless a first draft scores 9 or above.
- [ ] A failed or timed-out standup raises `StandupFailed`; `Retry` requests the job again.
- [ ] `JobFailed` blocks a work item with the ticket its reason calls for.
- [ ] `DeployFailed` blocks the item and raises a ticket; `Retry` requests Publish again.
- [ ] The first escalation of an item defaults to Retry, later ones to Kill.
- [ ] A standup cannot commission beyond the work-in-progress limit or give a writer a second
      item; the proptests hold both invariants under random commands.
- [ ] `next_due_step` for a pending standup, draft and review; bubbles follow `Utterance`.
- [ ] A snapshot taken at the gate restores and re-issues nothing.
- [ ] Goldens are re-baselined once, natively, in wasm and in the runner fixture.

## Evidence

- `swarmpress/nextest` (`crates/sim-core/tests/publish_gate.rs`, `tests/golden.rs`, the plan
  invariants in `tests/invariants.rs`, `inbox::tests`)
- `net/nextest` (`client-wasm`: the gate and the failure commands through the JSON boundary)
- `swarmpress/wasm-bindgen-test` (the same golden hash under wasm32)
- `runner/bun-test` (`packages/runner/test/fixtures/golden.json`)
- `game/playwright-e2e` (`apps/game/e2e/mvp.spec.ts`: the approval answered in the Inbox)
