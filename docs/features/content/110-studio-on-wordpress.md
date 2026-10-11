---
id: FEAT-110
title: "The Brick Studio over WordPress"
status: in-progress
importance: high
paths:
  - apps/game/src/php/wp-studio.ts
  - apps/game/src/php/wp-studio.test.ts
  - apps/game/src/php/wp-site-engine.ts
  - apps/game/src/session/wordpress-site.ts
  - apps/game/src/ui/studio/WpAdminDoor.tsx
  - apps/game/src/ui/studio/PaintShop.tsx
  - apps/game/src/ui/components/Blueprint.tsx
  - crates/storage-api-wasm/src/lib.rs
  - crates/orchestrator/src/wordpress.rs
  - crates/orchestrator/tests/wordpress.rs
  - apps/game/e2e/wp-studio.spec.ts
adrs:
  - ADR-0082
  - ADR-0077
---

# The Brick Studio over WordPress

Milestone M6 of [the build plan](../../design/wordpress-site-engine.md): the Studio edits a
company's WordPress in its own grammar (ADR-0082 §4); its workbenches, checker, diff and booklet
work unchanged on WordPress's structures.

## Built

- **Town:** the site's post types as buildings (`post`, `page` and public custom types).
- **Building:** a post type's block template as storeys. A storey is a *region*: a locked group
  whose inner blocks are the region's allowed blocks; a post type without regions is one free
  region. The regions live in the governed option `swarmpress_post_type_templates`, which the
  sandbox's must-use plugin applies to the post type; WordPress's block registry is the checker's
  block set. A new post type is refused (it is code, a plugin's job).
- **Paint shop** (FEAT-104): the theme's palette, repainted into the user's global styles.
- **Sets:** the site's plugins, each "Not governed" until the governed layer types its data.
- **Every edit is a commit on a branch:** the CEO's build writes on a `studio-…` branch and merges
  its change request into live (ADR-0077 §3); a stale draft is refused (409) and a refused one
  reports its issues (422), as the Astro path does.
- **wp-admin is a door** (ADR-0082 §5): a visible frame on the sandbox's origin, on an `admin-…`
  branch of its own; its sandbox speaks on the storage API's `door` channel (a session of its own,
  as the CEO), so every save in wp-admin is a commit on that branch. "Build it" merges it, "Discard"
  drops it. The sandbox serves wp-admin through a service worker under `/door`.
- **The architects work on WordPress too:** their structural jobs read the same models through the
  site engine (`SiteEngine::site_models`) and an approved proposal is built through it
  (`put_blueprint`: the regions, merged into live), so the staff's proposals and the CEO's builds
  share one path (`tests/wordpress.rs`).
- **Verified** (`e2e/wp-studio.spec.ts`, turso and sqlite): the Town and Building show WordPress's
  structures; new regions for posts land on live; a repainted colour lands in live's global styles;
  the plugin sets show; wp-admin opens through the door, a setting saved there is built into live.

## Not built yet

- The booklet read from change-request diffs (today from the blueprint diff).
- The Factory over WordPress (tools feeding blocks through bindings).
