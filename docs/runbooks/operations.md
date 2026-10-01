# Runbook: operations

How to run, observe and recover a SimPress deployment. Most of this describes the M2–M9 server.
At M0 there is no server in production.

## Topology

| Piece | Runs as | State |
|---|---|---|
| `server` | one Rust binary (axum + tokio); several replicas possible, company actors partitioned by `company_id` advisory lock | Postgres |
| Postgres | managed instance (≥ 14) | command logs, snapshots, jobs, sessions, transcripts, `llm_calls` |
| Static client | `apps/game/dist` on a CDN | — |
| Assets | `assets/out` on a CDN (KTX2/glTF), model shards from Hugging Face or a mirror | — |
| Site repos | GitHub (platform org), GitHub Pages | content |

## Configuration

| Variable | Notes |
|---|---|
| `DATABASE_URL` | required |
| `ANTHROPIC_API_KEY` | Agency jobs. Missing → Claude jobs fail loudly (ticket), browser jobs unaffected |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | repo access, webhooks |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | OAuth sign-in |
| `PLATFORM_ORG` | org for new site repos |
| `SESSION_SECRET` | cookie signing; rotating it logs everyone out |
| `SIM_DAY_REAL_MINUTES` | 60 on live servers; a world constant (changing it needs a migration) |
| `RUST_LOG` | e.g. `info,server=debug` |

`config/roles.toml`, `config/models.toml`, `config/economy.toml`, `config/events.ron` and
`config/rooms.ron` are loaded at start-up. A change to economy, event or room data alters sim
behaviour, so it is versioned with the sim version.

## Health signals

| Metric | Healthy | Alert |
|---|---|---|
| `sim_step_lag_ms` (per active company) | < 100 | p99 > 500 for 5 min |
| `ws_desyncs_total` | 0 | any increase. Investigate, since it means a determinism bug |
| `jobs_ready` (queue depth) by executor | drains | growing for 30 min with workers connected |
| `jobs_failed_total{reason}` | low | refusal or schema-failure spikes |
| `llm_calls` cost per company per day | — | daily report (no cap by design) |
| `webhook_signature_failures_total` | 0 | any |
| `site_audit_last_success` per company | < 26 h | > 26 h |
| `deploys_failed` per company | 0 | 3 in a row → deploy outage event fired |

Logs are structured `tracing` JSON, with `company_id`, `job_id`, `step` and `meeting_id` fields.

## Common incidents

### Desync reported

1. Clients self-heal by resnapshotting, so there is no player action.
2. Pull the desync record (`ops_desyncs`): both hashes, the step, and the last 500 commands.
3. Replay locally:
   `cargo run -p xtask -- replay --company <id> --to-step <n> --native --wasm` (planned). Diff the
   two worlds.
4. The fix is a determinism bug in `sim-core`. Add the replay as a golden test.

### Job queue stuck

1. Check the jobs: `SELECT kind, executor, state, count(*) FROM jobs GROUP BY 1,2,3;`
2. Expired leases are re-queued automatically. Jobs stuck in `claimed` past `lease_until + 60 s`
   mean the re-queue loop is down. Check the server logs for `jobs::reaper`.
3. A poison job (`attempts >= max`) is marked failed and opens a ticket. Never delete jobs by hand:
   the idempotency keys protect the site repos.

### Claude outage or rate limits

- The client retries with jitter on 429, 529 and `overloaded_error`. Beyond the retry budget, jobs
  re-queue with backoff.
- `BrowserThenClaude` jobs continue in browsers. Pure `Claude` jobs (research, design, escalations)
  wait.
- In the game, Agency visitors "are delayed". No player action is needed.

### GitHub outage or a webhook backlog

- GitHub redelivers webhooks. Deliveries are deduplicated by `X-GitHub-Delivery`.
- After an outage, run the reconciler (planned `xtask reconcile-prs`): it compares open PRs and the
  latest deployments per company with sim state, and injects any missing `DeployLanded` commands.

### A site's deploys failing

1. The `deployment_status` webhook reports failures. After 24 h, the sim fires a deploy outage
   event.
2. Inspect the site repo's Actions run. A theme change is the likely cause. The post-deploy smoke
   job opens a revert PR automatically, and the orchestrator merges it per policy.
3. If the kit itself is broken, publish a patch release of `@swarm-press/site-kit` and open
   kit-bump PRs.

## Backups and restore

- Postgres point-in-time recovery, with daily snapshots retained for 30 days.
- A company restores to any day boundary from its snapshot plus its command log. Site content is in
  git, so nothing content-related lives only in Postgres.
- Transcripts and `llm_calls` live in Postgres and follow the database's backup policy.

## Load and capacity

- Target: **200 active companies per core** at 10 Hz, with idle companies fast-forwarded on wake
  ([ADR-0020](../adr/0020-real-time-ticks-offline-catch-up.md)).
- The load test binary (`cargo run -p server --bin loadtest -- --companies 200 --hours 1`)
  produces `artifacts/bench/server-load.json` (`bench/server-load` in Cockpit).

## cinqueterre.travel

See the [cutover runbook](cinqueterre-cutover.md). Until step 0 lands, **any change to swarmpress
`main` is a production change for cinqueterre.travel**.
