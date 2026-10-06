# ADR-0074 — The story director

**Status:** Accepted (implements §9 of `docs/reference/gpt-6-luna-simulation-migration.md` in part; extends the render-state contract of ADR-0062's speech bubbles)
**Date:** 2026-10-06

## Context

Outside meetings, the office is silent. People walk, sit, type and eat, but nobody says anything
unless a standup or board is running. The owner's GPT-6-Luna migration document (ADR-0067) asks
for a **story director**: a rolling ten-minute chapter of studio life written by the hosted model
from the studio's state and recent events, played as conversations, with no authority over
production. Rule 2 (text never enters the sim) and rule 8 (the renderer draws only
`render_state()`) mean a line can't just be drawn by the host. The sim has to know that a person
is talking, to whom, and for how long. The words still stay outside the sim.

## Decision

1. **A remark is a logged command.** `ServerCommand::Remark{speaker, listener: Option<StaffId>,
   seq, chars}`, like `Utterance` but outside meetings.
   - The sim refuses a remark when:
     - `seq` is not the next one;
     - `chars` is outside 1..=600;
     - the speaker or listener isn't on site, or is in an active meeting;
     - the listener is the speaker.
   - A remark lasts as long as an utterance of its length. It changes nothing but the
     render state: the speaker's pose becomes `talk`, the listener's `listen`. Walking and
     meetings win.
   - `World.remarks` (each person's latest) and `next_remark` are state: world format 6.
2. **The render-state contract gains `remarks[]`** (`seq`, `speaker`, `listener`, `startedStep`,
   `untilStep`, `chars`) and `nextRemark`. The bubble layer shows a remark as a bubble with the
   meeting name `remark`. The host fetches its words from the company store's kv
   (`story.line.<seq>`) and keeps the last 200.
3. **The director lives in the host** (`apps/game/src/story/`).
   - **Request:** every 600 seconds of *running* clock (not paused, not holding, not night, model
     ready), it asks for one structured chapter. The rules come first; the changing state comes
     last, for the prompt cache.
   - **Context:**
     - the people on site with role, activity, work in hand and morale;
     - the newest eight plan items as events ("«X» was published");
     - the previous chapter's continuity notes.
   - **Answer:** up to five scenes of up to six lines, each with a speaker, a listener or null,
     and a time offset.
   - **Validation:** a scene is dropped when it has:
     - an unknown person, or talk to oneself;
     - markup, or an over-long line;
     - a production claim (published, approved, merged, rejected, live) when no event shows one.
   - **Prefetch:** the next chapter is requested at 420 seconds. A late chapter leaves the
     office quiet; it never invents news.
   - **Playback:** scene by scene, line by line, each line paced by its reading time. When the
     sim refuses a line (someone left, a meeting began), the scene ends.
   - **Persistence:** the chapter, elapsed time and played scene ids live in the kv, so a reload
     doesn't repeat a conversation.
4. **On for the hosted model by default.** `?story=on` turns it on with any backend (the fake
   model answers with a fixed two-scene chapter); `?story=off` turns it off. A read-only session
   never directs.

## Consequences

- The office talks between meetings, about what is really happening in the plan, and a reload
  doesn't repeat conversations.
- Every line is a logged command, so replay is exact. Remarks add commands to the log: about 15
  to 30 per ten minutes of play.
- **Negatives and not built yet** (from the migration document's chapter fields):
  - per-scene conditions, references and fallbacks;
  - player interactions with a scene;
  - real-world events;
  - relationships beyond what the lines imply;
  - a lead time measured from latency (it is fixed);
  - the Flex service tier;
  - a dedicated event stream: events are derived from the plan view, so "«X» was published" may
    repeat across chapters.
- The claim filter is lexical and coarse. One backed event allows production words in every line
  of the chapter.
- **Alternatives:**
  - The host draws bubbles without the sim. Rejected: it breaks rule 8, and replays and other
    devices would disagree on poses.
  - The words in the sim. Rejected: rule 2.
  - Per-agent idle chatter, one call per person. Rejected: the document asks for one shared
    director, so lines respond to each other, and it costs fewer calls.
