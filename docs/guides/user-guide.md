# Swarm.press User Guide

> **Version:** 1.1
> **Last Updated:** 2026-01-10

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Sitemap Editor](#sitemap-editor)
4. [Page Editor](#page-editor)
5. [Site Editor](#site-editor)
6. [Collections Browser](#collections-browser)
7. [Blueprint Editor](#blueprint-editor)
8. [Agent Collaboration](#agent-collaboration)
9. [Analytics Dashboard](#analytics-dashboard)
10. [GitHub Integration](#github-integration)
11. [Tips & Best Practices](#tips--best-practices)

---

## Introduction

**Swarm.press** is an autonomous virtual publishing house where AI agents collaboratively manage your website's content structure, SEO optimization, and publishing workflows.

### Key Concepts

- **Pages**: Individual routes/URLs in your website
- **Blueprints**: Templates that define page structure and components
- **Content Models**: Data schemas for different content types
- **Agents**: AI collaborators that suggest improvements and track activities
- **Sitemap**: Visual graph representation of your site structure

---

## Getting Started

### Accessing the Admin

1. Navigate to the admin dashboard
2. Select a website from the dropdown in the top-right
3. The sitemap graph will load automatically

### First Steps

1. **Create your first page**: Click "+ New Page" button
2. **Assign a blueprint**: Choose from predefined templates
3. **Add content**: Fill in page details and metadata
4. **Review suggestions**: Check AI agent recommendations

---

## Sitemap Editor

The sitemap editor is a visual graph-based interface for managing your website structure.

### Graph Navigation

- **Pan**: Click and drag on empty space
- **Zoom**: Scroll wheel or pinch gesture
- **Select Node**: Click on a page
- **Multi-select**: Ctrl/Cmd + Click

### Layout Options

Three auto-layout algorithms:

1. **Dagre (Hierarchical)**: Tree-based layout following parent-child relationships
2. **Circular**: Radial arrangement around a center point
3. **Force-Directed**: Physics-based organic layout

**To apply**: Use the layout buttons in the controls panel

### Search and Filters

**Search Bar**: Find pages by title or slug
- Type to filter in real-time
- Clear with ✕ button

**Filters**:
- Status: planned, draft, published, outdated, deprecated
- Page Type: Filter by template type
- Combine filters for precise results

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+F` | Focus search |
| `Delete` | Delete selected node |

### Node Details

Each node displays:
- **Title** (bold)
- **Status** (color-coded badge)
- **Priority** indicator
- **Freshness score** (if < 100)
- **Alert count** (if alerts exist)
- **Task count** (if tasks assigned)

**Color Coding**:
- 🟢 Green: Published
- 🟡 Yellow: Draft
- 🔵 Blue: Planned
- 🟠 Orange: Outdated
- 🔴 Red: Deprecated

---

## Page Editor

The page editor allows you to visually edit page content using JSON blocks.

### Sections and Blocks

Pages are composed of **sections**, each containing **blocks**:
- **Sections**: Logical groupings of content (header, body, footer, etc.)
- **Blocks**: Individual content units (hero, paragraph, image, etc.)

### Section Properties Panel

When you select a section, the properties panel shows:
- **Section Settings**: Name, ID, visibility
- **Block Properties**: Type-specific settings
- **Collection Binding**: For collection-based sections

### SlugPicker

For sections that display collection items (restaurants, hotels, hikes), use the **SlugPicker**:

1. **Select Collection Type**: Choose from available collections (restaurants, accommodations, hikes, etc.)
2. **Filter by Village**: Optionally narrow results to a specific village
3. **Search**: Find items by name or slug
4. **Select Items**: Check boxes to include items
5. **Reorder**: Use up/down arrows to set display order
6. **Remove**: Click X to remove an item

The SlugPicker automatically loads items from the content submodule and allows you to curate which items appear and in what order.

---

## Site Editor

The site editor manages site-wide configuration and settings.

### LocalizedStringEditor

For multi-language content, use the **LocalizedStringEditor**:

**Full Mode (Tabs)**:
- Tabbed interface for each language (EN, DE, FR, IT)
- Translation status badge shows missing translations
- Red indicators highlight incomplete translations
- "Copy from EN" button for quick translation starts

**Compact Mode (Collapsible)**:
- Single language input with current locale
- Expandable section for all translations
- Ideal for space-constrained panels

**Features**:
- **Status Indicators**: Shows filled/total translations
- **Missing Alerts**: Amber badges for incomplete translations
- **Copy Feature**: One-click copy from default locale
- **Multiline Support**: Textarea for longer content

### Context Panel

The context panel shows page-specific settings:
- **SEO Configuration**: Title, description templates
- **Navigation Settings**: Menu visibility, order
- **Village Context**: For village-scoped pages

---

## Collections Browser

Browse and manage collection items from the content submodule.

### Accessing Collections

Navigate to **Collections** in the sidebar to open the browser.

### Collection Types

View available collection types:
- **restaurants**: Dining venues by village
- **accommodations**: Hotels and lodging
- **hikes**: Hiking trails and routes
- **events**: Local events and festivals
- **faqs**: Frequently asked questions

### Collection Items Grid

For each collection type:
- **Grid View**: Card-based display of items
- **Search**: Filter by name or slug
- **Village Filter**: Show items from specific villages
- **Sort Options**: Alphabetical, by village, by date

### Collection Item Cards

Each card displays:
- **Name/Title**: Primary identifier
- **Village Badge**: Location context
- **Preview Image**: If available
- **Key Attributes**: Rating, price range, etc.

### Collection Item Detail

Click an item to see:
- **All Localized Content**: EN, DE, FR, IT versions
- **Metadata**: Slug, village, dates
- **Media References**: Associated images
- **Edit Actions**: Open in page editor (if applicable)

---

## Blueprint Editor

Blueprints define the structure and components of your pages.

### Creating a Blueprint

1. Navigate to Blueprints page
2. Click "+ New Blueprint"
3. Name your blueprint and set page type
4. Add components from the library

### Component Library

**60+ Block Types in 7 Categories**:

| Category | Count | Examples |
|----------|-------|----------|
| **Core** | 10 | paragraph, heading, hero, image, gallery, quote, list, faq, callout, embed |
| **Marketing** | 20 | hero-section, feature-section, pricing-section, testimonial-section, cta-section |
| **E-commerce** | 4 | product-list, product-overview, shopping-cart, promo-section |
| **Application UI** | 5 | card, data-table, form-layout, modal, alert |
| **Cinque Terre Theme** | 15 | village-selector, places-to-stay, eat-drink, featured-carousel, highlights |
| **Editorial** | 5 | editorial-hero, editorial-intro, editorial-interlude, editor-note, closing-note |
| **Template** | 9 | itinerary-hero, itinerary-days, blog-article, weather-live, collection-with-interludes |

All blocks are validated with Zod schemas in `packages/shared/src/content/blocks.ts`.

### Component Configuration

For each component:
- **Order**: Drag to reorder (⋮⋮ handle)
- **Required**: Toggle if mandatory
- **Props**: Configure default values
- **Variant**: Choose visual style
- **Show If**: Conditional display rules

### Linking Rules

Set internal linking guidelines:
- Min/Max total links
- Required page types to link to
- Forbidden slugs
- Topical cluster requirements

### SEO Templates

Define patterns for:
- Title: `{title} | {siteName}`
- Meta Description: `{description} - {keyword}`

**Available Variables**:
- `{title}`, `{keyword}`, `{siteName}`, `{pageType}`, `{category}`, `{author}`, `{date}`, `{excerpt}`

---

## Agent Collaboration

AI agents provide suggestions and track activities in real-time.

### Suggestions Panel

**4 Suggestion Types**:

1. **New Page** 💡: Agent recommends creating a new page
2. **Improve Content** ✏️: Suggestions to enhance existing content
3. **Add Links** 🔗: Internal linking opportunities
4. **Update Blueprint** 📐: Template improvements

**Value Estimates**:
- 🔥 High: Significant impact
- ⚡ Medium: Moderate improvement
- 💡 Low: Minor enhancement

**Actions**:
- **Accept**: Mark as approved
- **Implemented**: Confirm completion
- **Dismiss**: Reject suggestion

### Activity Feed

See real-time agent activities:
- 👁️ **Viewing**: Agent analyzing a page
- ✏️ **Editing**: Making changes
- 💡 **Suggesting**: Generating recommendations
- 🔍 **Reviewing**: Evaluating content
- 📊 **Analyzing**: Running analytics

**Auto-refresh**: Updates every 10 seconds (toggle on/off)

### Active Indicators

When a page is selected:
- See which agents are currently working on it
- Countdown shows time remaining for activity
- Color-coded by activity type

---

## Analytics Dashboard

Comprehensive SEO and performance metrics.

### Overview Tab

**Key Metrics**:
- Total Pages
- Average Freshness Score (target: >80%)
- Status Distribution
- SEO Health (keywords, meta descriptions)
- Link Structure

**Status Breakdown**:
Visual progress bars showing:
- Published pages
- Drafts in progress
- Planned content
- Outdated content requiring updates

**SEO Health**:
- Pages with keywords
- Meta description coverage
- Average keywords per page
- Total search volume

**Link Structure**:
- Total internal links
- Average outgoing/incoming links
- Pages with no outgoing links
- Broken links count

### Filters Tab

**6 Interactive Filters**:

1. **⚠️ Orphan Pages** (Orange)
   - No parent page
   - No incoming links
   - Risk: Poor discoverability

2. **📅 Needs Update** (Yellow)
   - Freshness score < 70%
   - Days since last update shown
   - Action: Refresh content

3. **🔗 No Links Out** (Blue)
   - Pages with zero outgoing links
   - Dead-end pages
   - Action: Add internal links

4. **❌ Broken Links** (Red)
   - Links to missing pages
   - Links to deprecated pages
   - Action: Fix or remove

5. **⭐ Hub Pages** (Purple)
   - Most outgoing links
   - Content distributors
   - Opportunity: Leverage for SEO

6. **👑 Authority Pages** (Indigo)
   - Most incoming links
   - Popular content
   - Opportunity: Update frequently

**Usage**:
- Click filter to highlight pages on graph
- Click again to clear
- Use to identify optimization opportunities

### Issues Section

**Automatic Alerts**:
- Lists first 5 orphan pages
- Shows pages needing updates (freshness < 70)
- Displays days since update
- "+X more" for additional issues

### Refresh

- Cache: 15 minutes default
- Manual refresh available
- Last updated timestamp shown

---

## GitHub Integration

Sync your sitemap with GitHub for version control and collaboration.

### Setup

1. Navigate to GitHub tab in sitemap editor
2. Enter repository URL
3. Provide GitHub personal access token
4. Verify access (checks permissions)

**Required Permissions**:
- `repo` (full repository access)
- Read and write to repository

### Sync Operations

**1. Push to GitHub** (Direct Commit)
- Exports all pages as YAML files
- Creates `content/sitemap.yaml` index
- Commits directly to branch
- Use for: Quick updates

**2. Create Pull Request**
- Creates feature branch
- Exports content as YAML
- Opens PR for review
- Use for: Major changes requiring review

**3. Import from GitHub**
- Reads YAML files from repository
- Updates local database
- Preserves metadata
- Use for: Pulling external changes

### YAML Structure

**Page YAML** (`content/pages/{slug}.yaml`):
```yaml
id: uuid
slug: /about
title: About Us
page_type: landing
status: published
priority: high
seo:
  primary_keyword: "about company"
  secondary_keywords:
    - "company info"
    - "our story"
  freshness_score: 95
internal_links:
  outgoing:
    - to: /contact
      anchor: "Get in touch"
  incoming:
    - from: /
      anchor: "Learn more"
```

**Sitemap Index** (`content/sitemap.yaml`):
```yaml
version: "1.0"
generated_at: 2025-11-23T08:00:00Z
total_pages: 42
pages:
  - id: abc-123
    slug: /about
    file: content/pages/about.yaml
```

### Sync Status

**Indicators**:
- ✓ **In Sync**: Local matches remote
- ⚠ **Out of Sync**: Differences detected
- **Conflicts**: Lists mismatched pages

**Conflict Resolution**:
1. Review conflicts list
2. Choose: Push (overwrite remote) or Import (accept remote)
3. Manual merge if needed

---

## Tips & Best Practices

### Sitemap Management

1. **Use Consistent Naming**
   - Lowercase slugs
   - Hyphens for spaces
   - Descriptive names

2. **Organize Hierarchically**
   - Set parent pages
   - Max 3 levels deep
   - Group related content

3. **Monitor Orphans**
   - Check analytics weekly
   - Every page should have incoming links
   - Or be in main navigation

### SEO Optimization

1. **Target 80%+ Freshness**
   - Update content quarterly
   - Review analytics monthly
   - Set `requires_update_after` on pages

2. **Internal Linking**
   - 3-5 outgoing links per page
   - Link to related content
   - Use descriptive anchors

3. **Keywords**
   - One primary keyword per page
   - 2-5 secondary keywords
   - Natural placement

### Agent Collaboration

1. **Review Suggestions Daily**
   - High-value suggestions first
   - Batch implement similar changes
   - Provide feedback via notes

2. **Monitor Activity**
   - Check for unusual patterns
   - Agents working on same page = potential conflict
   - Use activity feed for insights

3. **Accept/Reject Promptly**
   - Don't let suggestions accumulate
   - Implemented = helps agent learning
   - Dismiss with reason for better suggestions

### Blueprint Design

1. **Start Simple**
   - Few components initially
   - Add based on actual needs
   - Test before scaling

2. **Reuse Components**
   - Create variants instead of new components
   - Consistent UI patterns
   - Easier maintenance

3. **Set Linking Rules**
   - Enforce minimum links
   - Require topical connections
   - Avoid link spam

### GitHub Workflow

1. **Use Pull Requests for Major Changes**
   - Content rewrites
   - Structure changes
   - SEO updates

2. **Direct Commits for Minor Fixes**
   - Typos
   - Metadata updates
   - Small tweaks

3. **Sync Regularly**
   - Pull before editing
   - Push after changes
   - Resolve conflicts promptly

---

## Keyboard Shortcuts Reference

| Shortcut | Context | Action |
|----------|---------|--------|
| `Ctrl+Z` | Sitemap | Undo |
| `Ctrl+Y` | Sitemap | Redo |
| `Ctrl+F` | Sitemap | Search |
| `Delete` | Sitemap | Delete node |
| `Escape` | Any | Close modal/panel |
| `Tab` | Forms | Next field |
| `Shift+Tab` | Forms | Previous field |

---

## Troubleshooting

### "Orphan Pages" Warning

**Cause**: Pages with no parent and no incoming links

**Solution**:
1. Set a parent page, OR
2. Add incoming links from related content, OR
3. Add to navigation menu

### "Broken Links" Alert

**Cause**: Links pointing to deleted or deprecated pages

**Solution**:
1. Go to Analytics → Filters → Broken Links
2. Click to see affected pages
3. Update or remove broken links

### Low Freshness Score

**Cause**: Content hasn't been updated recently

**Solution**:
1. Review page content
2. Update with current information
3. Refresh publish date
4. Score recalculates automatically

### GitHub Sync Fails

**Cause**: Permissions or network issues

**Solution**:
1. Verify token has `repo` scope
2. Check repository exists and you have access
3. Ensure network connectivity
4. Try "Verify Access" button

---

## Support

For issues or questions:
- Check this guide first
- Review error messages
- Consult development team
- Report bugs via GitHub Issues

---

**Happy Publishing! 🚀**
