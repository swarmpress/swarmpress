# Protocol (`crates/protocol`)

> **Local-first update ([ADR-0038](../adr/0038-local-first-the-browser-is-authoritative-for-a-company.md)):**
> lockstep frames and server-authoritative sync are retired. The browser is authoritative, and
> the central HTTP API (gateway, events, sync, lease) is listed in [docs/mvp.md](../mvp.md) and
> `crates/server/README.md`. The command and snapshot encodings below still apply.

The browser and the server talk over one WebSocket per tab, carrying **postcard-encoded
frames**, plus a small REST surface for large or rarely needed data. `PROTO_VERSION` (currently
`1`) bumps on any breaking change to frames or to the sim's command set.

Feature: FEAT-011 (frames), FEAT-012 (lockstep), FEAT-039 (browser job frames).
Decisions: [ADR-0003](../adr/0003-deterministic-lockstep-server-authority.md),
[ADR-0025](../adr/0025-browser-job-worker-protocol.md).

## Connection lifecycle

```
client                                   server
  │── WS upgrade (session cookie, Origin) ──►│
  │◄──────────── Hello{proto_version, server_version}
  │── Join{company_id, last_step?} ─────────►│
  │◄──────────── Snapshot{step, sim_version, world_bytes}
  │◄──────────── Commands{from_step, [(step, seq, Cmd)]} …   (continuous)
  │◄──────────── HashCheck{step, hash}                        (every 50 steps)
  │── ClientCommand{nonce, cmd} ────────────►│
  │◄──────────── Ack{nonce, scheduled_step} | Reject{nonce, reason}
  │── ResnapshotRequest{step, local_hash} ──►│   (on mismatch)
  │◄──────────── Snapshot{…}
```

- `Hello` is the only frame implemented today (`crates/protocol/src/lib.rs`, with a round-trip
  test).
- A client whose `proto_version` differs is closed with a `VersionMismatch` close reason, and the
  UI asks the player to reload.
- Commands are scheduled **at least 2 steps ahead** of the server's current step (200 ms), so
  every connected replica receives them before they are applied.

## Frames

| Direction | Frame | Purpose |
|---|---|---|
| S→C | `Hello{proto_version, server_version}` | Handshake |
| C→S | `Join{company_id, last_step: Option<u64>}` | Subscribe to a company. `last_step` allows a delta resume |
| S→C | `Snapshot{step, sim_version, world: Vec<u8>}` | The full world (postcard) |
| S→C | `Commands{from_step, cmds: Vec<(u64 step, u32 seq, Cmd)>}` | Lockstep stream |
| S→C | `HashCheck{step, hash: u64}` | Desync detection |
| C→S | `ClientCommand{nonce, cmd}` | Player input |
| S→C | `Ack{nonce, scheduled_step}` / `Reject{nonce, reason}` | Command outcome |
| C→S | `ResnapshotRequest{step, local_hash}` | Desync recovery |
| S→C | `JobOffer{job_id, kind, inputs_ref, schema_ref, min_tier, priority}` | Browser job available |
| C→S | `JobClaim{job_id}` | Claim |
| S→C | `JobLease{job_id, lease_until}` | Claim granted |
| C→S | `JobProgress{job_id, delta: String}` | Token deltas, which also renew the lease |
| S→C | `BubbleDelta{meeting, seq, delta}` | Streamed text for other tabs and viewers |
| C→S | `JobResult{job_id, artifact: Vec<u8>}` / `JobFailed{job_id, reason}` | Completion |

Postcard is compact and fast, and enum variants are encoded by index. **New variants are only
ever appended**, which keeps older decoders' variant numbering valid. Reordering is a breaking
change. `insta` snapshots of encoded frames make accidental changes visible in review.

## Lockstep and desync

- The client applies commands at exactly their step, then calls `tick()` on its wasm replica. It
  runs ahead only as far as the latest command batch allows, and renders interpolated between
  ticks.
- On a `HashCheck` mismatch, the client:
  1. freezes input;
  2. sends `ResnapshotRequest`;
  3. replaces its world from the next `Snapshot`.

  The server logs the desync with both hashes and the last 500 commands (a metric and an
  `ops_desyncs` row).
- On reconnect, if the server's log still covers `last_step`, it streams `Commands` from there.
  Otherwise it sends a fresh `Snapshot`.

## REST

| Method and path | Returns |
|---|---|
| `GET /auth/github/start`, `GET /auth/github/callback`, `POST /auth/logout` | OAuth flow ([ADR-0019](../adr/0019-auth-github-oauth-cookie-sessions.md)) |
| `GET /me` | Session user and their companies |
| `POST /companies` | Found a company (onboarding) |
| `GET /companies/:id/meetings/:mid/utterances/:seq` | One utterance's text (bubbles by reference) |
| `GET /companies/:id/tickets/:tid` | Ticket details and attachments (mood board, screenshots, preview link) |
| `GET /companies/:id/feed?before=` | Newsroom feed with transcript links |
| `GET /jobs/:id/inputs` | Browser job inputs (by reference from `JobOffer`) |
| `GET /config/models.toml` | Model registry for the client |
| `POST /webhooks/github` | GitHub webhooks (HMAC, dedupe) |
| `GET /leaderboard?ladder=weekly` | Verified leaderboard |

State-changing REST calls require the CSRF header.
