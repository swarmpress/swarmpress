---
id: FEAT-104
title: "The Paint shop"
status: in-progress
importance: medium
paths:
  - docs/design/brick-studio.md
  - apps/game/src/ui/studio/PaintShop.tsx
  - apps/game/e2e/wp-studio.spec.ts
  - crates/content-import-wp/src/theme.rs
adrs:
  - ADR-0093
  - ADR-0077
  - ADR-0072
  - ADR-0082
---

# The Paint shop

The theme in the Studio: style sets (design intent), palette swatches and type tiles from the theme tokens, a preview that repaints the town and a sample page; changes go out as a ThemeCode work item. See [the design](../../design/brick-studio.md) and [ADR-0077](../../adr/0077-the-brick-studio.md).

## Built (a company on WordPress)

The Paint shop workbench (`ui/studio/PaintShop.tsx`) shows the site's palette as swatches the CEO
repaints; "Build it" writes the user's global styles over the theme's `theme.json` on a `studio-…`
branch and merges it into live (ADR-0082 §4). Verified end to end in `e2e/wp-studio.spec.ts`.

The same global styles carry a whole design as data on the neutral theme `canvas` (ADR-0093):
`content-import-wp`'s theme calls (`theme.rs`, tests in `src/tests.rs`) write a site's palette,
fonts and custom CSS into the user's global styles with its templates, parts, patterns and menus;
the Paint shop's palette edits land in the same object.

## Not built yet

- Style sets and type tiles; a preview that repaints the town and a sample page.
- The Paint shop for the Astro sites' theme tokens (a ThemeCode work item).

