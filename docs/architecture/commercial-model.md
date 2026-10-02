# Commercial model and managed architecture

> **Status: decided design, not built.** ADR-0044 to ADR-0055 record the decisions. Almost none
> of it exists in code yet; the build order is at the end. For what runs today, see
> [`overview.md`](overview.md) and [`../mvp.md`](../mvp.md).

swarm.press is a local-first management game whose simulated company produces a real website.
The game runs for free on the player's machine. The player pays only when swarm.press provides
real infrastructure on their behalf: cloud models, storage and delivery, web research services,
or running the company while they are away.

## 1. The principle and the free baseline

ADR: [0044](../adr/0044-commercial-principle-free-baseline-and-quotas.md)

There are three categories, not two:

| Category | Examples | Price |
|---|---|---|
| Local | sim, local models, extensions, drafting, previews, the player's own keys and runner | free |
| Coordination | sign-in, lease, publishing gateway, sync backup, events, web fetch proxy, tracker, audits | free within published quotas |
| Managed | cloud models, web research services, managed storage and delivery, hosted runner | metered |

Coordination is not free to provide, so it has quotas (starting values, all configuration):
web fetch 500 requests and 200 MB a day; sync 500 MB per company; gateway 60 writes an hour and
20 merges a day; tracker 100,000 events a month per project, then sampling; site audits cached
by deployed commit; 1 GB of managed storage.

swarm.press does not disable local capability to create paid features.

## 2. Executors, the lease and fencing

ADR: [0045](../adr/0045-executors-lease-epochs-and-fencing.md)

Exactly one executor is authoritative for a company at a time: a browser, a self-hosted runner
or a managed runner. One central row per company is the coordinator. It holds the holder, a
monotonic **epoch**, the head of the sealed command log, the next wake and the active run.

- Every write carries `epoch.lease_id`: gateway calls, log segments, snapshots, text packs, the
  job ledger and paid spend. A stale epoch is refused.
- A segment upload is a compare-and-swap on the log head, so two executors cannot both append
  from the same position. The sealed log wins; an orphaned local tail is discarded.
- Restore is central-first. Local state is used only if it matches the central head.
- A handover is graceful by default: the outgoing executor finishes its job, seals and
  releases. A forced takeover bumps the epoch.
- A central job ledger and memoised paid calls let a new executor adopt a finished job instead
  of running, and billing, it twice.
- A session that loses the lease stops its clock and goes read-only.

## 3. Durable backup and the state-repo mirror

ADR: [0046](../adr/0046-durable-backup-snapshots-text-packs-state-repo-mirror.md),
[0047](../adr/0047-player-owned-repositories.md)

A backup must restore a company with full fidelity on another device or runner. That takes
more than the command log:

```
manifest.json            scenario, seed, sim build, config, epoch, head, cursors, extensions
log/NNNNNN.json          immutable command-log segments
snap/<step>.bin          world snapshots (last three, plus one a week)
text/<gen>/NNNNNN.jsonl  changed rows of briefs, artifacts, transcripts, plan items and posts
```

The central service stays the primary backup, because only it can fence writes atomically. The
same tree is mirrored, server-side, to a private **state repository** that the player owns. The
player also owns the site repository: the GitHub App is installed on their account.

## 4. Executor time and continuity

ADR: [0048](../adr/0048-executor-time-and-continuity-shifts.md),
[0049](../adr/0049-managed-infrastructure-single-binary-control-plane-cloudflare-data-plane.md)

Game time advances only while an executor works the company.

- **Away with no runner:** the day may finish, then the company rests. On return it resumes
  where it stopped. No payroll is burned for absent days and no real work happens.
- **Away with a runner:** the runner works bounded shifts of one game day. It advances to the
  first job, holds the clock while each job runs, stops at 22:00, seals and snapshots. The
  player sets the pace: at most K game days per real day and C credits.
- Real-world triggers, such as a deploy landing or a scheduled publication, wake a shift. They
  are not sim time.
- The log records only `(seq, step, command)`, so any host replays it to the same hash.

The runner is the existing headless host, with the same wasm sim, orchestrator and QuickJS
sandbox as the browser. **Self-hosted continuity ships first**; the managed runner follows.

The control plane stays one Rust binary with SQLite. Cloudflare provides the data and compute
plane only: R2, delivery, and containers to host managed runs.

## 5. Money

ADR: [0051](../adr/0051-ledger-unit-pricing-buckets-and-top-ups.md),
[0052](../adr/0052-spend-requests-budgets-and-the-cfo.md)

- **Price:** published list cost × uplift (30% to start), per price version.
- **Unit:** the ledger is in integer micro-euros and settles exactly. The display unit is the
  credit: 1 credit = €0.001. There is no per-job rounding to a cent.
- **Balance:** prepaid. Two buckets per player: promotional (expires, spent first, not for
  recurring charges) and paid. Credits are granted on the net-of-VAT amount of a top-up.
  Real-money purchases stay off until the tax and legal questions are answered.
- **Flow:** quote → policy → hold at a true maximum → execute → settle the actual cost.
- **Control is central and deterministic.** Budgets, thresholds and the hard gate live in the
  central service, because a browser sim can be modified. The sim receives integer digests of
  real spend for display and tickets; balances never enter it.
- **Approval:** a request over the auto-approve threshold becomes a ticket with default Reject.
  For an unattended run the player grants a mandate in advance; anything beyond it waits for
  their return.
- **The CFO** writes the spend report, notes on approval tickets and extension cost notes, from
  numbers that deterministic code supplies. The CFO never approves, allocates or converts
  currencies.

## 6. Binary assets

ADR: [0050](../adr/0050-binary-assets-content-addressed-object-storage.md)

Bytes live in object storage under content-addressed, per-company keys. Each asset has a
sidecar in the site repo at `content/media/{id}.json`. The browser hashes the file, makes the
variants and uploads straight to storage with a short-lived presigned URL. The gateway refuses
to merge a page whose assets are missing, and promotes staged assets to the public namespace
before merging. External URLs and a player's own bucket remain the free path.

## 7. Extensions

ADR: [0053](../adr/0053-extension-placement-and-limits.md)

The manifest declares where an extension may run (`runtime.placement`) and hard `limits`. The
platform derives a cost ceiling from the limits and measures actual spend. Installing an
extension that needs managed resources raises a ticket. A runner never substitutes a cloud
model for a local tier without the player's mandate.

## 8. Bring your own

ADR: [0054](../adr/0054-byo-infrastructure-and-player-held-secrets.md)

A player may use their own model key in the browser, their own bucket and their own runner. The
browser never holds platform credentials, but a player may hold their own provider credentials
on their own device. Real revenue figures are self-reported or imported read-only; swarm.press
never holds or routes revenue.

## 9. Leagues and the in-game currency

ADR: [0055](../adr/0055-leagues-and-the-in-game-currency-symbol.md)

Continuity produces real work while the player is away, which raises real audience. The
leaderboard therefore has separate leagues: companies that ran only on the player's own
machine, and companies that used continuity or managed spend. The league is decided from facts
the server holds.

In-game cash gets its own symbol. The euro sign means real money only, and the Finance panel
has two tabs: the company's game books, and real money.

## Source of truth

| Data | Canonical location |
|---|---|
| Live company state | browser store (Turso/SQLite on OPFS), or the runner's store during a run |
| Simulation history | command log |
| Durable company backup | central sync, mirrored to the player's private state repository |
| Published content, theme, site config | site repository (player-owned) |
| Asset metadata | sidecars in the site repository |
| Asset bytes | object storage |
| Lease, epoch, log head, job ledger | central SQLite |
| Billing ledger, budgets, spend policy | central SQLite |
| Deployment status | GitHub, observed through webhooks |
| Financial commentary | the CFO persona |

## Build order

Each increment is shippable and carries its own test evidence. Everything before B10 can be
validated with promotional credits only.

**Track A — runtime**

| # | Increment |
|---|---|
| A1 | Epoch lease; a session halts on loss |
| A2 | Head compare-and-swap, fenced sync, central-first restore |
| A3 | World snapshot and pending-job re-issue |
| A4 | Text packs, job ledger, post dedupe |
| A5 | Extract the shared host package |
| A6 | Self-hosted continuity runner |
| A7 | Model proxy and memo cache |
| A8 | Coordinator and managed runs |
| A9 | State-repository mirror |

**Track B — money**

| # | Increment |
|---|---|
| B1 | Free-tier quotas |
| B2 | Pricing crate and price table v2 |
| B3 | Ledger with promotional credits |
| B4 | Spend gate, with web research as the first paid service |
| B5 | Cloud model jobs |
| B6 | Sim mirror of real spend |
| B7 | Finance panel and the in-game currency symbol |
| B8 | CFO jobs and the unit-tagged numbers validator |
| B9 | Extension limits and the install flow |
| B10 | Real-money purchase, after legal sign-off |

**Track C — assets and BYO**

| # | Increment |
|---|---|
| C1 | Assets, starting with a filesystem object store |
| C2 | Player-held key and external storage |
| C3 | Self-reported profit and loss |
