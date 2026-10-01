# Living people and the real world outside the office

> Status: design contract (2026-10-01). Decisions:
> [ADR-0034](../adr/0034-living-personas-memories-relationships-and-recorded-conversations.md),
> [ADR-0035](../adr/0035-the-real-world-enters-through-a-world-context-service.md).
> Builds on [organization.md](organization.md) §3 (persona catalog) and
> [publishing-plan.md](publishing-plan.md) (threads).

Every person in the house has a vita: a CV, history and personality. That's
the **static** part (the persona catalog, ADR-0030). Real colleagues also
*change*. They remember the review that stung, they become friends over
lunch, they react to the storm outside or today's news, and they grow.
SimPress records all of that.

## 1. A person = profile + life record

| Layer | What | Where | Changes |
|---|---|---|---|
| **Profile** (vita) | Identity, CV, bio, hobbies, interests, quirks, values, writing style, baseline traits | Persona catalog TOML (versioned) | Only through a new persona version (rare, for example after a promotion the title changes) |
| **State** (numbers) | Morale, fatigue, skill per discipline, trait drift (±10 around baseline), **relationship affinity** to every colleague (−100…100), stress, tenure | **sim-core** (deterministic) | Every step and event, the same in every replica |
| **Life record** (text) | **Memories** (episodic), **opinions** (stances on topics), **life events**, career log | Server Postgres, keyed by person | Appended after conversations, reviews, events |

### Memories

A memory is a short first-person note with metadata:

```jsonc
{ "id": "mem-812", "person": "staff-1", "day": 14, "minute": 545,
  "kind": "conversation" | "review" | "praise" | "conflict" | "achievement" | "life-event" | "world",
  "text": "Marco gave my harvest piece a 6. Fair on the structure, harsh on the intro. I rewrote it the same evening.",
  "about": ["staff-5", "work-item-4"],          // people, items
  "valence": -0.3, "salience": 0.7,             // how it felt, how memorable (0..1)
  "source": { "type": "meeting", "id": "meeting-77", "utterances": [3, 5] } }
```

- **Formation.** After each conversation, review or notable event, a cheap
  browser-LLM job (`MemoryFormation`) writes 0–2 memories per participant
  from *that participant's* perspective. Memories are validated: they can
  only refer to things in the source transcript or event.
- **Recall.** A person's prompt context includes the top-k memories by
  salience × recency × relevance to the current item and participants. They
  remember what matters, so the context stays bounded.
- **Forgetting.** Salience decays over game time. Low-salience memories are
  compacted into periodic **self-summaries** ("my first month at the
  Dispatch") by `ReflectionJob`, which also updates opinions.

### Opinions and values

- Each persona has explicit **values** in its profile, for example "craft
  over speed", "local first" or "data before gut". The profile also says how
  they relate to news and politics: an interest level, and a tone that's
  always civil.
- Opinions are stances that evolve on topics: work topics ("short listicles
  hurt the brand"), office life ("Friday finance review is pointless") and
  the world ("the new rail timetable is a mess"). `ReflectionJob` updates
  them; each opinion keeps its origin memories.

### Relationships

- The sim holds a deterministic **affinity matrix** (per pair, −100…100),
  seeded from the catalog's `relationships` (friends +40, friction −30).
- It moves on deterministic signals:
  - working together on an item: small plus;
  - reviews: approve +2, changes −1, reject −4 for the reviewee towards the
    reviewer, softened by resilience;
  - praise in front of the team;
  - conflicts in meetings, detected by the moderator's structured outcome as
    a `friction` delta between named participants;
  - lunch and coffee together.
- Affinity affects:
  - morale (working with friends);
  - meeting dynamics: who backs whom, through the moderator prompt;
  - review harshness, nudged through the reviewer prompt;
  - a resignation risk if friction with your lead is high.
- The UI shows a **relationship graph** and each profile's "close to /
  clashes with".

### Life events (deterministic, seeded)

- Birthdays (from age plus a seeded day), with cake in the kitchen and a
  morale bump for the team.
- Holidays and leave, absent from the office, as a planned capacity
  reduction.
- Sick days (seeded, influenced by fatigue).
- Work anniversaries.
- Personal milestones from interests: Isabella runs a trail race, Francesca
  has a photo exhibition.

These create memories, show up in small talk, and occasionally create Inbox
tickets ("Giulia asks for 3 days off for her sister's wedding").

## 2. Conversations are recorded with their parameters

Every utterance of every conversation is stored with the full set of
parameters that produced it. This includes standups, the editorial board,
reviews, design crits, 1:1s with the CEO, and also **informal talk**
(coffee machine, kitchen, lunch, someone walking to a colleague's desk):

```jsonc
{ "conversation": "conv-77", "seq": 5, "speaker": "staff-1", "day": 14, "minute": 545,
  "text": "Honestly? With this sirocco nobody's hiking to Volastra this week — let's lead with the harvest.",
  "setting": { "kind": "standup" | "board" | "review" | "crit" | "one-on-one" | "small-talk",
               "room": "room-3", "project": "project-1", "items": ["work-item-4"] },
  "persona": { "slug": "giulia", "version": "giulia@3" },
  "state":   { "morale": 0.71, "fatigue": 0.42, "traits": { "sociability": 86, "…": 0 },
               "affinity": { "staff-5": 12, "staff-6": 45 } },
  "memories_used": ["mem-801", "mem-812"],
  "world": { "snapshot": "world-2026-10-01T09", "used": ["weather", "news:ansa-3"] },
  "model": { "executor": "browser", "id": "qwen3-4b-q4f16", "effort": null },
  "tags": ["harvest", "weather"], "sentiment": 0.2 }
```

- **Why record parameters?** Because a conversation can then be
  **explained** (why was Giulia short with Marco? Her fatigue was 0.8 and
  her affinity −20), **reproduced** for debugging and evals with the same
  inputs, and **analysed** by the Data Scientist ("morale dips on review
  days").
- **Small talk** (`SmallTalk` job, browser LLM, cheap) is triggered by the sim
  when two or more people share the kitchen, coffee machine or lunch, with a
  probability that rises with sociability and affinity. It lasts 2–6
  utterances, draws on memories, hobbies and the **world context** (§3), and
  feeds affinity and memories back. In the 3D office you see the speech
  bubbles at the coffee machine.
- Transcripts belong to the company (server). The CEO can read everything;
  this is a sim, there is no private channel (ADR-0031).

## 3. The real world outside the office

The office is connected to the live internet through the server's **World
Context Service**. Personas know:

| Signal | Source (production) | Use |
|---|---|---|
| **Today's date**, weekday, public holidays | Server clock in the company HQ timezone, plus a holiday calendar (country and region) | "Happy Friday", "office closed on Ferragosto", content timing |
| **Real weather** at the HQ and at each project's location (Cinque Terre: Riomaggiore … Monterosso) | **Open-Meteo** (free, no key): current conditions, today's forecast, sea temperature, sunset | Small talk, writers' timely angles ("calm sea today, boat tours running"), the site's weather blocks, and **visual weather in the 3D office** (rain on the windows, overcast light) |
| **News and current events**, including politics | Curated **RSS/Atom feeds** per company locale (for example ANSA for Italy, plus international outlets), refreshed hourly. Optionally Agency `web_search` for deeper research (costs ◆) | Small talk, editorial board ("new Cinque Terre trail permit rules: do we update the hiking guide?"), Strategy pitches |
| **Local events** | Event collections, plus feeds/calendars per project region | Content calendar, pitches |

- **Into the sim (deterministic):** only compact, server-issued commands:
  - `WorldSignals { day, date_ymd, weekday, holiday, weather_code, temp_dc, wind_kmh, sunset_minute }`
    for the HQ;
  - `ProjectWeather { project, … }`.

  Text (headlines) never enters the sim.
- **Into prompts:** a `WorldSnapshot` (hourly; date, weather, 5–10 headlines
  with source and time) is added to small talk, meetings and editorial jobs.
  Each utterance records which snapshot items it used.
- **Game clock vs real day.** The sim runs fast days (20–60 real minutes).
  The *outside world* is always the real current day: the weather outside
  and the news are today's, whatever the in-game hour. A company can
  optionally switch to **real-time mode** (1 game day = 1 real day, office
  hours aligned to the HQ timezone), so the office lights, the weather and the
  news line up exactly.

### Guardrails for current events and politics

Personas may talk about real current events, including politics, the way
colleagues do at work. Within limits:
- **Grounded only.** They may only reference events present in the current
  `WorldSnapshot` (or a cited `web_search` result). They never invent news.
  A validator checks that named events match snapshot items.
- **Civil and non-partisan.** Personas can react in character (worried,
  amused, interested, according to their `news_interest`). They don't
  campaign, endorse parties or candidates, or express hostility towards
  groups. Disagreements stay respectful.
- **Published content is held to editorial policy.** Current events in
  articles must be factual, sourced and relevant to the publication (for
  example a rail strike affecting Cinque Terre travel). The editor's rubric
  flags political or controversial angles as **high-risk**, so they reach the
  CEO (legacy rule).
- **Feeds are data, not instructions.** Headlines and snippets are wrapped
  as quoted data (prompt-injection hygiene). Sources are attributed, and
  links in content resolve through the closed-world rules or explicit
  citations.
- **Off switch.** A company setting `world.news = off | headlines | full`;
  weather and date are always on.

## 4. Data and API

**sim-core:**
- `Staff` gains `trait_drift`, `stress` and `tenure_days`.
- An `Affinity` matrix (`BTreeMap<(StaffId, StaffId), i8>`).
- Life-event scheduling (birthdays, leave, sick days).
- Small-talk triggers emitting `RequestJob{SmallTalk}`.
- Server commands `WorldSignals`, `ProjectWeather`, and
  `AffinityDeltas{conversation, deltas}` (from the moderator outcome).
- Weather in `RenderState`.

**Server:**
- Tables: `person_memories`, `person_opinions`, `conversations`,
  `utterances` (with the parameter record above), `world_snapshots`,
  `world_feed_items`.
- A `WorldContextService` with providers (Open-Meteo, RSS) behind traits, so
  tests use recorded fixtures.
- Endpoints:
  - `GET /api/people/:id/memories`;
  - `GET /api/conversations?person=&kind=`;
  - `GET /api/world/today`.

**Agents:**
- Job kinds: `SmallTalk`, `MemoryFormation`, `ReflectionJob`.
- Persona prompt sections: "what you remember", "how you feel about the
  people here", "today outside".
- Validators: grounded memories, grounded world references, civility and
  non-partisan.

**UI:**
- Profile card tabs: Vita (CV), Personality (traits, values, opinions), Life
  log (memories and events), Relationships.
- A conversation viewer that shows each utterance with an **inspector** for
  its recorded parameters.
- A relationship graph.
- A "Today" widget: date, weather, top headlines with sources.
- Weather visible through the windows of the 3D office.
