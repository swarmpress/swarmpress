# MVP pipeline design: cinqueterre.travel on one resident local model

> **Status:** design, 2026-10-02. Decided in ADR-0058 to ADR-0062. Nothing here is built.
> Tracks **K, S, T, P, G, U, W, E** of [`docs/mvp.md`](../mvp.md).
> **Evidence status:** from reading the code. No builds or tests were run. Numbers marked
> "proposed" or "my number" are parameters to be set from runtime qualification
> ([mvp-runtime.md](mvp-runtime.md)) or by the owner.
> Principles applied: [`docs/reference/browser-agent-studio.md`](../reference/browser-agent-studio.md)
> sections 6, 9, 14–18, 20, 22, 26.

## 0. The setting

The owner runs their own company, the live cinqueterre.travel site, as CEO on their own machine.

- All inference is strictly local in the browser: one resident 27B model (Ternary-Bonsai-2,
  WebGPU, in a Dedicated Worker) shared by all staff, **one turn at a time**.
- No cloud model, no JSON-schema-constrained decoding, a working context of 8–16K tokens, and a
  model that reasons at length before answering. Assume tens of seconds to minutes per call.
- Staff write real articles; the editor (same model, different role prompt) reviews; **the CEO
  approves each article before it is merged**; merges deploy the live site.
- The existing isometric office stays. Game time must not depend on how fast the GPU is.

## Findings that shape the design

- **Blog pages render through the catch-all route.**
  `packages/site-builder/src/themes/cinque-terre/src/pages/[lang]/blog/[slug].astro` reads
  `BLOG_DIR` (`<content root>/blog`). The deploy workflow sets only `CONTENT_DIR`, so
  `content/pages/blog/*.json` is built by `[lang]/[...slug].astro`: one route per language key
  in the page's `slug`. That route passes no `type="article"`, so new articles get the default
  OG image and no Article JSON-LD. (Inferred from the code, not from a CI log.)
- **A v2 validator already accepts localized `seo`.** `content_model` (used by
  `KnowledgeBase::check_page`) accepts `seo.title: {en}` and media refs. Only
  `content_schema::validate_page` (v1, used by `site_validator`) insists on strings. No schema
  change is needed; switch validators.
- **`apply_option` dispatches on the option alone** (`crates/sim-core/src/inbox.rs:600`).
  `Approve` and `Reject` carry project semantics, so the publish gate needs its own options.
- **Deploys map by exact merged sha** (`crates/server/src/webhooks.rs:88`). Two merges in a
  burst leave the earlier item `Scheduled` forever, because the Pages concurrency group replaces
  pending runs.
- **Repair turns append the whole previous output, including reasoning**
  (`apps/game/src/llm/structured.ts:252`). On a model that reasons at length this overflows an
  8–16K context on the first repair.
- **`JsLlm` does not override `structured_checked`**, so semantic checks never get a repair turn
  in the browser.
- **`run_meeting`'s event callback is `+ Send`**, so a JS callback cannot be passed on wasm.
- **The gateway's `upsert_file` overwrites an existing base file** on a fresh branch. That is
  the slug-collision hole.
- **Speech bubbles (FEAT-025) are not built.** The render-state doc already specifies a
  `Bubbles` row; the struct lacks it.
- **The real runtime is not wired into the session** (`unwiredLlm()` in
  `apps/game/src/session/session.ts`).
- **The live agent-written article has broken links.** Its closing-note actions point at
  `/hiking/sentiero-azzurro` and `/stories/hiking` (not valid routes: the catch-all only emits
  language-prefixed routes), and its `status` is `draft`.

---

## 1. Staged article pipeline (P2, P3)

**Decision: stages are sub-steps inside the existing Draft and Review jobs. No sim change.**

- Rule 2: outline and section text never need to be sim facts.
- Rule 3: the sim still owns Draft → Review → Publish; stages only produce artifacts.
- Sim job kinds per stage would put a text-derived number (section count) into the sim, add
  about ten commands per article, and tie game time to stage count.

### Draft stages (revision 0)

| Stage key | Model call | Receives | Returns | Answer budget |
|---|---|---|---|---|
| `context#0` | none | brief, knowledge base | entity facts (≤5), link shortlist `L1..L8`, hero shortlist `M1..M6`, related titles | – |
| `outline#0` | structured | brief, shortlists, `page_prompts.blog_article` | Outline | ~600 tokens |
| `section#0` (intro), `section#i` | structured, one per section | outline, this section's points and word budget, digest of earlier sections, previous section's last paragraph, entity facts | SectionDraft | ≈1.3 × words + 150, ≤1,000 |
| `closing#0` | structured | outline, section digests | `{content}` | ~250 |
| `assemble`, `validate` | none | all parts | page JSON, error list by section | – |
| `fix#i.r` | structured | the failing section and its errors only | SectionDraft | as section |
| `commit` | gateway | page | PR | – |

- The digest per earlier section is heading, first sentence and last sentence (about 60 tokens).
- `max_tokens` is answer budget plus a reasoning allowance from a new
  `LlmProfile {context_tokens, reasoning_tokens, chars_per_token}` in the site binding. Runtime
  qualification supplies the values.
- The system prompt is a byte-stable prefix across calls (concept document §17). Prompt assembly
  reserves output first, then fills by priority.

### Schemas

They use only keywords the TS subset validator supports. A test asserts this.

```json
Outline: {"type":"object","additionalProperties":false,
 "required":["title","dek","category","hero","sections","closing_title","links"],
 "properties":{
  "title":{"type":"string","minLength":10,"maxLength":70},
  "dek":{"type":"string","minLength":40,"maxLength":160},
  "category":{"type":"string","enum":["<blog-index categories>"]},
  "hero":{"type":"string","enum":["M1","M2","..."]},
  "sections":{"type":"array","minItems":3,"maxItems":6,"items":{"type":"object","additionalProperties":false,
    "required":["heading","points","words"],"properties":{
     "heading":{"type":"string","minLength":3,"maxLength":70},
     "points":{"type":"array","minItems":2,"maxItems":4,"items":{"type":"string","minLength":1}},
     "words":{"type":"integer","minimum":100,"maximum":350}}}},
  "closing_title":{"type":"string","minLength":3,"maxLength":60},
  "links":{"type":"array","maxItems":2,"items":{"type":"string","enum":["L1","..."]}}}}

SectionDraft: {"type":"object","additionalProperties":false,"required":["blocks"],"properties":{
  "blocks":{"type":"array","minItems":1,"maxItems":6,"items":{"type":"object","additionalProperties":false,
   "required":["type","text","items"],"properties":{
    "type":{"type":"string","enum":["paragraph","list","tip"]},
    "text":{"type":"string"},
    "items":{"type":"array","maxItems":7,"items":{"type":"string","minLength":1}}}}}}}

Review: {decision: enum, score: 1..10, notes: string,
  issues: [{section: enum["title","intro","s1",…,"closing","whole"], problem, fix}] (maxItems 8),
  high_risk: [string]}
```

- One flat block shape replaces `anyOf`. Assembly maps `paragraph` → `paragraph{markdown}`,
  `list` → `list{ordered:false, items}`, `tip` → `callout{style:"info"}`.
- The orchestrator writes headings, hero, images, closing and `seo`; the model never does.
- Outline word budgets are normalised deterministically to the brief's target, not repaired.

### Per-section checks, run before the next section starts

- Shape semantics, banned phrases, plain text only, and 60–140% of the word budget.
- Emphasis markers and `[t](u)` are stripped deterministically. URLs and `<`/`>` are errors.
- Errors go back as a repair turn for that section only, at most 2 per section and 4 per job.
- Truncation retries with the section split in two (concept document §18).
- An unchanged section after a fix stops the loop (concept document §16, no-progress).

### Repair loop in Rust

- Add `agents::llm::structured_with_repair(llm, req, schema, check, max)`. It catches
  `InvalidOutput` from the bridge and semantic errors alike, and sends back only the stripped
  answer, capped, never the reasoning.
- Fix `apps/game/src/llm/structured.ts` the same way.

### Revisions (P3)

- `ArtifactRecord` gains
  `parts: {outline, sections[{id, heading, blocks, digest, words}], closing, hero}`.
- A revision job runs `revise#i` only for sections named in `issues`, plus `retitle#0` for
  `title`. Untouched sections stay byte-identical.
- A `whole` issue revises all sections; at most one is honoured.

### Review within context (P3)

- The editor receives reading text with section markers and the measured checks, not page JSON
  (about 40% fewer tokens).
- If the estimated tokens are ≤ 3,000 (parameter), use one call. Otherwise use
  `review_section#i` calls plus a `review_summary#0` over digests. The summary decides; any
  section score below bar − 2 forces `needs_changes`.

### Persistence

- New `Store` methods `get_stage` and `put_stage`, keyed `(company, job_id, stage, index)`,
  first write wins, plus an `input_hash`.
- A stage runner returns the stored value or runs and stores.
- When the sim retries a phase (new job id), a stage miss adopts the predecessor job's row if
  `input_hash` matches (predecessor from `ArtifactRecord.last_job[kind]`).
- Posts get a `dedupe` key `"{job}:{type}:{n}"` with a unique index. `open_draft` is already
  idempotent.

### Progress (P5)

- `Orchestrator` gains `progress: Option<Arc<dyn Progress>>`; `OrchestratorHandle` gains
  `set_progress(fn)`.
- Events are `{job_id, kind, staff, stage, index, total, state}`. The UI shows "Giulia is
  writing section 3 of 5", with counts only and no percentages.

### Files and functions

- `crates/agents/src/article.rs`: schemas, prompt builders, `assemble_page`, `sanitize_plain`,
  section checks.
- `crates/agents/src/llm.rs`: `structured_with_repair`.
- `crates/agents/src/pipeline.rs`: `EditorReview.issues` becomes tagged; `review_step` takes
  text.
- `crates/agents/prompts/writer.md`, `editor.md`: stage-oriented text.
- `crates/orchestrator/src/run.rs`: `draft`, `review`, new `stage()` helper.
- `crates/orchestrator/src/store.rs`: stage methods, `parts`, post dedupe.
- `crates/orchestrator-wasm/src/lib.rs`: `JsStore` stage calls, `JsProgress`.
- `apps/game/src/store/schema.ts` (migration 2: `job_stages`, `plan_posts.dedupe`,
  `plan_posts.job_id`) and `company-store.ts`.
- `apps/game/src/llm/structured.ts`.

**Golden impact:** no.

### Tests

- A `FakeLlm` loop where a failing section 3 triggers exactly one extra call and sections 1, 2,
  4 are not re-requested.
- Kill after section 2, re-run the same job: only the remaining stages call the model, and one
  PR and one post of each kind exist.
- A revision naming `s2` changes only `s2` bytes.
- Schema-subset test; repair-turn size bound test.
- Prompt-budget test: every rendered prompt ≤ ceiling minus reserves for a 1,500-word article.

**Size:** L. **Depends on:** §3 (shortlists), §4 (assembly target), and the runtime being wired.

---

## 2. Standup with real context and a real model (P4, U5)

### Protocol: a pitch round (amends ADR-0012 for the local tier; ADR-0062)

1. Deterministic cap. If the cap is 0, no model call: one system transcript line ("The desk is
   full: 3 articles await the CEO") and `MeetingOutcome{briefs: []}`.
2. Moderator opening: one `generate` call over the context pack.
3. One structured pitch per free writer, in staff-id order: `{say, title, angle, keywords[2..6]}`.
   `say` is the bubble text.
4. Moderator outcome: one structured call,
   `{commission: [{pitch: enum["P1"…], target_words: 500..1500}] (maxItems = cap), decisions, escalations}`.

- Briefs are built from the chosen pitches, so the assignee is always the pitcher and can never
  be unknown.
- This is 2 + N calls instead of 9, and the per-round moderator call (the main slip source) is
  gone.
- `decisions` and `escalations` are kept as a `minutes` post.

### Context pack (≤ ~1,200 tokens, lowest priority dropped first)

- Last 12 published titles and counts per category.
- In-flight items with status. The host adds these to the job JSON from `plan_json`.
- Up to 6 unpublished calendar topics for the season, chosen by wall-clock date passed in by the
  host (ADR-0048: seasons come from wall time).
- 3 under-covered entities and the entity name list.
- The cap.

### Cap

`min(free writers, WIP_LIMIT − open items, ⌊model minutes per game day ÷ measured minutes per article⌋, 8)`.

- The first two terms are sim facts and are also enforced in the sim (see §5's sim increment).
- The third is host policy: an average from the activity table, 1 until measured, with a default
  budget of 45 model minutes per game day (my number; make it a setting).
- The orchestrator truncates deterministically.

### De-duplication

- Each pitch is checked on arrival: the slug against existing page paths, in-flight briefs and
  earlier pitches; and title-plus-keywords token overlap ≥ 0.6 against existing titles.
- A duplicate gets one repair turn naming the conflict, then is dropped.

### Repair, not failure

- Truncated turn: keep the partial, cut at the last sentence. If empty, retry once with "two
  sentences", then skip the turn.
- Invalid pitch after repairs: skip that writer.
- Outcome call failure: commission the first `cap` valid pitches at a default length.

### Failure mode (rule 11)

- Zero valid pitches, or an infrastructure failure, sends the new
  `ServerCommand::JobFailed{job_id, reason}`.
- For a standup the sim ends the meeting and raises `TicketKind::StandupFailed` (options
  `Retry`/`Skip`, default `Skip`, deadline 1 game day).
- The sim's own 60-minute timeout raises the same ticket instead of dropping the job silently.

### Bubbles (U5)

- The orchestrator appends a transcript row after each turn, then emits
  `TurnFinished{job_id, seq, speaker, chars}`.
- The loop queues an `Utterance` and applies it at a step boundary. A rejected one (speaker not
  seated) is skipped without failing the loop.
- The next utterance waits `clamp(chars / 15, 3, 12)` real seconds.
- `MeetingOutcome` sits behind the job's utterance queue. The standup hold (§6) keeps the clock
  at 09:30 until it is applied, so the meeting stays open without a sim rule.
- `Meeting` gains `speak_from` and `speak_chars`; `RenderState` gains `bubbles`, as the
  render-state doc already specifies. Text is fetched from `transcripts` by `(job, seq)`.
- Typewriter animation runs client-side; streaming deltas are deferred.

### Files and functions

- `crates/agents/src/meetings.rs`: `run_pitch_round`, schemas, `trim_to_sentence`; drop the
  `Send` bound.
- `crates/orchestrator/src/run.rs`: `standup`.
- `crates/orchestrator/src/lib.rs`: `JobRequest.context`, `Outcome::JobFailed`.
- `crates/agents/prompts/editor_in_chief.md`, `meeting_speaker.md`.
- `apps/game/src/orchestration/loop.ts`: utterance queue, context enrichment.
- `crates/sim-core/src/world.rs`, `render_state.rs`, `plan.rs`.
- `apps/game/src/ui/bubbles/` (new).

**Golden impact:** yes for the sim parts (`JobFailed`, `StandupFailed`, `Meeting` fields). The
no-command golden cases time out a standup every day, so their hashes change. The orchestrator
parts have none.

### Tests

- Truncated speaker still yields a brief; duplicate pitch repaired then dropped; cap 0 makes
  zero model calls; outcome failure falls back.
- Sim: failed and timed-out standups raise the ticket; `Retry` re-requests.
- Loop: utterances apply in order while the meeting is active, and the outcome is applied last
  under fake timers.
- Bubble layout vitest (FEAT-025).

**Size:** M (orchestrator) + M (bubbles). **Depends on:** §3, and the sim increment for
`JobFailed`.

---

## 3. Site knowledge in the browser (K1, K2)

**Decision: compile `knowledge` into `orchestrator`, fed by one server-built pack.**

- `PageValidator` is synchronous and runs inside the repair loop, so rule 5's "validation
  errors returned to the model" needs the indexes in-process.
- A server check endpoint would put a network round trip into every repair and would not work
  with `FakeGateway` in native tests.
- The server needs the same crate anyway to enforce the closed world in `check_draft`.

### Pack (K1)

- `GET /api/gateway/knowledge` (lease required, ETag = base head sha) returns
  `{commit, files: {path: text}, manifest: SiteManifest, pages: [PageEntry]}`. (`manifest` was added in the build: without it a loaded pack cannot reproduce the direct build's language order and site name.)
- `files` holds eight config files verbatim from `content/config/`: `entity-index.json`
  (12.5 kB), `media-index.json` (172 kB, 338 images), `sitemap-index.json` (33 kB),
  `style-guide.json`, `writer-prompt.json` (9.9 kB), `content-calendar.json`,
  `linking-policy.json`, `media-guidelines.json` (about 270 kB raw in total).
- `pages` and `blog-index.json` are read from a snapshot of `content/`.
- New `RepoApi::snapshot(repo, ref, prefix)`: the HTTP implementation uses the tarball
  endpoint, the fake enumerates its tree. Cached in memory per repo and head sha.
- Shipping all pages and collections (about 10 MB) is avoided.

### Browser (K2)

- The pack is stored in a `site_knowledge` row keyed by commit.
- It is refetched with `If-None-Match` at session start, before each standup, and after each
  `DeployLanded` or merge.
- In-flight slugs from local briefs are added to the collision set.
- `SiteBinding` is built from the pack, replacing the fixture style guide.

### Crate changes

- `PageEntry` derives `Deserialize`; add `PageRegistry::from_entries` and
  `KnowledgeBase::from_parts` (empty `CollectionIndex`; articles embed no collections).
- New `knowledge::pack::{build, load}`.

### Closed world (rule 5)

- `site_validator` becomes v2 schema + house style + `check_links` + `check_media`.
- Model-facing ids are the shortlist aliases only. The orchestrator resolves them to routes and
  URLs, so an unknown id is a schema error returned to the model.

### Hero selection

- `suggest_media(entity, category, mood, 12)` is already deterministic (score, then id).
- Drop images already used as heroes by existing articles; take 6; the outline picks one alias.
- Alt text comes from the index. An inline image is the next-ranked candidate, placed after the
  middle section.

### Tickets

- An empty shortlist sends `JobFailed{NeedsMedia}`, which raises `TicketKind::NeedsMedia`.
- A link need with no page records a `NeedsPage` ticket when the outline asks for a target the
  shortlist cannot serve.
- Until the sim increment lands, both surface as an Escalation with a status post.

### Size budget

`orchestrator_wasm_bg.wasm` is 1,055,980 bytes gzip against a CI budget of 1,267,200.
`knowledge` adds no new heavy dependency (`jsonschema` is already linked). Estimate: +40–80 kB
gzip, not measured. If it exceeds, raise the budget deliberately in `.github/workflows/ci.yml`.

### Files and functions

- `crates/knowledge/src/{pack.rs (new), kb.rs, pages.rs}`.
- `crates/github/src/{api.rs, http.rs, fake.rs}`: `snapshot`.
- `crates/server/src/gateway.rs`: `knowledge` handler; `crates/server/src/app.rs`: route;
  server `Cargo.toml` gains `knowledge` and `content-model`.
- `crates/orchestrator/src/{article.rs (site_validator), run.rs (SiteBinding.kb), gateway.rs}`.
- `crates/orchestrator-wasm/src/lib.rs`: `site_binding` takes the pack.
- `apps/game/src/net/central.ts`, `session/session.ts`, `store/schema.ts`.

**Golden impact:** none for the pack. `NeedsMedia` and `NeedsPage` ticket kinds ride the sim
increment.

### Tests

- Pack built from the site clone via `DirSource` round-trips to an equal `KnowledgeBase` (page
  count, media 338).
- Server: ETag/304, lease required, cache invalidated by a merge.
- Orchestrator: invented media URL and unknown href come back as section-scoped errors; empty
  shortlist yields `NeedsMedia`.
- CI size-budget step.

**Size:** M. **Depends on:** nothing; can start immediately (after the epoch lease lands, so the
handler uses the fenced lease check).

---

## 4. Article shape for the frozen theme (P1, G3, G4)

The frozen theme (`packages/site-builder/src/themes/cinque-terre`, CLAUDE.md rule 9) is not
touched.

### Body (built by the orchestrator in this order)

1. `editorial-hero{title, subtitle: dek, badge: category, image: media URL, height: "70vh"}`.
   This supplies the only `<h1>`.
2. Intro `paragraph` blocks.
3. Per section: `heading` level 2, then `paragraph` / `list` / `callout`. One optional `image`
   after the middle section.
4. `closing-note{badge: "Practical Notes", title, content, actions}`, with actions built from
   the chosen link aliases.

Excluded for the MVP:

- `editorial-intro`: its fields are HTML.
- `editor-note`: an invented first-person anecdote.
- `quote`: there is no attributable source material.
- `faq`.

### Text

- Plain text only, because the theme prints `markdown` literally.
- `editorial-hero.title` and `closing-note.content` go through `set:html`, so the orchestrator
  HTML-escapes them and the server rejects raw `<` or `>` in those fields.
- Media is written as the index URL with a deterministic Unsplash sizing query; `url_identity`
  ignores the query. The media id is recorded in `metadata`.

### Envelope

- `seo: {title: {en: "<title> | The Dispatch"}, description: {en: dek}, keywords}`. This is the
  object shape the theme reads, and it is valid under v2.
- `metadata` carries author, category, hero media id and brief ref.
- `status` is `in_review` on the draft branch and flipped to `published` at merge.
- The slug comes from the brief and stays fixed even if the outline retitles.

### Language: English text, four slug keys (en/de/fr/it) — owner decision, default chosen

- `/de`, `/fr` and `/it` routes render the English text, as 17 of the 19 existing articles do.
- The reason is that `blog-index.json` is one file for all locales and links
  `/{locale}/blog/{slug}`. An `en`-only slug would make three index pages link to a 404.
- Cost: mislabelled `lang` on those routes. Translation is not possible on this theme anyway,
  because core blocks print strings.
- The alternative is an `en`-only slug and accepting the broken index links.

### Finalise at merge (G4; server, same pull request)

Under a per-repo mutex, `gateway::merge`:

1. Verifies the branch head equals the reviewed sha.
2. Merges base into the branch (new `RepoApi::merge_branch`, GitHub Merges API). The branch only
   ever added one new file, so this cannot conflict.
3. Writes the page with `status: "published"` and `updated_at`.
4. Writes `blog-index.json` as the branch's current content plus a story entry derived from the
   page (title, excerpt = dek, author, date, read time from words, category, hero URL), skipped
   if the slug is already present.
5. Squash-merges at the new head.

The index is never touched before finalise, so two open PRs cannot conflict on it.

### Server checks (G3)

- Pure `check_article_profile(page, path, content_id)` for `content/pages/blog/*.json`: v2
  schema; `page_type`; allowed block set and order; exactly one hero, first; closing last; no
  `<`/`>` in the two HTML fields; `id == content_id`; slug matches the file stem.
- Async `check_against_site`: `check_links`, `check_media`; the path must not exist on base
  (create-only); no other open gateway PR of the company targets the path. A violation returns
  409.

### Files and functions

- `crates/orchestrator/src/article.rs`: `ARTICLE_BLOCK_DOCS`, drop `article_schema` as the
  model-facing schema.
- `crates/agents/src/article.rs`: `assemble_page`, `html_escape`.
- `crates/server/src/gateway.rs`: `check_draft`, `draft`, `merge`, `finalize_publish`.
- `crates/github/src/{api.rs, http.rs, fake.rs, content.rs}`: `merge_branch`.
- `crates/server/src/db/gateway.rs`: `open_pr_for_path`.
- `crates/orchestrator/src/gateway.rs`: `FakeGateway` models finalise.

**Golden impact:** no.

### Tests

- A fixture article passes v2 and the profile check. Each violation maps to the right status
  code; collision with an existing slug and with a second open PR returns 409.
- Two PRs opened from the same base both merge, and the index holds both entries.
- Render test: build the frozen theme read-only against a fixture content directory containing
  one generated article; assert exactly one `<h1>`, no "Unknown block type", and the index card
  present. This needs a new suite in `cockpit.toml`.

**Size:** M. **Depends on:** §3 (server knowledge) for the closed-world half.

---

## 5. CEO publish gate and deploy failure (S, U1, G5)

### Sim increment (S) — one deliberate golden re-baseline, shared with §2, §3 and §7

- **Gate.** After a review ≥ bar, `advance_work` consults `company.policies.autonomy`.
  - `ApproveAll` (default): status `Approved`, Publish phase stays `Pending`, raise
    `TicketKind::PublishApproval`.
  - `Autonomous`: start Publish as today.
  - `ApproveMajor`: auto-publish only when score ≥ 9 and revision is 0; otherwise the ticket.
- **Ticket.**
  - Priority High, so the Secretary can never answer it.
  - Options `[Publish, SendBack, Kill, Defer]`.
  - Default `Defer`, deadline 1 game day (rule 10: the default never publishes).
- **Option effects.**
  - `Publish` starts the Publish phase.
  - `SendBack` increments the revision and restarts Draft. The CEO's note is a store post that
    the revision job reads as an issue.
  - `Kill` cancels.
  - `Defer` leaves the item parked. A fresh ticket is raised at the next 08:30.
  - Parked items count toward the WIP limit, so an absent CEO stops new commissions rather than
    losing work.
- **`apply_option` dispatches on ticket kind.**
- **`ServerCommand::JobFailed{job_id, reason}`** with reason
  `Model | InvalidOutput | NeedsMedia | NeedsPage | Timeout | Cancelled | Infrastructure`.
  `JobCompleted{ok:false}` stays for compatibility.
- **`ServerCommand::DeployFailed{work_item}`**: valid when `Scheduled`; blocks the item and
  raises `TicketKind::DeployFailed` (`Retry`/`Acknowledge`, default `Acknowledge`). `Retry`
  requests the Publish job again; the merge is done, so the job redeploys when the server
  reports the deploy `failed` (`POST /api/gateway/redeploy`, FEAT-085).
- **Tickets added:** `PublishApproval`, `StandupFailed`, `DeployFailed`, `NeedsMedia`,
  `NeedsPage`.
- **Escalation default** (§7): the first escalation of an item defaults to `Retry`; any later
  one to `Kill`.
- **Invariants.** One active draft per writer; WIP ≤ limit, in `check_meeting_outcome`.
- **Views.** `Sim::next_due_step()` and `dueStep` in `plan_json` (no hash effect); meeting
  `speak_from`/`speak_chars` and render-state `bubbles`; `busy_with` and work item in staff
  render state.
- After the world-snapshot increment lands, bump its `WORLD_FORMAT` constant.

### What the ticket shows (U1; from the store, never the sim)

- Title, dek, score and editor notes.
- Measured checks, shown separately from the editor's opinion (concept document §20).
- Words against target, revision count, writer and editor.
- PR link built from `company.site_repo`, and the head sha.
- A preview: new `ArticlePreview.tsx` renders the page blocks into a sandboxed `srcdoc` iframe,
  labelled as an approximation of the live theme.

**Answer path:** Inbox → `AnswerTicket{ticket, Publish}` → `loop.apply` → logged. The Publish
job merges at the stored reviewed head.

### Deploy outcomes (G5)

- Server: on a successful deployment of sha S, emit `DeployLanded` for every merged, unlanded
  gateway PR of the repo merged at or before S (add `merged_at`, `landed_at`).
- `DeployFailed` events are forwarded.
- **Observation without a public address:** a background poller in the server over merged,
  unlanded pull requests, using `RepoApi::list_check_runs(repo, sha)` (exists:
  `crates/github/src/api.rs:84`) or the deployments API, publishing the same events with
  `source: "poll"`. The real merge commit shows check runs `build` and `deploy`. This doubles as
  the missing reconciler. Never enable `SWARMPRESS_SIMULATE_DEPLOY` in real mode.
- Host: if neither event arrives within a wall-clock limit (20 real minutes; my number), ask
  `GET /api/gateway/deploy-status`, then apply `DeployLanded` or `DeployFailed`. The timeout is
  wall-clock host policy (ADR-0048 §4), never sim time.

### Files and functions

- `crates/sim-core/src/{plan.rs (advance_work, apply_job_failed, apply_deploy_failed, check_meeting_outcome), inbox.rs, commands.rs, validate.rs, world.rs, render_state.rs, scenarios.rs (golden_script)}`.
- `crates/client-wasm/src/{lib.rs (SERVER_VARIANTS), json.rs}`.
- `crates/server/src/{webhooks.rs, deploys.rs (new), app.rs, db/gateway.rs, migrations/0003_*.sql}`
  (the epoch-lease increment owns `0002_executor.sql`).
- `apps/game/src/orchestration/loop.ts`: `DeployFailed`, deploy watchdog.
- `apps/game/src/ui/components/{Inbox.tsx, ArticlePreview.tsx}`.

**Golden impact:** yes. Update `GOLDEN_HASH` in `crates/sim-core/tests/golden.rs` and
`crates/client-wasm/tests/golden_wasm.rs`, and all cases in
`packages/runner/test/fixtures/golden.json`. `golden_script` gains the `Publish` answer.

### Tests

- No `RequestJob(Publish)` exists before a `Publish` answer under `ApproveAll`.
- Expiry never publishes and re-raises at 08:30.
- The Secretary cannot answer under any delegation policy.
- `SendBack` restarts Draft; `Autonomous` behaves as today.
- `DeployFailed` blocks with a ticket.
- Server: a burst of two merges with one deployment lands both.
- e2e: the MVP spec gains the approval click.

**Size:** M (sim) + M (UI, server). **Depends on:** §4 for the preview's page shape.

---

## 6. Game time independent of GPU speed (T)

**Rule: the clock holds while any pending job is due.**

- A work-item job is due at its phase's `min_done_step`; a standup at request + 30 game minutes.
- `holdClock` becomes `halted || modelNotReady || sim.step() >= sim.next_due_step()`.
- Every action then costs exactly its phase minimum in game time on any GPU. The hold is host
  policy: the log still records only `(seq, step, json)`.

Also in the host:

- **Clamp.** `acc = min(acc + dt, 500 ms)` in `apps/game/src/main.ts`, so returning to a hidden
  tab never bursts. (Today `engine.getDeltaTime()` is unclamped: an hour away is 36,000 steps in
  one synchronous loop, three game days and three payrolls.)
- **Queue order.** Earliest due step first, ties by job id, replacing FIFO.
- **Rest.** At or after 22:00 with no pending job and no queued command, the clock stops with a
  "day done" card. The next day starts on a click, or automatically while an "unattended days"
  counter is positive. The night is skipped by fast stepping. Deadlines burn only played time.
- **Hidden tab.** A 1 Hz worker timer drives `boundary()` and bounded stepping so work in
  flight can finish; then the rest rule applies.
- **Other holds.** Model download, GPU recovery and a halted loop hold the clock (concept
  document §6, §22). An open approval ticket does not hold while other work is in flight.
- **HUD chip.** Running / Held ("Giulia · draft · section 3 of 5") / Resting / Model loading /
  Lease lost / Halted; pause and speed buttons; a boot screen.

### Worked cases (one game minute is 8.33 steps; a day is 12,000 steps = 20 real minutes)

- **A draft taking 12 real minutes.** The phase starts at step S, due S + 1,000. The clock runs
  100 seconds, then holds for about 10 minutes. The outcome applies at S + 1,000 and Review
  starts at S + 1,001. Game cost is 120 minutes whether the draft took one minute or twelve.
- **Two writers, one model.** Both drafts are due at S + 1,000 and the model runs them in turn.
  The clock holds at S + 1,000 for about 22 minutes, then both items move to Review together.
  In game time they worked in parallel; in wall time serially.
- **Tomorrow's standup against yesterday's review.** A review cannot outlive its due step, so it
  can only overlap inside its own hour. If it started at 08:40, the clock runs to 09:30 and
  holds; the running review finishes (no preemption), then the standup runs. The standup's
  context lists the item, and the cap counts it.
- **Replay.** Wall time decides only at which step an outcome is logged. Replay applies it at
  that step. One caveat: `seq_step`/`next_seq` are in the hash, so runs with different latencies
  have different logs and transient hashes, though the same gameplay state at the next phase
  boundary. If identical logs across machines matter later, apply outcomes exactly at the due
  step; that is a few lines in `boundary()`.
- **What the player sees.** The HUD chip. During a hold, people keep their poses and nobody
  walks. Panels and ticket answers still work, because commands apply at boundaries while held.

**Day length: keep 20 real minutes.** With holds, a game day's wall time is dominated by
inference (estimate: 40–70 minutes with two articles). A longer day only adds idle clock, and it
is part of the hash.

### Files and functions

- `apps/game/src/orchestration/loop.ts`: `holdClock`, queue order.
- `apps/game/src/session/clock-driver.ts` (new; pure `stepsToRun`).
- `apps/game/src/main.ts`, `session/session.ts`, `ui/hud.tsx`.
- `crates/client-wasm/src/{lib.rs, json.rs}` (the `next_due_step` view).

**Golden impact:** no.

### Tests

- `clock-driver` unit tests: clamp, hold, rest, night skip.
- Loop test with fake latencies of 0, 60 s and 12 min: the phase completes at the same step in
  all three, and replay of each log reproduces its hash.
- Two queued drafts hold, then both advance.
- Hidden-tab simulation produces no burst.

**Size:** M. **Depends on:** `next_due_step` only (view, no sim state).

---

## 7. Unattended robustness for a week (P6, G7, W)

- **Timeout and cancel (P6).**
  - `OrchestratorHandle.cancel()` sets a flag checked between stages.
  - The bridge keeps an `AbortController` for the call in flight.
  - Wall-clock limits per stage and per job (values from runtime qualification) abort, retry the
    stage once, then send `JobFailed{Timeout}`. Completed stages survive.
  - GPU device loss is not a job failure: the queue pauses, the clock holds, the model reloads,
    the job resumes from stored stages.
- **Escalation default (S).** The first escalation of an item defaults to `Retry` (transient
  failure is the common case with a local model). Any later one defaults to `Kill`. Each has a
  1 game day deadline, which now burns only played time. (Today: Kill after one game day, which
  is 20 real minutes; the PR and `drafts/` branch are left open.)
- **Orphans (G7).**
  - A host sweeper at day start closes the PR and deletes the branch of every artifact whose sim
    item is `cancelled` and unmerged.
  - It uses a new `POST /api/gateway/close {number}`, limited to PRs this company opened,
    idempotent, and recorded on the artifact.
  - No sim effect is needed.
- **Bounded growth (W).**
  - `localLlmBridge.calls` (full prompts), `recordingGateway.calls` and the session's `received`
    events become ring buffers.
  - `loop.jobs` keeps the last 50.
  - `job_stages` rows are pruned 3 game days after their outcome is logged.
  - `holdClock` stops parsing the full plan every step.
  - `plan.items` is left alone; a week adds about 20 items.
- **Economy (W).**
  - Not run; computed from the constants. Starting cash near €195k and burn €3.3k per day give
    a runway of about 59 days, above the 30-day alert. Project spend of roughly €71k a month is
    under the €80k budget × 110%. So no finance tickets are expected in week one, and nothing
    must change.
  - Add a guard test (7 days, no revenue, zero finance tickets).
  - Follow-up, not MVP: around day 29 `RunwayLow` would be re-raised daily once acknowledged.

### Files and functions

- `crates/orchestrator-wasm/src/lib.rs`: `cancel`.
- `apps/game/src/orchestrator/bridge.ts`.
- `apps/game/src/orchestration/{loop.ts, sweeper.ts (new)}`.
- `crates/server/src/gateway.rs`: `close`.
- `crates/sim-core/src/inbox.rs`: default by prior escalations.

**Golden impact:** yes for the Escalation default (in the sim increment); otherwise no.

### Tests

- A hung fake model times out, the item blocks, and `Retry` adopts completed stages.
- Kill closes the PR once.
- A soak test of 7 game days on the fake model (realistic latency and failure rates) asserts
  flat heap, row counts and call-log size.
- The finance guard test.

**Size:** M. **Depends on:** §1 (stages) and §5 (`JobFailed`).

---

## 8. Activity timeline and attribution, lean (P5, U4, G6)

### Record (P5)

- An `activity` table in store migration 2.
- One row per stage attempt, and one job-level row (`stage = 'job'`).
- Columns: job id, stage, index, attempt, kind, revision, work item, staff, role, persona, model
  id, tokens in and out, wall ms, game step, day and minute, result, and a `detail` JSON.
- `detail` holds: errors, repairs, words, score, PR, branch, head and merged sha,
  `seq_from`/`seq_to`, world hash.

### Writer

- The host writes rows from progress events.
- The bridge calls `runStructured` directly to get usage. Jobs run one at a time, so calls
  between `StageStarted` and `StageFinished` belong to that stage.
- No `Llm` trait change.

### Forward compatibility with ADR-0056

- Every text write carries its `job_id`; the job row carries the command seq range and world
  hash.
- A work record is then the job row + its commands + its job-keyed text, chained in completion
  order.
- Stage rows are the record's "pending text". The post dedupe key is dropped when atomic record
  commit arrives.

### UI (U4)

- `Activity.tsx` lists jobs newest first with expandable stages; filters by staff, work item and
  kind; the in-flight job is pinned.
- A "Now" strip in the HUD and a label above the working person, using a shared anchor helper
  that bubbles also use.

### Gateway attribution (G6) — must land before the first live merge

- Draft and merge bodies gain
  `attribution {staff_id, persona, name, role, job_id, job_kind, revision, work_item, model, executor}`.
- `PutFile` and `MergeOptions` gain `author`.
- Draft-branch commits carry the persona as author; the email is synthesised server-side and
  never taken from the client.
- The squash commit carries `Co-authored-by` plus `Job`, `Job-Kind`, `Work-Item`, `Model`,
  `Executor`, `Reviewed-by`, `Approved-by` trailers.
- The squash author stays the App: the merge API has no author field. **This narrows ADR-0056
  decision 8.**
- Values are single-line and length-capped.
- Live history cannot be rewritten, hence the ordering constraint.

### Files and functions

- `apps/game/src/store/{schema.ts, company-store.ts}`.
- `apps/game/src/ui/{activity-source.ts, components/Activity.tsx}`.
- `apps/game/src/orchestrator/bridge.ts`.
- `crates/github/src/{types.rs, http.rs, fake.rs, content.rs}`.
- `crates/server/src/gateway.rs`.
- `crates/orchestrator/src/gateway.rs`: `Gateway` methods take attribution.

**Golden impact:** no.

### Tests

- After the fake MVP loop: one job row per job with staff and model, and stage rows for the
  draft.
- A reload does not duplicate rows.
- Fake GitHub commits carry author and trailers.
- Malformed attribution is refused.

**Size:** S (rows) + M (panel and labels) + S (attribution). **Depends on:** §1's progress
events.

---

## 9. Quality bar and evaluation (E; FEAT-036)

### Harness

- A browser page in the existing harness build: `apps/game/eval.html` plus
  `apps/game/src/harness/eval-harness.ts`.
- Real model, orchestrator wasm, an in-memory store, a local fake gateway, and a pack built from
  the site clone by a new `cargo xtask site-pack`.
- It runs N briefs through draft → review → revisions, and writes a `cockpit.benchmark.v1`
  document plus the page JSONs for reading.
- FEAT-036's paths move from `crates/agents/src/bin/eval.rs` to the harness.

### Inputs

- Briefs: the unpublished topics in `content-calendar.json` (about 20).
- The 19 existing articles (`content/pages/blog/` in the site repo) are the reference set. They
  calibrate the deterministic checks: a check that fails many accepted references is
  miscalibrated (for example "hidden gem" is on the style guide's avoid/replace list and in a
  live slug). They also serve as positive controls for the editor.
- Note: 16 of the 19 are 245–500 words, so MVP targets should be 600–1,200.

### Reported

- Schema-valid-first-try and repairs per stage type; truncation rate; tokens and seconds per
  stage and per article.
- Revisions to approval; share blocked by reason.
- Deterministic checks: words against target, link and media validity, banned phrases, heading
  structure, plain text, title and description length, near-duplicate paragraphs.

### "Publishable" threshold on ≥ 20 briefs, all of (**proposed; the owner sets the numbers**)

1. 100% of committed drafts pass the server's `check_draft` (the two validators agree).
2. At least 80% reach a score ≥ 7 within 3 revisions; median revisions ≤ 1.
3. First-try validity ≥ 90% per stage type; mean repairs ≤ 0.3; truncation ≤ 2%.
4. Every approved article within ±25% of target, with zero banned phrases and zero
   near-duplicate paragraphs.
5. Editor discrimination, because writer and editor are the same model: the editor scores < 7 on
   at least 5 of 6 seeded-bad drafts and ≥ 7 on at least 80% of the references.
6. The owner reads every approved article: at least 80% "would publish" and none factually
   wrong.
7. No job exceeds its timeout. Median minutes per article is reported, not gated.

### Rehearsal on a fork before the live repository (Milestone B)

- Run 7 game days with the gate on.
- Every merged article builds, has exactly one `<h1>`, appears in the index, and its links
  return 200.
- Open PRs equal the items awaiting approval.
- No loop halt and no stuck `Scheduled` item.
- Replay from the log reproduces the hash.
- Storage and heap are flat from day 1 to day 7.

**Golden impact:** no. **Tests:** the harness runs with `?llm=fake` in CI and emits stable
counts (gating); the live run is informational. **Size:** M. **Depends on:** §1, §3, §4.

---

## Ordered increments, mapped to the plan's ids

∥ = can be built in parallel with the one before.

| Review # | Plan ids | Increment | Notes |
|---|---|---|---|
| 0 | R1–R8 | Runtime wired into the session; qualification numbers | Separate track ([mvp-runtime.md](mvp-runtime.md)); prerequisite for real runs |
| 1 | K1, K2 | Knowledge pack, read endpoint, `knowledge` in orchestrator | Starts now |
| 2 ∥ | S | Sim increment: gate, `JobFailed`, `DeployFailed`, tickets, defaults, invariants, bubble fields, `next_due_step`; goldens once | Pure sim and JSON views |
| 3 ∥ | T | Host clock: due-step hold, clamp, rest, queue order | Needs only the view from S |
| 4 | P1 | Article shape, assembly, v2 and closed-world validator | After K |
| 5 | P2, P3, P5 | Staged draft, revise, review; stage store; progress; repair fixes; activity rows | After P1 |
| 6 ∥ | G3, G4, G5, G6 | Gateway: profile and collision checks, finalise-on-merge, deploy mapping, attribution | Parallel with P2 |
| 7 ∥ | U1 | Inbox approval UI and preview | After S and P1 |
| 8 | P4 | Standup pitch round with context, cap, de-dup, fallbacks | After K and S |
| 9 | P6, G5 | Timeout and cancel, deploy watchdog | After P2 |
| A | – | **Milestone A: real model, fake GitHub, article reaches the gate, approved, merged** | |
| 10 ∥ | E | Eval harness and thresholds | Can start after P2 |
| B | – | **Milestone B: threshold met; rehearsal on a fork with a real deploy** | Needs G1, G2 |
| C | – | **Milestone C: first article on the live repository** (cap 1, `ApproveAll`, verified live by hand) | |
| 11 ∥ | U4 | Activity panel, "Now" strip, labels | After C is fine |
| 12 ∥ | U5 | Speech bubbles and utterance playback | After C is fine |
| 13 | G7, W | Sweeper, bounded growth, hidden-tab driver, 7-day soak | Before any unattended week |

Not in the review but in the plan: **G1** (site repository preparation: pin `deploy.yml`, tag
`legacy-final`, one manual deploy, baseline), **G2** (bind the company to the real repo; token
mode; single-origin run; env-gated live test), **U2** (panel fixes on live data), **U3** (staff
visibly moving). See [mvp-gap-analysis.md](mvp-gap-analysis.md).

## Rules and ADRs the design amends

**CLAUDE.md** (to be edited by the increment that implements each):

- Rule 2: add `JobFailed`, `DeployFailed`, `Utterance` to the digest-carrying commands.
- Rule 3: add the publish gate under `AutonomyPolicy`.
- Rule 4: idempotency keyed by job id, stage and index.
- Rule 5: name the two ticket kinds; media is written as an index URL on the frozen theme.
- Rule 11: a failed standup raises a ticket.
- Rule 12: plain text and the escaped HTML fields on the frozen theme.
- Architecture box: gateway read endpoint, knowledge in the orchestrator, the clock hold.

**ADRs:**

- ADR-0058 staged jobs on a single resident model (amends ADR-0011, 0024).
- ADR-0059 publish gate and failure commands (amends ADR-0028, 0031).
- ADR-0060 game-time budgets, hold and rest in the browser (amends ADR-0048, 0020).
- ADR-0061 knowledge pack, gateway read / finalise / close, create-only paths (amends ADR-0013,
  0009).
- ADR-0062 local standup protocol (amends ADR-0012).
- Lean activity records and squash-commit authorship refine ADR-0056 (recorded in ADR-0058).

**Docs to update when built:** `docs/architecture/{agents,sim,render-state,browser-runtime,content-model}.md`,
and FEAT-025, 032, 033, 036, 039, 043, 078.

## Assumptions not verified

- The model's real context, speed, reasoning control, usage reporting and mid-generation cancel.
  All budgets are parameters.
- The deploy builds blog pages through the catch-all route, and the workflow checks out the
  monorepo's current default branch.
- The `orchestrator-wasm` size after adding `knowledge`.
- GitHub behaviour: the Contents API `author` field, the squash author when an App merges, the
  Merges API for bringing base into a branch, and that two branches appending to the same array
  position conflict.
- The week-one economy; computed, not run.
- That a hidden tab keeps the WebGPU worker running at useful speed.
- The 45-minute model budget, the 20-minute deploy limit and the eval thresholds are proposals.
