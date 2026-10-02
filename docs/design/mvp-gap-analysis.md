# MVP gap analysis: what stands between the scripted MVP and a real company

> **Status:** findings of three read-only explorations, 2026-10-02, at commit `137fd94`.
> Appendix to [mvp-runtime.md](mvp-runtime.md) and [mvp-pipeline.md](mvp-pipeline.md).
> **Evidence status:** from reading code and docs, read-only `gh api` queries and `curl` against
> the live site. No builds or tests were run. Line numbers are as of that commit and will drift.
> Claims about GitHub permissions and pnpm behaviour are from memory and marked so.

## A. The model seam and the agent pipeline

### A.1 What happens today without `?llm=fake`

- `apps/game/src/session/session.ts:316` wires
  `llm: localLlmBridge(llmFromQuery(location.search, unwiredLlm))`. `unwiredLlm()`
  (`session.ts:177-183`) is a `FakeLlm` whose responder returns
  `new Error('the local model runtime is not wired into the game session yet; use ?llm=fake')`.
- **Standup:** the bridge maps the error to `{error:{Backend}}` (`bridge.ts:122-125`) and
  `run_meeting` fails. `standup()` swallows that and returns `MeetingOutcome{briefs: []}`
  (`crates/orchestrator/src/run.rs:342-348`), so no work item is ever created. This breaks
  rule 11 (stubs fail loudly).
- **Draft and review** would post a `status` and return `ok:false`, which blocks the item with a
  ticket. They are never reached.
- **Nothing in `apps/game/src/llm/` is imported by the game** except types, `FakeLlm`,
  `StructuredOutputError` and the MVP script. `llm/index.ts:3` says "main.ts is not wired yet".
- The scripted model (`?llm=fake`) covers exactly one article; calls after #8 fail loudly
  (`orchestrator/index.ts:72-77`).

### A.2 What `localLlmBridge(llm: LocalLlm)` needs and the session does not provide

- A real `LocalLlm`: `LlmClient.spawn({registry})` (`client.ts:65`) is never called.
- A loaded model: `LocalLlm.load(modelId, onProgress)` (`types.ts:94`) is never called. There is
  no registry load, `detectCapabilities()`, `chooseModels()`, tokens/sec probe, download UI or
  `requestPersistentStorage()`.
- A model choice per call. The request carries `profile: {job, role, seniority, staff_id}`
  (`crates/agents/src/llm.rs:18-25`), but the bridge types it `unknown` (`bridge.ts:73`) and
  ignores it. One `LocalLlm` holds one model (`TransformersJsLlm.load` disposes the previous
  one, `transformers-llm.ts:60-61`).
- `GpuScheduler` begin/end hooks, `electLeader`, an `AbortSignal` or timeout, and `onDelta` (the
  bridge never streams). The Rust side calls the delta sink once with the full text
  (`crates/orchestrator-wasm/src/lib.rs:332-334`), and `standup()` discards meeting events
  (`run.rs:341`).

### A.3 Wire contract

`crates/orchestrator-wasm/src/lib.rs:73-83, 303-355`; `LlmRequest` at
`crates/agents/src/llm.rs:66-74`:

```
complete(requestJson: string): Promise<string | object>
request:  {kind: 'generate'|'structured',
           request: {profile:{job,role,seniority,staff_id}, system: string[],
                     messages: [{role:'user'|'assistant', text}], max_tokens},
           schema?: object}
response: {text} (generate) | {value} or {text} (structured)
        | {error: {Refusal:{category,explanation}} | {Truncated:{partial}}
                | {InvalidOutput:{errors}} | {Unavailable:msg} | {Backend:msg}}
```

The `Llm` trait (`llm.rs:117-144`):

```rust
async fn generate(&self, req: &LlmRequest, on_delta: Option<DeltaSink<'_>>) -> Result<String, LlmError>;
async fn structured(&self, req: &LlmRequest, schema: &Value) -> Result<Value, LlmError>;
async fn structured_checked(&self, req: &LlmRequest, schema: &Value, check: &SemanticCheck<'_>) -> Result<Value, LlmError>;
```

`JsLlm` implements only `generate` and `structured`. `structured_checked` falls to the default
(validate once, no repair), and the pipeline never calls it.

### A.4 How structured output works today

- **Local** (`runStructured`, `apps/game/src/llm/structured.ts:222-260`): append the schema as
  text to the system message, generate at temperature 0.2, `extractJson` (strips `<think>`,
  fences, trailing commas), validate with a hand-written JSON-Schema subset, up to 2 repair
  turns.
- **Rust re-check:** the result is validated against the full schema with `jsonschema`
  (`orchestrator-wasm/src/lib.rs:349-353`).
- **Pipeline repair** (`Run::write`, `crates/agents/src/pipeline.rs:261-294`): up to 2 more
  turns for content-schema and banned-phrase errors.
- **Claude** (`structured_output_with`, `crates/claude/src/structured.rs:95-141`):
  `output_config.format = json_schema` plus local validation and 2 repair turns. Native only.
  **Out of the MVP (ADR-0057).**

Defects a real model will hit:

- **`anyOf` is not validated in JS.** The subset validator (`structured.ts:129-170`) has no
  `anyOf`, and `article_schema()` puts every body block under `anyOf`
  (`crates/orchestrator/src/article.rs:24-41`). A malformed block passes the JS loop, fails the
  Rust check, and becomes `InvalidOutput` → `DraftStep::Invalid` → `ok:false` with no repair
  turn. The comment at `structured.ts:113-114` promises an injected wasm validator that does not
  exist.
- **A long speaker turn kills the standup.** `generate` with `finishReason === 'length'`
  returns `Truncated` (`bridge.ts:117`). Any speaker who hits the 600-token cap (`run.rs:338`)
  fails the whole meeting.
- **Moderator slips are fatal.** `UnknownSpeaker` (including `next: ""` with `done: false`) and
  `UnknownAssignee` (`crates/agents/src/meetings.rs:249-253, 317-321`) end the meeting with no
  repair.
- **Reasoning handling is Qwen-only.** `enable_thinking: false` (`transformers-llm.ts:91`) and
  `<think>` stripping.
- **No context budgeting.** Revision prompts embed the full pretty-printed page plus the house
  style, and nothing checks the registry `context` value. The draft `max_tokens` alone is 16000
  (`pipeline.rs:118`).

### A.5 Model registry and readiness

Named models (`config/models.toml:32-106`):

| Id | HF repo | dtype | Download | VRAM | Tier | Status |
|---|---|---|---|---|---|---|
| `qwen3-0.6b-q4f16` | onnx-community/Qwen3-0.6B-ONNX | q4f16 | 570 MB | 900 MB | low | sha `TODO-UNVERIFIED` |
| `qwen3-4b-q4f16` | onnx-community/Qwen3-4B-ONNX | q4f16 | 2.8 GB | 4.2 GB | mid | sha `TODO-UNVERIFIED` |
| `gpt-oss-20b-q4f16` | onnx-community/gpt-oss-20b-ONNX | q4f16 | 12.8 GB | 14.5 GB | high | sha `TODO-UNVERIFIED` |
| `ternary-bonsai-2-27b` | `TODO-UNKNOWN/…` | ternary | 7 GB | 9 GB | high | `eval_pending = true` |
| `muse-glimmer-30b` | `TODO-UNKNOWN/…` | q4f16 | 16 GB | 18 GB | high | `eval_pending = true` |

- The client bundle (`registry.default.ts`) adds `granite-4.0-350m-q4f16` (260 MB, chatter only)
  and marks every entry `evalPending: true`. All sizes, limits and repo ids are estimates; the
  banner (`models.toml:4-11`) says Hugging Face was unreachable when the file was written.
- `chooseModels` excludes `evalPending` models by default (`capabilities.ts:119`), so the
  bundled registry yields tier `agency-only` on every device unless `allowEvalPending: true`.
- `loadRegistry` fetches `/config/models.toml` (`registry.ts:170`), but no route serves it in
  `crates/server/src/app.rs` or `vite.config.ts`, so it falls back to the bundle.
- Rust's `ModelEntry::verified_sha256()` (`crates/agents/src/models.rs:43-53`) refuses
  placeholders, but the browser never checks: `download.ts:18-21` says sha256 "is not wired to
  per-file checks yet".
- **Tier vocabularies disagree.** Rust and TOML use `low|mid|high` (`roles.rs:302-306`). The
  client uses `tiny|small|large|xl` with aliases (`registry.ts:26-32`). The architecture doc
  uses `chatter|laptop|high|frontier-local|agency-only`.
- **Download and caching today:** Transformers.js Cache Storage (`transformers-cache`), keyed by
  Hub URL. No OPFS, no Range resume, no integrity check (`download.ts:4-21`).
  `hybrid-inference.md` claims "resumable via range requests" and "`sha256` verified"; neither
  is implemented for that path.
- **What has ever been run:** `e2e/llm.spec.ts` (worker + Transformers.js + onnxruntime-web with
  `tiny-random-llama`, a ~150 kB random-weight model built in TypeScript; skipped unless
  `LLM_E2E=1`); `e2e/llm-leader.spec.ts` (Web Locks, no model); vitest for `FakeLlm`, the repair
  loop, the scheduler state machine and tier selection. **No real Hub model has been loaded.**
  `artifacts/bench/` is absent.

### A.6 Routing between local and cloud

- `config/roles.toml` defines executors per job (`browser`, `browser_then_claude`, `claude`,
  `min_tier`). `RolesConfig::route(...) -> Route` (`crates/agents/src/roles.rs:601-635`) exists.
- Its only callers are in `crates/agents/tests`. `crates/orchestrator` holds a single
  `llm: Arc<dyn Llm>` (`run.rs:68-73`) and never touches `RolesConfig`, `Route` or
  `ModelRegistry`. The server has no LLM code.
- **MVP consequence (ADR-0057):** there is one backend per company session and no cloud route.
  The routing table is not consulted; `browser_then_claude` and `claude` executors are out of
  the MVP.

### A.7 The editorial pipeline as implemented

Four job kinds (`crates/orchestrator/src/lib.rs:46-51`); the sim also reserves `Brief`, unused.

- **Standup** (`run.rs:304-405`): moderator = editor-in-chief (else editor) with
  `prompts/editor_in_chief.md`; others get `meeting_speaker.md`. The only input is the agenda
  string "Daily standup for {brand}: what we publish next." (`run.rs:312-319`): no backlog,
  sitemap, calendar or published history. Up to `standup_max_turns` (4) rounds of a moderator
  structured call `{next, prompt, done}` (512 tokens) plus a speaker `generate` (600 tokens),
  then an outcome structured call (2000 tokens) with schema (`meetings.rs:142-173`)
  `{briefs:[{title, angle, assignee ∈ ids, keywords[], target_words 100..5000}], decisions[], escalations[{kind, summary}]}`.
  Each brief becomes a `BriefRecord` under `brief_ref = xxh3(company, job_id, index)` with
  `content_id`, `slug = slugify(title)`. `escalations` and `decisions` are discarded.
- **Draft** (`run.rs:407-568`): system = `writer.md` + site layer + persona + hand-written
  `ARTICLE_BLOCK_DOCS` (`article.rs:48-55`); one structured call (`max_tokens` 16000) returning
  `{id, slug:{en}, title:{en}, page_type:"blog-article", seo:{title, description}, body:[≥3 blocks]}`
  with blocks `paragraph`, `heading`, `quote`, `list`, `callout`, `faq`; validation by
  `content_schema::validate_page` plus banned phrases with 2 repair turns. The orchestrator
  overwrites `id`, `slug`, `status:"draft"`, then opens the PR at
  `content/pages/blog/<slug>.json` on `drafts/content-<id>`.
- **Review** (`run.rs:570-636`): `editor.md` with the bar, the brief and the page JSON; returns
  `{decision, score 1..10, notes, issues[], high_risk[]}` (`pipeline.rs:142-155`), `max_tokens`
  4096. `ok` is false on any `high_risk` entry or a `reject`. The sim applies the bar (≥7),
  allows at most 3 revisions, then blocks with an Escalation ticket (`plan.rs:663-679`).
- **Publish** (`run.rs:638-686`): no model call; merge at the recorded head sha, then
  `DeployLanded` from the central event stream.

Not implemented in the session path:

- **Closed-world checks.** `knowledge::KnowledgeBase::check_links`/`check_media` exist, but no
  crate depends on `knowledge`. `NeedsPage` and `NeedsMedia` are never raised. (CLAUDE.md rule 5
  is stated as "never break" and is enforced nowhere in the running path.)
- **Numbers validator.** `jobs::numbers` exists only for CFO and data jobs.
- **QA gate.** `qa_coherence_review` exists in `qa.rs` and is never called (FEAT-034 planned).
- **Research, SEO, media, linking, design.** `seo_plan` and `photo_selection` exist as functions
  in `crates/agents/src/jobs/` with no sim job kind and no orchestrator path.
- **Media blocks.** The article schema has none, so articles are text only.

Doc versus code (`docs/architecture/agents.md`): the doc describes Pitch → Brief → Draft → Media
→ Edit → QA → Publish, per-role tools, block docs generated from the schema registry, a
deterministic moderator fed by the backlog and `content-calendar.json`, and `FakeClaude` in
`crates/testkit`. The code has none of the tools, hand-written block docs, an LLM moderator with
no backlog, and `FakeClaude` in `crates/claude`.

### A.8 Knowledge and context

- `crates/knowledge` is complete but orphaned: manifest, entity, media, page and collection
  indexes from a `SiteSource` (`DirSource`, `MemSource`); `resolve_link`, `find_link_targets`,
  `resolve_media`, `suggest_media`, `check_page`, `audit`. No GitHub-backed source.
- The browser gets nothing. `SiteBindingJson` (`bridge.ts:55-64`) carries only ids, brand,
  language, `style_guide`, optional `writer_prompt` and three numbers. The session supplies a
  trimmed test fixture of the style guide (`session.ts:19, 35-44`).
- The real inputs sit unused in the site repo under `content/config/`, with 157 page JSON files
  under `content/pages` (19 blog articles).
- No content fetch exists: the gateway has only draft and merge.
- Nothing decides topics day to day: no memory of yesterday, no calendar, no dedupe.
- **A repeated title overwrites.** `slugify(title)` is the file path and `open_draft` upserts
  (`crates/github/src/content.rs:211-222`).

### A.9 Day two and beyond

- Standups are daily per active project (`world.rs:1048-1090`) and may create up to 8 briefs
  each (`plan.rs:46`). No work-in-progress limit.
- Jobs run strictly one at a time (`loop.ts:378-430`).
- A game day is 20 real minutes (`clock.rs:88`; 12,000 steps). The 60-game-minute standup
  timeout is 50 real seconds, and the hold starts at 30 game minutes, about 25 seconds
  (`loop.ts:95, 155-165`). The hold covers standups only.
- No timeout or cancel anywhere: a hung generate stalls the queue forever.
- Any `ok:false`, or a fourth failed review, blocks the item with an Escalation ticket whose
  default is Kill after 1 game day = 20 real minutes (`inbox.rs:129, 143, 148-152`). The PR and
  `drafts/` branch are left open.
- `Plan.items` is never pruned, `loop.jobs` grows without bound, and `plan_json()` is parsed at
  every boundary (`loop.ts:159, 184, 310`).
- Reload mid-job re-runs the model call and duplicates plan posts (`loop.ts:13-16`).
- Web research: only the server half of ADR-0040 tier 1 exists (`GET /web/fetch`,
  `crates/server/src/web.rs`); no client calls it and no web tool is offered to any model.
  `ARTICLE_BLOCK_DOCS` invites "real, attributable quotes from the material you were given", and
  no material is given.

### A.10 Evals

`crates/agents/tests/pipeline.rs`, `crates/orchestrator/tests/loop.rs`,
`orchestrator-wasm/tests/loop.test.ts`, `bridge.test.ts`, `e2e/orchestrator.spec.ts`,
`e2e/mvp.spec.ts` all test plumbing with scripted text. FEAT-036 is planned and its paths
(`crates/agents/src/bin/eval.rs`, `crates/agents/evals/`, `bench/model-eval`,
`bench/agent-pipeline`) are absent.

## B. The real GitHub path and the live site

### B.1 Backend selection

`crates/server/src/config.rs:205-220`, `crates/server/src/gateway.rs:70-105`:

| Env | Effect |
|---|---|
| `SWARMPRESS_GITHUB=fake` | `RepoBackend::Fake`; repos are auto-created on first use (`gateway.rs:118-127`) |
| unset, empty or `real` | `GithubMode::Real`; any other value aborts startup |
| `GITHUB_TOKEN` | `RepoBackend::Token`; wins over the App if both are set |
| `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY_PATH` | `RepoBackend::App`; the PEM is read at startup |
| neither | `Unconfigured`; every gateway call returns 503 |
| `GITHUB_API_URL` | API base, shared with OAuth |
| `GITHUB_WEBHOOK_SECRET` | `/webhooks/github` returns 503 without it |
| `SWARMPRESS_SIMULATE_DEPLOY` | defaults on only with the fake |
| `GITHUB_SITES_ORG` | default repo owner, `swarmpress-sites` |
| `GITHUB_OAUTH_CLIENT_ID/_SECRET`, `GITHUB_OAUTH_AUTHORIZE_URL`, `GITHUB_OAUTH_TOKEN_URL` | player login only |

- **Token mode (MVP):** `SWARMPRESS_GITHUB=real` and `GITHUB_TOKEN`. From memory, a fine-grained
  token on the site repo needs Contents read/write, Pull requests read/write, Metadata read, and
  Actions or Deployments read for deploy polling.
- **App mode:** not needed for a single-owner MVP. No installations table; `api_for` calls
  `installation_for_repo` on every draft and merge (`gateway.rs:134`).
- **Never exercised against real GitHub.** `crates/github/tests/http_contract.rs` is wiremock
  only.

### B.2 API calls and real-world conditions

- **Draft** (`open_draft`, `crates/github/src/content.rs:211-237`): `get_branch` → `create_branch`
  if missing; `get_file` → `put_file` via the Contents API with the blob sha, 3 retries on
  conflict; `find_open_pr` → `create_pr` (`draft: false`); `get_pr` on a revision. Through
  `GuardedRepo(ContentAgent)`.
- **Merge** (`merge_draft`, 242-272): `get_pr`, `merge_pr` squash with `sha` = reviewed head,
  title `"{pr.title} (#{n})"`. Raw API as platform bot.

| Condition | What happens |
|---|---|
| Branch protection | None on `main` today. If added, merge returns 405 → `NotMergeable` → HTTP 409; the loop retries twice and the job fails rather than waiting |
| Required checks | None. `deploy.yml` runs only on push to `main`; a content PR has no CI before merge |
| Merge conflict | 405, same path. Nothing rebases the branch |
| Head moved | 409 → `Conflict("head moved")` |
| Existing branch for the same content id | Reused, never updated from base. Identical content after an earlier merge gives 422 "No commits between" → 502 |
| Stale branches | `delete_branch_on_merge: false` on the repo; merged draft branches pile up |
| Rate limits | Governor plus retries (`http.rs:207-255`), then 429 |
| Slug collision | `page_path()` is `content/pages/blog/{slug}.json`; an existing article is overwritten. `slugify` can return an empty string (`content/pages/blog/.json`) |

Branch names: the orchestrator's ids are `content-{hex}`, so branches are
`drafts/content-content-{hex}`; legacy branches are `drafts/content-{uuid}`.

### B.3 Company ↔ repository binding

- `POST /api/companies {name, site_repo?, base_branch?}` accepts both
  (`crates/server/src/companies.rs:30-60`). Default `{GITHUB_SITES_ORG}/{login}-site` on `main`.
- **No update route.** One company per user. An existing dev company must be re-created, or the
  row edited in SQLite.
- **The client never sends it.** `session.ts:294` calls `createCompany({ name })` only.
  `CreateCompany` in `apps/game/src/net/central.ts:48` already has the optional field.
- **No ownership check.** Any signed-in user can bind any `owner/name`. Acceptable only because
  the bind is `127.0.0.1`.

### B.4 Deploy feedback

- `POST /webhooks/github` exists (`crates/server/src/webhooks.rs`): HMAC verified, deduped by
  delivery id. Only `deployment_status` is acted on (success → `DeployLanded`, failure/error →
  `DeployFailed`); other events are parsed and ignored.
- The handler maps `deployment.sha` to the gateway PR through `pr_by_merged_sha`. The last real
  Pages deployment has `sha = 2d5683c` (the squash commit), environment `github-pages`.
- With simulation off, the webhook is the only source. There is no poller.
- **`DeployFailed` is never consumed.** The client handles only `DeployLanded`
  (`session.ts:353`) and sim-core has no failure command. A failed or missing deploy leaves the
  item `Scheduled` forever.
- **Queued deploys can be skipped.** `deploy.yml` uses `concurrency: pages` with
  `cancel-in-progress: false`.
- Options for localhost: the leftover smee webhook on the site repo
  (`https://smee.io/DGG7mVlrWR2zB1M4`, events `*`; its URL is public in
  `legacy-ts:package.json:15`), or **polling** via `RepoApi::list_check_runs(repo, sha)` — chosen
  (G5).

### B.5 The live site repository (`swarmpress/cinqueterre.travel`, `main` at `2d5683c`)

- Layout: `CNAME`, `README.md`, `content/`, `.github/workflows/deploy.yml` (the only workflow);
  legacy leftovers `build-all-pages.js`, `build-and-deploy.sh`, `populate-fr-pages.js`,
  `scripts/preview-server.ts`, `content-audit.json`, `content.backup.20260108_212203/`; `dist`
  is a gitlink (mode 160000) with no `.gitmodules`.
- Remote branches: `main`, `gh-pages` (stale; Pages is `build_type: workflow`), two merged
  `drafts/content-{uuid}` branches, `content/null-1764929126944`. PRs 1–6 closed.
- **`deploy.yml` is not pinned:** it checks out `swarmpress/swarmpress` with no `ref:` using
  `MONOREPO_PAT`, pnpm 9 and Node 20, plain `pnpm install` at the monorepo root, `pnpm astro
  build` in the theme with `CONTENT_DIR=…/content/content/pages`, requires `de/en/fr/it` folders
  and ≥ 100 HTML files, deploys with `deploy-pages@v4`. **The last deploy ran 2026-05-12, before
  the monorepo tree was replaced; no deploy has run on the new tree.**
- Content tree: `content/pages/` (top-level pages, per-village directories, `blog/` with 19
  files, `drafts/` with one file), `content/blog/` (18 files duplicating `content/pages/blog`),
  `content/collections/*`, `content/config/`.
- 18 of 19 blog pages:
  `{id, slug{en,de,fr,it}, title{en}, page_type:"blog-article", seo{title{en}, description{en}}, template, body:[{type:"blog-article", post, content}], metadata, status, created_at, updated_at}`.
  The 19th (`last-light-on-sentiero-azzurro.json`, legacy agents) is close to the orchestrator's
  shape: en-only slug, `seo: {}`, `status: "draft"`, blocks `editorial-hero`, `editorial-intro`,
  `paragraph{markdown}`, `image`, `editor-note`, `closing-note`.
- The v1 `Page` schema (`crates/content-schema/schema/page.schema.json`) has
  `additionalProperties: false` with no `template`, and string `seo.title`: the 18 older pages
  fail it. The gateway does not validate (`gateway.rs:207` only checks "is an object").
- `content/pages/drafts/f93c6537….json` sits on `main` with `page_type: "draft"`: "The Vineyards
  Above Manarola" was approved but is a 404 on the live site.

### B.6 Will the live theme render an agent article?

Yes, with defects (all addressed in [mvp-pipeline.md](mvp-pipeline.md) §4):

- Route: `src/pages/[lang]/[...slug].astro:38-75` walks `CONTENT_DIR` and routes by
  `content.slug[lang]`. `https://cinqueterre.travel/en/blog/last-light-on-sentiero-azzurro/`
  returns 200.
- All six current block types have inline renderers (`ContentRenderer.astro:210-345`).
- No visible title or image (the only `<h1>` comes from `hero`/`editorial-hero`).
- Markdown shows literally; empty meta description (route reads `seo.description?.[lang]`);
  English only; not listed in the hand-curated `blog-index.json`; `status: "draft"` never
  flipped.

### B.7 The frozen theme and the rename

- Theme files are byte-identical to `legacy-ts`. Package name still
  `@swarm-press/theme-cinque-terre`; workspace glob present.
- Paths in `deploy.yml` still exist on `main`. The rename cannot break it by package name.
- `391d5de` is an ancestor of `main`.
- **The lockfile is not byte-identical for the theme importer:** one line changed (the vite
  version key lost its `(yaml@2.8.2)` peer suffix). Not "purely additive" under rule 9; probably
  harmless.
- The CI job "Frozen cinque-terre theme still builds (live site guard)"
  (`.github/workflows/ci.yml:310-331`) uses pnpm 8.15.0, Node 22 and `--frozen-lockfile`; the
  live workflow uses pnpm 9 and Node 20. It never tests the language folders or `CNAME`, never
  compares output with production, never builds with an agent-written page.

### B.8 The cutover runbook (`docs/runbooks/cinqueterre-cutover.md`, ADR-0023, FEAT-050)

| Step | Purpose | Done? | Needed for MVP? |
|---|---|---|---|
| 0 | Tag `legacy-final` and `legacy-ts`; pin the monorepo checkout to `391d5de…`; baseline crawl | Partly: `legacy-ts` exists on the remote; `legacy-final` does not; the pin is not applied; no baseline | **Yes (G1)** |
| 1 | Vendor the theme into `theme-legacy/` | No | No |
| 2 | Real `CONTENT_ROOT`; dedupe the blog | No | No |
| 3 | `site.manifest.json` | No | No |
| 4 | site-kit, `theme/`, `site-ci.yml` | No | No |
| 5 | Schema v2, `kit migrate` | No | No |
| 6 | `ImportSite` job → derived indexes | No | No (the knowledge pack serves the MVP) |
| 7 | Shadow mode: `ApproveAll` for 2 weeks | No, and not enforceable today | The intent applies: the publish gate |

- The runbook's ready commit on local branch `swarmpress/cutover-step-0` does not exist in the
  checkout.
- **Minimum safe subset for the MVP (G1):** the one-line pin plus the `legacy-final` tag; a
  `workflow_dispatch` run to confirm green before any agent PR; a small baseline; a human gate
  before merge.
- **Rollback:** revert the squash commit on `main` (`crates/github/src/revert.rs` exists, no
  gateway route); revert the pin commit; a failed deploy leaves the previous Pages artifact
  live.

### B.9 Running the server locally

- Documented: `cp .env.example .env`, `cargo run -p server --bin swarmpress-server`, `pnpm dev`,
  open `http://localhost:5173/?central=1&llm=fake&ff=09:00` (Vite proxies `/auth`, `/api`, `/ws`,
  `/web`).
- **Server plus built client is not documented.** `SWARMPRESS_STATIC_DIR` defaults to
  `apps/game/dist` with SPA fallback and COOP/COEP (`app.rs:163-187`). Open
  `http://localhost:8080/?central=1…` and set `SWARMPRESS_PUBLIC_URL=http://localhost:8080`
  (`.env.example` has `:5173`).
- The client only does dev login (`session.ts:185-192`); nothing references `/auth/github`. A
  real run needs `SWARMPRESS_DEV_AUTH=1`, on loopback only.
- The Vite proxy lacks `/webhooks` and `/t`.

### B.10 Safety rails

In place: PathPolicy (`content/**` only, `drafts/` branches only, protected files refused,
`.json` object ≤ 256 KiB); lease required for gateway calls; merge only of PRs this company
opened, at the exact reviewed head; editor bar ≥ 7 and at most 3 revisions; browser-side schema
and house-style validation; the workflow's ≥ 100 pages check.

Missing: server-side validation; human approval (`AutonomyPolicy` is stored and read nowhere);
draft PRs and previews; quotas.

### B.11 Attribution today

`PutFile` has only `branch, path, content, message, expected_sha`
(`crates/github/src/types.rs:90-96`); no `author` or `committer`. Messages `Draft: {title}` /
`Revision N: {title}`; squash title `{title} (#n)`. Author is the token identity.

## C. The game client and the sim

### C.1 What the player sees today

- URL parameters (`apps/game/src/main.ts:11-25`): `renderer`, `quality`, `t`, `speed`, `facing`,
  `seed`, `tz`, `ui=mock`, `central=1` (plus `login`, `llm=fake`, `store`, `ff`).
- In both modes the scene is driven by the live sim (`main.ts:127-131`). `demoRenderState` is a
  test fixture only. `docs/architecture/render-state.md` is stale on this (lines 10-15, 64-73).
- Office: procedural boxes from `layout_json()` (`render/office.ts:113-310`). The layout's
  `doors`, `props` and `entrance` are ignored; partition door gaps are invented; the corridor
  (z 6..8, x 10..12) has no floor; coffee machine, whiteboards, plants, camera rig and kitchen
  table are not drawn; `RoomKind` in TS lacks `finance-office` and `strategy-room`.
- Camera: orthographic iso, Q/E, wheel zoom, drag pan. No picking.
- Quality tiers: low / medium / high (`postfx.ts:19-23`); default `high` with no auto-detection.
- Staff: a capsule plus a sphere head, coloured per persona, no labels, no facing; only pose
  handled is a 0.82 Y-scale when seated at a desk. They move as a 10 Hz teleport with no
  interpolation.
- **The sim side is complete** despite FEAT-004 being `planned`: FSM (`staff.rs`), decision and
  movement (`world.rs:1177-1346`), A* (`pathfinding.rs`). `render_state()` emits pose, activity,
  path with `start_step` and speed, fatigue and morale; the JSON adds `meeting`,
  `path.waypoints`, `meetings[]` with `speaker`. The TS `RenderState` type declares none of it.

### C.2 Speech bubbles and meetings

- Sim: the 09:00 standup opens a meeting and requests a job; `ServerCommand::Utterance{meeting,
  seq, speaker, chars}` sets the speaker and duration (validated: meeting active, seq in order,
  speaker seated).
- Agents: `run_meeting` emits `MeetingEvent::{TurnStarted, Delta, TurnFinished, Closed}`.
- Store: a `transcripts` table and reader.
- Missing: the orchestrator discards meeting events (`run.rs:341`); transcript rows are written
  only after the whole meeting; `orchestrator-wasm` has no progress callback; nothing emits
  `Utterance`; no bubble rendering; `JobRequest` does not carry the meeting id
  (`bridge.ts:23-32`); `MeetingOutcome` ends the meeting immediately (`plan.rs:446-451`).

### C.3 Overlay UI

| Panel | Live data | Wired to real sim commands | Display-only or broken live |
|---|---|---|---|
| Plan | `plan_json` skeleton plus store text | none | Calendar, Timeline, Workload and Goals near-empty |
| Work item | brief, phases with progress, thread posts | CEO comment (text only) | Re-prioritize, Approve, Cancel, Reassign, Send to Agency, Accept proposal, Complete todo build commands the sim lacks |
| Inbox | `inbox_json` | `AnswerTicket`, `SetDelegation`, `Delegate` | summary always "Untriaged: no summary (no secretary)" |
| Finance | `finance_json` | none | `report` never set; alert labels fall back to the slug; `revenueStubbed` not shown |
| Org chart, profile card | `org_json` | Praise, Promote, SetSalary, Assign, Remove, Fire | — |
| Projects | `org_json` | budget, lead, status, create | — |
| Hiring | candidates | Hire | — |
| Performance | none | none | always empty live |
| HUD | day, clock, cash, runway, tickets, renderer, fps, version | none | no pause, no speed, no job status |

- Pause exists only as a devtools hook; speed only as a URL parameter.
- CEO comments in session mode are in memory and lost on reload.
- No link to the GitHub PR or the published page (`plan-wire.ts:63-72`, `WorkItem.tsx:214-225`).
- Tickets do not show the work item or the amount though the JSON has both.

### C.4 Inbox and CEO decisions

- Raised in the editorial loop: only `Escalation` (on any `JobCompleted{ok:false}` or a review
  failing at revision ≥ 3). Options Retry / Kill; default Kill after one game day.
- `DelegationPolicy`: Off, Low, LowAndMedium; the Secretary never answers High tickets or
  financial ones above EUR 5,000. The scenario sets Low.
- **`AutonomyPolicy` is stored and never read.** There is no CEO approval gate before merge.

### C.5 Data that could feed an Activity timeline today

| Source | Fields | Limits |
|---|---|---|
| `command_log` table | seq, step, kind, payload | Persistent and synced; no staff, no text |
| `plan_posts` table | type, author, to, text, payload, `created_at` | This device only; the reader drops `created_at` and caps at 50 per item |
| `loop.jobs` | id, kind, revision, work item, state, ok, score, error | In memory; staff discarded at `loop.ts:187-190`; no timestamps |
| Sim `plan_json` | phases with assignee, job, state, progress; pending jobs; feed (32 kept) | Deterministic |
| `transcripts` table | job, seq, speaker, text | Written, never read by the UI |
| Gateway calls, central events | op, PR number, branch, shas; DeployLanded payloads | In memory |

Reuse: `Panel`, `Tabs`, `Badge`, `PersonButton`, `Avatar`
(`apps/game/src/ui/components/common.tsx`), `ThreadPost` (`WorkItem.tsx:295`), the filter row
(`Plan.tsx:46-91`), the `PANELS` registry, a new `DataTopic`.

### C.6 Session lifecycle

- First load: dev login as `ceo`, company "`<login>` Dispatch", scenario `cinqueterre`. No
  founding screen, no loading indicator.
- The 13 (`crates/sim-core/src/personas.rs:68-81`): writers Giulia, Isabella, Lorenzo;
  editor-in-chief Sophia; editor Marco; photographer Francesca; CFO Elena; secretary Paolo;
  strategist Chiara; data scientist Matteo; web developer Luca; SEO Alessia; IT engineer Davide.
  Eleven rooms on a 24×16 lot. The standup has 10 attendees.
- Error surfaces: boot failure sets `document.body.dataset.error` and logs; loop errors go to
  the console; a halted loop freezes the clock with no message. Toasts exist only for command
  results.

### C.7 Time

- Hidden tabs: `requestAnimationFrame` stops, but `engine.getDeltaTime()` is the raw frame
  delta. On return the `while (acc >= 100)` loop runs every missed step in one frame. This is
  the opposite of what ADR-0048's context section assumes.
- Minimum phase times: draft 120 game minutes (100 s), review 60 (50 s), publish 15
  (`plan.rs:204-210`).
- `day_real_minutes` is part of the hash, so it must be fixed at founding. `Sim.scenario
  ("cinqueterre")` always uses `SimConfig::default()` (20-minute days); no wasm entry point
  selects 60.

### C.8 Sim systems versus feature status

| Feature | Doc status | Code |
|---|---|---|
| 002 clock, phases | in-progress | complete (`clock.rs`) |
| 003 building, rooms, devices | planned | implemented (`building.rs`, `equipment.rs`) |
| 004 staff FSM, pathfinding | planned | implemented |
| 005 morale, fatigue, promotion | planned | implemented; no skills or XP |
| 006 projects, pipeline | in-progress | Draft, Review, Publish only |
| 007 economy, ledger | planned | implemented; revenue is a stub returning 0 |
| 008 events deck | planned | absent |
| 009 inbox | planned | implemented |
| 010 progression, failure | planned | levels gate rooms and projects; "receivership" only freezes hiring; no game-over state |

Economy estimate (hand-computed): salaries about EUR 2,020 a day, rent 576, upkeep about 480,
overtime about 250; roughly EUR 3,300 per game day; start cash about EUR 190–200k after rooms
and equipment; runway 55–60 game days. Seven game days are safe.

### C.9 Tests and visuals

- e2e: `smoke.spec.ts`, `visual.spec.ts` (7 baselines), `ui.spec.ts`, `mvp.spec.ts`,
  `orchestrator.spec.ts`, `llm.spec.ts`, `llm-leader.spec.ts`. Nothing tests staff movement on
  screen, bubbles, a second day, or a real model.
- No frame-budget test. Per tick the client parses the full render-state JSON and rescopes every
  staff mesh against every light (`lighting.ts:32-43`).
- Cross-origin isolation: Vite and the server send COOP `same-origin` and COEP `credentialless`.

### C.10 What would fail a week-long run

Cash with an always-open tab (about 20 real hours at speed 1, before the hold/rest rule); burst
catch-up after a hidden tab; unbounded reload cost (replay from step 0; fixed by the world
snapshot, FEAT-060); silent stalls (halted loop, lost lease, standup hold behind a serial
backlog, auto-killed escalations); memory growth (`localLlmBridge.calls`, `loop.jobs`,
`received`, `plan.items` re-serialised every second); plan text not in central sync; the fake
script exhausting after one article.

## D. Contradictions between docs and code worth fixing as they are touched

- CLAUDE.md's architecture diagram shows the LocalLlm worker inside the browser loop; it is
  built but imported by nothing.
- `config/models.toml` sets `eval_pending = false` for three unverified models while
  `registry.default.ts` sets `evalPending: true` for the same ids.
- `hybrid-inference.md` shows a registry field set neither parser accepts, and still describes
  the retired offer/claim/lease protocol; `job-runner.ts` is dead code under ADR-0038.
- FEAT-032 lists `crates/agents/src/pipelines/**` and `crates/server/tests/full_pipeline*.rs`;
  neither exists (the file is `pipeline.rs`). FEAT-033 is `planned` with non-existent paths
  although `meetings.rs` is implemented. FEAT-043 is `planned` with a `crates/testkit/fixtures`
  path, while fixtures live under `crates/knowledge/tests`.
- The prompts tell the writer and editor that links and media "must come from the provided
  indexes", and no index is provided.
- Rule 12 says renderers never parse Markdown, yet the paragraph field is named `markdown` and
  the block docs invite bold and italic.
- `quality_bar` exists twice: in the site binding (`session.ts:40`) and in sim policies
  (`economy.rs:146`).
- `gateway.rs:11-12` and the server README say "the webhook produces `DeployLanded`", while
  FEAT-047 is `planned` and the handler ignores every other event its doc lists.
- The FEAT-046 criterion "one commit per PR update (tree API)" is not what the code does (one
  Contents-API commit per file).
- `.env.example` sets `SWARMPRESS_PUBLIC_URL` to `:5173` while enabling static serving on
  `:8080`.
- `legacy-final` does not exist; only `legacy-ts` does.
