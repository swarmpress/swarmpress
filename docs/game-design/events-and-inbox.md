# Events and inbox

## The Inbox

QuestionTickets are **the only channel to the CEO**, a rule carried over from swarm.press. Every
decision the company can't make alone arrives in the Inbox. Every ticket has:
- options, each a structured effect;
- a **`default_option`**;
- a **`deadline_step`**.

When the deadline passes, the default applies, so an offline company never stalls.

The autonomy policy decides what reaches the Inbox:

| Policy | Pitches | Redesigns | ThemeTweaks | Merges |
|---|---|---|---|---|
| ApproveAll | every pitch | ticket | ticket | ticket |
| ApproveMajor | above cost or risk threshold | ticket | auto if diff ≤ 15% | auto after gates |
| Autonomous | none (logged in the feed) | ticket (always) | auto | auto after gates |

### Ticket kinds

| Kind | Raised by | Options | Default | Deadline |
|---|---|---|---|---|
| Pitch | standup outcome (risky, expensive or off-calendar) | approve · reject · approve with Agency | reject | 1 game day |
| Hire | CEO request, or a vacancy after a resignation | candidate A · B · C · none | none | 2 game days |
| Salary / promotion | staff at skill cap | grant · deny · counter (+10%) | deny | 2 game days |
| Resignation | morale < 250 ‰ | raise 15% · promise (morale +100 ‰, 7-day timer) · let go | let go | 2 game days |
| Redesign approval | design pipeline (redesign, or diff > 15%) | approve · request changes · reject | request changes | 3 game days |
| Escalation: NEEDS_PAGE | writer links to a missing page | create page project · drop link | drop link | 1 game day |
| Escalation: NEEDS_MEDIA | no suitable media in the index | PhotoStudio project · Agency research · publish without | publish without (if block rules allow), else hold | 1 game day |
| Escalation: editor deadlock | 3 rejections | send to Agency · kill project · override approve | send to Agency | 1 game day |
| Escalation: job failed | refusal, repeated schema failure, missing executor | retry · Agency · kill | kill | 1 game day |
| Event response | events below | per event | per event | per event |
| Loan | cash < 0 | take loan · cut costs · sell equipment | cut costs | 1 game day |

Answering a ticket is a `ClientCommand::AnswerTicket`, validated by the sim like any other
command.

## Event deck

Events are data (`config/events.ron`). They fire either from **seeded rolls**, using the world
RNG so they are deterministic, or from **earned triggers** (conditions on state).

| Event | Trigger | Effect | Ticket |
|---|---|---|---|
| Viral post | roll: 0.5% per quality article per day, ×2 if score ≥ 9 | audience spike +20% decaying over 5 days; reputation +10 | — |
| Critic review | roll: 2% per day at L2+ | an LLM job (Agency) reads the **real site** and returns a structured review; reputation −30…+30 | respond publicly (+5 reputation if score ≥ 8, −10 if defensive) |
| Burnout | fatigue = 1000 ‰ for 2 days, or Crunch for 5 days | staff off for 3 days; morale −200 ‰ | approve leave · ask to stay (−100 ‰ more, risk resignation) |
| Poaching | morale < 150 ‰ and ambition > 700 ‰, roll 5% per day | rival offer | match (+25% salary) · let go |
| Fact-check scandal | QA escape on an entity fact found by SiteAudit, roll 20% | reputation −60; credibility crisis if < 100 | correction PR (Agency) · statement · ignore |
| Tourist season | `content-calendar.json` windows (e.g. spring hiking, summer beaches) | page values for matching topics +30%; pitch backlog seeded | — |
| Deploy outage | deploys failing for 24 h (real `deployment_status`) | reputation −20/day; ServerRoom alarm | Agency fix · wait |
| Rollback | post-deploy smoke failed after a theme merge | automatic revert PR; reputation −25 | post-mortem meeting |

Event effects are commands, so they replay deterministically. Events driven by LLMs or the real
world (critic review, deploy outage) enter as server commands with digests.

## Newsroom feed

The feed records everything that happened. Meeting transcripts are shown in full. Drafts and
reviews link to PRs, and CI runs link to their screenshots. Each feed entry references a command
step, so clicking it can replay the moment in the dollhouse.
