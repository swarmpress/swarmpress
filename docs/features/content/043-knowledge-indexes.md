---
id: FEAT-043
title: "Closed-world knowledge indexes"
status: in-progress
importance: critical
paths:
  - "crates/knowledge/**"
  - "crates/knowledge/tests/**"
  - crates/knowledge/src/pack.rs
  - crates/github/src/snapshot.rs
  - crates/github/tests/snapshot.rs
  - xtask/src/site_pack.rs
  - crates/orchestrator/src/article.rs
  - crates/orchestrator/src/site.rs
  - crates/orchestrator/tests/site.rs
  - crates/server/src/gateway.rs
  - crates/server/src/site_knowledge.rs
  - crates/server/tests/knowledge.rs
  - apps/game/src/session/site-knowledge.ts
  - apps/game/src/session/site-knowledge.test.ts
adrs:
  - ADR-0013
  - ADR-0061
---

# Closed-world knowledge indexes

Entity, media, sitemap and schema indexes built from the site repo at a SHA; link and media
resolution for `write_page` and server-side artifact validation; NEEDS_PAGE / NEEDS_MEDIA tickets
instead of inventions.

Decisions: [ADR-0013](../../adr/0013-closed-world-knowledge-indexes.md).

## MVP: the knowledge pack (ADR-0061; increments K1, K2)

Design: [`docs/design/mvp-pipeline.md`](../../design/mvp-pipeline.md) section 3.

What exists today: `crates/knowledge` builds the indexes from a `SiteSource` and has tests against
the `cinqueterre-mini` fixture (which carries the real site's `style-guide.json` and
`writer-prompt.json`, verbatim). K1 and K2 are built: the server serves the pack and enforces the
closed world on article drafts, the browser caches the pack by commit, and the orchestrator's
binding is built from it. The Draft and Review jobs do not read the knowledge base yet (P2).

- **K1, built:**
  - `knowledge::pack::{build, load}`. A pack is `{commit, files, manifest, pages}`:
    - `files` holds, verbatim, the eight `content/config` files (`entity-index`, `media-index`,
      `sitemap-index`, `style-guide`, `writer-prompt`, `content-calendar`, `linking-policy`,
      `media-guidelines`, all `.json`) and `content/pages/blog-index.json`. A file the site does
      not have is left out.
    - `manifest` is the site manifest. It is carried because a site without `site.manifest.json`
      infers it from files the pack does not hold, and link resolution depends on its languages
      and base URL.
    - `pages` is the routed page list (`PageEntry`), not the page bodies.
  - `Pack::to_json` is deterministic, so the same tree at the same commit gives the same bytes.
  - `load` needs no `SiteSource` and compiles to wasm (`KnowledgeBase::from_parts`,
    `PageRegistry::from_entries`). The loaded base answers link, media and page-registry
    questions as one built from the tree does. It has no collection index and lists no stray
    copies, which articles do not need.
  - `RepoApi::snapshot(repo, ref, prefix)` returns the text files under a prefix at one commit.
    `HttpGitHub` decodes the repository tarball as it downloads, with size caps; `FakeGitHub`
    enumerates its tree. `Snapshot` implements `SiteSource`.
  - `cargo xtask site-pack <site-dir> [--out file] [--commit sha]` builds the pack of a local
    clone. On cinqueterre.travel at `2d5683c` the pack is 384 kB, 48 kB gzipped.
- **K1, built (route):** `GET /api/gateway/knowledge` (session and lease, ETag = the base head,
  304 on `If-None-Match`, `Cache-Control: no-cache`; `crates/server/src/site_knowledge.rs`)
  builds the pack from `RepoApi::snapshot(repo, sha, "content")`, caches it with its loaded
  `KnowledgeBase` per (repo, sha), drops a repo's entries on a merge, and answers 413 for
  `GitHubError::TooLarge`. The gateway's draft check uses the same knowledge base for the closed
  world (`KnowledgeBase::closed_world_issues`, 422), off with the article profile.
- **K2, built:**
  - `SiteBinding::from_json` (`crates/orchestrator/src/site.rs`, also behind
    `orchestrator-wasm`'s `site_binding`) takes `knowledge_pack` (the pack JSON), loads it into
    `SiteBinding.knowledge: Option<SiteKnowledge {commit, kb, blog_index, pack}>`, and takes the
    style guide and the writer prompt from the pack's `content/config/style-guide.json` and
    `writer-prompt.json`. Without a pack: the binding's `style_guide` / `writer_prompt` (tests,
    the harness), else an empty house style. `siteSummary()` reports what it was built from.
  - The browser (`apps/game/src/session/site-knowledge.ts`) keeps the pack in the store's
    `site_knowledge` table (migration 2) by commit, fetches it at session start, before each
    standup job and after each merge and `DeployLanded` with `If-None-Match`, keeps the last
    good pack when a fetch fails (one toast per failure streak), and rebinds orchestrator-wasm
    at the next job after the pack changed. Without any pack, standup, draft and review jobs
    fail loudly. The Inbox's banned-phrase check reads the pack's style guide.
  - Size: `orchestrator_wasm_bg.wasm` 1,056,510 → 1,109,616 bytes gzip (budget 1,267,200).
- Unknown link or media ids come back to the model as section-scoped validation errors; an empty
  hero shortlist raises a `NeedsMedia` ticket.

## Acceptance criteria

- [ ] Index builders run against `cinqueterre-mini` and match golden output.
- [ ] Unknown link or media id is a validation error returned to the model.
- [ ] Indexes rebuild on push to main and record the SHA.

## Evidence

- `knowledge/nextest`, `github/nextest`
