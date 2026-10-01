# Agents (`crates/agents`, `crates/claude`)

The staff of a SimPress company are LLM agents with a role, a persona, a seniority and a place in
the building. They never run the company's process. Deterministic pipelines do that, call them
for artifacts, and decide transitions from what they return
([ADR-0011](../adr/0011-orchestrator-owns-state-transitions.md)).

Features: FEAT-030 to FEAT-036. The executor split between local models and Claude is described
in [hybrid-inference.md](hybrid-inference.md).

## Organisation and RBAC

| Department | Roles | Room | May produce |
|---|---|---|---|
| Editorial | Editor-in-Chief (EiC), Editor | EditorOffice | briefs, reviews (score + verdict), pitch decisions |
| Writers Room | Writer | Newsroom | page JSON drafts, revisions |
| Research and SEO | Researcher, SEO, Linker | SeoLab | research notes (with `web_search`), link passes, SEO fields |
| Media | MediaEditor | PhotoStudio | media selections from the closed index, alt texts |
| Translation | Translator | TranslationDesk | localized fields |
| QA | QA | SeoLab, or any desk | QA reports (defect codes + coherence verdict) |
| Design | Art Director, Front-end Dev, QA designer | DesignStudio | mood boards, theme files, visual reviews |
| Governance | CEO (the player) | CeoOffice | ticket answers, policies |

- RBAC is enforced by the **tool set** each role receives, and by the orchestrator, which accepts
  an artifact kind only from the roles allowed to produce it.
  - A Writer has no merge tool, and nobody does.
  - A Front-end Dev's repo tool refuses writes outside `theme/**`.
- QuestionTickets are the only channel to the CEO.

## Roles and models

`config/roles.toml` holds the per-role defaults for Claude-executed (Agency) jobs:

| Role | Model | Effort / extras |
|---|---|---|
| Editor-in-Chief | opus-5-5 | high |
| Writer, Editor | opus-5-5 | medium |
| Art Director, Front-end Dev | opus-5-5 | high, vision |
| SEO, Linker, Researcher | sonnet-5-5 | `web_search` |
| Media | haiku-4-5 | |
| Chatter | sonnet-5-5 | low |

A staff member's **seniority** overrides the model: Junior → haiku-4-5, Mid → sonnet-5-5,
Senior/Star → opus-5-5. For staff jobs on the local model tier, seniority instead picks the
model *within the device tier* ([ADR-0026](../adr/0026-model-registry-webgpu-capability-tiers.md)).

## Personas

Persona records carry over from the legacy `agent-personas.ts`: background, writing style (tone,
formality, perspective, descriptive style), voice characteristics, preferred openings and
closings, favourite and avoided topics, and sample phrases in en/de/fr/it.

| Persona | Speciality | Imported as |
|---|---|---|
| Giulia | Culinary expert and food writer: Ligurian cuisine, trattorie, wine | Senior Writer |
| Isabella | Adventure travel writer: trails, beaches, outdoor | Senior Writer |
| Lorenzo | Cultural historian: villages, architecture, traditions | Senior Writer |
| Sophia | Hospitality and accommodations expert | Senior Writer |
| Marco | Practical information specialist: transport, logistics | Senior Writer |
| Francesca | Visual storyteller and photography expert | Senior MediaEditor |

For cinqueterre.travel, a generated EiC, Editor, QA, Art Director and Front-end Dev complete the
staff (cutover step 6). New companies hire from generated candidate cards (three per hire
ticket).

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
3. **Persona and staff**: the persona record, plus a **work-style paragraph** rendered from the
   staff member's traits. For example, high rigor with low speed renders as "You double-check
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
