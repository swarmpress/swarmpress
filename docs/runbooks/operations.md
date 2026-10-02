# Runbook: operations

How to run, observe and recover a SimPress deployment. Most of this describes the M2–M9 server.
At M0 there is no server in production.

## Topology

| Piece | Runs as | State |
|---|---|---|
| `server` | one Rust binary (axum + tokio), **one process** (ADR-0039): the central role only, since companies run in the browser (ADR-0038) | SQLite + `SIMPRESS_DATA_DIR` |
| SQLite | embedded, WAL, one file (`data/simpress.db`); one writer connection, parallel readers | users, sessions, companies, leases, event inbox, gateway PRs, webhook deliveries, sync index, tracker |
| Sync blobs | files under `SIMPRESS_DATA_DIR/sync/{company}/` (object storage later) | command-log segments, latest snapshot per company |
| Static client | `apps/game/dist` on a CDN | — |
| Assets | `assets/out` on a CDN (KTX2/glTF), model shards from Hugging Face or a mirror | — |
| Site repos | GitHub (platform org), GitHub Pages | content |

## Configuration

| Variable | Notes |
|---|---|
| `DATABASE_URL` | default `sqlite://data/simpress.db?mode=rwc` |
| `SIMPRESS_DATA_DIR` | sync blobs; default `./data` |
| `SIMPRESS_DEV_AUTH` | `1` enables `POST /auth/dev/login`. **Never in production** |
| `SIMPRESS_GITHUB` | `fake` = in-memory FakeGitHub for the content gateway; anything else = real GitHub |
| `GITHUB_TOKEN` or `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY_PATH` | content gateway credentials. Missing → gateway answers 503 |
| `GITHUB_WEBHOOK_SECRET` | `POST /webhooks/github` (`deployment_status` → `DeployLanded`) |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | OAuth sign-in |
| `GITHUB_SITES_ORG` | owner of default site repos (`{org}/{login}-site`) |
| `SIMPRESS_SIMULATE_DEPLOY` | emit `DeployLanded` right after a gateway merge (default on with the fake GitHub) |
| `SIMPRESS_LEASE_SECS` | company lease length, default 90 |
| `RUST_LOG` | e.g. `info,simpress_server=debug` |

See `.env.example` for the full list (tracker, web fetch limits).

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

- SQLite is replicated continuously with Litestream (or a periodic `VACUUM INTO`) to object
  storage (ADR-0039). The sync blob directory is backed up alongside it.
- A company restores from its synced snapshot plus its command-log segments
  (`/api/sync/{company}/…`). Site content is in git, so nothing content-related lives only on
  the server.
- Company data that never leaves the browser (plan text, transcripts) is protected by the
  browser's persistent storage plus central sync (ADR-0038).

## Load and capacity

- Target: **200 active companies per core** at 10 Hz, with idle companies fast-forwarded on wake
  ([ADR-0020](../adr/0020-real-time-ticks-offline-catch-up.md)).
- The load test binary (`cargo run -p server --bin loadtest -- --companies 200 --hours 1`)
  produces `artifacts/bench/server-load.json` (`bench/server-load` in Cockpit).

## cinqueterre.travel

See the [cutover runbook](cinqueterre-cutover.md). Until step 0 lands, **any change to swarmpress
`main` is a production change for cinqueterre.travel**.
