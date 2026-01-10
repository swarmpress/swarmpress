# Theme Development Guide

> **Last Updated:** 2026-01-10
> **Status:** Current

This guide explains how to create themes for swarm.press sites, using the Cinque Terre theme as a reference implementation.

---

## Overview

Themes in swarm.press:
- Are Astro-based static site generators
- Load content from Git submodules (JSON files)
- Support multi-language routing
- Render JSON blocks as components
- Can have site-specific block types

---

## Theme Structure

```
packages/site-builder/src/themes/
└── cinque-terre/              # Theme name
    ├── src/
    │   ├── components/        # Astro components
    │   │   ├── blocks/        # Block renderers
    │   │   │   ├── EditorialHero.astro
    │   │   │   ├── VillageSelector.astro
    │   │   │   └── ...
    │   │   ├── ui/            # UI components (shadcn/ui)
    │   │   ├── Hero.astro
    │   │   ├── Footer.tsx
    │   │   └── Navigation.astro
    │   ├── config/            # Theme configuration
    │   │   ├── navigation.config.ts
    │   │   └── village-content.config.ts
    │   ├── pages/             # Astro pages
    │   │   ├── index.astro
    │   │   └── [lang]/        # Multi-language routes
    │   │       ├── index.astro
    │   │       └── [village]/
    │   │           └── index.astro
    │   ├── layouts/           # Layout templates
    │   │   └── Layout.astro
    │   ├── types/             # TypeScript types
    │   └── ContentRenderer.astro
    ├── public/                # Static assets
    ├── astro.config.mjs
    ├── package.json
    └── tailwind.config.mjs
```

---

## Creating a New Theme

### 1. Copy Reference Implementation

```bash
# Copy the Cinque Terre theme
cp -r packages/site-builder/src/themes/cinque-terre \
      packages/site-builder/src/themes/mysite

# Update package.json name
cd packages/site-builder/src/themes/mysite
# Edit package.json: "name": "@swarm-press/theme-mysite"
```

### 2. Create Content Submodule

```bash
# Create content repository
mkdir ../mysite.travel
cd ../mysite.travel
git init

# Create structure
mkdir -p content/{config,pages,collections}

# Add agent config files
cp -r ../cinqueterre.travel/content/config/*.json content/config/

# Customize writer-prompt.json with your brand voice
```

### 3. Update Theme Configuration

**village-content.config.ts** (or equivalent):

```typescript
// Path to content submodule
const CONTENT_DIR = process.env.CONTENT_DIR || '/path/to/mysite.travel/content';

// Load content from JSON files
export function getVillageContent(slug: string) {
  const filePath = path.join(CONTENT_DIR, 'config', 'villages', `${slug}.json`);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return null;
}
```

---

## Content Rendering

### ContentRenderer.astro

The ContentRenderer maps JSON blocks to Astro components:

```astro
---
import EditorialHero from './components/blocks/EditorialHero.astro';
import VillageSelector from './components/blocks/VillageSelector.astro';
import Paragraph from './components/blocks/Paragraph.astro';
// ... more imports

interface Props {
  blocks: any[];
  locale: string;
  village?: string;
}

const { blocks, locale, village } = Astro.props;

// Block type to component mapping
const blockComponents = {
  'editorial-hero': EditorialHero,
  'village-selector': VillageSelector,
  'paragraph': Paragraph,
  // ... more mappings
};
---

{blocks.map(block => {
  const Component = blockComponents[block.type];
  if (!Component) {
    console.warn(`Unknown block type: ${block.type}`);
    return null;
  }
  return <Component {...block} locale={locale} village={village} />;
})}
```

### Block Component Example

**EditorialHero.astro**:

```astro
---
interface Props {
  title: Record<string, string>;
  subtitle?: Record<string, string>;
  image: string;
  badge?: string;
  locale: string;
}

const { title, subtitle, image, badge, locale } = Astro.props;
---

<section class="relative h-[70vh]">
  <img src={image} alt={title[locale]} class="absolute inset-0 object-cover" />
  <div class="relative z-10 text-white text-center">
    {badge && <span class="badge">{badge}</span>}
    <h1 class="text-5xl font-bold">{title[locale]}</h1>
    {subtitle && <p class="text-xl">{subtitle[locale]}</p>}
  </div>
</section>
```

---

## Multi-Language Routing

### URL Structure

```
/en/              # English homepage
/de/              # German homepage
/en/riomaggiore   # English village page
/de/riomaggiore   # German village page
```

### Dynamic Route: [lang]/[village]/index.astro

```astro
---
import Layout from '../../../layouts/Layout.astro';
import ContentRenderer from '../../../ContentRenderer.astro';
import { getVillageContent } from '../../../config/village-content.config';

export async function getStaticPaths() {
  const SUPPORTED_LANGS = ['en', 'de', 'fr', 'it'];
  const VILLAGES = ['riomaggiore', 'manarola', 'corniglia', 'vernazza', 'monterosso'];

  const paths = [];
  for (const lang of SUPPORTED_LANGS) {
    for (const village of VILLAGES) {
      const content = getVillageContent(village);
      paths.push({
        params: { lang, village },
        props: { content, locale: lang }
      });
    }
  }
  return paths;
}

const { lang, village } = Astro.params;
const { content, locale } = Astro.props;
---

<Layout title={content.seo.title[locale]} locale={locale}>
  <ContentRenderer blocks={content.body} locale={locale} village={village} />
</Layout>
```

---

## Loading Content from JSON

### Page Content

```typescript
// Load page JSON
const pagePath = path.join(CONTENT_DIR, 'pages', 'index.json');
const pageContent = JSON.parse(fs.readFileSync(pagePath, 'utf-8'));

// pageContent.body is an array of blocks
const blocks = pageContent.body;
```

### Collection Content

```typescript
// Load restaurant collection
const restaurantsDir = path.join(CONTENT_DIR, 'collections', 'restaurants');
const restaurants = fs.readdirSync(restaurantsDir)
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(restaurantsDir, f), 'utf-8')));
```

### Village Configuration

```typescript
// Load village config (dynamic - agents can update)
const villageConfig = path.join(CONTENT_DIR, 'config', 'villages', 'riomaggiore.json');
const village = JSON.parse(fs.readFileSync(villageConfig, 'utf-8'));

// Access localized content
const title = village.hero.title[locale]; // "Riomaggiore"
const subtitle = village.hero.subtitle[locale]; // "The easternmost jewel..."
```

---

## Adding Custom Block Types

### 1. Define Zod Schema

In `packages/shared/src/content/blocks.ts`:

```typescript
export const MyCustomBlockSchema = z.object({
  type: z.literal('my-custom-block'),
  title: LocalizedStringSchema,
  items: z.array(z.object({
    label: LocalizedStringSchema,
    value: z.string()
  }))
});
```

### 2. Add to Union

```typescript
export const ContentBlockSchema = z.discriminatedUnion('type', [
  // ... existing blocks
  MyCustomBlockSchema,
]);
```

### 3. Create Component

In theme `src/components/blocks/MyCustomBlock.astro`:

```astro
---
interface Props {
  title: Record<string, string>;
  items: Array<{ label: Record<string, string>; value: string }>;
  locale: string;
}

const { title, items, locale } = Astro.props;
---

<section class="my-custom-block">
  <h2>{title[locale]}</h2>
  <ul>
    {items.map(item => (
      <li>
        <strong>{item.label[locale]}</strong>: {item.value}
      </li>
    ))}
  </ul>
</section>
```

### 4. Register in ContentRenderer

```typescript
const blockComponents = {
  // ... existing
  'my-custom-block': MyCustomBlock,
};
```

### 5. Document for Agents

Add to `content/config/agent-schemas.json`:

```json
{
  "block_types": {
    "my-custom-block": {
      "description": "Displays a custom titled list with key-value items",
      "props": {
        "title": "LocalizedString - Block title",
        "items": "Array of { label: LocalizedString, value: string }"
      },
      "example": {
        "type": "my-custom-block",
        "title": { "en": "Key Facts" },
        "items": [
          { "label": { "en": "Population" }, "value": "1,500" }
        ]
      }
    }
  }
}
```

---

## Navigation Configuration

### Coastal Spine Example

```typescript
// navigation.config.ts
export const VILLAGES = [
  { slug: 'riomaggiore', name: { en: 'Riomaggiore', de: 'Riomaggiore' } },
  { slug: 'manarola', name: { en: 'Manarola', de: 'Manarola' } },
  { slug: 'corniglia', name: { en: 'Corniglia', de: 'Corniglia' } },
  { slug: 'vernazza', name: { en: 'Vernazza', de: 'Vernazza' } },
  { slug: 'monterosso', name: { en: 'Monterosso', de: 'Monterosso' } }
];

export const SECTIONS = [
  { slug: 'overview', name: { en: 'Overview', de: 'Überblick' } },
  { slug: 'stay', name: { en: 'Where to Stay', de: 'Unterkünfte' } },
  { slug: 'eat', name: { en: 'Eat & Drink', de: 'Essen & Trinken' } },
  { slug: 'hikes', name: { en: 'Hiking', de: 'Wandern' } }
];
```

---

## Building and Deploying

### Development

```bash
cd packages/site-builder/src/themes/mysite
pnpm dev
```

### Production Build

```bash
pnpm build
```

### Deploy to GitHub Pages

```bash
# EngineeringAgent handles this via workflow
# Or manually:
pnpm build
git -C dist init
git -C dist add .
git -C dist commit -m "Deploy"
git -C dist push -f git@github.com:org/mysite.github.io.git main
```

---

## Related Documentation

- [Content Architecture](../architecture/content-architecture.md) - Storage patterns
- [Architecture Overview](../architecture/overview.md) - System architecture
- [CLAUDE.md](/CLAUDE.md) - Development guidelines
