# Site kit and agent-authored themes

Each player's website is an Astro site in its own repository. The platform owns everything
except presentation (`@swarm-press/site-kit`), and the company's design department owns the
presentation (`theme/`).

Decisions: [ADR-0015](../adr/0015-agent-authored-themes-on-site-kit.md),
[ADR-0016](../adr/0016-site-kit-distribution-via-npm.md).
Features: FEAT-044 (site kit), FEAT-045 (theme PR gate), FEAT-035 (design department).

## `@swarm-press/site-kit`

This is a platform-owned Astro 5 integration (`packages/site-kit`), published to public npm with
semver. It provides:

- **Injected routes** from `site.manifest.json`:

  | Route | Pattern |
  |---|---|
  | home | `/{lang}/` |
  | region | `/{lang}/{region}/` |
  | region × section | `/{lang}/{region}/{section}/` |
  | collection index | `/{lang}/{region}/{collection}/` |
  | collection item | `/{lang}/{region}/{collection}/{item}/` (when the collection declares a detail route) |
  | blog | `/{lang}/blog/`, `/{lang}/blog/{slug}/` |
  | catch-all | any page JSON whose localized slug matches |
  | 404 | per language |

- **SEO:** the sitemap, `robots.txt`, `hreflang` alternates, canonical URLs, Open Graph and
  JSON-LD (Article, Place, BreadcrumbList).
- **Content loading with validation:** pages and collections are validated against the merged
  schema registry at build time. An invalid file fails the build with the file and path.
- **i18n:** `t(key)` for UI strings, `localize(value)` for `LocalizedString`, and language
  fallbacks from the manifest.
- **Block registry:** core blocks map to the theme's renderers, and `x:` custom blocks to
  `theme/blocks/<name>/Component.astro`. A missing renderer falls back to a neutral renderer and
  produces a warning.
- **Closed-world resolution:** internal links resolve through the sitemap, and `MediaRef`s through
  the media index. An unresolved reference fails `kit check`.
- **Dev block gallery:** `/_kit/blocks` renders every block's `example.json` with the current
  theme.
- **The `kit` CLI:**

  | Command | Does |
  |---|---|
  | `kit check [--strict] [--baseline file]` | schema validation, block coverage, theme lint, path guard; `--baseline` ratchets existing violations |
  | `kit migrate <from>..<to>` | codemods for content and theme across kit majors (e.g. schema v2) |
  | `kit screenshots` | Playwright screenshots of `screenshotPages` at the configured widths and languages |
  | `kit blocks-doc` | generated writer documentation for core and custom blocks |

## `theme/` and `defineTheme`

The theme lives in the site repo, is authored by agents, and follows this layout:

```
theme/
├── theme.config.ts        export default defineTheme({ name, tokens, layouts, chrome, blocks, islands })
├── tokens.json            W3C Design Tokens (color, typography, spacing, radius, shadow) → Tailwind 4 theme
├── layouts/               Base.astro, Article.astro, Region.astro, Collection.astro
├── chrome/                Header.astro, Footer.astro, Nav.astro, LanguageSwitcher.astro
├── blocks/                core renderers: paragraph.astro, hero.astro, …
│   └── <name>/            custom block: schema.json, Component.astro, example.json  (type "x:<name>")
└── islands/               React islands (client:visible only)
```

**Theme lint** (part of `kit check --strict`):
- no `fs`, `path`, `node:*` or `child_process` imports;
- dependencies only from the kit's allowlist;
- no remote `<script src>` and no remote fonts (fonts are self-hosted from `public/fonts/`);
- no hardcoded locales or region names (they must come from the manifest);
- writes are limited to `theme/**` (the path guard compares the PR diff).

## Change flow

1. A **Redesign** or **ThemeTweak** project starts. A pitch in a design-crit meeting, a CEO
   ticket or an event can start one.
2. The **Art Director** (opus with vision) writes a structured mood board: palette, typography,
   references, and imagery chosen from the **closed media index**.
3. Tokens are edited.
4. The **Front-end Dev** returns file artifacts. The repo tool limits writes to `theme/**`, and
   the **orchestrator commits** on `design/<project>` and opens the PR.
5. The **platform-owned `site-ci.yml`** runs on the PR:
   - `kit check --strict` (schema, coverage, theme lint, path guard);
   - the build, plus **URL-set parity** with `main` (no URL may disappear);
   - a link check;
   - Playwright screenshots of `screenshotPages` at **375, 768, 1280 and 1440** px in **en and
     de**;
   - a pixel diff against the `main` baselines;
   - **axe**, with 0 serious violations allowed;
   - **Lighthouse budgets:** performance ≥ 85, a11y ≥ 95, SEO ≥ 95, CLS ≤ 0.1, JS ≤ 150 KB;
   - artifacts (screenshots, `dist/`) emitting `cockpit.visual.v1` (screenshots vs baseline) and
     `cockpit.benchmark.v1` (Lighthouse).
6. A **QA designer** agent reviews the before and after screenshots with vision. Below 7 means a
   fix loop (at most 3), then a ticket.
7. **Merge gate:** the required checks plus the review.
   - A **redesign**, or a diff **above 15%**, needs a **CEO ticket** with the mood board, the
     before and after shots, and a preview link (`preview.<platform>/<company>/<pr>/`, served
     from the `dist` artifact).
   - Smaller changes auto-merge per the autonomy policy.
   - **The orchestrator merges.**
8. **After deploy,** a smoke screenshot and a link check run against production. On failure, a
   revert PR opens automatically and a **Rollback** event fires.

## In the game

- The **DesignStudio** room has a **MoodBoardWall** that shows the real mood-board images, and a
  **ColorMonitor** that shows CI screenshots while checks run.
- Design-crit meetings happen in the MeetingRoom.
- A redesign gives a **novelty audience bump**. Lighthouse and a11y scores become permanent
  economy factors. A rollback costs reputation.

## Site repo layout (after cutover step 4)

```
<site>/
├── .github/workflows/deploy.yml     build with the kit, deploy to Pages (platform-owned)
├── .github/workflows/site-ci.yml    PR checks (platform-owned)
├── package.json                     "@swarm-press/site-kit": "^1"
├── astro.config.mjs                 integrations: [siteKit()]
├── site.manifest.json
├── content/{pages,collections,config}/
└── theme/
```
