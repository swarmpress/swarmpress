# ADR-0013 — Closed-world knowledge indexes

**Status:** Accepted; amended by ADR-0050
**Date:** 2026-10-01

## Context

LLMs invent things. They write plausible URLs, image paths, restaurant names and internal links
that don't exist. On a live travel site, a hallucinated link is a broken link, and a hallucinated
image is a broken page or, worse, an unlicensed asset.

The cinqueterre.travel repo already has curated indexes: `entity-index.json`, `media-index.json`
(338 images), `sitemap-index.json` and `linking-policy.json`.

## Decision

- **`crates/knowledge`** builds **closed-world indexes** from the site repo at a pinned commit
  SHA:
  - **entities** (villages and regions, places, restaurants and other collection items);
  - **media** (id, URL, alt, licence, tags, dimensions);
  - **sitemap** (every routable URL per language);
  - **block schemas** (core plus custom).
- Agents refer to things **by id only.** `write_page` and the server-side artifact validator
  check every link, every media reference and every entity mention against the index:
  - An unknown id is a validation error that goes back to the model as a tool error for repair.
  - It is never silently dropped.
- Missing knowledge becomes a ticket, not an invention:
  - `NEEDS_PAGE` (link to a page that doesn't exist yet);
  - `NEEDS_MEDIA` (no suitable image).
- Indexes are rebuilt on every merge to `main`, from the push webhook, and stamped with the SHA.
  A job records the index SHA it was validated against.

Alternatives considered:

- **Web search or open retrieval for links and images.** Rejected for publishing. Research jobs
  may use `web_search`, but what lands on the page must resolve inside the index.
- **Post-hoc link checking only.** Rejected. Errors would be found after merge. Validating at write
  time lets the model repair them.

## Consequences

- Positive: zero hallucinated internal links or media on published pages, enforced, not hoped
  for.
- Positive: the same validator runs in the browser (wasm) and on the server, so local-model output
  is held to the same standard.
- Negative: agents are limited to what is indexed. New media must be added through the
  MediaEditor or PhotoStudio flow first, which slows the pipeline down deliberately.
- Negative: index builds must stay fast and are tested against a trimmed fixture
  (`crates/testkit/fixtures/cinqueterre-mini`).
