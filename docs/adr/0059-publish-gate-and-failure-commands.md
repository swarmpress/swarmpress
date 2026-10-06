# ADR-0059 — The CEO publish gate, and failures the sim can see

**Status:** Accepted (amends ADR-0028 and ADR-0031); amended by ADR-0069 (unstarted planned items do not count against the WIP limit)
**Date:** 2026-10-02

## Context

The MVP publishes to a live site. Today nothing asks the CEO before a merge: an editor score at
or above the bar starts the Publish job. `AutonomyPolicy` is stored with the default
`ApproveAll` and is read nowhere.

Failures are invisible to the sim. A standup that fails returns no briefs and looks like a quiet
day. A deploy that fails or never lands leaves the item `Scheduled` forever. Missing media or a
missing page surface as a generic escalation. An escalation defaults to Kill after one game day,
which is twenty real minutes.

Detail: [`docs/design/mvp-pipeline.md`](../design/mvp-pipeline.md) sections 2, 5 and 7.

## Decision

1. **`AutonomyPolicy` is honoured.** After an editor approval:
   - `ApproveAll` (default): the item becomes `Approved`, Publish stays pending and a
     `PublishApproval` ticket is raised.
   - `ApproveMajor`: publish automatically only at score 9 or above with no revision; otherwise
     the ticket.
   - `Autonomous`: publish as today.
2. **The `PublishApproval` ticket** is High priority, so the Secretary never answers it. Options
   are Publish, SendBack, Kill and Defer. The default is Defer with a deadline of one game day:
   **the default never publishes.** A deferred item is parked and a fresh ticket is raised the
   next morning.
3. **Parked items count toward a work-in-progress limit.** An absent CEO stops new commissions;
   no work is lost.
4. **New server commands:** `JobFailed{job_id, reason}` (model, invalid output, needs media,
   needs page, timeout, cancelled, infrastructure) and `DeployFailed{work_item}`. They carry
   digests only (rule 2).
5. **New ticket kinds:** `StandupFailed`, `DeployFailed`, `NeedsMedia`, `NeedsPage`. A standup
   that fails or times out raises a ticket (rule 11). Each has a default and a deadline
   (rule 10).
6. **Escalation default:** the first escalation of an item defaults to Retry, later ones to
   Kill.
7. **Invariants:** one active draft per writer; open items never exceed the limit.
8. **Ticket handling dispatches on the ticket kind**, not on the option alone.
9. **Views, no state:** the next due step of pending work, meeting speaker timing and bubbles,
   and what each person is working on.

This changes the world encoding and default behaviour, so the golden hashes are re-baselined
once, deliberately. Increment S of `docs/mvp.md` implements it; U1 adds the ticket UI.

## Consequences

- Nothing reaches the live site without the owner's yes, until they choose otherwise.
- Every failure becomes something the player can see and answer.
- **Negative:**
  - One golden re-baseline, and the snapshot format constant is bumped with it.
  - With the default policy the company produces nothing while the CEO is away for more than the
    work-in-progress limit allows. That is intended for the MVP.
  - More ticket kinds for the Inbox to explain.
- **Alternatives rejected:**
  - *Branch protection on the site repository as the gate.* The merge then fails with a 405 and
    the job fails instead of waiting; the approval would also live outside the game.
  - *A default that publishes after the deadline.* It defeats the gate.
  - *Reusing the Approve and Reject options.* They carry project semantics in the current
    handler.
