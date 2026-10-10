# ADR-0081 — The sync seam: a GPL connector and two APIs

**Status:** Superseded by [ADR-0084](0084-a-wordpress-fork-whose-storage-is-the-governed-repository.md) (2026-10-10: the owner decided to fork WordPress's storage instead of syncing a working copy). Was: Accepted (implements ADR-0078 §3 and §4 between the repository of ADR-0080 and a WordPress sandbox of ADR-0079)
**Date:** 2026-10-10

## Context

The repository holds the truth (ADR-0080), and WordPress is a working copy of one branch (ADR-0078 §4). Content must flow both ways:
- **into WordPress:** the branch's objects, so WordPress can render it and edit it;
- **out of WordPress:** the changes made there, by an agent through the REST API or by a person in wp-admin, so they become commits.

Under the owner's condition this happens **only through APIs**. Two observations shape it:
- WordPress's own REST API covers posts, pages, media, terms, menus, templates, users and settings. It cannot report everything that changed, and it skips some state.
- Anything that runs inside WordPress is a WordPress plugin, so it is GPL and belongs in the sandbox.

## Decision

1. **The connector.** A small WordPress plugin, `swarmpress-connector`, licensed GPL-2.0-or-later, is developed in its own repository and shipped in the sandbox (ADR-0078 §2). It is the only swarm.press-written code inside WordPress. It does three things, all as REST endpoints under `/wp-json/swarmpress/v1/`:
   - **change feed:** every write to a governed object type, recorded from WordPress's own hooks as `{seq, object type, id, kind}` without the content. The governed layer pulls it (`GET /changes?after=seq`) and reads the objects themselves through the standard REST API;
   - **materialize:** `PUT /objects` writes a batch of objects as the governed layer sends them, in one transaction, without firing the change feed for its own writes, so the round trip does not echo;
   - **snapshot:** `GET /snapshot` is a manifest of every governed object's id and content hash, to verify that the working copy equals the branch.

   Authentication is an application password held by the governed layer for that sandbox, never a player's password.
2. **The governed layer side is outside the sandbox.** A component (`content-sync`, in Rust with a TypeScript host binding, not GPL) speaks only HTTP to WordPress:
   - **checkout:** boot a sandbox (ADR-0079), then materialize the branch's objects;
   - **capture:** poll the change feed, read the changed objects through `/wp/v2/…`, normalize them (parse blocks into trees, map ids, separate media bytes), and commit them on the branch with attribution, from the job or session that made the request;
   - **verify:** compare the snapshot with the branch after every checkout and every capture batch. A difference is an issue, not a silent repair.
3. **What is governed, and what is scratch.** Governed object types are those ADR-0080 §1 lists. Everything else WordPress writes (transients, sessions, caches, cron, logs and plugin analytics) stays in the sandbox's working copy and is **disposable**: a fresh checkout rebuilds a site without it.

   A plugin's own content becomes governed only when its object type is modelled by an ADR or a typed mapping in the connector. Until then the Studio lists the plugin as "not governed" (ADR-0082 §4).
4. **Who may write in WordPress.** Agents never write through wp-admin. They write through the governed layer's capabilities, which become REST calls carrying their attribution (ADR-0082). A person in wp-admin is allowed only on a draft branch's working copy, and their changes are captured as the CEO's (or the named collaborator's) commits. **`live`'s working copy is read-only**: it is rendered, never edited.
5. **Ids.** Repository object ids are stable and independent of WordPress's numeric ids. The connector keeps the mapping in a post meta and a term meta, and the change feed and snapshot report both. The repository never depends on WordPress ids surviving a fresh checkout.
6. **Failure modes are loud** (rule 11):
   - a capture that cannot normalize an object;
   - a materialize the connector refuses;
   - a snapshot that does not match.

   Each blocks the work item with a ticket. Nothing is committed half-way: a capture batch is one commit or none.

## Consequences

- **WordPress stays unmodified,** apart from one GPL plugin. Every byte crossing the boundary is a documented HTTP request, auditable and testable, and the same connector works on every backend.
- **wp-admin is safe to use.** People can use it where they want WordPress's own editor, and their work is still governed.
- **Negatives:**
  - **Polling:** a pull-based change feed adds latency between a write and its commit, bounded by the poll interval during a job (seconds).
  - **REST coverage:** fidelity depends on the REST API covering a type. Gaps (some block-theme internals, plugin settings) need connector endpoints.
  - **Normalization cost:** normalizing Gutenberg markup to block trees and back must round-trip exactly, which needs a conformance corpus.
  - **Two repositories:** the connector is GPL and lives in its own repository, with its own release and licence notices.
- **Alternatives:**
  - **Reading WordPress's SQLite file directly:** faster, but it bypasses the APIs (the owner's condition) and couples to WordPress's schema.
  - **A `db.php` drop-in that classifies every SQL write:** inside WordPress (GPL), SQL-level, and brittle across plugins.
  - **WordPress revisions or webhooks only:** incomplete coverage, and webhooks need an always-on receiver.
