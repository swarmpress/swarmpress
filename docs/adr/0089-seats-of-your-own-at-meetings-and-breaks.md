# ADR-0089 — Seats of your own at meetings and breaks

**Status:** Accepted (supersedes the seat sentence of ADR-0088 decision 4; the rest of decision 4 stands)
**Date:** 2026-10-12

## Context

ADR-0088 decision 4 kept meeting and kitchen seats at the room's table: a player's seat designs
(a chair, a bench, a sofa) added to the room's totals, but nobody sat on them. A meeting room
seats at most as many as its table (`min(capacity, 12)`), the kitchen likewise, and everyone past
that goes back to their desk. The owner asked on 2026-10-12 whether seats of the player's own
should take part, and decided: **yes, at meetings and in the kitchen**.

The kit's summary counts seats (`seats`, construction-kit.md §12.4) but says nothing about where
each one is: only a workstation carries a seat position (`seat_at`, ADR-0088).

## Decision

1. **A seat object** is a floor design whose summary seats people (`seats > 0`) and that is no
   workstation. Placed in a room, it offers **places** at the meetings held there and, in the
   kitchen, at lunch.
2. **Order.** The seats of a room are handed out in a fixed order: the table's seats first, then
   each seat object's places, objects by id and places in order (`World::room_seats`), the way free
   workstations are handed out (desks first, then objects by id; ADR-0088). A person keeps the seat
   they have. Spots name their seat: `Seat::Table(n)` or `Seat::Object(object, n)`.
3. **Where the places are.** The sim derives them from the summary, not from the design: one place
   per seat, in a row along the object's longer side (x when the sides are equal) on its middle
   line, each the middle of an equal stretch, turned with the object (`objects::place_offset`,
   integer millimetres truncated towards zero). People walk there and sit, facing the room's
   table as at the table's seats.
4. **Bounds** (as ADR-0088 decision 5, the summary is still the client's word): at most one place
   per 8 studs (50 cm) of the longer side, at least one, and at most 8 per object; every place lies
   on the object's footprint and at least 20 cm (`SEAT_CLEARANCE_MM`) inside the room, so it is on
   walkable floor of the room the object stands in. A desk-top or ceiling design offers no places.
5. **In use.** A seat object someone sits on or walks to is neither moved nor removed.
6. **What the renderer is told.** A person on a seat object carries `seated_on` (the object) in
   the render state; the layout lists each seat object's `places`; the room's totals gain
   `places`. The office designer counts a room's places among its meeting seats.

## Consequences

- A player can grow a meeting past its table with a bench of their own, and lunch overflow sits on
  the kitchen's sofa instead of going back to the desk.
- The goldens move once (world format 14, shared with ADR-0090): meeting and kitchen spots carry a
  `Seat` instead of a table index.
- Negative: the row rule is coarse. An L-shaped sofa or a ring of stools seats people on its
  middle line, not on its seat parts; exact places need the kit to report seat positions (a change
  of the summary contract and its golden), a later decision.
- Negative: a forged summary can claim places it does not have, bounded by decision 4 until the
  central audit recomputes summaries (ADR-0065 §4).
- Negative: people sit at the rig's seat height (45 cm) whatever the seat's own height (40–70 cm).

### Alternatives considered

- **Seat positions from the kit** (each `seat` part's centre in the summary): exact, but changes
  the summary contract, the kit's golden digest and every logged summary's meaning; deferred.
- **Seats everywhere** (any room's seat objects as extra desks or lounge places): no game rule
  needs them yet, and staff would sit around with nothing to do.
- **Keep seats decorative** (ADR-0088 decision 4): no sim change, but the owner wants seats of
  one's own to be used.
