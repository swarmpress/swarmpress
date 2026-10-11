---
id: FEAT-113
title: "The LEGO app shell (sections, sidebar, status strip, inspector) and the generic town of sections"
status: in-progress
importance: high
paths:
  - apps/game/src/ui/components/Shell.tsx
  - apps/game/src/ui/sections.ts
  - apps/game/src/ui/shell.css
  - apps/game/src/ui/shell.test.tsx
  - apps/game/src/ui/overlay.css
  - apps/game/src/ui/mount.tsx
  - apps/game/src/render/bricks/town.ts
  - apps/game/src/render/bricks/town.test.ts
  - apps/game/src/render/camera.ts
  - apps/game/src/render/tiltshift.ts
  - apps/game/src/render/postfx.ts
  - kit/designs/town-house.json
  - kit/designs/town-tree.json
  - kit/designs/street-lamp.json
  - kit/designs/town-bench.json
adrs:
  - ADR-0086
  - ADR-0018
  - ADR-0085
  - ADR-0072
---

# The LEGO app shell

The frame of the owner's mockups (`ui/`, ADR-0086) around the game: the sections along the top, the
company and its tools on the left, the HUD as a status strip, the 3D town in the middle, the panels
as the inspector on the right, in warm cream and brick yellow.

## Built (2026-10-11)

- **Top bar** (`Shell.tsx` `TopBar`): the logo, the sections Town · Building · Plan · Factory ·
  Staff · Projects (`sections.ts`), each with its icon and subtitle; the lit section follows what is
  open; Building and Factory appear only with the Studio and open it on their workbench (the
  workbench is in the store, `studioTab`).
- **Sidebar** (`Sidebar`): the company's site (the repository's name, connected or not), every CEO
  tool with its count (*CEO tools*: the Plan's open items, the inbox's open tickets, the staff, the
  projects) and quick actions that do something (the Studio, the repository, back to the town).
- **Status strip**: the HUD under the top bar: the clock, its status and controls, what runs now,
  the company's numbers, the site binding, the renderer.
- **Light theme**: the overlay's tokens and every hard-coded dark colour; axe clean in jsdom.
- **The stage** sits between the bars once the overlay mounts (`body.has-shell`) and follows its box.
- **The generic town** (`render/bricks/town.ts`): the office is the Staff building; Plan, Building,
  Factory and Projects are houses of the kit's new `town-house` design (two storeys, windows, a
  door, a stepped tile roof, a dark plaque) in a row opposite the entrance, fronts to the office,
  a tiled path between, each with its section's name on the plaque. The same for every company:
  placed from the layout's bounds and entrance only, in fixed colours.
- **The camera follows the sections**: choosing one glides to its building (`IsoCamera.frame`), framed
  in the part of the stage the inspector leaves visible; Town frames the whole town; the boot view
  still frames the office.
- **The low tier** draws the plastic without clear coat and reflections (software WebGPU in CI).
- **The town's furniture** (`townScenery`): a street lamp between every two houses and at the row's
  ends, a bench in front of each house looking at the office, trees past the row's ends and along
  the lot's sides; the kit's new `town-tree`, `street-lamp` and `town-bench` designs. Generic too.
- **The miniature look** (`tiltshift.ts`): the view's middle band sharp, the top and bottom blurred,
  on the medium and high tiers; golden hour as a warm colour grade and a soft warm vignette.
- **The block dock**: the Studio's parts trays (Building and Factory) show each part as a 2 × 2 brick
  in its colour with its name under it (`BrickIcon`), as in the mockups' bottom palette.

## Not built yet

- The mockups' section views in their new form: the Plan's timeline, calendar,
  workload and goals restyled, the Data Studio, the inspector's breadcrumb and status pill.

## Evidence

- `game/vitest`
- `game/playwright-e2e`
