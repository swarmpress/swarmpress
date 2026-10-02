/** Scaffolds for `simpress new <kind> <dir>`. Each one passes `simpress check` and `simpress test`. */
import { SDK_VERSION } from "@simpress/sdk";

export const TEMPLATE_KINDS = ["content-pack", "skill", "sim-rule", "context-provider", "publish-target"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const sdkRange = `^${SDK_VERSION}`;

function manifest(slug: string, kind: TemplateKind, extra: Record<string, unknown>) {
  return json({
    id: `com.example.${slug}`,
    name: slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()),
    version: "0.1.0",
    sdk: sdkRange,
    description: `A ${kind} scaffolded by simpress new.`,
    kinds: [kind],
    ...extra,
  });
}

export function template(kind: TemplateKind, slug: string): Record<string, string> {
  switch (kind) {
    case "content-pack":
      return {
        "simpress.ext.json": manifest(slug, kind, {
          capabilities: [],
          entry: { content: { personas: ["content/personas/nina.json"], happenings: ["content/happenings/team-lunch.json"] } },
        }),
        // Persona schema v2 (agents::Persona; docs/game-design/organization.md §3).
        "content/personas/nina.json": json({
          slug: "nina",
          id: 600,
          name: "Nina",
          pronouns: "she/her",
          age: 31,
          hometown: "Sarzana, Liguria",
          department: "editorial",
          role: "writer",
          title: "Local Culture Writer",
          seniority: "mid",
          salary_eur_month: 3200,
          languages: ["it (native)", "en (C1)"],
          affinities: ["festivals", "local crafts", "culture"],
          pitch: "Writes about the people who keep old traditions alive.",
          birthday: "05-12",
          bio: "I'm Nina. I grew up above my parents' bakery and write about the people who keep old traditions alive.",
          cv: {
            education: [{ years: "2013–2016", what: "BA Cultural Anthropology", where: "Università di Genova" }],
            experience: [
              { years: "2016–2020", role: "Staff writer", org: "A regional culture magazine", highlights: ["Covered village festivals"] },
              { years: "2020–present", role: "Freelance writer", org: "Travel portals", highlights: ["Wrote 60 short guides"] },
            ],
            skills: ["interviews", "festival guides"],
            awards: [],
          },
          life: {
            hobbies: ["bread baking"],
            interests: ["local crafts"],
            quirks: ["Quotes the people she meets"],
            likes: ["village festivals"],
            dislikes: ["tourist traps"],
            work_style: "Warm and curious; interviews first, writes second.",
            values: ["people first", "honest prices"],
          },
          traits: { rigor: 60, speed: 55, creativity: 75, sociability: 80, resilience: 60, ambition: 50 },
          writing_style: {
            tone: "friendly",
            perspective: "first_person",
            descriptive_style: "evocative",
            voice: ["Warm and curious", "Quotes the people she meets"],
            preferences: {
              opening_style: "A small scene",
              structure_preference: "Narrative with practical tips",
              closing_style: "An invitation",
              favorite_topics: ["festivals"],
              avoid_topics: ["tourist traps"],
            },
            sample_phrases: { en: ["The baker told me…"] },
          },
          family: { household: "Lives with her partner in Sarzana.", key_people: ["her parents, the bakers"] },
          traditions: { christmas: "Bakes pandolce with her parents", easter: "Torta pasqualina for the whole street" },
          world: { news_interest: "medium", topics: ["local festivals"], tone_on_current_events: "curious and kind" },
          appearance: { palette: "#c0703a", description: "Flour on her sleeves, a notebook in her apron pocket." },
        }),
        "content/happenings/team-lunch.json": json({
          id: "team-lunch",
          title: { en: "Team lunch" },
          story: { en: "Nina brings focaccia from her parents' bakery and everyone gathers in the kitchen." },
          trigger: { kind: "roll", permille_per_day: 50 },
          cooldown_days: 7,
          primitives: [
            { type: "gather", people: ["all"], place: "kitchen", minutes: 30 },
            { type: "mood", people: ["all"], delta: 10 },
            { type: "narration", text: { en: "Lunch ran long; nobody minded." } },
          ],
        }),
        "test/basic.scenario.json": json({
          name: "pack loads and the world replays",
          seed: 42,
          days: 1,
          expect: { hash: "replay", day: 1 },
          content: { expect: { personas: 1, happenings: 1 } },
        }),
      };
    case "skill":
      return {
        "simpress.ext.json": manifest(slug, kind, { capabilities: ["llm:low", "store:notes"], entry: { bundle: "src/index.ts" } }),
        "src/index.ts": `import { defineSkill, jobResult } from "@simpress/sdk/runtime";

export default defineSkill({
  tools: {
    shout: {
      description: "Upper-cases a text.",
      input: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      run: (input: { text: string }) => ({ text: input.text.toUpperCase() }),
    },
  },
  jobs: {
    summarize: {
      description: "Summarizes the input text with the low-tier model.",
      example: { input: { text: "SimPress is a publishing-house sim." } },
      async handler({ job, llm, store }) {
        const { text } = job.input as { text: string };
        const res = await llm.complete({ tier: "low", prompt: "Summarize in one sentence: " + text });
        await store.table("notes").put(job.job_id, { summary: res.text });
        return jobResult({ kind: "summary", content: { summary: res.text } }, { ok: true, score: 7 });
      },
    },
  },
});
`,
        "test/summarize.scenario.json": json({
          name: "summarize returns a digest",
          seed: 1,
          days: 0,
          jobs: [
            {
              kind: "summarize",
              input: { text: "SimPress is a publishing-house sim." },
              llm: ["A sim about running a publishing house."],
              expect: { digest: { ok: true, score: 7, words: 7, qa_defects: 0 }, artifactKind: "summary" },
            },
          ],
          tools: [{ tool: "shout", input: { text: "hi" }, expect: { output: { text: "HI" } } }],
        }),
      };
    case "sim-rule":
      return {
        "simpress.ext.json": manifest(slug, kind, { capabilities: [], entry: { bundle: "src/index.ts" }, rule: { stepInterval: 500 } }),
        "src/index.ts": `import { defineRule } from "@simpress/sdk/runtime";

// Runs in deterministic mode: Math.random is seeded, Date is pinned to the sim clock.
export default defineRule({
  onDayStart(view) {
    if (Math.random() < 0.5) return [];
    return [{ type: "Spotlight", day: view.day, line: "good-morning" }];
  },
});
`,
        "test/replay.scenario.json": json({
          name: "rule output replays",
          seed: 42,
          days: 2,
          expect: { hash: "replay" },
          rules: { expect: { commands: "replay" } },
        }),
      };
    case "context-provider":
      return {
        "simpress.ext.json": manifest(slug, kind, {
          capabilities: ["web"],
          origins: ["https://example.org"],
          entry: { bundle: "src/index.ts" },
          poll: { cadenceMinutes: 60, regions: ["cinque-terre"] },
        }),
        "src/index.ts": `import { defineContextProvider } from "@simpress/sdk/runtime";

export default defineContextProvider({
  async poll({ now, region, cursor }) {
    const res = await fetch("https://example.org/alerts.json");
    const alerts = (await res.json()) as Array<{ id: string; title: string; text: string; until: string }>;
    const fresh = alerts.filter((a) => cursor === null || a.id > cursor);
    return {
      cursor: alerts.length ? alerts[alerts.length - 1].id : cursor,
      facts: fresh.map((a) => ({
        kind: "news" as const,
        title: a.title,
        summary: a.text,
        source_url: "https://example.org/alerts",
        region,
        valid_from: now,
        expires_at: a.until,
      })),
      happenings: [],
    };
  },
});
`,
        "test/poll.scenario.json": json({
          name: "poll turns alerts into facts",
          seed: 1,
          days: 0,
          polls: [
            {
              region: "cinque-terre",
              now: "2026-10-01T08:00:00Z",
              web: {
                "https://example.org/alerts.json": {
                  body: [{ id: "a1", title: "Market day", text: "Market in Levanto.", until: "2026-10-01T18:00:00Z" }],
                },
              },
              expect: { facts: 1, happenings: 0, cursor: "a1" },
            },
          ],
        }),
      };
    case "publish-target":
      return {
        "simpress.ext.json": manifest(slug, kind, {
          capabilities: ["web"],
          origins: ["https://cms.example.org"],
          credential: { kind: "bearer", scopes: ["posts:write"] },
          entry: { bundle: "src/index.ts" },
        }),
        "src/index.ts": `import { definePublishTarget } from "@simpress/sdk/runtime";

const API = "https://cms.example.org/api";

export default definePublishTarget({
  async openDraft(input, { web }) {
    const res = await web.fetch(API + "/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: input.path, page: input.page, message: input.message }),
    });
    const d = (await res.json()) as { id: string; rev: string };
    return { ref: d.id, headSha: d.rev };
  },
  async merge(input, { web }) {
    const res = await web.fetch(API + "/drafts/" + input.ref + "/publish", { method: "POST", body: JSON.stringify({ rev: input.headSha }) });
    return { mergedSha: ((await res.json()) as { rev: string }).rev };
  },
  async status(input, { web }) {
    const res = await web.fetch(API + "/drafts/" + input.ref);
    return { state: ((await res.json()) as { published: boolean }).published ? "merged" : "open" };
  },
});
`,
        "test/cycle.scenario.json": json({
          name: "draft, merge, status",
          seed: 1,
          days: 0,
          publish: {
            credential: { ref: "cred_test", secret: "s3cret" },
            draft: { contentId: "page-1", path: "hello", page: { blocks: [] }, message: "Add hello" },
            server: [
              {
                method: "POST",
                url: "https://cms.example.org/api/drafts",
                expectHeaders: { authorization: "Bearer s3cret" },
                body: { id: "d1", rev: "r1" },
              },
              { method: "POST", url: "https://cms.example.org/api/drafts/d1/publish", body: { rev: "r2" } },
              { method: "GET", url: "https://cms.example.org/api/drafts/d1", body: { published: true } },
            ],
            expect: { state: "merged", ref: "d1" },
          },
        }),
      };
  }
}
