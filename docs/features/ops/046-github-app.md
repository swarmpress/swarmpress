---
id: FEAT-046
title: "GitHub App client and site repos"
status: planned
importance: critical
paths:
  - "crates/github/**"
  - "crates/testkit/src/fake_github*.rs"
  - crates/server/tests/binding.rs
  - crates/server/migrations/0004_site_binding.sql
  - scripts/run-local.sh
  - scripts/rebind-company.sh
  - .env.rehearsal.example
  - docs/runbooks/fork-rehearsal.md
adrs:
  - ADR-0009
  - ADR-0047
---

# GitHub App client and site repos

App auth (JWT → installation tokens), repo-from-template, contents/branches/PRs/checks via the Git
Data API, merges by the orchestrator.

Decisions: [ADR-0009](../../adr/0009-site-repo-canonical-github-app.md).

Player-owned repositories (ADR-0047, superseding the platform org of ADR-0009): the App is
installed on the player's own account or organisation, and the site repository (and the optional
state repository, FEAT-066) lives there. The server stores the installation link per company and
mints installation tokens scoped to that company's repositories. Rate limits and Actions minutes
are then per player. The platform org remains only as a sandbox for tests.

## What exists (increment G2: token mode on the owner's machine)

Before the App, the MVP runs the gateway in **token mode** (`SWARMPRESS_GITHUB=real`,
`GITHUB_TOKEN`) against a repository the owner names:

- **The binding is the server owner's.** `SWARMPRESS_DEFAULT_SITE_REPO` and
  `SWARMPRESS_DEFAULT_BASE_BRANCH` bind a new company (the game passes them explicitly when it
  founds the company, never from the URL); `PATCH /api/companies/me` rebinds one with the lease,
  refused while its pull requests are open or a deploy is pending, recorded as `SiteRebound`
  (FEAT-048 has the founding side).
- **The allow-list** `SWARMPRESS_ALLOWED_SITE_REPOS` is required in real mode and checked at
  creation, at a rebind and on every gateway call (403). Real mode also refuses simulated
  deploys, the fake seed, the article profile off and dev login off loopback at startup.
- **Single-origin run:** `scripts/run-local.sh` serves the built game from the server and prints
  which repository the company writes to; the game shows the binding on the boot screen and in
  the HUD.
- **The content path, live:** `crates/github/tests/live_repo.rs` runs the gateway's calls as one
  scenario against the fake on every run and against a sandbox repository when the owner asks
  (`SWARMPRESS_LIVE_REPO`, `GITHUB_TOKEN`; `#[ignore]`, refuses the live site). Not run against
  GitHub yet.
- **The rehearsal:** `docs/runbooks/fork-rehearsal.md` (a fork with Pages from Actions, the
  pinned workflow, the loop with the scripted model, the checks, the clean-up, the checklist for
  the first live article).

Not built: the App installation per player, the installation table, the owner check that a
player owns the repository a company is bound to (ADR-0047 decision 5). Until then the allow-list
is the guard. The token permissions (Contents and Pull requests read/write, Actions and Metadata
read) are from GitHub's documentation, unverified.

## Acceptance criteria

- [ ] FakeGitHub in-memory repos, PRs and checks drive agent tests.
- [ ] wiremock contract tests against recorded GitHub API responses.
- [ ] One commit per PR update (tree API), never one per file.
- [ ] An installation token is scoped to the company's own repositories and to nothing else.
- [ ] An uninstall or a revoked repository leaves the company playable and raises a ticket.

## Evidence

- `github/nextest`
- `server/nextest`
