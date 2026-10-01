# MVP: one article, end to end

The MVP is done when **one automated test and one manual run** both show
this loop working on the merged tree:

```
CEO logs in ─► company "cinqueterre.travel" founded (13 people, 1 project, plan seeded)
   │
   ▼  sim runs (server actor, 10 Hz) ◄────────── browser replica in lockstep (3D office, overlay UI)
09:00 project standup ──► RequestJob(Standup) ──► executor ──► transcript (utterances) + outcome
   │                                                          └─► plan: work item + brief + minutes post
   ▼
Draft phase  ──► RequestJob(Draft, writer=Giulia) ──► executor ──► page JSON
   │                 validate (content-model v2 + knowledge closed-world) ─ repair loop
   │                 GitHub: branch drafts/content-<id>, commit content/pages/blog/<slug>.json, PR
   │                 plan: handoff post, artifact post (PR)
   ▼
Review phase ──► RequestJob(Review, editor=Marco) ──► verdict {decision, score, notes}
   │                 plan: review post; score ≥ 7 → approve, else revise (≤3) / escalate (ticket)
   ▼
Publish ──► orchestrator squash-merges the PR ──► deployment_status webhook (or simulated)
   │                 ServerCommand::DeployLanded{work_item} → item published, KPIs, CEO feed
   ▼
CEO sees it: Plan board (item moved to Published, full thread), Inbox, Performance (tracker)
```

## Executors in the MVP

| Mode | Used by | LLM | GitHub |
|---|---|---|---|
| **test** (CI, deterministic) | `crates/server/tests/mvp_e2e.rs` | `FakeClaude` / scripted `FakeLlm` | `FakeGitHub` |
| **dev** (local manual run) | `SIMPRESS_MODE=dev` | Claude via `ANTHROPIC_*` env, or scripted fake when unset | Local file-backed `FakeGitHub`, or a sandbox repo when a token is configured |
| **live** | Production | Browser staff (ADR-0024), plus Agency (Claude) | GitHub App on the site repo |

## Contract between the sim and the orchestrator

- The sim emits `Effect::RequestJob { job_id, kind, project, work_item, staff[] }`
  (deterministic `job_id`), drained by the actor after each step.
  - `kind` is one of `standup | brief | draft | review | publish`.
- The orchestrator turns each effect into a `jobs` row (idempotency key
  `company:job_id`), runs it, writes plan text and artifacts, and feeds the
  result back as a `ServerCommand`:
  - `JobCompleted { job_id, digest }`;
  - `MeetingOutcome { meeting, briefs[] }`, which creates work items;
  - `DeployLanded { work_item }`.
- The sim owns every state transition; the orchestrator only reports
  outcomes (ADR-0011).

## Acceptance checklist

- [ ] `cargo nextest run --workspace` green, including `mvp_e2e`
- [ ] `pnpm -r test` and the Playwright smoke, visual and UI suites green
- [ ] `mvp_e2e`: standup → work item → draft PR with schema-valid page JSON
      → review ≥ 7 → merged → `DeployLanded` → item `published`, and the
      plan thread contains minutes, handoff, artifact, review and status
      posts in order
- [ ] Manual dev run: `docker compose up -d` (or `crates/server/scripts/test-pg.sh start`),
      `cargo run -p server`, `pnpm dev`; log in (dev login), watch the
      standup bubbles, see the item move across the Plan board, open the PR
      artifact
- [ ] `cockpit validate --strict` green, with MVP features linked to evidence
- [ ] Docs: getting started covers the dev run; CLAUDE.md is current
