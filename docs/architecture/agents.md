# Agents (`crates/agents`, `crates/claude`)

> **Local-first update ([ADR-0038](../adr/0038-local-first-the-browser-is-authoritative-for-a-company.md)):**
> the pipelines run in `crates/orchestrator` (wasm, in the browser). Text goes to the browser
> store, and PRs go through the central gateway.

The staff of a swarm.press company are LLM agents with a role, a persona, a seniority and a place in
the building. They never run the company's process. Deterministic pipelines do that, call them
for artifacts, and decide transitions from what they return
([ADR-0011](../adr/0011-orchestrator-owns-state-transitions.md)).

Features: FEAT-030 to FEAT-036. The executor split between local models and Claude is described
in [hybrid-inference.md](hybrid-inference.md).

## Organisation and RBAC

The organisation is specified in [organization.md](../game-design/organization.md)
([ADR-0028](../adr/0028-organization-model-executive-office-and-departments.md)) and implemented
in `crates/agents/src/roles.rs`. Role and department names are kebab-case on the wire and match
`sim-core`'s `Role`.

| Department | Roles |
|---|---|
| `executive-office` | `cfo`, `secretary` |
| `strategy` | `strategist`, `analyst`, `data-scientist` |
| `editorial` | `editor-in-chief`, `editor`, `writer`, `translator`, `fact-checker` |
| `photo-video` | `photo-editor`, `photographer`, `video-producer` |
| `web-development` | `art-director`, `web-developer`, `ux-designer` |
| `it-operations` | `it-engineer`, `dev-ops` |
| `seo-marketing` | `seo-specialist`, `marketing-manager`, `social-media-manager` |

`ceo` (the player) and `system` (the orchestrator) are actors, not staff. Every staff role has a
salary band (`Role::salary_band_eur_month`) that persona salaries must fall in.

- RBAC is enforced by the **tool set** each role receives, and by the orchestrator, which accepts
  an artifact kind only from the roles allowed to produce it (`JobPolicy::performed_by`).
  - A Writer has no merge tool, and nobody does.
  - The web developer's `site-change` job returns artifacts only (a proposed diff); it never
    deploys.
- Publishing-plan edits are `PlanOp`s checked by `agents::validate_plan_ops` (role × op, plus
  contextual rules such as "only your own items"; [ADR-0031](../adr/0031-the-publishing-plan-is-the-shared-workspace-for-ceo-and-agents.md)).
- QuestionTickets are the only channel to the CEO. The Executive Secretary triages them first.

## Roles, jobs and models

`config/roles.toml` holds three tables:

- `[roles.*]`: the Claude model and effort per role for Agency (Claude-executed) jobs, with
  `web_search` (strategist, analyst, SEO, marketing) or `vision` (art director, web developer, UX
  designer) where the role needs them.
- `[seniority]`: a staff member's seniority overrides the model (Junior → haiku-4-5, Mid →
  sonnet-5-5, Senior/Star → opus-5-5). On the local model tier, seniority instead picks the model
  *within the device tier* ([ADR-0026](../adr/0026-model-registry-webgpu-capability-tiers.md)).
- `[jobs.*]`: one executor policy per `JobKind` ([ADR-0024](../adr/0024-hybrid-inference-browser-llms-and-claude.md)):
  the role that performs it (plus `also`, the fallbacks when a project team has nobody in that
  role), the executor (`browser`, `claude`, `browser_then_claude`), the minimum device tier and
  the output budget. A test fails if a `JobKind` has no policy or no prompt template.

| Executor | Jobs |
|---|---|
| `browser` | standup chatter; the secretary's triage, CEO briefing, draft reply and thread summary |
| `claude` | research, art direction, theme code, visual and critic reviews, project business case, site change, candidate generation |
| `browser_then_claude` | everything else: briefs, drafts, revisions, edit review, QA, translation, strategy pitch and weekly plan, KPI and content reports, plan scheduling, photo selection and briefs, ops check, SEO and marketing plans, newsletter, finance report, hiring affordability |

Organisation jobs live in `crates/agents/src/jobs/` and each has a structured-output schema plus a
validator that feeds errors back to the model:

- **CFO** (`finance-report`, `hiring-affordability`) and **data scientist** (`kpi-report`,
  `content-performance`, `experiment-readout`): every number in the output, including figures
  inside text, must appear in the input (`jobs::numbers`). Dropping decimals is allowed; anything
  else is an invented figure.
- **Executive Secretary** (`secretary-triage`): priority by the legacy rubric (HIGH: legal,
  financial, high-risk or a critical blocker; MEDIUM: strategy, resource allocation, policy; LOW:
  informational), a one-paragraph summary and a proposed option that must be one of the ticket's
  options.
- **Candidate generation**: the output must validate as a persona and receives the next free pool
  id.

## Personas

Personas are a data catalog ([ADR-0030](../adr/0030-personas-are-a-data-catalog-with-cv-hobbies-and-interests.md),
schema v2 in organization.md §3): one TOML file per person in `crates/agents/personas/`, embedded
at build time and validated strictly by `Catalog::builtin()` (unknown fields, empty fields, unique
ids and slugs, slug = file name, relationship targets, salary within the role's band, CV depth,
stated pronouns, non-partisan `world`).

| Id | Slug | Name | Role | Seniority |
|---|---|---|---|---|
| 1 | giulia | Giulia Rossi | writer (food, wine, restaurants) | senior |
| 2 | isabella | Isabella Ferraro | writer (hiking, beaches, outdoors) | senior |
| 3 | lorenzo | Lorenzo Bertolotti | writer (history, culture, villages) | senior |
| 4 | sophia | Sophia Lanza | editor-in-chief (hospitality background) | senior |
| 5 | marco | Marco Vitali | editor (practical information) | senior |
| 6 | francesca | Francesca De Luca | photographer | senior |
| 7 | elena | Elena Marchetti | cfo | senior |
| 8 | paolo | Paolo Bianchi | secretary | senior |
| 9 | chiara | Chiara Galli | strategist | mid |
| 10 | luca | Luca Moretti | web-developer | mid |
| 11 | davide | Davide Conti | it-engineer | senior |
| 12 | alessia | Alessia Ferri | seo-specialist | mid |
| 13 | matteo | Matteo Greco | data-scientist | mid |

Ids 100 and up are the **hiring pool** (18 candidates, junior to star, covering every staff role).
The writers keep their legacy voice (writing style, voice, content preferences, sample phrases in
en/de/fr/it). Work routing uses `affinities`: `best_writer_for(topic, team)` picks the writer whose
affinities match the topic, with the legacy `agent-page-mapping.ts` fallbacks.

`catalog_json()` and `cargo run -p agents --example export_catalog -- <out.json>` export the
catalog as camelCase JSON for tools and the UI. Content packs carry personas in the same shape:
`packages/sdk`'s `PersonaSchema` mirrors the Rust `Persona`, and a test fails when the two drift
([sdk.md](sdk.md)).

## Prompt layering

There are three levels (carried over from the legacy `specs/prompting.md`):

1. **Company / platform**: the role's system prompt, the tool contracts, the output schema, and
   the rules (closed world, never invent URLs or media, artifacts are data).
2. **Site**: house style from the site repo:
   - `style-guide.json`, including the **banned-phrase list**: "tourist trap", "must-see",
     "hidden gem", "bucket list", "instagrammable", "best-kept secret", "off the beaten path",
     "picture-perfect", "breathtaking", "stunning", "amazing", "world-famous", "iconic",
     "legendary";
   - `linking-policy.json`, `writer-prompt.json`, `media-guidelines.json`, `blog-workflow.json`;
   - the brand voice and languages from the manifest.
3. **Persona and staff**: the persona block (`format_persona_for_prompt`: name, title, pitch, CV
   highlights, hobbies, interests and quirks, relationships for meeting dynamics, the writing
   style for writers and editors, phrases in the site language with an `en` fallback), plus a
   **work-style paragraph** rendered from the staff member's traits. For example, high rigor with low speed renders as "You double-check
   facts against the entity index before writing; you prefer fewer, well-sourced claims."

Rules:
- **Block documentation is generated from the schema registry** (core plus the site's custom
  block schemas, with block metadata for intent, media and linking rules). It is never written by
  hand.
- The stable prefix (levels 1–2 plus the block docs) is placed before a `cache_control`
  breakpoint, so successive jobs for the same site hit the prompt cache.
- Prompt resolution is snapshot-tested with `insta` per role and persona.

## Pipelines

Pipelines are deterministic Rust state machines. The sim owns the stage
([sim.md](sim.md#pipeline-stages)), and `crates/agents` executes the job for the current stage.

| Project kind | Stages |
|---|---|
| Article | Pitch → Brief → Draft → Media → Edit → QA → Publish |
| PageRefresh | Brief → Draft (diff against current) → Edit → QA → Publish |
| CollectionResearch | Research (`web_search`, Claude) → Draft collection items → QA → Publish |
| Translation | Translate (per language) → Edit (native-language review) → QA → Publish |
| LinkPass | Analyse (sitemap index) → Propose links → QA → Publish |
| SiteAudit | Crawl and measure (deterministic, no LLM) → `SiteSignals` |
| Redesign / ThemeTweak | Mood board → Tokens → Theme files → Site CI → Visual review → (CEO ticket) → Merge → Smoke |

Job execution:
1. The job runner claims the job (Claude path) or hands it to the browser worker.
2. It builds the prompt (the three layers, plus the job inputs by reference).
3. It runs the LLM with the role's tools. Each tool is validated server-side:
   - `write_page` validates the schema, links and media;
   - `lookup_entity`, `search_media`, `get_page`, `web_search` (research roles only).
4. It parses the structured result against the artifact schema, with up to N repair turns.
5. It stores the artifact: page JSON is committed to the PR branch, and text goes to Postgres.
6. It injects `Cmd::JobCompleted{digest}`.

A refusal, or validation still failing after the repair turns, means `JobFailed`: the stage is
blocked and a ticket opens.

## Meetings

[ADR-0012](../adr/0012-meetings-streamed-multi-agent-conversations.md). Kinds:
- the **Standup** (09:00 daily);
- **Pitch** meetings;
- **Design crit**;
- **Post-mortem** (after a rollback or scandal).

Flow:
1. The moderator (the EiC role, as deterministic rules) sets the agenda from the backlog,
   `content-calendar.json` and open tickets.
2. It picks the next speaker: the agenda owner first, then unspoken attendees, then whoever was
   mentioned.
3. Each turn is one streamed call in the speaker's persona, given the transcript so far.
4. Each turn becomes `Cmd::Utterance{meeting, seq, speaker, chars}`, and the text is stored in
   `meeting_utterances`.
5. The closing turn produces a structured outcome: accepted pitches (title, kind, owner, region,
   language, estimated cost and risk), assignments and risks.
6. Pitches above the autonomy policy's thresholds become CEO tickets. The rest become projects.

## QA gate

1. **Deterministic checks**, which run first and cost nothing:
   - JSON Schema validity;
   - every link resolves in the sitemap index;
   - every media id resolves in the media index, with alt text present;
   - `LocalizedString` completeness for the site's languages;
   - banned phrases;
   - length bounds per page type;
   - headings hierarchy;
   - the block metadata's media and link rules.
2. **LLM coherence review**: consistency with the brief, factual consistency with entity records,
   and voice consistency with the persona. It returns `{ok, defects[]}`.
3. **Fix loop**: the Writer revises against the defect list, at most 3 times. Then a ticket
   (deadlock) or an Agency escalation.
4. **QA escapes** (defects found by the SiteAudit after publish) are counted against reputation
   and the leaderboard.

## Design department

[ADR-0015](../adr/0015-agent-authored-themes-on-site-kit.md); detail in [site-kit.md](site-kit.md).
- The **Art Director** (opus with vision) writes a structured mood board that references
  closed-index media.
- The **Front-end Dev** returns theme file artifacts, limited to `theme/**`.
- A **QA designer** reviews before and after screenshots with vision. Below 7 means a fix loop.
- The orchestrator commits on `design/<project>` and merges after the gates.

## Testing

- `FakeClaude` (`crates/testkit`) replays scripted SSE transcripts. Pipelines and meetings are
  tested for:
  - approve;
  - the revise loop;
  - reject;
  - escalation;
  - the QA fix loop;
  - refusal;
  - `max_tokens`.
- `insta` snapshots of resolved prompts and of the generated block docs.
- The `claude` crate has SSE parser fixtures and request snapshots (`cache_control` placement, no
  forced `tool_choice`).
- An opt-in live eval harness grades output against the editor rubric, and emits
  `cockpit.benchmark.v1` (calls, tokens, wall time per article).
