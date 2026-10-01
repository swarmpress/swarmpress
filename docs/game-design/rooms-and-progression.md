# Rooms and progression

The building is a lot with one floor at start, laid out on a 1 m grid. Rooms are rectangles
with doors and windows, built from room modules. Rooms enable pipeline stages, and their
equipment sets capacity and comfort.

## Room kinds

| Room | Unlock | Min size | Seats | Enables | Without it |
|---|---|---|---|---|---|
| Newsroom | L1 | 6×6 | 1 per Desk | Draft, revisions | No Draft stage |
| EditorOffice | L1 | 4×4 | 1–2 | Brief, Edit | Edit done at Newsroom desks: −1 to review score, slower |
| Kitchen | L1 | 3×3 | 4 | Lunch fatigue recovery, morale | Fatigue recovery halved |
| MeetingRoom | L2 | 4×5 | 1 per chair (max 10) | Standup, pitch meetings, design crit | Standup held at desks: fewer pitches, lower quality |
| Archive | L2 | 3×4 | 1 | +research quality, freshness checks | Research stages −10% quality |
| PhotoStudio | L3 | 4×4 | 1–2 | Media stage by a MediaEditor | Writers pick media themselves (slower, more QA defects) |
| SeoLab | L3 | 4×4 | 2–3 | SEO, LinkPass, QA | QA at desks, LinkPass unavailable |
| TranslationDesk | L4 | 3×4 | 1–2 | Translation; **each level adds one language** | Single language |
| DesignStudio | L4 | 5×5 | 2–3 | Redesign / ThemeTweak projects | Design department unavailable |
| CeoOffice | L1 (free) | 3×3 | 1 | Your avatar; praise bonus +20% | — |
| ServerRoom | L1 (free, small) | 2×3 | 0 | Deploys; **room level caps deploys/day** (L1: 3, L2: 6, L3: 12) | No publishing |

Room **level** (1–3) is raised by upgrading equipment. Higher levels add capacity, comfort or
caps.

## Equipment

| Item | Rooms | Effect | Price | Upkeep / day |
|---|---|---|---|---|
| Desk | Newsroom, EditorOffice, SeoLab, DesignStudio | +1 seat | €400 | €2 |
| Monitor (tier 1–3) | on desks | stage speed +0/+5/+10% | €200 / €600 / €1 500 | €1 / €2 / €4 |
| DeskLamp | on desks | overtime fatigue −20% | €80 | €0.5 |
| Whiteboard | MeetingRoom | meeting outcome quality +5% | €300 | — |
| ArchiveShelf | Archive | Archive level +1 (max 3) | €500 | €1 |
| CameraRig | PhotoStudio | media quality +10% | €2 000 | €5 |
| ColorMonitor | DesignStudio | shows CI screenshots; visual review +5% | €1 800 | €4 |
| MoodBoardWall | DesignStudio | shows the real mood board; design crit +5% | €700 | — |
| CoffeeMachine | Kitchen | morale +5 ‰/day for all; fatigue recovery +10% | €900 | €3 |
| Plant | any | room comfort +1 (max 3 per room) | €60 | €0.2 |

Device state is Off / On / InUse and is visible: monitors glow, and lamps light the desk at
night.

## Company levels

| Level | Requirement (all of) | Unlocks |
|---|---|---|
| L1 Startup | — | Newsroom, EditorOffice, Kitchen, CeoOffice, ServerRoom (L1), Junior/Mid hiring |
| L2 Small press | 10 verified quality pages, reputation ≥ 300 | MeetingRoom, Archive, Senior hiring, ServerRoom L2 |
| L3 Publication | 40 verified quality pages, reputation ≥ 450, audience ≥ 5 000 | PhotoStudio, SeoLab, collections |
| L4 Multilingual | 100 verified quality pages, 2 languages live, reputation ≥ 550 | TranslationDesk (languages), DesignStudio, Redesigns, ServerRoom L3 |
| L5 House | 250 verified quality pages, reputation ≥ 650, audience ≥ 50 000 | Second floor, Star hiring pool, Agency contracts |

"Verified quality page" means live, valid, in a declared language, editor score ≥ 7 on record,
and no open QA defects, per the latest SiteAudit.

cinqueterre.travel starts as a **Legacy publication**: level 3, with reputation from its first
SiteAudit.

## Failure states

| Trigger | State | Effect | Exit |
|---|---|---|---|
| Cash < 0 | Overdrawn | **Loan ticket** (options: take a loan at 8% / 30 days, cut costs, sell equipment) | Cash ≥ 0 |
| 7 consecutive days with negative net income | **Receivership** | Hiring frozen; automatic layoffs (lowest morale × highest salary first) until projected net ≥ 0; **the site is never deleted or unpublished** | 7 consecutive positive days |
| Reputation < 100 | **Credibility crisis** | Editor approval bar rises to **8** for 14 days; critic events more likely | Timer expires and reputation ≥ 100 |
| Deploy outage (failing deploys for 24 h) | Outage | Reputation −20 ‰/day; a ticket offers Agency help | Next green deploy |

Companies can't lose their website. The worst outcome is a frozen, bankrupt house whose site
keeps serving the last good build.
