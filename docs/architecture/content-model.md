# Content model and knowledge indexes

Pages are JSON documents made of typed blocks, stored canonically in the company's site
repository. They are validated identically in the browser, on the server and in site CI.
Agents can refer only to things the knowledge indexes contain.

Decisions: [ADR-0014](../adr/0014-content-model-json-blocks-localizedstring.md),
[ADR-0013](../adr/0013-closed-world-knowledge-indexes.md),
[ADR-0009](../adr/0009-site-repo-canonical-github-app.md).
Features: FEAT-042 (content model), FEAT-043 (knowledge indexes).

## Page

A page file lives in the site repo at `content/pages/**.json`. The schema below is
`packages/content-schema/src/page.ts`:

| Field | Type | Notes |
|---|---|---|
| `id` | string, non-empty | stable id |
| `slug` | `LocalizedString` | e.g. `{ "en": "/en/blog/last-light-on-sentiero-azzurro" }` |
| `title` | `LocalizedString` | |
| `page_type` | string | `blog-article`, `village`, `collection-index`, … |
| `seo` | `{ title?, description?, keywords?, canonical?, og_image? }` | localized in schema v2 |
| `body` | `Block[]` | discriminated by `type` |
| `metadata` | object, optional | |
| `status` | `draft` \| `in_review` \| `published` \| `archived` | |
| `created_at`, `updated_at` | ISO strings | |

Collections (restaurants, accommodations, hikes, …) are stored as **per-region arrays** at
`content/collections/<type>/<region>.json`, not as one file per item.

## LocalizedString

```ts
type LocalizedString = { en: string; de?: string; fr?: string; it?: string; [lang: string]: string }
```

- `en` is required and is the fallback locale.
- Always read values through `localize(value, locale)` (site kit) or
  `getLocalizedValue(value, locale)`, never with `value[locale] || value.en`.
- **Schema v2** (cutover step 5) generalises text fields to `string | Partial<Record<Lang,
  string>>` for the site's declared languages, adds a real `blog-article` block and a `MediaRef`
  (`{ media: "<media-index id>", alt?: LocalizedString, crop? }`) in place of raw URLs.

## Blocks

**Core blocks** are platform-owned and versioned with the site kit. There are 46 today
(`packages/content-schema/src/blocks.ts`):

| Group | Types |
|---|---|
| Core | `paragraph`, `heading`, `hero`, `image`, `gallery`, `quote`, `list`, `faq`, `callout`, `embed`, `collection-embed`, `map` |
| Sections | `hero-section`, `feature-section`, `cta-section`, `stats-section`, `faq-section`, `content-section`, `newsletter`, `section-header` |
| Cinque Terre (theme-adjacent, to become `x:` custom blocks of that site at cutover step 4) | `village-selector`, `places-to-stay`, `featured-carousel`, `village-intro`, `trending-now`, `about`, `curated-escapes`, `latest-stories`, `eat-drink`, `highlights`, `audio-guides`, `practical-advice` |
| Editorial | `editorial-hero`, `editorial-intro`, `editorial-interlude`, `editor-note`, `closing-note` |
| Templates | `itinerary-hero`, `itinerary-days`, `team-grid`, `airports-overview`, `weather-live`, `weather-journal`, `blog-article`, `collection-with-interludes`, `blog-index` |

**Custom blocks** live in the site repo at `theme/blocks/<name>/`:
- `schema.json` (JSON Schema for the block, with `type: "x:<name>"`);
- `Component.astro`;
- `example.json`.

The schema registry merges core and custom schemas per site and SHA.

**Block metadata** carries over from the legacy `block-metadata.ts`, one record per block type:
- intent (what the block is for);
- media rules (required, optional or forbidden; count; aspect);
- linking rules (internal links allowed; max count).

It feeds the generated writer documentation and the QA gate.

**Rules:**
- Renderers never parse Markdown at render time. Emphasis and links are structured sub-blocks.
- Writer prompts get block docs **generated** from the merged registry and metadata
  (`kit blocks-doc` on the site side, `agents::prompts::block_docs` on the server).
- A theme must render every core block its content uses. The rest fall back to the kit's
  neutral renderers.

## One schema, two validators

```
packages/content-schema (Zod, source)
   └─ pnpm schema:export ─► crates/content-schema/schema/page.schema.json (committed)
                               ├─ Rust validator (jsonschema)  ── server, agents
                               └─ compiled to wasm             ── browser (LocalLlm.structured)
shared fixtures: crates/content-schema/fixtures/{valid,invalid}/*.json  (both validators must agree)
```

- `pnpm schema:check` fails CI if the committed JSON Schema drifts from the Zod export.
- `crates/content-schema` becomes `crates/content-model` in M3. That adds typed `Page`/`Block`
  structs, the custom-schema registry, and `validate_page(page, registry) -> Vec<Error>` with
  errors phrased for the model to repair.

## Knowledge indexes (`crates/knowledge`)

Built from the site repo at a commit SHA, rebuilt on every push to `main`. Every job records the
index SHA it was validated against.

| Index | Source in the site repo | Used for |
|---|---|---|
| Manifest | `site.manifest.json` / `content/site.json` | languages, regions (villages: slug, name, order, colour, geo, entity ref), sections, collections, routes, `screenshotPages`, authors |
| Entities | `content/config/entity-index.json` + collections | `lookup_entity`, entity mentions, fact consistency |
| Media | `content/config/media-index.json` (338 images on cinqueterre.travel) | `search_media`, `MediaRef` resolution, alt text |
| Sitemap | `content/config/sitemap-index.json` + the crawl | internal link resolution per language |
| Schemas | core registry + `theme/blocks/*/schema.json` | validation, generated block docs |
| House style | `style-guide.json`, `linking-policy.json`, `writer-prompt.json`, `media-guidelines.json`, `blog-workflow.json` | prompt layer 2, QA checks |
| Calendar | `content-calendar.json` | pitch backlog, tourist-season events |
| Research templates | `collection-research.json` | CollectionResearch projects |

**Closed world:**
- `write_page` and the server-side artifact validator check every internal link, media id and
  entity reference against these indexes.
- An unknown id is a tool error that goes back to the model. It is never dropped silently.
- If the knowledge needed does not exist, the agent raises `NEEDS_PAGE` or `NEEDS_MEDIA`, which
  becomes a ticket or a new project rather than an invention.

Index builders are tested against a trimmed copy of cinqueterre content in
`crates/testkit/fixtures/cinqueterre-mini`.
