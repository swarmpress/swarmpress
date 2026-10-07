---
id: FEAT-093
title: "Blueprint import: reverse-engineering the live site, then HTML and ZIP designs"
status: in-progress
importance: normal
paths:
  - "crates/blueprint/src/import.rs"
  - "crates/blueprint/tests/import.rs"
  - "crates/blueprint/tests/fixtures/cinqueterre-mini.blueprint.json"
  - "apps/game/src/blueprint/design-import.ts"
  - "apps/game/src/blueprint/design-import.test.ts"
  - "apps/game/src/blueprint/fixtures/**"
adrs:
  - ADR-0072
  - ADR-0061
---

# Blueprint import: reverse-engineering the live site, then HTML and ZIP designs

After the MVP. The first blueprint is derived from cinqueterre.travel, read-only and deterministically,
with no model:
- page types come from the page registry;
- slots come from block usage per type;
- relationships come from entity relations and collection embeds;
- navigation comes from `navigation.json`;
- intent comes from the theme tokens.

Later, HTML and ZIP design exports (including Claude Design exports) are imported:
- a deterministic DOM pass builds a section tree and finds token candidates;
- the Art Director's model only labels sections with catalogue block ids;
- imported files are untrusted data.

Re-importing an import produces a semantic diff.

Design: [`docs/design/construction-kits.md`](../../design/construction-kits.md) §8.

## As built (2026-10-06)

`blueprint::import::import(src)` reads a site checkout without a model:
- **Page types** come from the pages; a core type keeps the platform's slots.
- **Slots** come from block usage. A block that opens (or closes) at least 80% of a type's pages
  and stands nowhere else becomes the opening (closing) slot; every other block goes into a `body`
  slot. The slots are kept only if every page of the type fits them.
- **Routes** become `/{lang}/…/{slug}` patterns.
- **Relationships** come from the link graph (at least 30% of a type's pages, and at least two).
- **Collections and navigation** come from the manifest, item counts from the collection index,
  and the tokens file from the theme.

The fixture site's import is golden (`tests/fixtures/cinqueterre-mini.blueprint.json`), passes the
checker in its own context, and its derived registry accepts every page of each non-core type.
**Designs (HTML or ZIP, Claude Design exports included)** are read in the browser by
`apps/game/src/blueprint/design-import.ts`:
- **Parsing:** `DOMParser` parses the pages, so their scripts never run, and nothing is fetched.
- **ZIP:** stored and deflated entries are read without a library; non-text and oversized files
  are skipped.
- **Sections to blocks:** each page's top-level sections map to catalogue blocks by fixed rules
  (newsletter, FAQ, gallery, cards, hero, stats, call to action, content), and the rule that
  fired is kept.
- **Page types:** each page becomes one page type with slots in section order.
- **Globals:** headers and footers become globals only when the site has their blocks.
- **Tokens:** `:root` custom properties become token candidates.

The proposal checks clean on the real checker (blueprint-wasm). The semantic reconciliation is
`diffBlueprints` against the stored blueprint.

**In the Blueprint panel**, while the CEO is editing, "Import a design" takes an HTML file or a
ZIP:
- `mergeDesign` merges the interpretation into the draft: an imported page type replaces the one
  with the same id, any other page type is added, new page types join the navigation, and the
  site's own globals win.
- The canvas shows the diff, and the CEO saves it or discards it. A second import of a changed
  export is therefore a diff, not a replacement.

## Acceptance criteria

- [ ] The reverse-engineered blueprint of a fixture site is golden-tested and passes the checker.
- [ ] Importing a fixture HTML export yields page types and slots made only of catalogue ids.
- [ ] A second import of a changed export yields a diff, not a replacement.

## Evidence

- `knowledge/nextest`
