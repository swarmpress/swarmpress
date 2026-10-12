# ADR-0090 — Ceiling designs hang as lights

**Status:** Accepted (supersedes the ceiling sentence of ADR-0088 decision 3)
**Date:** 2026-10-12

## Context

ADR-0088 decision 3 put desk-top designs on desks and left ceiling designs (`mount: "ceiling"`,
like the kit's own `ceiling-light`) unplaceable. The sim's built-in ceiling lights are equipment
that takes no floor space and keeps 0.5 m from other ceiling lights. The owner decided on
2026-10-12: **ceiling designs are placeable, as lights**.

## Decision

1. **Placed like floor designs.** A ceiling design is placed, moved and removed with `PlaceObject`,
   `MoveObject` and `RemoveObject` at a footprint centre and a quarter turn, on the same grid as the
   floor; it hangs over that footprint with its top at the ceiling.
2. **Collisions on the ceiling only.** It takes no floor: floor equipment, floor objects, desks'
   chairs, workstation seats and door clearances ignore it, and it ignores them. On the ceiling its
   footprint keeps clear of the built-in ceiling lights (each the square of half the light spacing,
   ±25 cm, around its centre, so two lights' squares touch at the sim's spacing) and of other
   ceiling designs; a new ceiling light keeps the same distance from it. Its footprint stays inside
   the room (the walls' half thickness clear) and it counts towards the room's item limit.
3. **Lights.** Its `lights` count towards the room's (the room's totals, the office designer's light
   check, where it lights desks within reach from where it hangs). It is lit like the room's
   ceiling lights, by the room's light level; the sim's light rules do not change.
4. **Bounds.** A ceiling design hangs at most 32 plates (80 cm), so under the 2.9 m ceiling its
   lowest part stays above 2.1 m, and it seats nobody. It is never a workstation and never goes on a
   desk.

## Consequences

- Players can light rooms with lamps of their own, and the office designer counts them.
- The goldens move once (world format 14, shared with ADR-0089).
- Negative: a ceiling design's light is counted, not simulated: rooms are still lit by occupancy
  and daylight, so a dark room with ten lamps of one's own looks no different in the sim's numbers.
- Negative: a deep pendant may hang into a tall floor design (a 2.4 m shelf) since floor and
  ceiling are not checked against each other; the 80 cm bound keeps it above head height only.

### Alternatives considered

- **A light slot on the ceiling grid** (designs replace built-in lights one for one): simpler
  collisions, but no free placement and no designs bigger than a light.
- **Full 3D collision** (heights of floor designs against hanging ones): exact, but the sim knows
  floor items by footprint only; it would need every item's height first.
- **Keep them unplaceable**: no change, but the kit ships a ceiling design players cannot use.
