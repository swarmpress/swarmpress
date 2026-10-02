# The Day Director: one browser-LLM thread that steers each day

> Status: design contract (2026-10-01). Decision: [ADR-0036](../adr/0036-a-day-director-thread-steers-each-day-within-sim-bounds.md).
> Builds on [living-people-and-the-real-world.md](living-people-and-the-real-world.md),
> [publishing-plan.md](publishing-plan.md) and [ADR-0024](../adr/0024-hybrid-inference-browser-llms-and-claude.md).

Rules alone make an office that ticks. A **director** makes an office that
*lives*. Each company has one dedicated browser-LLM thread, the **Day
Director**. It reads who these people are, what happened to them and what the
world looks like today, then shapes the day: who has coffee with whom,
which tension surfaces in the standup, who stays late because the piece
matters to them, who asks for Friday off because it's their daughter's school
play.

It is a storyteller, not a dictator. It **proposes intents**. The
deterministic sim validates them and applies them within strict bounds. The
CEO's authority and the sim's economy are never touched.

## 1. Where it runs

- **One thread per company**, on the leader tab (Web Locks, ADR-0025), in its
  own Web Worker next to the job runner. It uses the `director` role in the
  model registry: the largest model the device tier allows, because quality
  matters more than speed here and it runs rarely.
- **Cadence (game time):**

| When | Call | Output |
|---|---|---|
| 07:00 (before arrivals) | `DayPlan` | The day's **beats**: social moments, likely tensions, personal events, small talk with topics, spotlight candidates. Also a 2–3 sentence **morning narration** for the CEO feed. |
| Every game hour, 08:00–20:00 | `DayTick` (small) | Adjustments to how the day actually unfolds (a review landed badly, it started raining, a deploy failed) |
| On notable events (review score below 5, deploy failure, viral post, holiday) | `DayReact` | Up to 3 reactive beats |
| 22:00 | `DayRecap` | An evening **recap** for the CEO ("Giulia and Marco finally settled the intro dispute over focaccia…") and which memories are salient for tomorrow |
| Monday 07:00 | `WeekArcs` | Advances multi-day **story arcs** (§3) |

GPU budget (ADR-0027): director calls are small (the context is a compact
digest, and the output is a short structured script), they're scheduled
between job runs, and they never block jobs.

## 2. What it reads (bounded context)

A compact **DayDigest**, assembled client-side from the sim and the plan and
memory stores. Target size is at most ~6k tokens:

- **Calendar and world:** real date, weekday, holiday or festive season,
  weather at the HQ and project, 3–5 headlines (with
  `world.news ≠ off`), the in-game day and hour.
- **People** (for each person on site or due today):
  - a one-line persona summary;
  - mood, fatigue and stress bands;
  - today's schedule, leave and the current work item and phase;
  - the top 3 memories;
  - their relevant tradition for today (for example Christmas), birthday or
    name day.
- **Relationships:** the strongest bonds and frictions (top 8 pairs).
- **Plan:** items due within 2 days, blocked items, items in review, and
  recent review scores.
- **Arcs:** the open story arcs, each with its state.
- **Recent events:** yesterday's recap, overnight tickets, deploys, KPI
  highlights.

## 3. What it may do: intents (validated, bounded)

The director returns **structured intents only** (JSON schema). Each one is
validated by deterministic code, then applied as a server-issued sim command
at the next step boundary (`DirectorIntents{day, seq, intents}`), so every
lockstep replica applies the same thing.

| Intent | Effect in the sim | Bounds |
|---|---|---|
| `SmallTalk{participants[2..4], place, at_minute, topic_hint, reason}` | Schedules an informal chat. People walk there, a `SmallTalk` job runs with the topic hint, and memories and affinity follow. | Only people on site and free at that time; at most 6 per day per company and 2 per person |
| `SocialMoment{kind: coffee-round, lunch-together, birthday-cake, name-day-greeting, celebration, condolence, welcome-new-hire}` | A group gathering animation plus a mood or affinity effect | Kinds tied to real triggers (birthday dates, hires, wins); at most 1 cake per birthday |
| `MoodBeat{person, delta, reason}` | A small morale or stress nudge with a reason shown in the life log | \|delta\| ≤ 3% per beat, ≤ 6% per person per day; must cite a real cause (memory, event, weather, holiday) |
| `WorkFocus{person, item, reason}` | Suggests which assigned item a person picks first | Only items already assigned to that person on their project team; never reassigns |
| `OvertimeChoice{person, item, reason}` | The person chooses to stay late for something they care about | Only if the overtime policy allows it; respects fatigue caps |
| `PersonalRequest{person, kind: leave-day, swap-day, wfh-day, training, raise-talk, reason}` | Creates an Inbox ticket via the Secretary, with a default option | At most 1 per person per week; leave consistent with traditions and the calendar |
| `Spotlight{person or item, line}` | A highlight line in the CEO feed and HUD toast | At most 4 per day |
| `ArcStep{arc, step, participants, beat}` | Advances a multi-day story arc | Arc types allowed: mentorship, rivalry → reconciliation, burnout risk, ambition and promotion push, newcomer onboarding, project crunch, celebration; workplace-appropriate only |
| `Narration{text}` | Feed text (morning, recap) | Grounded in the digest; no invented facts |

**Never allowed:** changing cash, prices, budgets, salaries or plan
priorities; hiring or firing; answering tickets; publishing anything;
inventing people, events or news; and anything outside the workplace-
appropriate arc catalogue (no romance, nothing medical beyond "sick day", no
harassment storylines). Those remain the CEO's verbs and the sim's rules.

**Validation:**
- schema;
- referenced people, items, places and arcs exist;
- per-type caps;
- grounding: reasons and topics must cite digest facts by id;
- civility rules (ADR-0035) on any text.

Invalid intents are dropped and logged with the reason. They're never
partially applied.

## 4. Recording and explainability

Every director call is recorded like an utterance (ADR-0034):
- the digest hash and the digest itself (retention-limited);
- the model and executor;
- the raw output and the accepted and rejected intents with reasons;
- the resulting sim commands.

From the CEO's feed you can open any beat and see **why it happened**
("Isabella stayed late: she cares about the trail piece (memory mem-801),
rain cancelled her climbing (weather), overtime policy Allow").

## 5. Without a browser: the fallback director

When no tab is open, the company still lives (ADR-0020). A **deterministic
fallback director** runs inside the server actor: seeded rules with the
same intents and the same bounds. It's simpler (birthdays get cake; friends
lunch together; tired people go home on time) and has no narration. When a
tab returns, the LLM director picks up from the recorded state, and its
first `DayTick` writes a short "while you were away" recap from the event log.

## 6. Interfaces

- **sim-core:**
  - the `DirectorIntent` enum;
  - `validate_director_intent(world, intent)` with the caps above;
  - `ServerCommand::DirectorIntents`;
  - the `Arc` registry (type, participants, step, started_day);
  - the deterministic `fallback_director(world, rng)`.
- **client:**
  - `apps/game/src/llm/director.ts`, the director loop on the leader tab:
    it builds the digest, calls the `LocalLlm` structured output, and sends
    the intents to the server, or applies them locally in the offline
    sandbox;
  - the "Today" feed panel with the morning narration, spotlights and the
    recap, each beat linked to its explanation.
- **server:**
  - validates the intents again (never trust the client);
  - records the director calls;
  - injects `DirectorIntents` into the actor;
  - runs the fallback director when no worker is connected.
- **agents:**
  - prompt templates `day_plan`, `day_tick`, `day_react`, `day_recap`,
    `week_arcs` with output schemas;
  - the digest formatter;
  - the arc catalogue with allowed steps.

## 7. Improvisation: extraordinary, unscripted happenings

The intents in §3 keep ordinary days believable. Now and then the director
does something **nobody defined**: an *extraordinary happening*. The **story
is free**: the director invents what happens, in its own words, grounded in
who these people are and what is going on. The **mechanics are composed**
from a small, safe set of **effect primitives**, so the unexpected can't break
the sim, the economy or the CEO's authority.

Examples of what can emerge, none of them pre-scripted:
- Lorenzo finds a 17th-century map of the old mule paths in the archive. He
  gathers Isabella and Francesca around it, and the next morning there's a
  proposal for a 4-part "Lost paths of the Cinque Terre" series in the plan.
- During a real sirocco storm the power flickers. Davide jokes about the
  server room's "Ligurian UPS". The team ends up writing a live "storm day in
  the villages" update, which Alessia pushes to the newsletter.
- On a quiet Sunday-in-August shift, Giulia invites a fisherman from
  Riomaggiore to the office for an interview. A guest appears in the lobby,
  and the interview becomes a draft work item.
- After a viral post, the whole team spontaneously celebrates at the coffee
  machine with Francesca's playlist. Paolo pins a printout of the traffic
  graph to the wall, and it stays there as a prop.

### Effect primitives (the director's toolbox)

| Primitive | What it can do | Bounds |
|---|---|---|
| `gather{people[], place, minutes}` | People walk to a place and stay together | People on site and free; at most 60 game minutes; capacity |
| `emote{person, kind}` | Laugh, cheer, think, surprise, applause, phone call, … (animation clips) | Catalogue of clips; no harmful kinds |
| `prop{kind, place, ttl_days, label}` | Temporary prop in the 3D office: pinned printout, map on the table, cake, flowers, guest chair, whiteboard sketch, decoration | Procedural or catalogue props only; at most 5 active; TTL ≤ 14 days |
| `guest{name, role, place, minutes}` | A visitor (external, unnamed in sim stats), for example "a fisherman from Riomaggiore" | Fictional or role-described only (never a real private person by name); no stats, no hiring |
| `ambience{kind, minutes}` | Music, lights dim, storm flicker (tied to real weather), cheering crowd sound | Must be tied to a cited cause |
| `memory{people[], text}` | Shared memories of the happening | Grounding: must describe the happening itself |
| `affinity{pairs[], delta}` / `mood{people[], delta}` | Social and emotional aftermath | Same caps as §3, counted in the daily budget |
| `proposal{work item: kind, title, brief, workstream?}` | **Real work emerges**: a plan proposal from the protagonist | Goes through the normal plan and editorial gates; the CEO or EiC must accept; nothing auto-publishes |
| `ticket{kind, summary, options}` | A decision for the CEO that the happening raises | Via the Secretary; standard ticket rules |
| `spotlight{line}` / `narration{text}` | The story told in the CEO feed, with an "extraordinary" badge | Grounded; civil |
| `arc{type: novel, title, steps≤5}` | It becomes a multi-day thread | Novel arcs are still workplace-appropriate |

A happening is a **script of 2–12 primitives** with a title, a short story,
the cited grounds (memories, interests, weather, holiday, events) and a
"why now". The sim plays it out over game minutes or days. People actually
walk, gather and emote, and props appear in the 3D office.

### Rarity, novelty and safety

- **Wonder budget:** at most 1 extraordinary happening per company per real
  day (and at most 2 per game week in fast mode). The chance rises with what
  the digest offers: a holiday, weather extremes, a viral post, an arc
  climax, a quiet stretch.
- **Novelty:** the director sees a list of past happenings (titles and
  embeddings). The server rejects a happening too similar to an earlier one
  (embedding similarity threshold, plus checks on primitive patterns).
  Surprises stay surprising.
- **Grounding:** every happening must cite at least 2 digest facts:
  something about the people (interests, memories, traditions) and something
  about the moment (weather, calendar, events, plan).
- **Same hard limits as all intents:**
  - no money, salaries, budgets, priorities, hiring, ticket answers or
    publishing;
  - no real private persons;
  - civility and workplace-appropriateness;
  - content ideas only ever become *proposals*.
- **CEO control:**
  - a per-company **"magic" setting** (off | rare | lively) scales the
    budget;
  - every happening can be opened ("why did this happen?", with the full
    recording, ADR-0034);
  - any lingering effect (a prop, an arc) can be dismissed;
  - proposals can be declined.
- **Offline:** the fallback director never improvises. Happenings need the
  LLM director, so they're a reason to come back.

### Beyond the catalogue (later)

When a happening needs a prop or animation that doesn't exist, the director
describes it (`prop{kind: "custom", description}`).
- **Now:** it renders as a labelled procedural placeholder.
- **Later:** the description can be sent to the Agency (Claude, metered in
  credits) to assemble a small glTF from the parametric asset kit. If
  approved, the prop joins the company's catalogue. So, over time, the
  office's set of possible things grows out of what has actually happened
  in it.
