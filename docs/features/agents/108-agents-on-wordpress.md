---
id: FEAT-108
title: "The staff work on WordPress through capabilities"
status: in-progress
importance: high
paths:
  - crates/orchestrator/src/wordpress.rs
  - crates/orchestrator/src/wordpress/fake.rs
  - crates/orchestrator/tests/wordpress.rs
  - crates/knowledge/src/wordpress.rs
  - crates/orchestrator-wasm/src/lib.rs
  - apps/game/src/php/wp-site-engine.ts
  - apps/game/src/php/wp-site-engine.test.ts
  - apps/game/src/session/wordpress-site.ts
  - apps/game/e2e/wp-publish.spec.ts
adrs:
  - ADR-0082
  - ADR-0080
---

# The staff work on WordPress through capabilities

Milestone M4 of [the build plan](../../design/wordpress-site-engine.md). The jobs never call
WordPress: they get a closed set of site capabilities on their work item's branch, executed by the
governed layer as REST calls into the branch's sandbox (ADR-0082 §1). The pipeline's transitions do
not change (§2).

## Built

- **The port** (`crates/orchestrator/src/wordpress.rs`): `SiteEngine` beside `Gateway` (branches,
  posts read and saved, change requests, the merge into `live`, the release's state), and
  `EngineGateway`, which gives the jobs that port in the shape they already call:
  - Draft: the article as a post on `draft-<content id>`, then its change request;
  - Publish: the change request merged into `live`, once (idempotent);
  - refresh and fix: the post read from `live`, its update on `update-<content id>` naming the
    version it read (refused when `live` moved).
- **Capability checks:** an article page becomes Gutenberg blocks from WordPress core, each of them
  required in the site's block set; the hero becomes the featured image (an attachment id from the
  media index, anything else refused); the category a term. A post the pipeline wrote reads back as
  the same article; a post with blocks no capability writes is refused for an update.
- **The knowledge pack of a WordPress site** (`crates/knowledge/src/wordpress.rs`): media, posts,
  pages, categories, tags and block types read through REST become the pack the jobs already
  read (media index by attachment id, routed pages by permalink, the blog index, category
  entities, the block set). Deterministic. Links without a language prefix resolve.
- **Tests** (`crates/orchestrator/tests/wordpress.rs`): the article loop (standup, draft, review 6,
  revision, review 8, publish) over a fake engine: one branch, one change request, one merge with
  the writer's, editor's and approver's attribution; a fix of a broken link on a post read from
  `live`; the article ↔ post mapping both ways.

- **In the browser:** orchestrator-wasm takes a site engine in place of the gateway (told apart by
  `savePost`) and builds `EngineGateway` over it (`JsSiteEngine`), with the block set from the pack;
  `wordpress_pack` shapes registries into a pack. `WpSiteEngine` (`apps/game/src/php`) runs each
  capability as REST into the sandbox, with the sandbox's session bound to the capability's branch
  and author, one capability at a time; the merge is refused when the branch moved since the
  approval. The knowledge client reads the registries from `live` and rebuilds the pack when
  `live`'s head moved.
- **End to end** (`e2e/wp-publish.spec.ts`, the real game page on the central server): a company on
  WordPress, its media seeded by the CEO on a branch and merged; standup, draft (a post on its
  branch with a change request, nothing on live), review 6, revision, review 8, the CEO's Publish,
  the merge, the export and deploy, `DeployLanded`, and the public site serving the revised
  article.

## Not built yet

- Block schemas generated from the site's block registry for the writer's prompts: the writer
  still drafts the article blocks, which the capability layer maps onto core blocks.
