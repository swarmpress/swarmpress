---
id: FEAT-067
title: "Free-baseline quotas and usage counters"
status: planned
importance: high
paths:
  - crates/server/src/quota.rs
  - crates/server/src/db/quota.rs
  - crates/server/tests/quota.rs
  - crates/server/src/web.rs
  - crates/server/src/sync.rs
  - crates/server/src/gateway.rs
  - crates/server/src/tracker.rs
  - crates/server/src/config.rs
adrs:
  - ADR-0044
---

# Free-baseline quotas and usage counters

Increment B1. A player who runs everything locally still uses central resources. Coordination is
free within published quotas, counted per company per day in `usage_counters`:

| Resource | Starting quota (config) |
|---|---|
| Web fetch proxy | 500 requests and 200 MB per day |
| Sync storage | 500 MB per company |
| Gateway | 60 writes per hour, 20 merges per day |
| Tracker | 100,000 events per month per project, then deterministic 1-in-N sampling |
| SiteAudit | cached by deployed SHA; only companies active in the last 7 days |
| Managed storage | 1 GB |

Over quota, a route answers 429 with the quota name and reset time. A platform kill switch per
company exists for abuse.

Depends on: nothing.

## Acceptance criteria

- [ ] Each quota is enforced at its boundary and resets at the documented time.
- [ ] Tracker sampling above the quota scales counts with integers and is deterministic.
- [ ] The kill switch blocks gateway writes and leaves reads working.
- [ ] Quotas are configuration; defaults match the table.

## Evidence

- `server/nextest`
