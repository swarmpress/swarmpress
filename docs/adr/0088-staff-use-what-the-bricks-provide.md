# ADR-0088 — Staff use what the bricks provide

**Status:** Accepted (implements ADR-0065 §4's second half, increment K-4; amends ADR-0087 decision 7)
**Date:** 2026-10-12

## Context

Since ADR-0087 decision 7 (built 2026-10-12) players place their own kit designs in the office
(`PlaceObject`, `MoveObject`, `RemoveObject`), carrying the design's hash and its compiled summary.
Staff ignore them: they work only at the built-in `Desk`, and an object's seats, workstation,
lights, storage and screens are only totalled per room for the UI. Only floor designs can be
placed. ADR-0065 §4 decided that staff should look for "a free workstation", not "a Desk", once the
summary rules (construction-kit.md §12.4) had the owner's review.

The owner decided on 2026-10-12:

- what a design provides is decided by its **geometry**, through the kit's summary rules as drafted
  in §12.4, not by tags a player sets;
- a player's small designs go onto desks through the **desk's existing slots** (screen, lamp), the
  way monitors and lamps do.

## Decision

1. **The summary rules of construction-kit.md §12.4 are accepted** as game design: a seat is a
   `seat` part whose top is 40–70 cm high; a workstation is a design with a work surface of at
   least 0.25 m² at desk height (70–80 cm), a `screen` or `paper` part, and a port accepting a seat;
   lights, storage and screens are counted from part tags. The kit's compiler applies them; the sim
   takes their result from the summary and never re-runs them (replay stays fast and
   deterministic).
2. **A workstation object is a home for staff.** Staff are assigned to, and sit at, a free
   workstation: a built-in `Desk` or a placed object whose summary says `workstation`. The summary
   carries where its seat is (the seat port's position relative to the design's centre, in
   millimetres, before the object's turn), so the sim knows where the person sits and the renderer
   draws them there. A workstation object in use cannot be moved or removed, like a desk.
3. **Desk-top designs take a desk slot.** A design mounted on a surface is placed on a built-in
   desk: one with a screen takes the desk's screen slot, any other takes its lamp slot. It is
   refused when the slot is taken. It moves with its desk and is removed with it. Ceiling designs
   stay unplaceable for now.
4. **What does not change yet:** meeting and kitchen seats still come from the room's table
   (seat objects add to the room's totals, but nobody sits on them yet); a workstation object's
   productivity is that of a desk with a monitor; storage and lights from objects only count
   towards the room's totals. Each is a later decision.
5. **The summary is still the client's word** until the central audit recomputes it from the
   design (ADR-0065 §4, leagues ADR-0055). The sim bounds what it accepts (one seat per
   workstation, a seat within the object's reach).

## Consequences

- A player can build a desk of their own and staff will work at it; the office designer and the
  hiring flow count it as a free workstation.
- The goldens move once (a new world format): the summary gains the seat position, staff homes
  can be objects, objects can sit on desks.
- The rules of §12.4 now bind every shipped and player design; changing them is a new ADR, and old
  summaries in the log keep the meaning they were placed with.
- Negative: a forged summary can claim a workstation until the audit exists; the bounds in
  decision 5 limit the damage to one seat per object.
- Negative: the slot rule is coarse (a mug takes the lamp slot); free placement on the desk top
  needs the sim's desk (1.2 × 1.2 m) to match the brick desk (1.5 × 0.75 m) first.

### Alternatives considered

- **Player tags backed by geometry** (the player marks "desk", the kit refuses unsupported tags):
  more control, but one more step per design and two sources of truth for the same fact.
- **Objects stay decorative:** no sim change, but players' furniture would be scenery only.
- **Free placement on the desk top:** richer, but needs the desk sizes reconciled first and moves
  every layout.
