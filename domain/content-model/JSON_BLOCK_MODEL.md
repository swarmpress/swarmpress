# JSON Block Model Specification

**Version:** 1.0
**Status:** Canonical
**Last Updated:** 2025-11-22

---

## Purpose

The JSON Block Model is the canonical content format for agent.press. It provides a structured, LLM-friendly, component-based content representation that is:

- **Flexible** — Supports rich layouts and components
- **Parseable** — Easy for LLMs to generate and analyze
- **Type-safe** — Validated with schemas
- **Extensible** — New block types can be added
- **Framework-agnostic** — Not tied to React/MDX

---

## Philosophy

### Why Not Plain Markdown?
- Too limited for complex layouts
- No component support
- Difficult to extend

### Why Not MDX?
- Couples content to React
- Harder for LLMs to reason about
- Makes indexing and analysis difficult

### Why JSON Blocks?
- Similar to Notion, Editor.js, Medium
- LLM-friendly structure
- Component-like flexibility
- Safe parsing and validation

---

## Block Structure

Every block follows this pattern:

```typescript
{
  "type": "block_type",
  // ...type-specific properties
}
```

Blocks are stored as an array in `ContentItem.body`:

```typescript
{
  "id": "content-001",
  "type": "article",
  "body": [
    { "type": "hero", "title": "Welcome" },
    { "type": "paragraph", "markdown": "Content here..." },
    { "type": "image", "src": "...", "alt": "..." }
  ]
}
```

---

## Core Block Types

### 1. Paragraph

Rich text content with Markdown support.

```json
{
  "type": "paragraph",
  "markdown": "This is **bold** and this is *italic*."
}
```

**Properties:**
- `markdown` (string, required) — Markdown-formatted text

**Use cases:**
- Body text
- Descriptions
- General content

---

### 2. Heading

Section headers (H2, H3, H4).

```json
{
  "type": "heading",
  "level": 2,
  "text": "Introduction to Riomaggiore"
}
```

**Properties:**
- `level` (number, required) — 2, 3, or 4
- `text` (string, required) — Plain text heading
- `id` (string, optional) — Anchor ID for linking

**Use cases:**
- Section breaks
- Table of contents anchors
- SEO structure

---

### 3. Hero

Page hero section with title and optional subtitle.

```json
{
  "type": "hero",
  "title": "Discover Riomaggiore",
  "subtitle": "A Hidden Gem of Cinque Terre",
  "backgroundImage": "https://..."
}
```

**Properties:**
- `title` (string, required) — Main heading
- `subtitle` (string, optional) — Subheading
- `backgroundImage` (string, optional) — URL to background image

**Use cases:**
- Page headers
- Landing sections
- Visual impact

---

### 4. Image

Single image with caption and alt text.

```json
{
  "type": "image",
  "src": "s3://bucket/image.jpg",
  "alt": "Colorful houses along the harbor",
  "caption": "The iconic harbor view of Riomaggiore",
  "width": 1200,
  "height": 800
}
```

**Properties:**
- `src` (string, required) — Image URL or S3 path
- `alt` (string, required) — Accessibility text
- `caption` (string, optional) — Visible caption
- `width` (number, optional) — Image width
- `height` (number, optional) — Image height

**Use cases:**
- Inline images
- Illustrations
- Visual content

---

### 5. Gallery

Multiple images in a grid or carousel.

```json
{
  "type": "gallery",
  "layout": "grid",
  "images": [
    { "src": "...", "alt": "...", "caption": "..." },
    { "src": "...", "alt": "...", "caption": "..." }
  ]
}
```

**Properties:**
- `layout` (string, required) — "grid" | "carousel" | "masonry"
- `images` (array, required) — Array of image objects

**Use cases:**
- Photo galleries
- Multiple related images
- Visual storytelling

---

### 6. Quote

Blockquote with optional attribution.

```json
{
  "type": "quote",
  "text": "Riomaggiore is where the mountains meet the sea.",
  "attribution": "Local proverb"
}
```

**Properties:**
- `text` (string, required) — Quote content
- `attribution` (string, optional) — Source or author

**Use cases:**
- Pull quotes
- Testimonials
- Citations

---

### 7. List

Ordered or unordered list.

```json
{
  "type": "list",
  "ordered": false,
  "items": [
    "Visit the harbor at sunset",
    "Hike the Via dell'Amore",
    "Try the local seafood"
  ]
}
```

**Properties:**
- `ordered` (boolean, required) — true = numbered, false = bullets
- `items` (array of strings, required) — List items

**Use cases:**
- Bullet lists
- Numbered steps
- Feature lists

---

### 8. FAQ

Question and answer pairs.

```json
{
  "type": "faq",
  "items": [
    {
      "question": "How do I get to Riomaggiore?",
      "answer": "You can reach Riomaggiore by train from La Spezia."
    },
    {
      "question": "When is the best time to visit?",
      "answer": "Spring and early fall offer the best weather."
    }
  ]
}
```

**Properties:**
- `items` (array, required) — Array of `{ question, answer }` objects

**Use cases:**
- FAQs
- Q&A sections
- Help content

---

### 9. Callout

Highlighted information box.

```json
{
  "type": "callout",
  "style": "info",
  "title": "Pro Tip",
  "content": "Visit early in the morning to avoid crowds."
}
```

**Properties:**
- `style` (string, required) — "info" | "warning" | "success" | "error"
- `title` (string, optional) — Box heading
- `content` (string, required) — Box content (supports Markdown)

**Use cases:**
- Tips and warnings
- Important notices
- Highlighted information

---

### 10. Embed

External content embed (video, map, etc.).

```json
{
  "type": "embed",
  "provider": "youtube",
  "url": "https://youtube.com/watch?v=...",
  "title": "Walking tour of Riomaggiore"
}
```

**Properties:**
- `provider` (string, required) — "youtube" | "vimeo" | "maps" | "custom"
- `url` (string, required) — Embed URL
- `title` (string, optional) — Accessible title

**Use cases:**
- YouTube videos
- Google Maps
- External widgets

---

## Extensibility

New block types can be added by:

1. Defining the JSON structure
2. Adding a Zod schema validator
3. Creating an Astro component renderer
4. Documenting in this spec

**Future block types:**
- `table` — Data tables
- `code` — Code snippets with syntax highlighting
- `tabs` — Tabbed content sections
- `accordion` — Expandable content
- `timeline` — Event timeline
- `comparison` — Side-by-side comparison

---

## Validation

All blocks are validated using Zod schemas (see `/packages/shared/src/content/blocks.ts`).

Invalid blocks should:
- Be rejected during content creation
- Logged with clear error messages
- Never reach the rendering stage

---

## Rendering

Blocks are rendered in:
- **Astro** (site-builder) — Server-side static generation
- **React** (optional, future) — Client-side rendering
- **Plain HTML** (optional, future) — Simple templates

---

## Example: Complete Article

```json
{
  "id": "article-riomaggiore",
  "type": "article",
  "body": [
    {
      "type": "hero",
      "title": "Discover Riomaggiore",
      "subtitle": "A Hidden Gem of Cinque Terre"
    },
    {
      "type": "paragraph",
      "markdown": "Riomaggiore is the southernmost village of **Cinque Terre**, perched dramatically on the Ligurian coast."
    },
    {
      "type": "image",
      "src": "s3://images/riomaggiore-harbor.jpg",
      "alt": "Colorful houses along the harbor",
      "caption": "The iconic harbor view"
    },
    {
      "type": "heading",
      "level": 2,
      "text": "Things to Do"
    },
    {
      "type": "list",
      "ordered": false,
      "items": [
        "Visit the harbor at sunset",
        "Hike the Via dell'Amore",
        "Try the local seafood"
      ]
    },
    {
      "type": "faq",
      "items": [
        {
          "question": "How do I get there?",
          "answer": "Take the train from La Spezia."
        }
      ]
    }
  ]
}
```

---

## LLM Guidelines

When generating content blocks, LLMs should:

1. **Use appropriate block types** — Match content to block semantics
2. **Include all required fields** — Never omit required properties
3. **Validate structure** — Ensure JSON is well-formed
4. **Use Markdown in paragraphs** — For rich text formatting
5. **Provide alt text** — For all images (accessibility)
6. **Keep blocks focused** — One concept per block
7. **Order logically** — Hero → Content → Calls-to-action

---

**This is the canonical content model for agent.press.**
