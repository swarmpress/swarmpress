# MVP: your own company, for real

> **Status:** plan approved 2026-10-02. Decided in ADR-0057 to ADR-0062; nothing in the tracks
> below is built unless a feature file says so.
> **Design detail:** [runtime](design/mvp-runtime.md) · [pipeline, gate, time, site path](design/mvp-pipeline.md) ·
> [gap analysis](design/mvp-gap-analysis.md) · concept source
> [Browser Agent Studio](reference/browser-agent-studio.md).
> **Architecture:** [ADR-0038](adr/0038-local-first-the-browser-is-authoritative-for-a-company.md)
> (browser authoritative), [ADR-0041](adr/0041-turso-in-the-browser-one-sqlite-dialect-everywhere.md)
> (store), [ADR-0039](adr/0039-sqlite-is-the-central-database.md) (central SQLite),
> [ADR-0057](adr/0057-strict-in-browser-inference-one-resident-model-on-webgpu.md) (inference).

The scripted MVP ([Stage 0](#stage-0-done-one-scripted-article-end-to-end) below) proves the
plumbing with a fake model and a fake GitHub. It proves nothing about the product. The first
real MVP is:

- **Your own company, for real.** The owner runs cinqueterre.travel as CEO on their own
  machine. Staff write real articles; real pull requests land in the real site repository;
  merges deploy the live site; the result returns to the game.
- **Strictly local inference in the browser.** One resident model, Ternary-Bonsai-2-27B on
  WebGPU, in a Dedicated Worker, shared by all staff. No inference API, no native model server,
  no cloud fallback. The runtime is proven by a benchmark report before anything is built on it.
- **A watchable office:** staff visibly at work, meeting speech bubbles, working Plan / Inbox /
  Finance panels, an Activity timeline.
- **The CEO approves each article** before it is merged.

What the explorations found, and this plan fixes:

- Without the fake model every standup silently yields nothing; no local-model code is wired
  into the session.
- The Bonsai WebGPU demo contains a clean engine module (one cut, no patches), but it is
  unlicensed, greedy-only, throws on system messages through its high-level call, and defaults
  to a 16K context that the current single 16,000-token draft call cannot fit.
- The first real merge would be the first live deploy built from the new code tree: the site's
  deploy workflow is not pinned.
- Agent articles would render with no title or image, literal `**markdown**`, an empty meta
  description, `status: draft`, and no entry in the blog index. A draft can overwrite an
  existing article with the same slug.
- Nothing asks the CEO before a merge; a deploy that fails or never lands leaves the item stuck.
- A returning hidden tab runs all missed game time in one burst; only standups hold the clock.

## What "done" means

On the owner's Mac (M3 Max, 128 GB) in Chrome, with the local server serving the built game:

1. Bonsai downloads once, verifies, loads in a Worker and passes a qualification turn; a status
   chip shows each stage. No inference request leaves the machine.
2. The 09:00 standup runs on real site context and commissions a capped number of articles; the
   turns play as speech bubbles.
3. A writer drafts in bounded stages; the editor reviews; deterministic checks pass.
4. An Inbox ticket shows title, score, measured checks, a preview and the pull-request link. On
   the CEO's yes, the gateway finalises and squash-merges; the pinned workflow deploys; the
   server observes it; the item becomes Published. The article is live with a visible title and
   hero image and is listed on the blog index.
5. Staff move through the office with names; the Activity timeline shows who did what, with
   which model, in how long; commits carry the staff persona and provenance trailers.
6. Pause, reload and continue all work; a week of game days runs without a stall, a duplicate
   or a silent failure.

## Decisions

| Topic | Decision | ADR |
|---|---|---|
| MVP target | The owner's company on cinqueterre.travel, single player, server run locally | – |
| Inference | Strictly local in-browser WebGPU; Bonsai PTQ1_0; no Claude in the MVP | 0057 |
| Runtime source | Extract the engine from the webml-community demo behind the existing `LocalLlm` interface; prove first | 0057 |
| Second backend | Chrome Prompt API as a separately labelled adapter on the same fixtures; never substituted silently | 0057 |
| Pipeline | Bounded stages inside the Draft and Review jobs | 0058 |
| Publish gate | The CEO approves every article before merge | 0059 |
| Game time | The clock holds while work is due; day length stays 20 real minutes | 0060 |
| Site knowledge and gateway | One knowledge pack; server-side validation; create-only paths; finalise on merge; deploy polling | 0061 |
| Standup | A pitch round with a deterministic cap | 0062 |
| Game depth | Watchable office; no building or hiring | – |
| Landing | Commit and push to `main`; parallel work in isolated worktrees | – |

Defaults chosen with the plan:

- **Engine licence:** the engine is not committed (this repo is public and GPL-3.0). The repo
  holds the extractor and a hash lock; a setup script fetches the pinned demo page into a
  git-ignored folder. Fine for the owner's machine. A licence is requested upstream. Shipping to
  others waits for a licence or an explicit owner decision.
- **Language:** English text, with slug keys for en/de/fr/it, as 17 of the 19 existing articles
  do. An English-only slug would make three blog index pages link to a 404.
- **Rehearsal:** a fork of the site repository before the live one.
- **Qualification reports:** committed under `docs/qualification/` (`artifacts/` is ignored).

## Milestones

| | Milestone | Proves |
|---|---|---|
| R | Runtime go/no-go | Bonsai in a Worker meets thresholds on the owner's Mac, or the fallback ladder is taken |
| A | Real model, fake GitHub | A staged article reaches the gate, is approved and merged, on real inference |
| B | Rehearsal | Eval thresholds met; 7 game days against a fork with real deploys |
| C | First live article | One article, cap 1 per day, approved by the CEO, verified live by hand |
| D | MVP done | Watchable office, Activity, bubbles, a supervised week on the live site |

## Tracks and increments

Sizes: S up to a day, M two to four days, L one to two weeks. ∥ = can run in parallel.
"Golden" = the sim's golden hashes change deliberately. Files, schemas and tests for each
increment are in the design documents.

### Z — land what is in flight (first)

| # | Increment | Notes |
|---|---|---|
| Z1 | Epoch lease; a session that loses the lease halts (FEAT-013, ADR-0045) | Migration `0002_executor.sql`; `takeover.spec.ts` |
| Z2 | World snapshot and pending-job re-issue (FEAT-060, ADR-0046) | Restore no longer replays from the seed |
| Z3 | Record the decisions | ADR-0057 to 0062, the design documents, this file |

### R — prove the runtime (∥ with K, S, T) — [design](design/mvp-runtime.md)

| # | Increment | Proof | Size |
|---|---|---|---|
| R1 | Extraction tooling: extractor, hash lock, type declaration, setup script into a git-ignored folder | `extract.test.ts`; the script reproduces the pinned hashes | S |
| R2 | Worker adapter over the engine's low-level calls: thinking control, reasoning cap, JSON-balance stop, prefix snapshots, device-loss event; protocol gains `probe`, `bench`, `resetSession` | unit tests on a fake session; gated e2e: load, stream, cancel in a Worker | M |
| R3 | Upstream equivalence on five fixed prompts | zero mismatched token ids (gating on every pin bump) | S |
| R4 | Structured policy: the Rust validator exported to the browser; repair turns send only the stripped answer; one retry on truncation, never a partial success | Rust + vitest: a bad block now repairs | M |
| R5 | Chrome Prompt API adapter and backend selection (`?llm=fake\|bonsai\|chrome\|transformers`) | contract tests with a fake `LanguageModel`; manual run | S–M |
| R6 | Qualification harness: fixtures, metrics, frame times per quality tier | `cockpit.benchmark.v1` documents | L |
| R7 | Run and decide; write the report under `docs/qualification/` | thresholds table filled with measurements | S |
| R8 | On go: wire into the session, startup flow, origin-wide resident lock, loss surface, renderer hooks for the GPU scheduler | MVP e2e with `?llm=bonsai` (gated) | M |

Go thresholds on the M3 Max (**proposed, unmeasured**): warm start ≤ 60 s; prefill ≥ 300 tok/s;
decode ≥ 20 tok/s with the scene at medium; short action p50 < 10 s; valid after ≤ 1 repair
≥ 98%; staged article p50 ≤ 8 min; frame p95 ≤ 33 ms while generating; ≥ 95% of 20 suite runs
without device loss; zero equivalence mismatches.

Fallback ladder: retune (8K context, thinking off) → PQ2_0 → a smaller model on the same
architecture → the existing Transformers.js Qwen3-4B path (licence-clean) → Chrome adapter as
the labelled mode.

### K — site knowledge (∥) — [design §3](design/mvp-pipeline.md)

| # | Increment | Size |
|---|---|---|
| K1 | Knowledge pack: `knowledge::pack`, `RepoApi::snapshot`, `GET /api/gateway/knowledge` (lease, ETag) | M |
| K2 | `knowledge` compiled into `orchestrator`; browser caches the pack by commit; `SiteBinding` from the real style guide and writer prompt | M |

### S — one sim increment (∥; golden, once) — [design §5](design/mvp-pipeline.md)

- Publish gate: `AutonomyPolicy` becomes real; `PublishApproval` ticket (High; Publish /
  SendBack / Kill / Defer; default Defer, re-raised each morning); parked items count toward a
  work-in-progress limit.
- `ServerCommand::JobFailed{job_id, reason}` and `DeployFailed{work_item}`; tickets
  `StandupFailed`, `DeployFailed`, `NeedsMedia`, `NeedsPage`; the standup timeout raises a
  ticket.
- First escalation of an item defaults to Retry, later ones to Kill.
- Invariants: one active draft per writer; items ≤ WIP limit.
- Meeting `speak_from`/`speak_chars` and render-state `bubbles`; `busy_with` and work item in
  staff render state; `Sim::next_due_step()` view.
- Goldens re-baselined; the snapshot `WORLD_FORMAT` bumped.

### T — game time independent of GPU speed (∥; after S's view) — [design §6](design/mvp-pipeline.md)

- The clock holds whenever a pending job is due. Host policy, never sim state.
- Clamp the accumulator; earliest-due-first job queue.
- Rest after 22:00 with nothing in flight; the next day starts on a click or while an
  "unattended days" counter is positive.
- Hidden tab: a 1 Hz worker timer lets work in flight finish, then the rest rule applies.
- Model download, GPU recovery and a halted loop hold the clock.
- HUD chip (Running / Held / Resting / Model loading / Lease lost / Halted), pause and speed
  buttons, a boot screen.

### P — a pipeline one bounded local model can finish (after K, R4) — [design §1, §2, §7, §8](design/mvp-pipeline.md)

| # | Increment | Size |
|---|---|---|
| P1 | Article shape for the frozen theme: hero, intro, sections, closing note; plain text; localized `seo`; v2 validator plus closed-world checks; hero from a deterministic shortlist | M |
| P2 | Staged draft inside the Draft job: context → outline → sections → closing → assemble → validate → fix one section; flat schemas; stage store; post dedupe | L |
| P3 | Revision and review: issues tagged by section; patch only named sections; sectioned review when long | M |
| P4 | Standup as a pitch round: cap, context pack, de-duplication, repair or skip, `JobFailed` on total failure | M |
| P5 | Progress events and the lean `activity` table | S–M |
| P6 | Timeout and cancel through the bridge; one retry, then `JobFailed{Timeout}`; device loss resumes from stored stages | M |

### G — the real site path (∥ with P) — [design §4, §5](design/mvp-pipeline.md), [gap analysis B](design/mvp-gap-analysis.md)

| # | Increment | Size |
|---|---|---|
| G1 | Site repository preparation (**needs the owner's go; it touches the live repo**): tag `legacy-final`; pin `deploy.yml`'s monorepo checkout to `391d5de`; one manual deploy to confirm green; baseline; enable delete-branch-on-merge | S |
| G2 | Bind and run for real locally: client passes `site_repo`; token mode; documented single-origin run on `:8080`; env-gated live test against a sandbox repo | M |
| G3 | Server-side checks in `check_draft`: v2 schema, article profile, closed-world links and media, create-only path, no second open PR for the path, non-empty slug | S–M |
| G4 | Finalise on merge in the same pull request: verify head, merge base, `status: published`, blog-index entry, squash-merge | M |
| G5 | Deploy observation by polling merged, unlanded pull requests; a success lands every merge at or before that sha; failures emit `DeployFailed`; migration `0003` | M |
| G6 | Attribution before the first live merge: persona as author on draft commits; trailers and `Co-authored-by` on the squash commit | S–M |
| G7 | Orphan cleanup: `POST /api/gateway/close`; a day-start sweeper | S |

### U — watchable office (∥; mostly after Milestone A) — [gap analysis C](design/mvp-gap-analysis.md)

| # | Increment | Size |
|---|---|---|
| U1 | Inbox approval ticket with measured checks, pull-request link and a sandboxed article preview | M |
| U2 | Panel fixes on live data: ticket text, dead actions disabled, CEO comments persisted, links, empty tabs hidden, Finance labels | S each |
| U3 | Staff visibly moving: interpolation along `path`, facing, seated poses, name labels, corridor floor, doors, what each person is working on, click to open | M |
| U4 | Activity panel and a "Now" strip in the HUD | M |
| U5 | Speech bubbles: transcript row per turn, `Utterance` commands at step boundaries, Preact bubble layer | M |
| U6 | Construction kit core (ADR-0065, FEAT-083): part catalogue, design format and hash, the `crates/kit` compiler (bricks and capability summaries), shipped designs for every equipment and room kind | L |
| U6b | Brick office spike on the kit (ADR-0063, FEAT-081): two rooms and two live surfaces behind `?office=bricks`, measured idle and while generating; then all rooms. Player and staff building come after the MVP | M |
| U7 | WebGPU only (ADR-0064, FEAT-017): remove the WebGL2 fallback, a no-WebGPU screen, all browser tests and baselines on SwiftShader WebGPU | M |

### W — a week without stalls — [design §7](design/mvp-pipeline.md)

Ring buffers for the bridge call log, gateway calls and received events; `loop.jobs` capped;
stage rows pruned; no full plan parse per step; a 7-day soak test on a fake model with realistic
latency and failure rates; a guard test that seven days with no revenue raise no finance
tickets (computed runway is about 59 game days).

### E — qualify before going live — [design §9](design/mvp-pipeline.md)

- Eval harness: N briefs from the unpublished calendar topics through the staged pipeline on
  the real model; the 19 existing articles calibrate the checks and act as positive controls.
- Proposed "publishable" threshold on ≥ 20 briefs: every committed draft passes the server
  checks; ≥ 80% approved within 3 revisions; first-try validity ≥ 90% per stage; every approved
  article within ±25% of target with no banned phrases; the editor rejects ≥ 5 of 6 seeded-bad
  drafts; the owner reads them all and would publish ≥ 80%, none factually wrong.
- Rehearsal on a fork: 7 game days with the gate on; every merged article builds, has one
  `<h1>`, appears in the index, links return 200; no stuck item; replay reproduces the hash.

## Order of work

1. Z1, Z2, Z3.
2. In parallel: R1–R7 (runtime proof) · K1–K2 · S · T · G1–G3.
3. P1 → P2 → P3, P5; G4–G6 and U1 in parallel; then P4, P6. R8 as soon as R7 says go.
4. **Milestone A.** Then E (eval) and W; U2–U5 in parallel.
5. **Milestone B** (rehearsal) → **Milestone C** (first live article) → **Milestone D**.

If R7 says no-go for Bonsai, everything except R8 is unaffected: the pipeline, gate, clock and
site path are model-independent and tested on the fake model; the fallback ladder decides the
backend.

## What is needed from the owner

- Go-ahead for G1, the only step that changes the live site repository before Milestone C.
- A fine-grained GitHub token for the rehearsal fork and later the site repository (Contents
  and Pull requests read/write, Actions read).
- Chrome with WebGPU and about 6 GB for the model download.
- A reading of the eval articles, and the thresholds to hold them to.
- A decision later, not now: whether a build for other people may fetch or serve the engine.

## Risks

| Risk | Guard |
|---|---|
| Prefill speed in Chrome on Metal, or the fast kernels needing an experimental feature | R6 measures first; fallback ladder |
| Engine licence never arrives | Not committed; fetch-at-setup; a licence-clean fallback exists |
| Greedy-only decoding loops or repeats | Bounded stages, no-progress stop, repair with thinking off |
| Same model writes and reviews | Deterministic checks, seeded-bad editor test, the CEO's approval on every article |
| First deploy on the new tree breaks the live site | G1 pin and manual deploy before any agent merge; a failed build leaves the previous site live |
| An article overwrites or mislinks existing content | Create-only paths, closed-world checks, server-side validation |
| Upstream demo rebuild changes the bundle | Hash lock, export-name anchor, equivalence test on every bump |
| Tab hidden or GPU lost mid-job | Clock holds, stored stages resume, nothing repeats |

## Verification

- Every increment lands with its proving test and its feature file moved to `in-progress` in
  the same change; `cockpit validate --strict` stays the gate.
- Green before a merge to `main`: `cargo fmt --check`, `clippy`, `cargo nextest`, wasm build and
  size budgets, `pnpm typecheck`, `pnpm test`, `pnpm test:sdk`, site-kit, schema check, and the
  Playwright suites (smoke, ui, orchestrator, MVP, takeover).
- R: the equivalence spec and the benchmark documents; the report under `docs/qualification/`.
- S: sim tests for the gate (no Publish job before a Publish answer; expiry never publishes; the
  Secretary cannot answer), failure commands and tickets; goldens re-baselined once.
- T: `clock-driver` unit tests; a loop test where latencies of 0 s, 60 s and 12 min complete the
  phase at the same step and each log replays to its hash.
- P: fake-model tests that a failing section costs exactly one extra call, a killed job resumes
  from stored stages with one pull request and one post of each kind, and every rendered prompt
  fits the context ceiling.
- G: server tests for each refusal code, two pull requests from one base both merging with both
  index entries, a burst of two merges landing on one deployment; a render test building the
  frozen theme against a fixture article (one `<h1>`, no unknown block, index card).
- End to end: `mvp.spec.ts` extended with the approval click and bubbles on the fake model; the
  gated `?llm=bonsai` run for Milestone A; the fork rehearsal for B; a hand check of the live
  page, its index card and its commit trailers for C; the soak test and a supervised week for D.

---

## Stage 0 (done): one scripted article, end to end

The plumbing MVP. Its acceptance test is `apps/game/e2e/mvp.spec.ts`, run with
`pnpm --filter @swarm-press/game exec playwright test -c playwright.mvp.config.ts`: the real
game page (`/?central=1`) against the real server with dev login, the in-memory fake GitHub,
simulated deploys and the scripted `?llm=fake` model, on both store engines (turso, sqlite). It
covers dev login and company founding, fast-forward to 09:00, standup → draft PR → review 6 →
revision → review 8 → the CEO's approval in the Inbox (the publish gate, ADR-0059, since
increment S) → merge, `DeployLanded` through the events API, the Plan thread, a reload
restored from OPFS, and a fresh browser context restored from central sync. Health is derived
from that evidence by Cockpit, not declared here.

Known limits of Stage 0, all addressed by the tracks above: the script covers exactly one
article; a fresh device restores the sim state without plan text; restore replays from the seed
(until Z2).

```
Browser (authoritative)                                          Central server (Rust + SQLite)
───────────────────────────────────────────────────────────     ─────────────────────────────────────
dev login ─────────────────────────────────────────────────────► session; company + project row; lease
found company: sim-core scenario "cinqueterre" (13 people)
Turso wasm/OPFS: sim log + snapshots, plan, briefs, artifacts, transcripts
   │
09:00 standup ─ Effect::RequestJob(Standup)
   └─ orchestrator (wasm) ─ LocalLlm (FakeLlm in tests) ─ transcript, briefs
        └─ ServerCommand::MeetingOutcome → sim creates work item
Draft phase ─ RequestJob(Draft) ─ orchestrator: page JSON, validate (content-schema + house style)
   └─ gateway: open draft PR ───────────────────────────────────► POST /api/gateway/draft (PathPolicy:
                                                                   content/** on drafts/*) → GitHub
   └─ plan: minutes, artifact, handoff posts (Turso)               (FakeGitHub in tests/dev)
Review phase ─ RequestJob(Review) ─ verdict/score → plan review post
   └─ JobCompleted{score} → sim: <7 revise, ≥7 the publish gate
Gate (ApproveAll) ─ item parked, PublishApproval ticket ─ CEO answers Publish in the Inbox
Publish ─ RequestJob(Publish) ─ gateway: merge ─────────────────► POST /api/gateway/merge → squash merge
                                                                   deployment_status webhook (or simulated
                                                                   in dev) → offline/online event inbox
   ◄──────────────────────────── event: DeployLanded{work_item} ◄─ GET /api/events (+ push channel)
   └─ ServerCommand::DeployLanded → item Published; plan status post; CEO feed
sync: append log segment + snapshot ───────────────────────────► PUT /api/sync/{company}/… (blobs on disk)
reload / new device: restore from OPFS or sync (world snapshot + the log after it), merge inbox events (ADR-0048)
```

### Contracts (still current)

**sim ↔ orchestrator:**

- `Effect::RequestJob { job_id, kind, project, work_item, brief_ref, revision, staff }`, drained
  with `World::drain_effects()`.
- Results come back as `ServerCommand::{MeetingOutcome, JobCompleted, DeployLanded}`, and
  since increment S (ADR-0059, FEAT-079) `JobFailed{job_id, reason}` and
  `DeployFailed{work_item}`. The sim accepts both; no executor sends them yet (P4, P6, G5).

In the browser these are *local* commands that the client applies at the next step boundary and
appends to the command log. "Server command" just means "not a player command".

**`crates/orchestrator`** (wasm-compatible, no tokio or sqlx). Same logic as the earlier server
prototype (`git show f0db482:crates/server/src/orchestrator.rs`):

- `Orchestrator<S: Store, G: Gateway>` with `run(&JobRequest) -> Result<Vec<Outcome>>`.
- `trait Store`: briefs, artifacts, transcripts and plan posts (item text, append post), async.
- `trait Gateway`: `open_draft(content_id, path, page, message) -> DraftPr` and
  `merge(pr, head_sha) -> merged_sha`.
- `Llm` is the agents crate trait.
- Implementations: `MemStore` and `FakeGateway` for tests; in the browser a Turso-wasm-backed
  store (sqlite-wasm fallback, ADR-0041) and an HTTP gateway (JS bridge,
  `crates/orchestrator-wasm`; see `docs/architecture/browser-runtime.md`).

**Central HTTP API** (SQLite):

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/dev/login` (only with `SWARMPRESS_DEV_AUTH=1`), GitHub OAuth, `GET /api/me` |
| Company | `POST /api/companies`, `GET /api/companies/me`, `POST /api/companies/{id}/lease` |
| Gateway | `POST /api/gateway/draft`, `POST /api/gateway/merge` (company lease required; PathPolicy). ADR-0061 adds `GET /api/gateway/knowledge` and `POST /api/gateway/close` |
| Events | `GET /api/events?after=`, plus a WebSocket push channel (`/ws/events`) |
| Sync | `PUT/GET /api/sync/{company}/log/{segment}`, `PUT/GET /api/sync/{company}/snapshot` |
| Web | `GET /web/fetch?url=`; `POST /web/firecrawl/*` (stubbed) |
| Tracker | `/t/s.js`, `/t/e`, `/api/analytics` (from ADR-0032, on SQLite) |

### Executors

| Mode | LLM | GitHub |
|---|---|---|
| test (CI) | scripted `FakeLlm` (Rust tests), scripted fake `LocalLlm` (browser e2e) | `FakeGitHub` in the server |
| dev (manual) | `?llm=fake` scripted; `?llm=bonsai` once track R lands | `SWARMPRESS_GITHUB=fake` (in-memory, lost on restart) or a sandbox repo |
| MVP (owner's machine) | the resident in-browser model (ADR-0057) | token mode against the site repository (G2) |
