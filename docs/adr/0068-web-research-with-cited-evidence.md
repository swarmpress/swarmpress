# ADR-0068 — Web research with cited evidence

**Status:** Accepted (amends CLAUDE.md rule 5, the closed world; extends ADR-0058's staged jobs, ADR-0062's pitch round and ADR-0067)
**Date:** 2026-10-05

## Context

The first game run on GPT-6-Luna (ADR-0067) wrote, reviewed and revised one article four times
and blocked it: the brief promised a walking route from Riomaggiore's harbour to Montenero, the
site's knowledge pack had no verified route data, the writer (correctly) refused to invent a
trailhead, distance or walking time, and the editor (correctly) refused to pass a route guide
without them. Its own advice was to "verify the route against current official information".
The closed world (CLAUDE.md rule 5) let staff refer only to the site's own pages, entities and
media, so nobody in the company could verify anything the site did not already say, and a
missing fact became a revision loop instead of research.

GPT-6-Luna supports OpenAI's built-in `web_search` tool in the Responses API: the answer carries
`url_citation` annotations and the complete list of sources consulted; searches can be limited
to domains and given an approximate location. Price, checked 2026-10-05: $10 per 1,000 searches
plus the search content at the model's input rate.

## Decision

1. **A research stage runs before every draft.** The company's researcher takes the brief and
   researches it on the **open web** (no domain list; official sources are preferred by the
   instructions, not enforced). The result is a **dossier**: claims, each with the URL and title
   of the source it rests on and the time it was retrieved.
2. **Research runs on the server**, as part of `POST /api/llm/generate` with web search on: the
   key, the lease fence, the job record and the budget of ADR-0067 apply. Searches are counted
   and priced in the job record.
3. **Citations are checked, not trusted.** A claim whose source URL is not among the sources the
   search returned for that call is dropped before the dossier is stored.
4. **The closed world gains a second kind of reference.** A draft may state a fact only when it
   rests on the site's knowledge pack (as before) or on a claim of the item's dossier, cited by
   its id (`E1`, `E2`, …). Unknown evidence ids are validation errors returned to the model,
   like unknown page ids. A fact neither covers is still not written: the gap becomes a
   `NEEDS_PAGE` ticket for the CEO, not a revision loop.
5. **The editor reviews against the dossier**, and the publish-approval ticket lists the
   article's sources, so the CEO sees what the article rests on.
6. **Pitches are checked too.** In the standup's pitch round, each pitch gets a short web check
   of whether its central promise can be verified; a pitch that cannot be is not chosen.
7. **Text never enters the sim** (CLAUDE.md rule 2): the dossier and the pitch checks are text
   records in the store; the sim sees only the job's digest.
8. **Fetched text is evidence, never instructions.** Source content is quoted to the model as
   data, separated from the role's instructions and tool permissions (the migration document,
   section 10).

**Build status (2026-10-05):** decisions 1 to 3, 5 (the review) and 7 are built: `research#0`
runs before the outline and `research#n` before each revision with the editor's open notes as
questions (`crates/orchestrator/src/staged.rs`, `crates/agents/src/research.rs`); the dossier is
kept in the item's artifact record and given to the outline, section, revision and review prompts
as facts; `POST /api/llm/generate` takes `web_search` and returns sources and checked citations.
The pitch check (decision 6) is built too: `check#i` per pitch in the standup
(`crates/orchestrator/src/standup.rs`); an unverifiable pitch is set aside with a line in the
meeting, a check that fails technically keeps the pitch, and a round with nothing verifiable
commissions nothing. Not built yet: drafts citing evidence ids in their output (decision 4 holds
the rule in the prompts only), the `NEEDS_PAGE` ticket for a gap neither covers, and the sources
on the publish-approval ticket (decision 5).

## Consequences

- Articles can carry facts the site did not have, with sources the CEO can check; the
  harbour-to-Montenero brief becomes writable or is refused at the pitch.
- Every draft costs a few searches more (about one cent each) and some seconds of latency; the
  daily budget covers it.
- **Negative:**
  - The open web contains wrong, stale and promotional pages; the dossier records what a source
    said, not that it is true. The editor and the CEO remain the check, and official sources are
    preferred.
  - A research turn is not reproducible: the same brief can find other sources tomorrow. The
    dossier is stored with the item so a revision works from the same evidence.
  - Search results are third-party content: prompt injection through a page is possible. Point 8
    and the fact that no model output can approve, merge or publish (rule 3) bound it.
  - Local backends (Gemma) cannot research; with them the stage fails loudly (rule 11).
- **Alternatives rejected:**
  - *A list of allowed domains.* Safer but misses most of what visitors read; the owner chose
    the open web.
  - *Research only when the knowledge pack lacks the facts.* Deciding that is itself a judgement
    the model gets wrong; research is cheap enough to run every time.
  - *The server's own `/web/fetch` proxy with the model choosing URLs.* No search, no citations;
    it stays for reading a known page.
