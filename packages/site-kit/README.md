# @swarm-press/site-kit

The platform-owned Astro 5 integration that every SimPress website is built on
([ADR-0015](../../docs/adr/0015-agent-authored-themes-on-site-kit.md),
[ADR-0016](../../docs/adr/0016-site-kit-distribution-via-npm.md), FEAT-044).

The kit owns everything except presentation: routing, content loading and
validation (schema v2), i18n, SEO (canonical, hreflang, Open Graph, JSON-LD),
sitemap and robots, the first-party tracker tag, closed-world link and media
resolution, and the block dispatcher. A **theme** owns tokens, layouts, chrome
and block renderers. Nothing else.

This README is the authoring guide for theme agents (the design department)
and for people reviewing their PRs.

```
site repo
├── astro.config.mjs        integrations: [siteKit()]          (platform-owned)
├── site.manifest.json      languages, regions, sections, ...  (platform-owned)
├── content/                pages/, collections/, config/      (writers, via the orchestrator)
└── theme/                  ← the only directory a theme PR may touch
```

## Setup

```js
// astro.config.mjs
import { defineConfig } from 'astro/config'
import siteKit from '@swarm-press/site-kit'

export default defineConfig({ integrations: [siteKit()] })
```

`siteKit(options)`:

| Option | Default | |
|---|---|---|
| `contentDir` | `content` | content root (pages, collections, config) |
| `manifest` | `site.manifest.json` | path or an inline object |
| `theme` | `manifest.themeDir` (`theme`) | theme directory |
| `baseline` | `kit-baseline.json` | ratchet file of tolerated content errors |
| `base` | `manifest.base` | override the path prefix (preview deploys: `/preview/42/`) |
| `inferManifest` | `false` | infer a manifest from legacy config when none exists |
| `tailwind` | `true` | compile Tailwind 4 (tokens become `@theme`) |
| `failOnInvalid` | `true` | fail the build on content errors not in the baseline |
| `gallery` | `true` | dev-only block gallery at `/_kit/blocks` |

The build writes `.kit/content-report.json` (all findings) and
`.kit/link-report.json` (closed-world link check) next to the config.

## The manifest (`site.manifest.json`)

Validated by Zod (`SiteManifestSchema`); the JSON Schema export is
`schema/site-manifest.schema.json`. Main fields: `siteId`, `baseUrl`, `base`,
`languages[]`, `defaultLanguage`, `brand {name, tagline, logo, favicon, voiceRef}`,
`regions {label, items[{slug, name, order, color, geo, entityRef}]}`,
`sections[{slug, label, collection?, perRegion, hubPage?}]`,
`collections[{type, dir, label, detailRoute, itemKey, regionField?}]`,
`routes {home?, blogIndex?}`, `analytics {endpoint, projectKey}`,
`screenshotPages[]`, `themeDir`. Localized fields take `"text"` or
`{ "en": "…", "de": "…" }` (`en` required). `kit manifest --infer` prints a
manifest inferred from legacy config (`inferManifest()`, a port of
`knowledge::SiteManifest::infer`).

## Routes (injected; themes never add routes)

| Pattern | What |
|---|---|
| `/` | redirect to `/<defaultLanguage>/` |
| `/[lang]/` | home page (`content/pages/index.json`) |
| `/[lang]/[...slug]/` | every page by its localized `slug` |
| `/[lang]/[region]/` | region page (or a kit-generated hub) |
| `/[lang]/[section]/`, `/[lang]/[region]/[section]/` | sections, per region when `perRegion` |
| `/[lang]/[collection]/[item]/` | collection item detail (when `detailRoute`) |
| `/[lang]/blog/[slug]/` | blog posts |
| `/404`, `/[lang]/404/`, `/sitemap.xml`, `/robots.txt` | |

A page is only routed in the languages its `slug` declares; hreflang lists
exactly those languages.

## Writing a theme

```
theme/
├── theme.config.ts        export default defineTheme({ … })   (optional)
├── tokens.json            W3C design tokens → Tailwind 4 @theme + :root variables
├── styles.css             extra CSS (Tailwind utilities available)
├── layouts/<Name>.astro   Base, Page, Article, Region, CollectionIndex, CollectionItem, NotFound
├── chrome/<Name>.astro    Header, Footer, LanguageSwitcher, RegionNav
├── blocks/<type>.astro    core block overrides: paragraph.astro, editorial-hero.astro, …
├── blocks/<name>/         custom block x:<name>: schema.json, Component.astro, example.json
└── i18n/<lang>.json       UI strings for ctx.t()
```

Everything is discovered by convention. Override only what you want: every
core block has a neutral fallback renderer in the kit (semantic HTML styled by
your tokens), and every layout and chrome piece has a default.
`theme.config.ts` makes the contract explicit and is validated at build start:

```ts
import { defineTheme } from '@swarm-press/site-kit/theme'   // the light entry: never import '@swarm-press/site-kit' values in theme code
import tokens from './tokens.json'
import Hero from './blocks/editorial-hero.astro'
import KeyFacts from './blocks/key-facts/Component.astro'
import keyFactsSchema from './blocks/key-facts/schema.json'

export default defineTheme({
  name: 'my-theme',
  tokens,
  blocks: { 'editorial-hero': Hero },
  customBlocks: [{ name: 'key-facts', component: KeyFacts, schema: keyFactsSchema }],
})
```

Type-only imports (`import type { RenderContext } from '@swarm-press/site-kit'`)
are fine anywhere.

### Components receive `ctx`

Layouts and chrome get `{ ctx }`; block renderers get `{ block, ctx, index }`.
`ctx` (`RenderContext`) is the only way a theme reads data:

| | |
|---|---|
| `ctx.l(value)` | localized text for the current language (fallback: default language, then `en`) |
| `ctx.list(value)`, `ctx.pick(value)` | localized list / raw localized value |
| `ctx.t(key, vars)` | UI string (theme `i18n/` → kit strings → `en` → key) |
| `ctx.media(ref)` | `media:<id>` / URL / `/path` → `{ src, alt, width, height }` or `undefined` |
| `ctx.href(value)` | internal links get the language prefix and base; external pass through |
| `ctx.url(route)` | public URL of a route path |
| `ctx.nav` | `home`, `regions`, `sections`, `languages` (with `translated`), `breadcrumb`, `children` |
| `ctx.collectionItems(type, {region, keys})`, `ctx.itemTitle/itemImage/itemHref` | collections |
| `ctx.posts()` | blog posts in the current language, newest first |
| `ctx.lang`, `ctx.dir`, `ctx.languages`, `ctx.brand`, `ctx.page`, `ctx.region`, `ctx.section`, `ctx.item`, `ctx.title`, `ctx.year` | |
| `ctx.components` | `Header`, `Footer`, `LanguageSwitcher`, `RegionNav`, `Blocks` (in layouts) |

Kit components a theme may import: `components/Blocks.astro` (render a block
list through the registry), `RichText.astro`, `Img.astro`, `Breadcrumb.astro`,
`ItemGrid.astro`, `PostList.astro`.

The kit owns `<head>`: never add `<title>`, meta, hreflang, canonical,
JSON-LD or analytics in a theme.

### Tokens

`tokens.json` uses the W3C Design Tokens format. Top-level groups map to
Tailwind 4 namespaces (`color` → `--color-*`, `font` → `--font-*`, `radius`,
`spacing`, `shadow`, `container`, `breakpoint`, …), so `{"color": {"accent": …}}`
gives `bg-accent`, `text-accent` and `var(--color-accent)`. Aliases
(`"{color.brand.500}"`) become `var(…)`; a dangling alias fails the build.
The kit's fallbacks use `color.bg/surface/fg/muted/border/accent/accent-fg`,
`font.sans/serif`, `radius.card`, `spacing.gutter`, `container.prose/page`.

### Custom blocks

`theme/blocks/<name>/` with `schema.json` (JSON Schema; `type` const
`x:<name>`), `Component.astro` and `example.json` (validated against the
schema, shown in the gallery). Content uses `{ "type": "x:<name>", … }`.
Names are lowercase kebab-case and may not shadow a core block.

## Rules (`kit check` enforces them)

- No `fs`, `path`, `node:*`, `child_process`, `process.env`, `fetch()`,
  `import.meta.glob`, `Astro.glob`. Data comes from `ctx`.
- Dependencies only from the allowlist (`astro`, `react`, `react-dom`, `clsx`,
  `tailwind-merge`, `class-variance-authority`, `lucide-react`,
  `embla-carousel-react`, `@fontsource/*`, the kit). No imports outside `theme/`.
- No remote scripts, stylesheets or fonts. Self-host fonts (`@fontsource/*`).
- No third-party analytics. The kit renders the first-party tracker from
  `manifest.analytics`.
- Islands hydrate with `client:visible` only.
- No hardcoded language lists, `lang === 'de'`, `value.de` or `'de-DE'`. Use
  `ctx.languages`, `ctx.lang`, `ctx.l()`.
- No hardcoded region slugs or names. Use `ctx.nav.regions` and `ctx.region`.
- A theme PR may only change files under `theme/` (path guard, `--diff origin/main`).

## CLI

```sh
kit check [--strict] [--baseline kit-baseline.json] [--write-baseline file] [--json report.json] [--diff origin/main] [--infer]
kit migrate [v1..v2] [--write] [--verbose]
kit blocks-doc [--out BLOCKS.md]
kit screenshots [--dist dist] [--out .kit/screenshots] [--widths 375,768,1280,1440] [--langs en,de] [--baseline dir]
kit manifest [--infer]
# common: --root <dir> (default cwd), --manifest <file>, --content <dir>, --theme <dir>
```

- **check**: content validation (schema v2: `string | {lang: string}` with `en`,
  `MediaRef`, `x:` custom blocks), closed-world links (warnings; errors with
  `--strict`) and media (`media:<id>` must be in `content/config/media-index.json`),
  block coverage (every type used has a renderer), theme lint, tracker presence,
  path guard. Exit 1 on errors not in the baseline. The baseline is a ratchet:
  `--write-baseline` records today's errors, new ones fail, and fixed ones are
  listed for removal.
- **migrate**: codemods for legacy drift (`editorial-intro` content → leftContent,
  `closing-note` buttons/primaryButton → actions, `faq-section` faqs → items,
  `blog-article` post wrapper, `blog-index` intro fields). Dry run by default.
  Fields with no place in the target schema go to `page.metadata`, never dropped.
- **blocks-doc**: writer documentation generated from the core and custom block schemas.
- **screenshots**: Playwright (`playwright-core`, optional peer) screenshots of
  `manifest.screenshotPages` in `en` plus the longest language at 375/768/1280/1440,
  pixel diff against `--baseline`, and a `cockpit.visual.v1` document
  (`cockpit.visual.json`). Uses `CHROMIUM_PATH` when set.

## Development

```sh
pnpm --filter @swarm-press/site-kit test          # unit + astro build of themes/starter/fixture-site (+ screenshots if Chromium exists)
pnpm --filter @swarm-press/site-kit test:unit
pnpm --filter @swarm-press/site-kit typecheck
pnpm --filter @swarm-press/site-kit schema:check   # manifest JSON Schema in sync with Zod
(cd themes/starter/fixture-site && astro build)    # the starter theme against the cinqueterre-mini fixture
```

Tests that need the real cinqueterre.travel content run when
`/home/user/cinqueterre.travel/content` (or `$CINQUETERRE_CONTENT`) exists and
are skipped otherwise.
