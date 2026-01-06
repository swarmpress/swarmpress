# Visual & Technological Concept  
## Cinque Terre Website – Navigation & Language System  
*(Detailed briefing for web designers & frontend developers)*

---

## 1. Purpose of This Document

This document describes the **visual**, **interaction**, and **technical** concept for redesigning the main navigation and language system of the Cinque Terre website.

The goal is to create a navigation system that:
- Feels fully integrated with the existing UX/UI quality
- Reflects the geography and experience of the Cinque Terre
- Works seamlessly across villages, content depths, and languages
- Scales for future features and content types

This is not a classic “menu redesign”.  
It is a **spatial orientation system**.

---

## 2. Core Design Principle

The Cinque Terre is:
- Linear, not hierarchical
- Experiential, not categorical
- A journey, not a sitemap

The navigation must therefore:
- Represent **movement along the coast**
- Allow **zooming into villages**
- Allow **drilling down into content**
- Preserve context at all times

There must be **one navigation system**, not separate global and local menus.

---

## 3. Navigation Model: The Coastal Journey

### 3.1 The Coastal Spine

The main navigation is built around a persistent element called the **Coastal Spine**.

Characteristics:
- Represents the coastline visually
- Displays all five villages in geographic order:
  1. Riomaggiore
  2. Manarola
  3. Corniglia
  4. Vernazza
  5. Monterosso al Mare
- Always visible on all pages
- Does not change structure when navigating

The spine is:
- Horizontal on desktop
- Vertical or bottom-aligned on mobile

It replaces:
- Traditional top navigation bars
- “Villages” dropdowns
- Breadcrumb-heavy systems

---

### 3.2 Village Nodes

Each village is represented by a **node** on the spine.

Each node contains:
- Village name (always visible)
- Interactive states:
  - Default
  - Hover / Focus
  - Active (current village)

The active village:
- Is visually emphasized
- Acts as the anchor for deeper navigation

---

## 4. Navigation Depth Model

Navigation depth is handled via **expansion**, not mode switching.

### 4.1 Level 1 – Overview (Homepage)

- All villages visible
- No village expanded
- Content aggregated across villages
- Homepage represents the “zoomed-out” view

The navigation shows:
- Orientation only
- No secondary navigation

---

### 4.2 Level 2 – Village Focus

When a user enters a village page:
- That village node expands
- Secondary navigation becomes visible

Secondary navigation items:

- Village Overview (Village Name)
- Things to do
- Accommodations
- Events
- Weather
- Transportation
- Sights
- Restaurants
- Itinerary
- Culinary
- Blog

Important:
- These items only appear for the active village
- Other villages remain visible but minimized

---

### 4.3 Level 3 – Content Depth

When navigating within village sections:
- The village remains expanded
- The current section is highlighted
- No navigation structure changes

This ensures:
- No disorientation
- Clear mental mapping
- No “submenu jumping”

---

## 5. Homepage Behavior

The homepage is:
- The Cinque Terre hub
- A fully zoomed-out state

Requirements:
- Coastal spine visible
- No village expanded
- Existing village selector remains conceptually valid
- Aggregated content aligned visually with the coast

No village-specific navigation should appear on the homepage.

---

## 6. Language System Concept

### 6.1 Language as a Lens

Language is treated as:
- A global content lens
- Not a navigation level
- Not a site version

Switching language must:
- Never reset navigation
- Never redirect to homepage
- Never remove spatial context

---

### 6.2 Language Switcher Placement

Desktop:
- Top-right utility area
- Outside the coastal spine
- Always visible

Mobile:
- Utility area or bottom sheet
- Accessible from all pages

Language selector must not:
- Interrupt navigation flow
- Compete visually with villages

---

### 6.3 Language Switcher UI

Representation:
- Text-based language codes (EN, IT, DE, FR)
- Or full language names in the active language
- No flags as primary indicator

Behavior:
- Current language highlighted
- Subtle transition on change
- No page reload where possible

---

### 6.4 Language Switching Logic

When switching language:
- Stay on the same village
- Stay on the same section
- Reload only content, not navigation

Example:
- `/en/riomaggiore/restaurants/`
- Switch to German
- → `/de/riomaggiore/restaurants/`

---

### 6.5 Translation Fallbacks

If a page is not translated:
- Show fallback language content
- Display editorial notice:
  “This section is not yet available in German.”

This is preferred over forced redirects.

---

## 7. Visual Design Guidelines

### 7.1 Visual Tone

The navigation must feel:
- Calm
- Editorial
- Mediterranean
- Tactile
- Lightweight

Avoid:
- Corporate UI patterns
- Heavy borders
- Sharp dropdowns

---

### 7.2 Typography

- Village names: editorial serif or humanist sans-serif
- Secondary navigation: clean, readable sans-serif
- Clear typographic hierarchy
- Generous spacing

---

### 7.3 Color System

- Neutral base tones (stone, sand, paper)
- Accents inspired by:
  - Sea
  - Vineyards
  - Sunlight
- Active village slightly warmer or more saturated
- Never use color alone to indicate state

---

## 8. Motion & Interaction Rules

- Use micro-interactions only
- Prefer scale, opacity, and position shifts
- No dropdown animations
- No hard transitions

Rule of thumb:
If it feels like a menu, it’s wrong.  
If it feels like a map, it’s right.

---

## 9. Technical Architecture

### 9.1 Single Navigation Component

- One persistent navigation component
- State derived from:
  - URL
  - Village context
  - Language context
- No duplicated navigation logic

---

### 9.2 URL Structure

Recommended pattern:

- `/{language}/`
- `/{language}/{village}/`
- `/{language}/{village}/{section}/`

Examples:
- `/en/`
- `/en/vernazza/`
- `/en/vernazza/events/`
- `/de/manarola/restaurants/`

---

### 9.3 Data-Driven Navigation

Navigation is generated from data, not hard-coded.

Village data includes:
- Name
- Order
- Slug
- Available sections
- Translation coverage per section

Navigation renders dynamically based on:
- Current village
- Current language
- Content availability

---

### 9.4 Performance Considerations

- Navigation loads once
- Content loads per route
- Avoid layout shifts during expansion
- Prefer static generation + hydration

---

## 10. Mobile-Specific Considerations

- Coastal spine adapted to vertical or bottom layout
- Villages swipeable
- Village expansion via tap
- Language switcher in utility layer

Navigation must remain:
- One-handed usable
- Visually lightweight
- Fully accessible

---

## 11. Accessibility Requirements

- Keyboard navigation support
- Clear focus states
- Screen reader labels for:
  - Village navigation
  - Language switcher
- Reduced motion support

---

## 12. Deliverables Expected from Design

- Desktop navigation states:
  - Homepage
  - Village expanded
  - Section active
- Mobile navigation states
- Language switcher states
- Motion guidelines
- Component anatomy diagrams

---

## 13. Final Design Principles

1. One navigation system
2. Place-based orientation
3. Language never breaks context
4. Expansion over switching
5. Calm over clever

---

## 14. Final Note

The navigation should never feel like “using a website”.

It should feel like:
- Being guided
- Exploring naturally
- Understanding where you are at all times

If implemented correctly, users will not notice the navigation —  
they will simply trust it.
