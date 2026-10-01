# Game design overview

> You are the CEO of a small publishing house. Your staff are AI agents. You don't write; you
> hire, build, set policy and answer your inbox. Every article your newsroom publishes appears on
> a **real website** that you own.

SimPress is a management sim and digital dollhouse played in the browser. The building is a
detailed isometric 3D cutaway. You watch writers arrive in the morning, the 09:00 standup argue
over pitches in speech bubbles, the editor's lamp burning late before a deadline, and the server
room blinking as a deploy lands.

## Pillars

1. **Real work, visible.** Every animation corresponds to a real job: an LLM call, a PR, a
   deploy. Nothing is faked for show. Text you see in bubbles is the actual meeting.
2. **The CEO decides through the Inbox.** QuestionTickets are the only channel to you. They come
   with options, a default and a deadline, so the company never stalls while you're away.
3. **The score is the real site.** Revenue, reputation and the leaderboard come from
   SiteAudit-verified facts about the website, not from the sim alone.
4. **It runs while you sleep.** Real-time ticks; one game day per real hour on live servers.
   Coming back is a morning briefing, not a pause screen.
5. **Staff are people.** Traits, seniority, fatigue, morale. A promotion really changes the model
   behind the persona.

## Core loop

```
 hire & build ──► staff work (meetings → briefs → drafts → review → QA → publish)
      ▲                                         │
      │                                         ▼
 money & unlocks ◄── nightly settlement ◄── SiteAudit of the real site
      ▲                                         │
      └──────── Inbox: pitches, hires, escalations, events, redesigns ◄┘
```

## A day at the office (live server: 1 game hour = 2.5 real minutes)

| Time | Phase | What you see |
|---|---|---|
| 22:00–06:00 | Night | Building dark. The ServerRoom blinks. Queued browser jobs wait for your return |
| 06:00–09:00 | Arrival | Staff walk in, grab coffee in the Kitchen, sit, and monitors switch on |
| 09:00 | Standup | Everyone in the MeetingRoom. Pitches play out in bubbles. Risky pitches land in your Inbox |
| 09:30–12:30 | Work | Typing at desks, the editor reviewing, the PhotoStudio picking media |
| 12:30–13:30 | Lunch | Kitchen crowded. Fewer jobs start |
| 13:30–18:00 | Work | Reviews, QA, merges. The ServerRoom lights up on deploy |
| 18:00–22:00 | Evening / overtime | Under the overtime policy, deadline staff stay. Desk lamps on, fatigue ×2, 1.5× pay |
| 00:00 | Settlement | Revenue and costs booked. The SiteAudit runs. The morning briefing is prepared |

## Player verbs

| Verb | Where | Effect |
|---|---|---|
| Build rooms, place furniture | Build mode | Unlocks pipeline stages and capacity (seats), improves comfort |
| Hire / fire / promote | Inbox (hire tickets), Staff panel | Changes who does the work, with which model |
| Set policies | Company panel | Overtime (Never / Allow / Crunch), autonomy (ApproveAll / ApproveMajor / Autonomous), quality bar |
| Answer tickets | Inbox | Approve pitches and redesigns, resolve escalations, respond to events, take loans |
| Praise staff | Staff panel | Morale boost (limited per day) |
| Send to Agency | Ticket option | Escalates a job to Claude: costly, better |
| Read | Feed | Full meeting transcripts, drafts, reviews, CI screenshots, links to PRs |

## Documents

- [Staff](staff.md): roles, seniority, traits, fatigue, morale, hiring and promotion
- [Rooms and progression](rooms-and-progression.md): room kinds, equipment, levels, unlocks,
  failure states
- [Economy](economy.md): revenue, audience, costs, settlement, real site signals
- [Events and inbox](events-and-inbox.md): ticket kinds, defaults and deadlines, the event deck
- [Leaderboard](leaderboard.md): what counts and why it can't be gamed

The sim implementation is in [../architecture/sim.md](../architecture/sim.md). All numbers here
are defaults from `config/*.toml` / `*.ron` and are balanced in data, not code.
