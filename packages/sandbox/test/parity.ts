/**
 * Browser ↔ Bun parity: the same example bundles, the same host fakes, the
 * same calls. `sandbox.test.ts` runs this under Bun; `e2e/parity.spec.ts`
 * runs it in Chromium. Both must equal `fixtures/parity.expected.json`.
 *
 * This file is bundled into the browser page, so it imports nothing but the
 * sandbox API it is handed.
 */
import type { HostWeb, Sandbox, SandboxOptions } from "../src/index.ts";

type Create = (opts: SandboxOptions) => Promise<Sandbox>;
type StoreCtor = new (initial?: Record<string, string>) => { files: Map<string, string>; read(p: string): Promise<string | null>; write(p: string, d: string): Promise<void> };

const WIKI = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const PAGES: Record<string, string> = {
  [WIKI + "Vernazza"]: JSON.stringify({
    extract: "Vernazza is a town in the province of La Spezia. It is one of the five towns that make up the Cinque Terre region.",
  }),
  [WIKI + "Monterosso_al_Mare"]: JSON.stringify({ extract: "Monterosso al Mare is one of the Cinque Terre. It has about 1,500 inhabitants." }),
};

const web: HostWeb = async (req) => {
  await new Promise((r) => setTimeout(r, 1)); // a real async hop, as in the browser
  const body = PAGES[req.url];
  return body ? { status: 200, headers: { "content-type": "application/json" }, body } : { status: 404, headers: {} as Record<string, string>, body: "" };
};

export async function runParity(createSandbox: Create, MemoryStore: StoreCtor, bundles: { factChecker: string; coffee: string }) {
  // 1. The fact-checker skill: web + llm + store, async host functions.
  const replies = ["SUPPORTED: listed as a Cinque Terre town.", "CONTRADICTED: about 1,500 inhabitants."];
  let i = 0;
  const store = new MemoryStore();
  const logs: string[] = [];
  const skill = await createSandbox({
    capabilities: ["web", "llm:low", "store:factchecks"],
    origins: ["https://en.wikipedia.org"],
    host: {
      store,
      web,
      llm: async () => ({ text: replies[i++] ?? "UNVERIFIABLE: no script" }),
      log: (level, m) => logs.push(`${level}: ${m}`),
    },
  });
  await skill.load(bundles.factChecker);
  const job = await skill.call("runJob", {
    job: {
      job_id: "parity-1",
      kind: "fact-check",
      revision: 0,
      input: {
        page_id: "villages",
        claims: [
          { text: "Vernazza is one of the five villages of the Cinque Terre.", source: "Vernazza" },
          { text: "Monterosso has 12,000 inhabitants.", source: "Monterosso_al_Mare" },
        ],
      },
    },
  });
  const tool = await skill.call("runTool", { tool: "extract_claims", input: { text: "Hi. Riomaggiore has 1,300 residents." } });
  skill.dispose();

  // 2. The coffee-machine sim rule in deterministic mode (seeded Math.random, pinned Date).
  const rule = await createSandbox({ capabilities: [], deterministic: { seed: "42", nowMs: 0 }, host: { log: () => {} } });
  await rule.load(bundles.coffee);
  const commands: unknown[] = [];
  for (let day = 0; day < 6; day++) {
    const view = { seed: "42", step: day * 12000, day, minute: 420, cash_cents: 0, rooms: [], devices: [], staff: [] };
    commands.push(await rule.call("onDayStart", view, { seed: `42:coffee:${day}`, nowMs: Date.UTC(2026, 0, 1 + day, 7) }));
    commands.push(await rule.call("onStep", { ...view, step: view.step + 1500, minute: 600 }, { seed: `42:coffee:${day}:s`, nowMs: Date.UTC(2026, 0, 1 + day, 10) }));
  }
  const clock = await (async () => {
    const det = await createSandbox({ capabilities: [], deterministic: { seed: 7, nowMs: 1_767_225_600_000 }, host: {} });
    await det.load("globalThis.ext = { probe: () => ({ now: Date.now(), iso: new Date().toISOString(), r: [Math.random(), Math.random()] }) }");
    const r = await det.call("probe");
    det.dispose();
    return r;
  })();
  rule.dispose();

  return { job, tool, store: Object.fromEntries([...store.files].sort()), logs, commands, clock };
}
