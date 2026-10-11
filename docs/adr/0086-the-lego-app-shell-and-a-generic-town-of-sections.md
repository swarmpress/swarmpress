# ADR-0086 — The LEGO app shell and a generic town of sections

**Status:** Accepted (amends ADR-0018, the overlay; builds on ADR-0063, ADR-0072, ADR-0077, ADR-0085)
**Date:** 2026-10-11

## Context

The owner supplied fifteen UI mockups (`ui/`, not committed: large images) of swarm.press as a LEGO
product. Every one shares a frame:

- a **top bar** of sections, each a large tab with an icon and a subtitle: Town (Your studio),
  Building (Pages & design), Plan (Editorial board), Factory (Tools & automation), Staff (People &
  teams), Projects (All sites); Paint Shop and Data Studio appear as further tabs. The clock, play and
  fast-forward sit on the right;
- a **sidebar**: the site switcher, the tools with their counts, section-specific entries, quick
  actions;
- an **inspector** on the right: breadcrumb, thumbnail, serif title, status pill, tabs, forms;
- in the middle a **3D LEGO diorama** (tilt-shift, warm light): the sections are buildings of one town
  with sign plaques, a page is a baseplate, a workflow is machines on a belt, data models are islands;
- a **block dock** of coloured 2 × 2 bricks along the bottom of the builders;
- a warm cream look: white cards, brick yellow, charcoal for the active state, a serif for titles.

Today's overlay (ADR-0018) is a dark mini-HUD and a bottom tab bar over a full-screen office. The
mockups draw the owner's own site (Cinque Terre) into the town and show minifigure-like people.

The owner decided on 2026-10-11: start with the **app shell**; the people stay **our own brick
figure**; the 3D world becomes a **town of section buildings**; and **the town is always generic**:
the same for every company, never themed after a company's site.

## Decision

1. **The app shell frames the game.** A top bar with the logo and the sections; the HUD as a status
   strip under it (the clock, its status and controls, the company's numbers); a sidebar with the
   company's site, every CEO tool with its count (it keeps the name *CEO tools*) and quick actions;
   the 3D scene between them; the panels open as the inspector on the right. The shell applies once
   the overlay mounts (`body.has-shell`); frozen screenshot pages without the overlay keep the
   full-screen scene. Every control does something real (rule 11): a section the source cannot offer
   (the Studio without the site's models) is not shown, and no search box, notification bell or
   switcher without a function is drawn.
2. **Sections map onto the tools.** Town shows the world (no panel); Building and Factory open the
   Studio on their workbench (the workbench moves into the store); Plan opens the Plan (with the
   Inbox); Staff the org chart (with Hiring and Performance); Projects the projects. A section is lit
   while one of its tools is open (`sections.ts`).
3. **One look: warm cream and bricks.** The overlay's tokens become light (cream paper, white cards,
   charcoal ink, brick yellow), with contrast checked by axe in jsdom and in the browser.
4. **The town of sections, generic.** The 3D world becomes one town whose buildings are the sections
   (Staff is today's office), each with a sign; choosing a section moves the camera there. The town is
   the same for every company: its buildings, ground, water and greenery come from the kit, never
   from the company's content. A company's site appears in it only as data: the page types and tools
   on the Building's and the Factory's model tables (ADR-0072), names on signs. *Not built by this
   ADR's first step.*
5. **People stay our own brick figure** (ADR-0063 decision 8, ADR-0085): friendlier faces, hair and
   accessories may come; the minifigure's shape does not.

## Consequences

- The game reads as one product across the office, the Studio and the panels; the scene gets less
  space (the bars take 72 + 46 px on top and 236 px on the left), and the canvas now follows its own
  box (a `ResizeObserver`), not the window.
- The overlay's dark styles are gone; components that hard-coded dark colours were changed with it.
- Visual baselines change once the overlay is part of them; today's visual tests run without the
  overlay and keep the full-screen scene.
- **Negative:**
  - The mockups show far more than this step builds: the tilt-shift town, the block dock, the
    timeline, calendar, workload and goals views in their new form, the Data Studio. Until they come,
    the shell frames today's panels.
  - The status strip carries everything the HUD had; at narrow widths it hides the "Now" strip and
    the site binding rather than wrapping.
  - A generic town gives up the mockups' strongest image (the company's own coast); the site shows
    up only on model tables and signs.
- **Alternatives rejected:**
  - *The clock and controls in the top bar, as mocked.* The HUD carries more (the company's numbers,
    the job in flight, the site binding); a strip under the bar keeps all of it without crowding the
    sections.
  - *A town themed after each company's site.* Generated scenery per company costs build time and
    determinism, and a town that changes with the content stops being a place the player knows.
  - *Minifigure-like people, as mocked.* A registered three-dimensional trade mark (ADR-0085).
