# ADR-0080 — The governed content repository

**Status:** Accepted (supersedes ADR-0047's "content lives in the player's GitHub repository" as the source of truth, and ADR-0056 decision 11's rejection of branches and merge for content; keeps ADR-0056's attributed, digest-chained work records for company state; amends rule 6)
**Date:** 2026-10-10

## Context

ADR-0078 makes WordPress the site engine and keeps the truth outside it. Guardian's model is the target the owner names: every meaningful change is an attributable, reviewable, policy-checked, mergeable and reversible contribution.

| Guardian has | swarm.press has today |
|---|---|
| typed objects | content in GitHub (real Git, branches per draft, pull requests) |
| a commit layer with a Merkle state tree | company state as a linear command log with planned work records (ADR-0056) |
| branches, change requests | no branches or merges of its own (ADR-0056 decision 11) |
| a merge queue, releases | — |

The owner chose a Guardian-style semantic repository over keeping GitHub as the store.

## Decision

1. **One governed repository per company is the source of truth for its site.** It holds **typed objects**, not files, mirroring WordPress's model as the governed layer sees it through the APIs:
   - posts and pages: their fields, status and slug, and the **block tree** (blocks parsed, with their attributes and inner blocks);
   - media: an asset sidecar plus the content hash of the bytes in object storage (ADR-0050);
   - terms and taxonomies, menus, and templates and template parts (block themes);
   - **governed options**: an allow-list, such as the site title and permalinks;
   - users as authors, mapped to staff and the CEO, never to passwords;
   - the active theme and plugins with their pinned versions (ADR-0079 §6).

   Scratch state is **not** in the repository: transients, sessions, caches, cron state, logs and analytics tables (ADR-0081 §3).
2. **Commits.** A commit is an atomic set of object changes. It records:
   - its parent and its digest (SHA-256, domain-separated as in ADR-0056);
   - its author: a staff member, the CEO, or an extension;
   - the job and model when an agent made it;
   - its message.

   Commits are write-once. History is never rewritten: a correction is a new commit, and erasure removes the company's repository as a whole (ADR-0056's rules).
3. **Branches, change requests, merges.**
   - **`live`** is what the public site shows. Each work item drafts on **its own branch** off `live`.
   - **A change request** proposes merging a branch into `live`. It carries a semantic diff (objects added, removed or changed, down to blocks and fields), the reviews, and the policy checks: the closed world (rule 5), the page-type rules (ADR-0072), and the editor's score.
   - **Merging** happens only when the sim's state machine says so (rule 3). For an article that is the CEO's `Publish` answer at the publish gate (ADR-0059); for structure it is `StructureApproval`.
   - **A three-way merge at object level** resolves a branch that `live` moved under. A conflict on the same field or block becomes a ticket, never a silent choice.
   - **The merge queue** applies approved change requests in order.
4. **Releases.** A release is a tagged state of `live` that was exported and deployed (ADR-0083). Rolling back is a new commit that restores a release's objects, approved like any change.
5. **Where it lives** (ADR-0038, ADR-0041, ADR-0049):
   - the executor holding the lease keeps the repository locally, in the company store (SQLite in the browser);
   - commits are sealed centrally as write-once segments, the existing sync path (ADR-0075 is its first increment);
   - the head of each branch is a compare-and-swap fenced by the lease epoch (ADR-0045);
   - GitHub is **optional and a mirror**: an export of `live` for players who want their content in Git, written by the server and never read back as truth.
6. **Its relation to the sim:** text never enters the sim (rule 2). The sim sees digests: a change request's id and diff counts, a merge, a release. The orchestrator keeps owning transitions; the repository executes merges the sim decided.
7. **Guardian's code is not adopted.** Its model is the reference, as ADR-0056 decided for its code; reconsider when Guardian's kernel builds for the browser. The repository is a swarm.press crate (`crates/content-repo`) that compiles to wasm, like the sim.

## Consequences

- **What governance gains:**
  - every change to a site is attributed, reviewable and reversible, down to a block;
  - the CEO's publish gate becomes a merge;
  - staff work in parallel on branches, and conflicts are visible.
- **ADR-0075's role:** its text journal becomes the bridge. Briefs, reviews and transcripts stay work records (ADR-0056); site content moves into this repository.
- **Negatives:**
  - **Build cost:** a semantic repository with three-way merge at block level is substantial work, Guardian's largest component.
  - **Storage:** history grows with every revision, so retention follows ADR-0046 and ADR-0056 (bases and segments).
  - **Losing GitHub as truth** gives up GitHub's tooling (pull requests, web view) except through the mirror.
  - **Mapping coverage:** objects of plugins the repository does not model are scratch state or unsupported until modelled (ADR-0081 §3).
- **Alternatives:**
  - **GitHub stays the store:** real Git with branches, but files, not objects, and no block-level merge or policy; rejected by the owner.
  - **Guardian itself:** couples the products, and its kernel does not build for the browser (ADR-0056 decision 11).
  - **WordPress revisions as history:** owned by WordPress, not attributed to staff or jobs, and no branches.
