# ADR-0052 — Spend requests, budgets and the CFO

**Status:** Accepted (amends ADR-0033; amends `docs/game-design/organization.md` §6–7 and `credits.md`)
**Date:** 2026-10-02

## Context

Managed resources cost real money (ADR-0044, ADR-0051). The commercial briefing wants every paid
operation to pass a structured spend request, strict budgets, and a CFO persona who owns real
infrastructure spending in the game. It also says: "The CFO persona reasons about money;
deterministic platform code controls money."

What the repo already decides:
- Rule 3 and ADR-0011: LLMs never drive state transitions.
- The CFO prompt (`crates/agents/prompts/cfo.md`): "You never change the books, approve
  spending, or make decisions; you inform them." A numbers validator
  (`crates/agents/src/jobs/numbers.rs`) rejects any number that is not in the job input,
  including currency conversions.
- ADR-0038: the browser sim can be forged, so a real limit enforced in the sim is no limit.
- Tickets (`crates/sim-core/src/inbox.rs`) have options, a `default_option` and a
  `deadline_step`. `amount_cents` and `FINANCIAL_DELEGATION_THRESHOLD_CENTS` are in-game money.
- ADR-0033 specified quote → hold → settle and an auto-approve threshold. None of it is built.

The briefing's "the CFO approves within delegated authority" contradicts the CFO prompt if the
model's judgement is the gate.

## Decision

1. **Placement of responsibilities.**

   | Responsibility | Where | Why |
   |---|---|---|
   | Price arithmetic | `crates/billing` (also wasm) | the browser shows estimates with the same code |
   | Estimator, policy, hard gate, ledger | `crates/server` | authoritative; the browser sim is forgeable |
   | Approval UI | a sim ticket in the browser | a mirror only; the host calls the central approve endpoint, never the sandbox |
   | Forecast | `crates/server` | deterministic integers |
   | Commentary | the CFO model | text only |

2. **Flow.**
   1. The sim emits `Effect::RequestJob`.
   2. The orchestrator asks central for a quote.
   3. Central policy answers: auto-approved, pending approval, or rejected.
   4. On approval, central places a hold at the maximum, executes, and settles the actual cost.
   5. A platform failure releases the hold.

   A spend request carries: company, department, category (`llm`, `runner`, `media-storage`,
   `media-processing`, `web`, `publishing`), optional work item and extension id, estimate and
   maximum in µ€, and an idempotency key.
3. **Estimates and holds for LLM jobs.**
   - Input tokens come from the token-counting endpoint.
   - The estimate uses the rolling median output per (job kind, model), seeded from config.
   - The maximum is exact input + `max_tokens` × output rate + `max_uses` × search price, summed
     over a fixed turn cap.
   - The server sets those caps on the API request, so the hold is a true upper bound.
4. **Central tables** (plain SQLite subset, integers only, ADR-0039 and ADR-0041):
   `price_versions`, `ledger_accounts`, `ledger_transactions`, `ledger_entries`,
   `wallet_balances`, `holds`, `spend_requests`, `spend_policies`, `dept_budgets`,
   `usage_counters`.
   - `wallet_balances` has `CHECK` constraints: no negative balance, held ≤ balance.
   - Σ entries = 0 per transaction is enforced in Rust inside `BEGIN IMMEDIATE` and by property
     tests. The server does not use triggers.
   - `ledger_transactions.idempotency_key` and `spend_requests.idempotency_key` are unique.
5. **Policy is data.** `spend_policies` holds, per company: monthly cap, daily cap, per-job
   maximum, auto-approve threshold and a mask of allowed categories. `dept_budgets` holds a
   monthly amount per department.
   - Only the balance and the company caps are security-relevant.
   - Department budgets are self-control: they shape tickets and reports, not the hard gate.
   - Budgets reset on wall-clock months, not game months.
6. **Department mapping.**
   - LLM and web spend: the requesting staff member's `Role::department()`.
   - Media storage and processing: Photo & Video.
   - Runner, publishing and extension polls: IT & Operations.
7. **The sim mirror.** Real-spend facts enter the sim only as integer server commands (rule 2):
   - `SpendApprovalRequested{request, category, department, project, work_item,
     estimate_micros, max_micros}`
   - `SpendResolved{request, outcome, actual_micros}`
   - `RealSpendDay{day, by_category, by_department, total_micros, journal_digest}`
   - `SpendPolicySet{…, version}`

   Balances stay out of the sim. Real amounts never touch the in-game `Ledger`, in-game cash,
   reputation or score.
8. **Tickets.** A new `TicketKind::SpendApproval`:
   - options Approve and Reject; **default Reject**; deadline one game day;
   - priority High, so the Secretary never answers it;
   - its own `real_micros` field. `amount_cents` and `FINANCIAL_DELEGATION_THRESHOLD_CENTS` are
     in-game values and do not apply.
   - Central keeps its own wall-clock expiry on the request and wins any disagreement with the
     sim.
9. **Unattended runs** (a runner with nobody at the screen).
   - Before leaving, the player grants a **mandate**: total cap, per-job cap, categories and
     expiry.
   - The runner session is itself a spend request whose hold bounds the run.
   - An over-threshold request never waits for a person. The ticket defaults to Reject and the
     work item falls back to the local queue for the player's return. Work is delayed, not lost.
10. **What the CFO model does.**
    - Writes the infrastructure spend report (a new job, `infra-spend-report`, with real figures
      only).
    - Writes a note attached to each approval ticket.
    - Writes a cost note when an extension is installed (ADR-0053).
    - Narrates a budget proposal that a deterministic allocator produced.
11. **What the CFO model does not do.**
    - It never approves, allocates or mutates anything.
    - "The CFO approves within delegated authority" means the deterministic policy engine,
      presented in the fiction as the CFO's standing limit.
    - Policy enforcement does not depend on a CFO being employed. Without a CFO the reports and
      notes are missing; the gate is not.
12. **Deterministic forecasts**, computed centrally as integers and handed to the CFO job:
    - month-end projection = month-to-date + trailing 7-day average × days remaining;
    - recurring commitments: storage, and extension polls at the declared cadence;
    - days of balance left = available ÷ trailing 7-day average.

    Each figure is supplied in both display forms (`spent_credits`, `spent_eur`), so the model
    never converts.
13. **Unit-tagged numbers validator.** `crates/agents/src/jobs/numbers.rs` gains unit tags: a
    currency symbol beside a number that the input supplied in another unit is an error fed back
    to the model. The two currencies never share one job input (ADR-0055).

Alternatives considered:
- **The CFO model approves spend.** Rejected. It contradicts rule 3, ADR-0011 and the CFO
  prompt, and web or extension content could then steer money through the model.
- **Enforce limits in the sim.** Rejected. The browser is forgeable (ADR-0038).
- **Reuse `amount_cents` and the €5,000 delegation threshold.** Rejected. Those are in-game
  values; mixing them is the confusion ADR-0033 exists to prevent.
- **Let an unattended run wait for approval.** Rejected. A run would hold a container and a
  lease while nobody answers.
- **A default of Approve on deadline.** Rejected. Real money defaults to the conservative
  option, like every other financial ticket.

## Consequences

- Positive: one central, auditable gate for every euro spent, with a true upper bound per job.
- Positive: the CFO becomes useful without becoming an attack surface.
- Positive: the existing ticket system, with defaults and deadlines, carries approvals. An absent
  player never stalls the company and never spends by accident.
- Positive: real spend is visible in the game through integer digests, and replay stays exact.
- Negative: every paid job needs a central round trip for a quote before it starts.
- Negative: two clocks. Central expiry is wall time; the ticket deadline is game time. Central
  wins, and the mirror can briefly disagree.
- Negative: new sim commands and a new ticket kind change the world hash; the goldens in
  `crates/sim-core` and `packages/runner/test/fixtures/golden.json` must be regenerated.
- Negative: department budgets look like limits but are not security. This must be explained in
  the UI.
- Negative: `organization.md` §6–7 and `credits.md` are stale on the CFO's jobs, on "the report
  mentions both currencies", and on the Secretary's delegation, which never covers real spend.
- Not built: all of it. No ledger, wallet, spend table, policy, ticket kind, server command or
  `infra-spend-report` job exists yet.
