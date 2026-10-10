# ADR-0082 — Agents and the Studio work on WordPress through capabilities

**Status:** Accepted (re-targets the pipeline of ADR-0058 to ADR-0062, the gateway of ADR-0061 and ADR-0070, and the Studio of ADR-0077 onto WordPress; keeps rules 2, 3, 5 and 10)
**Date:** 2026-10-10

## Context

Today the staff write JSON blocks that the central gateway commits to GitHub (ADR-0058 to ADR-0062, ADR-0070), and the Studio edits the blueprint (ADR-0077). With WordPress as the engine (ADR-0078) and the governed repository as the truth (ADR-0080), the staff and the CEO need a way to work on a WordPress site that:
- keeps the orchestrator in charge of transitions (rule 3);
- keeps text out of the sim (rule 2);
- keeps the closed world (rule 5);
- reaches WordPress only through APIs (ADR-0078 §3).

## Decision

1. **Capabilities, not WordPress.** The agents never call WordPress. The orchestrator gives a job a closed set of **site capabilities** on its work item's branch. Each one is executed by the governed layer as REST calls to the branch's working copy, then captured (ADR-0081):
   - read a page or post with its block tree;
   - draft a post (title, slug, excerpt, blocks from the allowed block set, terms, featured media from the media index);
   - update listed blocks or fields of an existing post;
   - add a term;
   - set a menu item.

   A capability's input is checked before any call:
   - blocks must be in the site's block set and the page type's template (ADR-0072 page types map to post types and block templates);
   - links and media must come from the knowledge indexes;
   - facts must come from the evidence (ADR-0068).

   An unknown id is a validation error returned to the model, as today.
2. **The pipeline is unchanged in its transitions.**
   - **The work item** gets its branch when its Draft phase starts.
   - **Draft and revise** use capabilities.
   - **Review** reads the branch's semantic diff and its rendered preview: a page fetched from the working copy, shown as data.
   - **Approval** at a score of 7 or more opens the change request.
   - **The publish gate** (ADR-0059) answers it: `Publish` merges into `live` through the merge queue (ADR-0080 §3), and the release and export follow (ADR-0083).
   - **What the sim sees:** the digests it knows (`JobCompleted`, `DeployLanded`), with the merge in place of the GitHub merge.
3. **The central gateway's role shrinks.** It stops writing GitHub content and keeps:
   - the lease, fencing and the credit ledger;
   - the optional GitHub mirror (ADR-0080 §5);
   - the deploy of exports (ADR-0083).

   PathPolicy and the article profile (ADR-0061) are replaced by the capability checks of §1.
4. **The Brick Studio edits WordPress structures** in its grammar (ADR-0077):
   - **Town:** post types and their templates as buildings;
   - **Building:** the block template of a post type, its blocks as bricks, and the template's locked and repeatable regions as storeys;
   - **Factory:** the tools (ADR-0076), whose outputs feed blocks through bindings;
   - **Paint shop:** the block theme's `theme.json` (colours, fonts, spacing).

   **How edits land:** edits are commits on a branch and are reviewed as an instruction booklet over the change request. The CEO's edits land when the CEO builds them (ADR-0077 §3).

   Plugins appear as **sets**, with their governed object types and their sandbox capabilities. A plugin outside the governed types is shown as "not governed".
5. **wp-admin is a door, not the road.** The CEO, or a collaborator the CEO invites, may open wp-admin on a draft branch's working copy, inside the sandbox's origin, for anything the Studio does not cover. What they change is captured and reviewed like everything else (ADR-0081 §4).
6. **The authority rules are unchanged:**
   - no capability can approve, merge, publish or change a stage (rule 3);
   - the Secretary can never answer a publish approval (ADR-0059);
   - QuestionTickets stay the only channel to the CEO (rule 10).

## Consequences

- **What stays:**
  - the game loop stays as it is: the board, standups, drafts, reviews, the gate, analytics and maintenance;
  - only the site it acts on changes;
  - the agents' outputs remain artifacts, and their effects remain commits the CEO can review block by block.
- **What carries over:** the closed world becomes stronger. Block types, terms and media are WordPress's own registries, read through the API into the knowledge indexes.
- **Negatives:**
  - **The pipeline's site layer is reworked.** The section-staged drafting of ADR-0058 writes blocks instead of JSON blocks, and the quality checks (word counts, house style, link policy) are re-pointed at Gutenberg trees. That is substantial.
  - **Plugin blocks** without a known schema are allowed only after their attributes are typed in the block set.
  - **Previews** cost a WordPress request each (about 0.7 s on php-wasm in Node), so reviews batch them.
- **Alternatives:**
  - **Agents call the REST API themselves:** no closed-world checks, no attribution, and model output acting directly on WordPress (against rule 3).
  - **Agents write wp-admin forms:** brittle and unreviewable.
