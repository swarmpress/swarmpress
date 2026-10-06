---
id: FEAT-093
title: "Blueprint import: reverse-engineering the live site, then HTML and ZIP designs"
status: planned
importance: normal
paths:
  - "crates/blueprint/src/import/**"
  - "crates/blueprint/tests/import*.rs"
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

## Acceptance criteria

- [ ] The reverse-engineered blueprint of a fixture site is golden-tested and passes the checker.
- [ ] Importing a fixture HTML export yields page types and slots made only of catalogue ids.
- [ ] A second import of a changed export yields a diff, not a replacement.

## Evidence

- `knowledge/nextest`
