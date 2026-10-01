# Staff

Each staff member is an agent with a persona, a role, a seniority and six traits. Staff stats
affect **both** the simulation (speed, error rate, mood) **and** the prompts (the model, and a
work-style paragraph). That makes hiring and promotion meaningful.

## Roles

| Role | Department | Home room | Pipeline stages |
|---|---|---|---|
| Editor-in-Chief | Editorial | EditorOffice | Brief, moderates meetings, approves pitches |
| Editor | Editorial | EditorOffice | Edit (score 0–10, approve at ≥ 7) |
| Writer | Writers Room | Newsroom | Draft, revisions |
| Researcher | Research | SeoLab | CollectionResearch (Agency/Claude with web search) |
| SEO | Research | SeoLab | SEO fields, LinkPass |
| Linker | Research | SeoLab | LinkPass |
| MediaEditor | Media | PhotoStudio | Media |
| Translator | Translation | TranslationDesk | Translation |
| QA | QA | SeoLab | QA gate |
| Art Director | Design | DesignStudio | mood board, design crit |
| Front-end Dev | Design | DesignStudio | theme files |

## Seniority

| Seniority | Salary / game day | Claude model (Agency) | Local model (in tier) | Skill cap | Hiring pool |
|---|---|---|---|---|---|
| Junior | €120 | haiku-4-5 | smallest allowed | 400 ‰ | L1+ |
| Mid | €200 | sonnet-5-5 | middle | 650 ‰ | L1+ |
| Senior | €320 | opus-5-5 | largest that fits | 850 ‰ | L2+ |
| Star | €500 | opus-5-5 (or an Agency contract) | largest that fits | 1000 ‰ | L5 |

Salaries are in cents in the sim. The amounts above are `config/economy.toml` defaults.

## Traits (permille, 0–1000)

| Trait | Sim effect | Prompt effect (work-style paragraph) |
|---|---|---|
| rigor | Lower defect chance; slower stages (−0.2% speed per 10 ‰ above 500) | "double-checks facts against the index; prefers fewer, well-sourced claims" |
| speed | Shorter minimum stage time (up to −30%) | "writes tight first drafts; avoids digressions" |
| creativity | Pitch quality and novelty bonus | "looks for unusual angles and specific, sensory detail" |
| sociability | More meeting turns; morale contagion | "builds on colleagues' points in meetings" |
| resilience | Less morale loss from rejections and crunch | "treats editor feedback as a checklist, not criticism" |
| ambition | Faster skill growth; earlier promotion requests; poaching risk | "pushes for bigger stories" |

The paragraph is rendered deterministically from trait bands and snapshot-tested.

## Skill

- Each role has a skill in permille, starting from a seniority-dependent band.
- **Growth** after each completed stage: `+5 ‰`, `+10 ‰` if the editor scored ≥ 8, and `+0` on a
  rejection.
- At the seniority **skill cap**, the staff member files a **promotion-request ticket**.
  - Granting it raises the seniority, the salary and the model.
  - Denying it costs morale (−80 ‰) and sets a 7-day cooldown.

## Fatigue

| Situation | Fatigue per game hour |
|---|---|
| Working, 09:00–18:00 | +40 ‰ |
| Working after 18:00 (overtime) | +80 ‰ (×2) |
| Meeting | +20 ‰ |
| Lunch / Kitchen | −60 ‰ |
| Off-site (night) | −120 ‰ |

- Above 700 ‰, work is **rushed**: defect chance ×1.5, and the QA gate is more likely to fail.
- At 1000 ‰, the staff member goes home regardless of policy, and a **burnout** event becomes
  possible.

## Morale

| Cause | Change |
|---|---|
| Draft approved first time | +30 ‰ |
| Revision requested | −20 ‰ (scaled by 1 − resilience) |
| Rejected / escalated to Agency | −60 ‰ |
| Each overtime hour under Crunch policy | −15 ‰ |
| CEO praise (max 1 per staff per day) | +50 ‰ |
| Salary below market for seniority | −10 ‰ per day |
| Room comfort (plants, coffee machine, light) | up to +10 ‰ per day |
| Promotion granted / denied | +150 ‰ / −80 ‰ |

- Below 250 ‰, a **resignation ticket** opens (options: raise, promise, let go). The default is
  "let go" after 2 game days.
- Below 150 ‰, there is a chance of a **poaching** event.

## Hiring

- A hire ticket shows **three candidate cards**. Each has a persona, a role, a seniority, traits,
  skill, a salary ask, and a short sample written in voice by the local model.
- Candidates are generated deterministically from the world RNG; only the sample text is from an
  LLM.
- Star candidates appear only at L5. A Star may be an **Agency contract**: no desk, visits the
  building, always executed on Claude.

## The cinqueterre.travel staff

On import, Giulia, Isabella, Lorenzo, Sophia and Marco join as Senior Writers, and Francesca as
Senior MediaEditor. The game then generates an EiC, an Editor, a QA, an Art Director and a
Front-end Dev ([cutover runbook, step 6](../runbooks/cinqueterre-cutover.md)).
