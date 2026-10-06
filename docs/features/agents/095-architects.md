---
id: FEAT-095
title: "The architects: the Information Architect proposes blueprints, the Web Developer builds tools"
status: in-progress
importance: normal
paths:
  - "crates/blueprint/src/edit.rs"
  - "crates/blueprint/tests/edit.rs"
  - "crates/agents/prompts/information_architect.md"
  - "crates/agents/src/jobs/architect.rs"
  - "crates/orchestrator/src/structure.rs"
  - "crates/orchestrator/tests/structure.rs"
  - "crates/server/tests/site_blueprint.rs"
  - "apps/game/src/blueprint/commission.ts"
  - "apps/game/src/blueprint/digest.ts"
  - "apps/game/src/blueprint/structure.test.ts"
  - "apps/game/src/llm/testing/fake-tools.ts"
  - "apps/game/src/ui/structure.test.tsx"
adrs:
  - ADR-0072
  - ADR-0058
  - ADR-0059
---

# The architects: the Information Architect proposes blueprints, the Web Developer builds tools

After the MVP. The Information Architect runs the `Architect` job; the UX designer plays the role
(else the strategist, else the editor-in-chief: the sim's choice), so no new role was added.
The Web Developer runs the `ToolBuild` job. Both work the same way:
- a request (from the canvas's "ask the architect" box, or from the board) gives a structured output
  against the blueprint or tool schema;
- the checker runs, with one repair turn;
- the result is a semantic diff, applied only through a `StructureApproval` ticket whose default never
  applies it.

Connector choice and schema inference are stages of `ToolBuild`, not separate agents.

Design: [`docs/design/construction-kits.md`](../../design/construction-kits.md) §5.2, §5.3, §9.

Depends on: FEAT-090, FEAT-091, FEAT-032 (staged jobs), FEAT-079 (approval tickets).

## Acceptance criteria

- [ ] On the fake model, "add an author page type" yields a valid diff; unknown block ids come back
      as issues for repair.
- [ ] Nothing changes in the repo before the CEO approves; the ticket's default leaves it unchanged.

## As built

- **Edit operations** (`crates/blueprint/src/edit.rs`): a closed, `op`-tagged `Edit` set
  (`add-page-type`, `remove-page-type`, `add-slot`, `remove-slot`, `set-slot`, `add-relationship`,
  `remove-relationship`, `set-navigation`, `set-intent`), parsed from the model's flat answer
  (`parse_edits`, `null` fields ignored) and applied by stable ids (`apply_edits`). A target that does
  not exist, or an id declared twice, is an `Issue` at `/edits/<i>/<field>`; the result is then
  checked with `blueprint::check`. `proposal_schema(block_ids(ctx))` is the answer schema: one flat
  edit shape, the operations and the block ids (core catalogue plus the site's `x:` blocks) closed
  enums, only the keywords the browser's subset validator knows. `tool_proposal_schema()` is the
  `ToolBuild` answer: a whole `swarmpress.tool.v1` graph (at most 12 nodes).
- **Server** (`PUT /api/site/blueprint`): `blueprint` is optional and `tools: {id: graph}` installs or
  replaces tools after `check_tool` in the site's context (422 with the issues; 400 when a graph's id
  is not its key), written by the structure actor to `blueprint/tools/<id>.tool.json`.
- **Gateway** (`crates/orchestrator/src/gateway.rs`): `site_models`, `put_blueprint` and `put_tool`,
  failing loudly by default; a write answers `ModelsPut::{Landed, Stale, Refused}` (409, 422). The
  `FakeGateway` holds in-memory models (`FakeSite`) and applies a PUT as the server does. The browser's
  gateway implements them over the central client (`siteModels`, `putBlueprint`, `putTool` through
  `crates/orchestrator-wasm`).
- **Jobs** (`crates/orchestrator/src/structure.rs`): `Architect` reads the request (the item's brief,
  `orchestrator::structure_brief`: the `BriefRecord` shape with the CEO's words as `brief.angle`) and
  the site's models, prompts with the assignee's persona and `prompts/information_architect.md`
  (`agents::JobKind::SiteArchitect`), and makes one structured call with one repair turn whose check
  is apply + checker (+ "changes nothing"); the call is stored as the stage `architect#0`. The
  proposal (`{base_hash, proposal, edits, changes, summary, hash, repaired}`) is the item's artifact
  (`ArtifactRecord.structure`), its summary and change list an `artifact` post (`payload.structure`).
  `JobCompleted{ok, score: min(changes, 10), words: 0, qa_defects: issues the first answer had,
  artifact_sha: the proposal's hash}`; an answer that still does not check is `JobFailed{InvalidOutput}`,
  a refusal `JobFailed{Model}`, a lost model an error the host waits out. `ToolBuild` is the same with
  the Web Developer's prompt (`tool-build`) and the tool checker (the site's types, the other tools'
  signatures). A revision names the previous summary and the CEO's newest send-back note.
  `ThemeCode` fails loudly (`JobFailed{Infrastructure}` and a post naming FEAT-094); `ToolRun` fails
  loudly too (the tool interpreter is not wired into the orchestrator).
- **Publish dispatch:** the shared `Publish` job applies the artifact when the record holds a
  structural proposal (`put_blueprint` on the stored base hash, or `put_tool`), and takes the article
  path unchanged otherwise. A stale base (409) or a refusal (422) is `JobFailed{InvalidOutput}` with a
  status post ("The blueprint changed meanwhile…"); a landed write is `JobCompleted{ok}` with the commit,
  and never a `DeployLanded` (the sim publishes a structural item without a deploy). A run again
  after a reload writes nothing.
- **Fake model:** `agents::fake_writer` answers `site architect` (an `author` page type with a
  `team-grid` profile slot, a `written-by` relationship from the articles; a free id when `author` is
  taken) and `tool build` (the ferry-times graph when the site has its types, else a `latest-pages`
  tool of built-in types); `apps/game/src/llm/mvp-script.ts` is its twin for `?llm=fake`.
- **Browser:** the Blueprint panel's "Ask the architect" (Blueprint tab) and "Ask for a tool" (Tools
  tab) store the request as the brief and log `Command::Commission{project, kind, brief_ref}` (the ref
  below 2^53, so the JSON number is exact; a command the sim would refuse stores nothing). The Inbox
  shows `structure-approval` tickets with the summary and change list from the thread and
  Approve / Send back / Kill / Defer. After the session reads the models it logs
  `BlueprintChanged` and `ToolsChanged` when they differ from `plan_json().structure`
  (`apps/game/src/blueprint/digest.ts`; tools with checker issues are left out), and a successful
  `Publish` of a structure or tool item reads them again. The client facade now routes both digests as
  server commands (`crates/client-wasm`).
- **Not built here:** the board does not commission structural work yet, and no Playwright e2e drives the
  ask box against a running server (the vitest and orchestrator tests cover the path on the fake model).

## Evidence

- `blueprint/nextest` (`tests/edit.rs`), `orchestrator/nextest` (`tests/structure.rs`, the sim's gate
  included), `server/nextest` (`tests/site_blueprint.rs`), `client-wasm` (`model_digests_are_server_commands`)
- `apps/game` vitest: `src/blueprint/structure.test.ts`, `src/ui/structure.test.tsx`
