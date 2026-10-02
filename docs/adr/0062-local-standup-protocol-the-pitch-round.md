# ADR-0062 — Local standup protocol: the pitch round

**Status:** Accepted (amends ADR-0012)
**Date:** 2026-10-02

## Context

ADR-0012 describes meetings as streamed multi-agent conversations. The implemented standup runs
up to four rounds of a moderator call that picks the next speaker, a speaker turn, and a final
outcome call. Its only input is an agenda line. A speaker who reaches the token cap, or a
moderator who names an unknown speaker or assignee, fails the whole meeting, and the day
silently gets no briefs. Nothing limits how many articles are commissioned or stops a topic
being repeated.

On one slow resident model (ADR-0057) each call is expensive, and the per-round moderator call
is the main source of slips.

Detail: [`docs/design/mvp-pipeline.md`](../design/mvp-pipeline.md) section 2.

## Decision

1. **The standup is a pitch round:**
   - a deterministic cap on commissions; if it is zero, no model call is made and the meeting
     closes with a system line;
   - one opening by the moderator over a context pack;
   - one structured pitch per free writer, in staff order: what they say, a title, an angle and
     keywords;
   - one commissioning call that picks pitches and sets lengths.
2. **Briefs are built from the chosen pitches**, so the assignee is always the pitcher.
3. **The cap** is the smallest of: free writers, the work-in-progress limit less open items, the
   measured throughput of the model for a game day, and eight. The first two are also enforced
   in the sim (ADR-0059).
4. **The context pack** (about 1,200 tokens) holds recent published titles, items in flight,
   calendar topics for the season by wall-clock date, under-covered entities and the cap.
5. **Topics are de-duplicated** against existing page paths, briefs in flight and earlier
   pitches, by slug and by word overlap.
6. **Slips are repaired or skipped, never fatal.** A truncated turn is cut at the last sentence;
   a bad pitch gets one repair and is then skipped; a failed commissioning call commissions the
   first valid pitches at a default length.
7. **Total failure is visible.** No valid pitch, or an infrastructure failure, sends `JobFailed`
   and raises a `StandupFailed` ticket (ADR-0059, rule 11).
8. **Turns play as speech bubbles.** Each turn is written to the transcript and applied as an
   `Utterance` command at a step boundary while the meeting is open; the outcome is applied
   last. Text stays in the store (rule 2).

Nothing here is built. Increments P4 and U5 of `docs/mvp.md` implement it.

## Consequences

- A standup costs two calls plus one per free writer, and cannot name an unknown person.
- The company commissions only what it can finish, and does not repeat itself.
- Decisions and escalations from the meeting are kept as minutes.
- **Negative:**
  - Less of a conversation than ADR-0012 pictured: writers pitch once and do not answer each
    other. Free discussion can return when a faster model or a cloud tier allows it.
  - The throughput term of the cap is a host measurement, so two machines may commission
    different numbers of articles. The sim-enforced terms keep the result valid either way.
- **Alternatives rejected:**
  - *Keeping the round-robin moderator with repair turns.* Each repair is a slow call, and the
    assignee could still be wrong.
  - *A deterministic standup with no model.* The pitches are the creative input the game is
    about.
