# swarmpress-server

The central swarm.press server in the local-first architecture
([ADR-0038](../../docs/adr/0038-local-first-the-browser-is-authoritative-for-a-company.md)):
the company itself (sim, plan, orchestrator, local LLM staff) runs in the
player's browser, and this server keeps only what must be shared, secret or
trusted: accounts, the company row and its device lease, the content gateway
to GitHub, the offline event inbox, sync blobs, the web fetch proxy and the
analytics tracker. One binary, one process, embedded SQLite
([ADR-0039](../../docs/adr/0039-sqlite-is-the-central-database.md)).

## Run

```bash
cp .env.example .env && set -a && . ./.env && set +a
cargo run -p server --bin swarmpress-server
```

`DATABASE_URL` defaults to `sqlite://data/swarmpress.db?mode=rwc`; the file and
its directory are created on first start and `migrations/` run at startup.
Sync blobs go under `SWARMPRESS_DATA_DIR` (default `./data`). For local
development set `SWARMPRESS_DEV_AUTH=1` and `SWARMPRESS_GITHUB=fake` (both are in
`.env.example`).

The built game on the server's own origin (increment G2), with the
prerequisites and the binding checked and printed first:

```bash
scripts/run-local.sh --build            # pnpm build, then the server serving apps/game/dist
open 'http://localhost:8080/?central=1&llm=fake&ff=09:00'
scripts/run-local.sh --check            # start, check COOP/COEP + SPA fallback + API, stop
```

### Token mode (the MVP: a real repository from the owner's machine)

`SWARMPRESS_GITHUB=real` with `GITHUB_TOKEN` writes to GitHub with that token.
The server refuses to start in real mode without `SWARMPRESS_ALLOWED_SITE_REPOS`,
with `SWARMPRESS_SIMULATE_DEPLOY`, `SWARMPRESS_FAKE_SITE` or
`SWARMPRESS_ARTICLE_PROFILE=off`, and with `SWARMPRESS_DEV_AUTH=1` on a bind
address that is not loopback. `.env.rehearsal.example` holds a complete
configuration; `docs/runbooks/fork-rehearsal.md` walks through a rehearsal on a
fork.

The token: a fine-grained personal access token whose repository access is the
site repository only, with **Contents: read and write** (draft branches, page
commits, the Merges API, branch deletion, the repository tarball for the
knowledge pack), **Pull requests: read and write** (open, merge, close),
**Actions: read** (the deploy poller's check runs; **Actions: read and write**
for `POST /api/gateway/redeploy`, which re-runs a failed deploy workflow run)
and **Metadata: read** (always included). These are taken from GitHub's documentation and have not
been verified against the API by this project; a 403 in the server log names
the call that needs more. Whether the check-runs endpoint the poller reads is
covered by Actions: read for a fine-grained token is the least certain of
them: if the poller logs 403, merges stay `pending` and time out.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite://data/swarmpress.db?mode=rwc` | `sqlite::memory:` works for throwaway runs |
| `SWARMPRESS_DATA_DIR` | `data` | sync blobs (`sync/{company}/log/*.bin`, `snapshot.bin`) |
| `SWARMPRESS_BIND` | `127.0.0.1:8080` | |
| `SWARMPRESS_PUBLIC_URL` | `http://localhost:<bind port>` | the origin players open: OAuth redirect base; `https` makes cookies `Secure`. The server serves the built game itself, so this is its own address; set `http://localhost:5173` for GitHub sign-in through `pnpm dev` |
| `SWARMPRESS_STATIC_DIR` | `apps/game/dist` | built client served at `/` (empty = off) |
| `SWARMPRESS_SESSION_TTL_SECS` | 2592000 | |
| `SWARMPRESS_DEV_AUTH` | off | `1` enables `POST /auth/dev/login`. Never in production. With a real GitHub a startup error unless `SWARMPRESS_BIND` is a loopback address |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | | GitHub sign-in (`GITHUB_OAUTH_AUTHORIZE_URL`, `GITHUB_OAUTH_TOKEN_URL`, `GITHUB_API_URL` override endpoints) |
| `SWARMPRESS_GITHUB` | real | `fake` = in-memory `github::FakeGitHub` (repos created on demand; state is lost on restart). Unset or `real` needs `SWARMPRESS_ALLOWED_SITE_REPOS` |
| `SWARMPRESS_DEFAULT_SITE_REPO` | | `owner/name` a new company is bound to (the game passes it explicitly when it founds the company, from `GET /api/me`'s `default_binding`). Without it `{GITHUB_SITES_ORG}/{login}-site`. A startup error when malformed or not on the allow-list |
| `SWARMPRESS_DEFAULT_BASE_BRANCH` | `main` | base branch of a new company's binding |
| `SWARMPRESS_ALLOWED_SITE_REPOS` | | comma-separated `owner/name` (compared without case): the only repositories a company may be bound to (creation, rebind: 403) or the gateway may touch (draft, merge, close, knowledge: 403, checked on every call). Required with a real GitHub (a startup error when empty or malformed); empty with the fake = any |
| `SWARMPRESS_FAKE_SITE` | | a directory: every site repo the fake creates on demand starts with its files (all text files under it, at their paths relative to it; hidden entries left out), so the knowledge pack is a real site's. `apps/game/e2e/central-server.mjs` sets it to `crates/knowledge/tests/fixtures/cinqueterre-mini`. Without it a fake repo holds a `README.md` only (an empty pack). A startup error with a real GitHub |
| `GITHUB_TOKEN` | | real gateway with a static token (token mode, above: the permissions it needs) |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH` | | real gateway as the GitHub App (installation per repo). Without a token or App, gateway calls answer 503 |
| `GITHUB_SITES_ORG` | `swarmpress-sites` | owner of the default site repo `{org}/{login}-site` when `SWARMPRESS_DEFAULT_SITE_REPO` is unset |
| `GITHUB_WEBHOOK_SECRET` | | `POST /webhooks/github` (503 when unset) |
| `SWARMPRESS_SIMULATE_DEPLOY` | on with `fake`, else off | emit `DeployLanded` right after a gateway merge. A startup error with a real GitHub: it would report every merge as live |
| `SWARMPRESS_DEPLOY_POLL_SECS` | 30 | deploy poller interval (real GitHub only; at least 5) |
| `SWARMPRESS_DEPLOY_POLL_MAX_AGE_SECS` | 3600 | a merge still pending this long after it was merged fails as `timed_out` and is no longer asked about (at least 60) |
| `SWARMPRESS_DEPLOY_POLL_BATCH` | 20 | most merges asked about per repository and round, the newest (1 to 100) |
| `SWARMPRESS_DEPLOY_CHECK` | `deploy` | name of the check run (the workflow job) whose success means the site is live |
| `SWARMPRESS_DEPLOY_WORKFLOW` | `deploy.yml` | file name of the site's deploy workflow, whose failed run `POST /api/gateway/redeploy` re-runs |
| `SWARMPRESS_ARTICLE_PROFILE` | `enforce` | the article profile on drafts under `content/pages/blog/`. `off` is for scripted runs that write articles outside the profile (the staged orchestrator no longer needs it; the e2e suites run with the profile on): it is accepted only with `SWARMPRESS_GITHUB=fake` (a startup error otherwise), and the site checks (create-only path, one open pull request per path) stay on. With the profile off the closed-world check (links and media against the knowledge pack) is off too: the scripted runs write articles outside the site's indexes |
| `SWARMPRESS_STAFF_EMAIL_DOMAIN` | `staff.swarm.press` | mail domain of the git author addresses synthesised for staff personas (`<staff>+<company>@<domain>`); a host name. Choose it before the first live merge: the site's history is not rewritten |
| `SWARMPRESS_LEASE_SECS` | 90 | company lease length |
| `SWARMPRESS_SYNC_MAX_BYTES` | 67108864 | largest sync upload |
| `SWARMPRESS_WEB_FETCH_RATE_PER_MIN`, `SWARMPRESS_WEB_FETCH_BURST` | 30, 10 | per-user token bucket for `/web/fetch` |
| `OPENAI_API_KEY` | unset | hosted inference (ADR-0067); without it `/api/llm/generate` answers 503 |
| `OPENAI_BASE_URL`, `SWARMPRESS_LLM_MODEL` | `https://api.openai.com`, `gpt-6-luna` | provider and model |
| `LUNA_DAILY_BUDGET_USD` | 2 | spending cap per company and UTC day; past it, 429 |
| `SWARMPRESS_LLM_TIMEOUT_SECS` | 600 | one provider call |
| `SWARMPRESS_TRACKER_*` | | see `.env.example` |
| `RUST_LOG` | `info,sqlx=warn` | |

## Routes

| Route | Notes |
|---|---|
| `GET /healthz` | `{"status":"ok"}`, or 503 when the database is unavailable |
| `GET /auth/github/login`, `GET /auth/github/callback` | GitHub OAuth web flow (state cookie, code exchange, `/user`), sets `swarmpress_session` (HttpOnly, SameSite=Lax, Secure on https) |
| `POST /auth/dev/login` | `{login}` (1–39 of `[A-Za-z0-9_-]`) creates or fetches the dev user and signs in; 404 unless `SWARMPRESS_DEV_AUTH=1` |
| `POST /auth/logout` | deletes the session, clears the cookie |
| `GET /api/me` | `{user, company, default_binding: {site_repo, base_branch}}`; 401 without a session. `default_binding` is what a new company of this user gets (`SWARMPRESS_DEFAULT_SITE_REPO`, `SWARMPRESS_DEFAULT_BASE_BRANCH`) |
| `POST /api/companies` | `{name, site_repo?, base_branch?}` → 201 company; 409 when the caller already owns one. Without `site_repo`/`base_branch` the default binding; 400 for a malformed repository or branch, 403 for a repository outside `SWARMPRESS_ALLOWED_SITE_REPOS`. The game sends the default binding explicitly |
| `GET /api/companies/me` | the caller's company, or 404 |
| `PATCH /api/companies/me` | `{site_repo?, base_branch?}` (at least one; a missing one keeps its value) → the rebound company. Lease required (428, 409 when stale). 400 malformed, 403 outside the allow-list, 409 while a gateway pull request of the company is open (merge it or `POST /api/gateway/close`) or a merge's deploy is `pending`. A change of repository retires the company's settled gateway pull requests to `gateway_prs_retired` (numbers are only unique per repository). Recorded in the inbox as `SiteRebound {from, to, by, epoch, retired}` in the same transaction; the same binding again answers 200 and records nothing. `scripts/rebind-company.sh` does the sign-in, lease and release around it. Nothing checks yet that the player owns the repository (ADR-0047's installation check is a later increment): the allow-list is the guard |
| `POST /api/companies/{id}/lease` | `{device_id, mode?, kind?}` → `{epoch, lease_id, token, holder, holder_kind, ttl_ms, renewed, handover_requested, handover_by, head}` (ADR-0045). `mode`: `acquire` (default; a free, expired, released or own lease, epoch + 1), `renew` (with `x-swarmpress-lease`; epoch unchanged, works past expiry if nobody took the lease), `request` (as `acquire`, and a 409 records a handover request and publishes `HandoverRequested`), `force` (takeover, epoch + 1, publishes `LeaseRevoked`). Another executor's unexpired lease answers 409 `{error, epoch, holder, holder_kind, ttl_ms, handover_requested}`. `kind`: `browser` (default) or `self`. The epoch is never reset |
| `DELETE /api/companies/{id}/lease` | with `x-swarmpress-lease`: release (204), 409 if not held. The epoch stays |
| `x-swarmpress-lease` | the fencing token `<epoch>.<lease_id>` (the lease reply's `token`). A fenced route answers 428 without it and 409 when the epoch or the lease id is not the company's current, unexpired one. A lease grant and every fenced write hold a per-company mutex, so a takeover waits for an in-flight write to be recorded |
| `POST /api/gateway/draft` | lease required. `{content_id, path, page, message, work_item?, attribution?}` → `{number, branch, head_sha, created_pr, committed}`. An article (`content/pages/blog/*.json`) that breaks the schema or the article profile answers 422 `{error, issues: [..]}`; a path that exists on the base branch, a second open pull request for the path, or a second path for the content id answers 409 |
| `POST /api/gateway/merge` | lease required. `{number, head_sha, attribution?}` → `{merged_sha, finalized?}`; only PRs this company opened through the gateway; 409 if the head moved or the PR was closed. An article is finalised in the same pull request first (see "Finalise on merge") and the reply carries `finalized: {index: "added" \| "present" \| "absent" \| "skipped"}`. The merge is then `pending` until its deployment is observed |
| `POST /api/gateway/close` | lease required. `{number}` → `{number, closed: true, already_closed, branch_deleted}`: close a pull request this company opened through the gateway, without merging, and delete its `drafts/` branch (for cancelled work). 404 for any other pull request, 409 for a merged one. Idempotent: closing again answers `already_closed: true` and calls nothing; a close that failed half-way is completed by the next one |
| `GET /api/gateway/knowledge` | lease required (428 without the header, 409 with a stale one), like draft and merge. The knowledge pack (ADR-0061) of the site at the head of the company's base branch: 200 with the pack JSON `{commit, files, manifest, pages}` (`Content-Type: application/json`), `ETag: "<head sha>"` and `Cache-Control: no-cache`; 304 with the same `ETag` and `Cache-Control` and no body when `If-None-Match` names the head (weak, listed or `*` too). 404 when the base branch does not exist, 413 when the site is over the snapshot caps (`GitHubError::TooLarge`), 502 when a carried file is broken (an index that is not JSON) or GitHub fails. See "Knowledge pack" |
| `POST /api/gateway/redeploy` | lease required. `{number}` (or `{work_item}`: its newest pull request) → `{number, work_item, state, requested, run_id, run_attempt, attempt, detail}`. Deploys a merge whose deployment `failed` again: re-runs the failed jobs of the newest run of the deploy workflow (`SWARMPRESS_DEPLOY_WORKFLOW`) on the commit whose deployment failed; the merge is `pending` again from now. A merge already `pending` answers 200 with `requested: false` and asks GitHub nothing (idempotent per failed run attempt). 409 for a merge that landed, a pull request that is not merged, or a commit with no run of the deploy workflow; 403 when GitHub refuses the re-run (it then stays `failed`). See "Redeploy" |
| `GET /api/gateway/deploy-status?number=` (or `?work_item=`) | session required, no lease. What became of one of the company's gateway pull requests: `{number, content_id, work_item, path, state, merged_sha, merged_at, landed_at, closed_at, detail, checked_at, now}` with `state` one of `open`, `closed`, `pending`, `landed`, `failed`, `unknown`. Instants are unix ms on the server's clock (`now`). Reads the record only. 400 unless exactly one key is given, 404 for an unknown pull request |
| `GET /api/events?after=&limit=` | `{events: [{seq, company_id, kind, payload, created_at}], last_seq}` (oldest first, max 500) |
| `GET /ws/events?after=` | WebSocket (cookie auth): backlog after `after`, then live events, one JSON text frame each |
| `POST /webhooks/github` | HMAC-verified (`X-Hub-Signature-256`), deduped by `X-GitHub-Delivery`. `deployment_status` of a commit the gateway merged: success lands every gateway pull request of the repository merged at or before it (`DeployLanded` each), failure/error fails that pull request (`DeployFailed`). A deployment of any other commit is reported, unmapped, to every company bound to the repo. See "Deploy observation" |
| `PUT /api/sync/{company}/log/{segment}` | raw bytes; 201 stored, 200 identical, 409 different bytes (immutable) |
| `GET /api/sync/{company}/log/{segment}` | the bytes (`x-swarmpress-sha256`) |
| `GET /api/sync/{company}/log` | `{segments: [{segment, sha256, size, created_at}]}` |
| `PUT /api/sync/{company}/snapshot` | raw bytes, `x-swarmpress-step` required; replaces the latest snapshot |
| `GET /api/sync/{company}/snapshot` | the bytes with `x-swarmpress-step` and `x-swarmpress-sha256`; 404 before the first |
| `POST /api/llm/generate` (lease) | `{messages, kind?, max_output_tokens?, reasoning_effort?, service_tier?: flex\|default, json_schema?}` → `{job_id, text, finish: stop\|length, service_tier, usage, cost_micros, duration_ms}`; 429 past the daily budget, 503 without a key or credits (FEAT-086) |
| `GET /web/fetch?url=` | `{url, status, content_type, text}`; see below |
| `POST /web/request` | signed in. The fetch proxy for a site's tools (ADR-0076: an n8n HTTP Request node): `{url, method?, headers?, body?}` with GET, HEAD, POST, PUT, PATCH, DELETE or OPTIONS and a body of at most 256 KiB (413); `Host`, `Cookie`, hop-by-hop and `X-SwarmPress-Credential` headers are dropped; redirects are followed (re-checked) for GET and HEAD only; the same SSRF guard, rate limit, size cap and content types as `/web/fetch` (an empty body passes); `{url, status, content_type, headers, body}` with the body raw (no HTML reduction) |
| `POST /web/firecrawl/{*rest}` | 501 `{"error":"firecrawl requires credits (wave 3)"}` |
| `GET/POST /api/projects` | the company's publications; `POST {simProjectId, slug, name, domain?, repo?}` mints a public `trackerKey` |
| `GET /api/analytics?project=&days=` | Performance panel data (ADR-0032) |
| `GET /api/analytics/signals` | lease required. The company's pending analytics signals, oldest first, as the sim's `AnalyticsSignals` takes them (the digest as decimal text) plus `project_key` and `day` for the ack (ADR-0071) |
| `POST /api/analytics/signals/ack` | lease required. `{rows: [{project_key, day}]}`: the rows the host logged are applied; rows of other companies are ignored |
| `GET /api/analytics/page?path=&from=` | lease required. One page's page views, sessions, average engaged time, 75%-scroll count and days since `from`, with the project's per-page median (ADR-0071) |
| `GET /api/site/audit` | lease required. The audit of the site at the base head (ADR-0070): the `SiteSignals` fields, broken links per page, orphans, stale articles (over 90 days by the server's day), linking-policy findings; cached per commit; `ETag: "<commit>-<day>"`, 304 on `If-None-Match` |
| `GET /api/site/blueprint` | lease required. The site's semantic models at the base head (ADR-0072): `blueprint/site.json` with its types, or one imported from the pages without a model (`source: "imported"`); its tools with their checker issues and derived manifests; the checker's issues; the brick town (`swarmpress.design.v1`) with slots that have issues marked; cached per commit; `ETag: "<commit>"`, 304 on `If-None-Match` |
| `PUT /api/site/blueprint` | lease required. A change of the site's structure (ADR-0072): `{blueprint?, types?, base_hash, message?, tools?}`. `blueprint` (absent: kept) is checked in its site as the GET checks it; `tools` (`{id: swarmpress.tool.v1}`, FEAT-095) installs or replaces tools, each graph's id its key (400 otherwise) and each passing `check_tool` with the site's types and the other tools' signatures; any issue is a 422 `{error, issues}` and nothing is written; a `base_hash` that is not the current blueprint's hash is a 409. Written by the structure actor (`blueprint/**` on a `structure/` branch: the blueprint, its types, `blueprint/tools/<id>.tool.json`), the page-type registry derived by the platform, squash-merged; `{commit, hash, changes, tools}` (the semantic diff and the tool ids written). The CEO's canvas edits and the architects' approved proposals (the Publish job of a `Structure` or `Tool` item) both land here |
| `PUT /api/site/data` | lease required. A tool run's output as site data (ADR-0072, FEAT-092): `{tool, key?, port?, value}`; the value is validated against the tool's output type at the base head (422 with the reasons), then committed to `content/data/<tool>/<key>.json` as a content write and squash-merged; the same value again changes nothing; `{path, commit, changed}` |
| `GET /api/site/data?tool=&key=` | lease required. The data file back: `{path, commit, value}`; 404 when absent |
| `PUT /api/site/theme` | lease required. Theme components for a `Theme` work item (ADR-0072, FEAT-094): `{item, files: {path: source}, message?}`; only block renderer paths, each passing `blueprint::theme::check_component` (422); 409 on a site without `theme/theme.config.ts` (the frozen theme waits for the cutover); written by the design actor on `design/<item>`, one pull request per item; `{number, branch, head_sha}` |
| `POST /api/site/theme/merge` | lease required. `{number, head_sha}`: squash-merges a `design/` pull request after the CEO's approval; `{commit}` |
| `GET /api/gateway/file?path=` | lease required. One `content/pages/**/*.json` file at the base head with its blob sha (`{path, sha, commit, page}`), for refresh and fix jobs; 403 elsewhere, 404 when absent. A draft with `update: <blob sha>` updates that article, only if it is still that blob; every other draft of an article path stays create-only (ADR-0070) |
| `GET /t/s.js`, `POST /t/e` | tracker script and collector (no auth; see `src/tracker.rs`) |
| `/*` | static game client with SPA fallback |

Sync routes are owner-only: 401 without a session, 403 for another player's
company, 404 for an unknown company.

### Content gateway rules

The browser's orchestrator opens and merges content PRs through the server,
which holds the GitHub credentials. Drafts are written as a content agent
through `github::GuardedRepo` + `PathPolicy`: only `content/**`, only on
`drafts/content-{content_id}`, never platform files (`package.json`,
`.github/**`, ...); paths with `..`, a leading `/`, empty segments,
backslashes or NUL are refused (400), paths outside `content/` are refused
(403), and the page must be a JSON object in a `.json` file of at most
256 KiB (413). Merges are squash merges at the exact reviewed head. Every
gateway route (draft, merge, close, knowledge) answers 403 before it touches
GitHub when the company's repository is not on `SWARMPRESS_ALLOWED_SITE_REPOS`
(`gateway::company_repo`), also for a company bound before the list changed.

#### Articles (ADR-0061)

A draft at `content/pages/blog/<slug>.json` is an article and is validated on
the server, whatever the browser checked (`src/article.rs`,
`gateway::check_draft`, `gateway::check_against_site`):

| Check | Answer |
|---|---|
| a valid page under schema v2 (`content_model::validate_page_v2`) | 422 `{error, issues}` |
| `page_type` is `blog-article`; `id` is the content id | 422 |
| the slug (the file stem) is lowercase kebab-case, 1 to 100 bytes, and every `slug.<lang>` is `/<lang>/blog/<slug>` | 422 |
| exactly one `editorial-hero`, first; exactly one `closing-note`, last; in between only `heading`, `paragraph`, `list`, `callout`, `image`, with at least one paragraph | 422 |
| no raw `<` or `>` in `editorial-hero.title` and `closing-note.content` (the theme prints both as HTML) | 422 |
| links and media against the site's indexes (closed world): every internal link resolves to a page of the site and every media reference is in the media index, checked against the knowledge pack at the base head (`KnowledgeBase::closed_world_issues`, the check and text of the orchestrator's article validator) | 422 `{error, issues}`, one `<pointer>: <message>` line each, e.g. `/body/6/actions/0/href: "/en/nowhere" is not a page of the site: no page at this route`; 413 when the pack cannot be built because the site is over the snapshot caps. Off with `SWARMPRESS_ARTICLE_PROFILE=off` |
| the path does not exist on the base branch (article paths are create-only) | 409 |
| no other open gateway pull request of the company targets the path | 409 |
| the content id has no open pull request on another path | 409 |

`content/pages/blog-index.json` cannot be drafted at all (403): only the merge
writes it. Every other `content/**` page is accepted as before: a JSON object,
no schema check, and a draft may change a page that exists on the base branch.

#### Knowledge pack (ADR-0061 decision 1)

`GET /api/gateway/knowledge` (`src/site_knowledge.rs`) resolves the head of
the company's base branch (`RepoApi::get_branch`): that sha is the ETag. On a
miss it reads `RepoApi::snapshot(repo, sha, "content")` (the tarball with a
real GitHub, the tree with the fake), builds the pack with
`knowledge::pack::build` and serialises it with `Pack::to_json`
(deterministic: one commit, one byte string; about 384 kB for
cinqueterre.travel). The JSON and the `KnowledgeBase` loaded from it
(`knowledge::pack::load`) are cached in memory per (repository, sha), at most
8 entries, least recently used dropped first; the draft check reads the same
entry. A merge through the gateway drops the repository's entries (its base
head is the merge commit now), so the next request builds the new head's pack.
A snapshot over its caps is a 413 and nothing partial is cached. The company
lock is held for the lease check only, not across the download.

#### Finalise on merge (ADR-0061 decision 6)

Merging a pull request whose path is `content/pages/blog/*.json` makes the
branch publishable first, in the same pull request, under the company lock and
a per-repository lock (`gateway::finalize_and_merge`, pure parts in
`src/finalize.rs`):

1. The branch head must be the reviewed `head_sha`. (Or the head an earlier,
   interrupted attempt of this same merge left behind, recorded as
   `gateway_prs.final_head`: the attempt is then resumed.) Anything else
   answers 409 and nothing is written.
2. The base branch is merged into the draft branch (GitHub's Merges API).
3. The page is written with `status: "published"` and `updated_at`.
4. `content/pages/blog-index.json` gets one story entry derived from the page,
   on top of what the branch now has from the base.
5. The pull request is squash-merged at the new head.

The story list is never touched before step 4, so two pull requests opened
from the same base both merge and the list holds both entries. The entry
mirrors the existing ones, in their key order:

```json
{
  "id": 14,
  "slug": "harvest-week-in-manarola",
  "title": "Harvest Week in Manarola",
  "excerpt": "Seven days among the terraces above Manarola.",
  "author": "Giulia Rossi",
  "date": "Oct 2, 2026",
  "readTime": "4 min read",
  "category": "Culture",
  "image": "https://images.unsplash.com/photo-..."
}
```

| Field | From |
|---|---|
| `id` | the highest `id` in the list plus one |
| `slug` | the file stem |
| `title` | the page's `title.en` (else the hero's title, unescaped) |
| `excerpt` | the hero's `subtitle` (the dek); else `seo.description.en`; else the first paragraph, cut at 200 characters |
| `author` | `metadata.author` (a string, or `{name}`); else the merge attribution's `name`; else the list block's `title` (the publication) |
| `date` | the day of the merge, UTC, as `Oct 2, 2026` |
| `readTime` | the words of headings, paragraphs, lists, callouts and the closing note at 200 a minute, at least `1 min read` |
| `category` | the hero's `badge`; else `metadata.category`; else the list's first category after "All Stories" |
| `image` | the hero's `image` |

The file is edited as text: the entry is inserted after the last story with
the indentation of its neighbours, and every other byte stays as it is. A slug
that is already listed is left alone (`present`); a repository without the
file is published without an entry (`absent`); a page with no hero image, or a
path that is not a canonical article path, is not listed (`skipped`; only
possible with the article profile off); a file that is not JSON or has no
`blog-index` block with `stories` blocks the merge with 409.

Pages outside the blog merge exactly as before: no finalise, no `finalized`.

#### Attribution (ADR-0056 decision 8, as narrowed by ADR-0058)

Draft and merge take an optional `attribution` object. Without it (or with
`null`) both behave exactly as before.

```json
{ "staff_id": "staff-1", "name": "Giulia Rossi", "persona": "giulia", "role": "writer",
  "job_id": 12, "job_kind": "draft", "revision": 0, "work_item": "work-item-1",
  "model": "ternary-bonsai-2-27b", "executor": "browser laptop epoch 3",
  "reviewed_by": "Marco Bianchi", "approved_by": "ada" }
```

| Field | Rule |
|---|---|
| `staff_id` (required) | 1–64 of `[A-Za-z0-9._:-]` |
| `name` (required), `reviewed_by`, `approved_by` | one line, 1–100 characters, no `<` or `>` |
| `persona`, `role`, `job_kind` | 1–64 of `[A-Za-z0-9._:-]` |
| `job_id` | a non-negative integer, or 1–64 of `[A-Za-z0-9._:-]` |
| `revision` | an integer from 0 to 1000 |
| `work_item` | 1–100 of `[A-Za-z0-9._:-]` |
| `model`, `executor` | one line, 1–120 characters. Without `executor` the lease holder stands in: `<kind> <holder> epoch <n>` |

An unknown field, a wrong type, a line break or a control character answers
400, before anything reaches GitHub. There is no email field: the server
synthesises `<staff_id>+<company id>@<SWARMPRESS_STAFF_EMAIL_DOMAIN>`.

- **Draft:** the commit on the draft branch has the persona as git author
  (`name`, the synthesised address). The committer is left to GitHub, which
  uses the authenticated identity: the token's user or the App. The commit
  message is the request's `message`, a blank line, then the trailers `Job`,
  `Job-Kind`, `Work-Item`, `Model`, `Executor`. The pull request is titled by
  the first line of `message`.
- **Merge:** `staff_id` and `name` name the article's author. The squash
  commit's body is the trailers `Job`, `Job-Kind`, `Work-Item`, `Model`,
  `Executor`, `Reviewed-by`, `Approved-by` and
  `Co-authored-by: <name> <address>`. Its git author is the token's user or
  the App and cannot be changed: GitHub's merge API has no author field.

### Deploy observation (ADR-0061 decision 7)

A merged gateway pull request is `pending` until a deployment that contains it
is seen to succeed (`landed`) or its deployment is seen to fail (`failed`).
`src/deploys.rs` holds the two transitions; each pull request lands or fails
once, whichever source reports it, and the event is stored in the same
transaction as the transition.

| Source | `source` in the event | When |
|---|---|---|
| the poller | `poll` | a real GitHub (token or App) and no simulated deploys: a background task asks every `SWARMPRESS_DEPLOY_POLL_SECS` for the check runs of each merged, unlanded commit. A server on localhost receives no webhooks, so this is what the owner's machine uses |
| the webhook | `webhook` | `deployment_status` deliveries, when the server has a public address |
| simulation | `simulated` | `SWARMPRESS_SIMULATE_DEPLOY` with the fake GitHub: the merge lands at once |

- **At or before.** The site's deploy workflow runs in one concurrency group
  and GitHub drops a queued run when a newer one arrives, so a burst of merges
  produces fewer deployments than merges. A successful deployment of the merge
  commit S lands every unlanded gateway pull request of that repository merged
  at or before S (`merged_at`, kept strictly increasing per repository).
- **Check runs.** The deploy check (`SWARMPRESS_DEPLOY_CHECK`, default `deploy`)
  completed with `success` means live. Any check completed with `failure`,
  `timed_out`, `startup_failure` or `action_required` means failed. A check
  still queued or running means wait. No check run, or only `cancelled`,
  `skipped`, `neutral` or `stale` ones, means the run has not started or was
  superseded: such a merge fails only when a later merge's deployment failed
  and nothing after it is still running.
- **Timeout.** A merge still pending after
  `SWARMPRESS_DEPLOY_POLL_MAX_AGE_SECS` fails with `state: "timed_out"` and is
  no longer asked about.
- **A failed merge lands later** if a later deployment succeeds, or if its own
  workflow is re-run and succeeds while it is still inside the polling window.
- **Events.** `DeployLanded` and `DeployFailed` carry
  `{content_id, work_item, number, merged_sha, deployed_sha, state, detail, environment, source, attempt}`.
  `merged_sha` is the pull request's own squash commit; `deployed_sha` the
  commit whose deployment was observed; `attempt` the number of redeploys
  before the event (a `DeployFailed` with a higher one is a new failure).

### Redeploy (FEAT-085)

`POST /api/gateway/redeploy` deploys a `failed` merge again; the browser's
publish job calls it when the CEO answers `Retry` on a `DeployFailed` ticket
(the merge is done, so there is nothing to merge).

- **Mechanism: re-run the failed jobs** of the deploy workflow's run
  (`POST /repos/{o}/{r}/actions/runs/{id}/rerun-failed-jobs`), not
  `workflow_dispatch`. A re-run is a new attempt of the same run on the same
  commit, so its check runs belong to the merge commit the poller watches and
  its `deployment_status` names that commit. A `workflow_dispatch` runs at the
  head of the base branch, a commit the gateway may not have merged (it could
  not be placed among the merges). The site's `deploy.yml` allows both (`push`
  to `main` and `workflow_dispatch`); both need the Actions write permission.
- **Which run.** The newest run of `SWARMPRESS_DEPLOY_WORKFLOW` on the commit
  whose deployment failed: the merge itself, or, for a superseded merge, the
  later merge whose deployment failed (`deploy_failed_sha`); its success lands
  both (at or before). A run still going, or one that succeeded after all, is
  not re-run: the merge is `pending` again and the observation decides. No run
  at all (a merge that timed out without one) is a 409: start the workflow by
  hand or merge again.
- **State.** The merge is `pending` from the request (`deploy_since`: the age
  limit restarts), `deploy_attempt` counts up, and `deploy_rerun` records the
  run attempt that was re-run (`<run id>:<attempt>`), so a second request for
  the same failed attempt changes nothing. For one poll interval after the
  request a failed verdict is read as still running: GitHub replaces the
  failed attempt's check runs only once the new attempt's jobs are queued.
- **Refusals** leave the merge `failed`: GitHub's 403 (no Actions write
  permission) is answered with a 403 that says so.
- **Not covered:** a deployment of a commit the gateway did not merge (a push
  by hand) cannot be placed among the merges, so it lands nothing by itself.

### Web fetch rules (ADR-0040)

`http`/`https` only, no URL credentials; the host is resolved and every
address must be public (loopback, private, link-local, CGNAT, multicast,
documentation, reserved and their IPv6 forms, incl. v4-mapped, NAT64 and
6to4, are refused with 403). The connection is pinned to the checked address,
redirects are followed by hand (max 5) and re-checked, no proxy, 10 s timeout
(504), HTML/text/JSON only (415), 2 MiB cap (413). HTML is reduced to text.
Fetched text is untrusted data.

## Storage

`src/db/` holds every SQL statement (repository functions; handlers never
write SQL), in the plain SQLite subset Turso also accepts (ADR-0041): no
extensions, virtual tables, FTS, generated columns or triggers. Conventions:
TEXT uuid ids, INTEGER unix-ms instants, TEXT `YYYY-MM-DD` days, JSON as TEXT
checked by `json_valid`.

Concurrency: a writer pool with exactly one connection (the write queue) and a
read-only reader pool, WAL, `foreign_keys=ON`, `synchronous=NORMAL`, 5 s busy
timeout. `Db::begin_immediate` opens a `BEGIN IMMEDIATE` transaction for
read-check-write sequences (the lease takeover today, the credits ledger
later).

Migrations (`migrations/`, applied at startup):

| File | Adds |
|---|---|
| `0001_init.sql` | accounts, companies, events, gateway pull requests, webhook deliveries, sync, tracker |
| `0002_executor.sql` | `company_executors`: the executor lease with its fencing epoch (ADR-0045) |
| `0003_deploys.sql` | on `gateway_prs`: `merged_at`, `landed_at`, `deploy_state`, `deploy_detail`, `deploy_checked_at` (deploy observation), `closed_at` (`POST /api/gateway/close`), `final_head` (finalise on merge). Pull requests merged before it get `deploy_state = 'unknown'` |
| `0004_site_binding.sql` | `gateway_prs_retired`: a company's settled gateway pull requests of a repository it was rebound away from (`PATCH /api/companies/me`), with that repository and base branch and `retired_at` |
| `0005_redeploy.sql` | on `gateway_prs`: `deploy_since`, `deploy_failed_sha`, `deploy_attempt`, `deploy_rerun` (`POST /api/gateway/redeploy`) |

## Modules

| Module | What it does |
|---|---|
| `config` | Environment config, the combinations refused at startup, the site binding rules (`default_binding`, `site_repo_allowed`). |
| `db` | `Db` (writer/reader pools, migrations, `begin_immediate`) and the repositories: `accounts` (users, sessions, companies and their rebind, leases), `events`, `gateway` (gateway PRs, webhook deliveries), `sync`, `tracker`. |
| `auth` | GitHub OAuth, dev login, session rows keyed by sha256(token), the `CurrentUser` extractor. |
| `companies` | Company create/read/rebind, lease acquire/renew/release, `require_lease`. |
| `gateway` | `RepoBackend` (fake with its optional seed, token, App, unconfigured), draft and merge handlers, `PathPolicy` checks, the site checks for articles, the closed world (`ClosedWorld` for `KnowledgeBase`). |
| `site_knowledge` | `GET /api/gateway/knowledge`, `If-None-Match`, the pack cache (`KnowledgeCache`) the draft check shares. |
| `article` | The blog-article profile (pure): schema v2, block set and order, slug, the two HTML fields. |
| `finalize` | Finalise on merge, the pure half: the published page, the story entry derived from it, and the text edit that adds it to the blog index. |
| `events` | `EventHub` (tokio broadcast), `publish`, `/api/events`, `/ws/events`. |
| `webhooks` | GitHub webhook receiver (`github::webhooks::WebhookHandler` + SQLite dedupe); `deployment_status` feeds `deploys`. |
| `deploys` | Deploy observation: check-run verdicts, the plan for a repository's merges, the land and fail transitions with their events, the poller (real GitHub only), `GET /api/gateway/deploy-status`. |
| `sync` | Sync blob handlers (temp file + rename, index rows). |
| `web` | Fetch proxy, SSRF guard, HTML → text, Firecrawl stub. |
| `tracker` | First-party analytics (ADR-0032): collector, salts, rollup (computed in Rust), retention, nightly signals, `/api/projects`, `/api/analytics`. |
| `app` | `AppState`, routes, background tasks. |

## Tests

No external services: every integration test gets a fresh temp-file SQLite
database (WAL, both pools) and every unit test an in-memory one.

```bash
export CARGO_TARGET_DIR=...   # optional
cargo nextest run -p server
cargo clippy -p server -p testkit --all-targets -- -D warnings
```

| Suite | Covers |
|---|---|
| unit (`src/**`) | DB pools (WAL, FKs, read-only readers, `BEGIN IMMEDIATE`), accounts and leases, dev-login validation, gateway path policy and repo parsing, the article profile (every violation), config combinations refused at startup (the allow-list in real mode, the default binding on it, dev login off loopback in real mode), SSRF IP/URL checks (incl. resolving `localhost`), HTML → text, tracker helpers. |
| `tests/http.rs` | Schema, healthz, OAuth flow (state/code errors, cookie attributes, hashed sessions, logout, expiry via the manual clock), dev login on and off, one company per user, repo binding, static/SPA serving, the single-origin run (a `vite build`-shaped client and the API on one origin: COOP/COEP on every file, the SPA fallback for deep links with the game's parameters, wasm MIME, a dev-login session on that origin). |
| `tests/binding.rs` | The site binding (G2): the owner's default applied at creation and returned by `/api/me`; the allow-list at creation, at a rebind and on every gateway route (403, nothing reaches GitHub); `PATCH /api/companies/me` needs the session and the current lease, refuses while a pull request is open or a deploy pending, records `SiteRebound`, retires the old repository's pull requests (the new repository's #1 is a fresh record); a base-branch change keeps them; real mode refuses to start without an allow-list, with a default off it, and with dev login off loopback. |
| `tests/lease.rs` | Acquire, renew, conflict (409 with holder), force takeover, expiry, configurable TTL, release, ownership. |
| `tests/gateway.rs` | Draft + revision + merge against FakeGitHub, stale-head 409, idempotent merge, one simulated `DeployLanded`, PathPolicy rejections (nothing written), lease required (428/409, takeover, expiry), merging only own PRs, `deployment_status` webhook (bad HMAC, dedupe, success, failure, other repos). |
| `tests/articles.rs` | Articles through the gateway: a valid fixture drafts; each profile violation answers 422 with its issue and writes nothing; an existing slug, a second open pull request for the path and a second path for the content id answer 409; the blog index cannot be drafted; other content is untouched; the profile switch. |
| `tests/knowledge.rs` | `GET /api/gateway/knowledge`: the pack of the base head with its `ETag`, `Cache-Control` and `Content-Type`; 304 on a matching (also weak or listed) `If-None-Match`; the second request is a cache hit; session and lease required (401, 428, 409 after a takeover), 404 without the base branch; a merge drops the cached pack and the next request answers the new head (new ETag, the merged article in `pages`); 413 for `TooLarge` (route and draft), 502 for a broken index; the closed-world refusal (422) of an unknown link and of media not in the index, nothing written; the fake GitHub path: a repo seeded by `SWARMPRESS_FAKE_SITE` gives the mini fixture's pack, the profile off accepts an article outside the closed world, an unseeded repo gives an empty valid pack. |
| `tests/attribution.rs` | The persona is the author of draft commits and the platform the committer; the squash commit carries `Co-authored-by` and the trailers, with the platform as author; the executor defaults to the lease holder; every malformed attribution answers 400 on draft and merge and reaches GitHub with nothing; without attribution nothing changes. |
| `tests/close.rs` | `POST /api/gateway/close`: the pull request is closed and its branch deleted once; closing again calls nothing; foreign and hand-made pull requests answer 404 and are untouched; merged ones answer 409; the lease is required; a closed one cannot be merged and frees its path; an interrupted close is completed. |
| `tests/deploys.rs` | The poller's round against the fake GitHub and the manual clock: a success lands the merge, a failure emits one `DeployFailed` and a re-run lands it, a burst of merges with one deployment lands all at or before it (poller and webhook), a superseded merge fails with the deployment that replaced it, a merge nobody deployed times out; `POST /api/gateway/redeploy`: failed → redeploy → success lands the item (also past the age limit), a second redeploy for the same failed run is a no-op, a redeploy that fails again is a new failure (`attempt`) and is redeployed again, a superseded merge re-runs the run that failed it, refusals (lease, landed, not merged, no run of the deploy workflow, GitHub 403); `deploy-status` (states, scoping); the poller does not run with the fake or with simulated deploys; simulated deploys with a real GitHub refuse to start; the background task against a wiremock GitHub. |
| `tests/finalise.rs` | Finalise on merge: the page on the base branch is `published`; the story entry has the key order and types of a real entry and the rest of the file keeps its bytes; two pull requests from the same base both merge and the list holds both; a moved head is refused before anything is written; an interrupted merge is resumed, also after another merge moved the list; a repeated merge answers from the record; a site without a list; a broken list blocks the merge; pages outside the blog merge untouched. |
| `tests/events.rs` | Polling with `after`/`limit`, per-company scoping, WebSocket backlog + live push. |
| `tests/sync.rs` | Segment immutability (201/200/409), list, bytes on disk, snapshot with step, owner-only access. |
| `tests/web.rs` | SSRF refusals and bad URLs, per-user 429, Firecrawl 501, HTML reduction, JSON, redirects, 415 and 413 against a local wiremock. |
| `tests/tracker.rs` | Projects and keys, `/t/s.js`, collector checks, per-IP 429, salt rotation, no IP/UA columns, rollup, retention, nightly signals, `/api/analytics`, hashed sessions. |

## Tracker script drift check

The collector serves `assets/tracker.min.js`, a committed build of
`packages/tracker`. After changing the tracker source, run
`pnpm --filter tracker sync` and commit both. The unit test
`tracker::tests::assets_match_built_tracker` fails whenever
`packages/tracker/dist` exists and differs from the embedded copy.

## Known stubs and limits

- `POST /web/firecrawl/*` answers 501 until credits ship (wave 3).
- The fetch proxy does not read robots.txt or cache yet (ADR-0040 asks for both).
- `SWARMPRESS_GITHUB=fake` keeps repos in memory only.
- The closed-world check of an article draft and the knowledge route read the pack of the base
  head: a page another pull request adds is not linkable until that pull request merges.
- The gateway has only been run against the in-memory GitHub and wiremock. Three GitHub
  behaviours it relies on are taken from the documentation and not verified against the real
  API: the Contents API's `author` field with the committer left out, the Merges API for
  bringing the base into a draft branch (201/204/409), and the check runs a superseded or
  cancelled deploy run leaves on its commit. The first two are what
  `crates/github/tests/live_repo.rs` checks against a sandbox repository when the owner runs
  it (`crates/github/README.md`); it has not been run yet. So are the token permissions above.
- Any signed-in player can bind a company to any repository on the allow-list: there is no
  check that the player owns it (ADR-0047's installation check, a later increment). On the
  owner's machine the allow-list holds the owner's own repositories.
- A rebind does not tell an open game tab: it shows the old binding until it is reloaded.
- A deployment of a commit the gateway did not merge lands nothing by itself.
- `PendingSignalSink` leaves nightly analytics signals `pending`; delivering them to the
  browser (as inbox events) is still to come.
