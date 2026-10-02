# What the SDK makes possible

> This is a catalogue of extension ideas, kept to steer the SDK's design. The interfaces are in
> [ADR-0042](../adr/0042-extension-sdk-and-the-headless-bun-runner.md) (bundles, sandbox, runner)
> and [ADR-0043](../adr/0043-extension-points-context-publish-challenges-self-authored-props.md)
> (the five extension points v0 designs for). Nothing here is a commitment to ship. Each idea
> names the extension point it uses.

Extension points:

| Point | What it is | Defined in |
|---|---|---|
| `content-pack` | data: personas, happenings, prompt layers, job kinds, blocks | ADR-0042 |
| `sim-rule` | deterministic hooks that propose commands | ADR-0042 |
| `skill` | agent tools and jobs that return artifacts and digests | ADR-0042 |
| `panel` | overlay UI | ADR-0042 |
| `context-provider` | real-world feed → world context and happening candidates | ADR-0043 |
| `publish-target` | gateway adapter: open draft, merge, status | ADR-0043 |
| `challenge` | seed, rules and a scoring function, verified by replay | ADR-0043 |
| `prop-pack` | glTF props declared by id, placed by the sim | ADR-0043 |

Staff-authored extensions (also ADR-0043) aren't an extension point. They're a provenance and
approval flow that applies to every kind.

## 1. The company extends itself
The IT and web-dev staff write extensions themselves.

**Example:** Lorenzo (IT) notices the writers checking ferry timetables by hand. He proposes a
"Ferry Desk" skill and drafts it.
1. The CEO gets a ticket with the code diff, the requested capabilities (`web`) and a test run
   in the runner.
2. After approval, the tool installs, and a new device appears on the writers' desks.

**What follows:**
- Every company grows its own tooling over time: unscripted infrastructure, not just unscripted
  events.
- Good tools can be listed in the marketplace, earning credits.

**Points:** any kind, plus the staff-authored flow.

## 2. The real world leaks in
`context-provider` extensions turn real data into world context and happening candidates.
- **Cinque Terre:**
  - ferry cancellations from sea state;
  - Trenitalia strikes;
  - trail closures (Sentiero Azzurro);
  - sagre and festival calendars;
  - cruise-ship arrivals.
- **The mood of the day:** local headlines, a football derby, an election night.
- **Region packs:** Tokyo, Lake Como, any place, each adding its feeds, holidays and traditions.

**Effect:** "Trail closed, rewrite the hiking guide today" becomes a real page update on the live
site. The game becomes the operating system that keeps a travel site truthful.

## 3. Verifiable challenges and replays
The sim is deterministic, and command logs replay exactly.
- **Challenges:** a seed plus a rule bundle plus a scoring function. Examples: "Launch a food
  blog in 30 game days with €20k", "Survive the core update", "Rescue a dying 1987 local paper".
  The central leaderboard re-runs the log in the runner, so scores are proven and a modified
  client can't cheat.
- **Shareable seeds:** "play my week 12 from here."
- **Timelapse and documentary mode:** a camera-director panel replays a week, and a narrator
  skill voices it. The result is a shareable video of your publishing house.
- **Spectating and coaching:** friends watch a replay and leave notes on the timeline.

## 4. New departments and media
- **Podcast studio:** in-browser TTS in persona voices, with episodes and show notes on the site.
- **Newsletter desk:** a weekly digest, sent through the player's email provider, gated by a
  capability.
- **Social desk:** drafts per channel, never posted without a CEO ticket.
- **Fact-check desk:** web capability, citations per claim, and a scandal risk if you skip it.
- **Translation desk:** local translation models, plus a native-speaker persona as reviewer.

## 5. Real optimization loops
These run through our own tracker:
- **A/B headlines:** two variants, a traffic split, and the data scientist reports the winner at
  standup. A real growth loop played as a game.
- **Content-decay hunter:** pitches refreshes for pages losing traffic.
- **Auditors:** an SEO auditor, a broken-link hunter and an accessibility checker crawl the live
  site and open tickets.

## 6. Publish anywhere
`publish-target` adapters:
- WordPress, Ghost, Contentful, Shopify blogs, Notion, and GitHub + Astro (built in).

With these, SimPress becomes a playful front end for a real editorial team. They import their
style guide, the agents work in their CMS, and humans approve in the Inbox.

## 7. People
- **Persona packs:** archetypes such as the grizzled 1970s Fleet Street editor, each with a CV,
  family and traditions.
- **Real colleagues as personas:** a human's messages become meeting turns, giving a mixed newsroom.
- **Staff diaries:** private entries about who resents the overtime and who is being courted by
  a rival.
- **Office life:** pets, a coffee machine that breaks, birthday cakes (small `sim-rule` bundles).

## 8. Between companies
These run over the central events channel:
- **Wire service:** sell stories to other players for credits, licensed and attributed on the
  real sites.
- **Syndication deals and guest posts:** real cross-site links.
- **Talent market:** staff with history get poached across companies and keep their memories.
- **NPC rival publishers:** for example "Riviera Weekly" scoops your story.

## 9. Look and feel
- **`prop-pack`:** a vintage printing press, a rooftop terrace, a Ligurian palazzo office theme.
- **Real-world bridges:** when the office is in crunch, your real smart lamp turns orange. Opt-in,
  capability-gated.
- **Voice CEO:** talk to the secretary through Web Speech.
