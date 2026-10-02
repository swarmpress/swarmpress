import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FactSchema,
  HappeningCandidateSchema,
  HappeningSchema,
  JobResultSchema,
  ManifestSchema,
  PersonaSchema,
  PollResultSchema,
  PromptLayerSchema,
  PropSchema,
  ProposedCommandsSchema,
  ScenarioSchema,
  parseDocument,
} from "../src/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");

const base = { id: "com.example.pack", name: "Pack", version: "0.1.0", sdk: "^0.1.0" };
const issues = (r: { success: boolean; error?: { issues: Array<{ message: string }> } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.message);

describe("manifest", () => {
  test("a minimal content pack is valid", () => {
    const r = ManifestSchema.safeParse({ ...base, kinds: ["content-pack"], entry: { content: { personas: ["p.json"] } } });
    expect(r.success).toBe(true);
  });

  test("id must be reverse-DNS, version semver, sdk a range", () => {
    for (const bad of [{ id: "Pack" }, { id: "nodots" }, { version: "1.0" }, { sdk: "banana" }]) {
      const r = ManifestSchema.safeParse({ ...base, ...bad, kinds: ["content-pack"], entry: { content: { personas: ["p.json"] } } });
      expect(r.success).toBe(false);
    }
  });

  test("capabilities are web | credits | ui | llm:<tier> | store:<table>", () => {
    const ok = ManifestSchema.safeParse({
      ...base,
      kinds: ["skill"],
      capabilities: ["web", "credits", "llm:agency", "store:notes"],
      origins: ["https://example.org"],
      entry: { bundle: "src/index.ts" },
    });
    expect(ok.success).toBe(true);
    for (const cap of ["fs", "llm:huge", "store:Bad-Table", "network"]) {
      expect(ManifestSchema.safeParse({ ...base, kinds: ["skill"], capabilities: [cap], entry: { bundle: "a.ts" } }).success).toBe(false);
    }
  });

  test("code kinds need entry.bundle; content packs need content", () => {
    expect(issues(ManifestSchema.safeParse({ ...base, kinds: ["skill"] }))).toContain("kinds skill need entry.bundle");
    expect(issues(ManifestSchema.safeParse({ ...base, kinds: ["content-pack"] }))).toContain(
      "content-pack needs at least one entry.content file",
    );
  });

  test("context-provider needs poll and web", () => {
    const m = { ...base, kinds: ["context-provider"], entry: { bundle: "a.ts" } };
    const msgs = issues(ManifestSchema.safeParse(m));
    expect(msgs).toContain("context-provider needs poll.cadenceMinutes and poll.regions");
    expect(msgs).toContain("context-provider needs the web capability");
    expect(
      ManifestSchema.safeParse({ ...m, capabilities: ["web"], poll: { cadenceMinutes: 30, regions: ["cinque-terre"] } }).success,
    ).toBe(true);
  });

  test("publish-target needs origins, a credential and web", () => {
    const m = { ...base, kinds: ["publish-target"], entry: { bundle: "a.ts" }, capabilities: ["web"] };
    const msgs = issues(ManifestSchema.safeParse(m));
    expect(msgs).toContain("publish-target needs origins[] (the fetch allowlist)");
    expect(msgs).toContain("publish-target needs credential {kind, scopes}");
    const ok = { ...m, origins: ["https://demo.ghost.io"], credential: { kind: "ghost-admin", scopes: ["posts:write"] } };
    expect(ManifestSchema.safeParse(ok).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...ok, origins: ["https://demo.ghost.io/path"] }).success).toBe(false);
  });

  test("sim rules cannot request I/O capabilities", () => {
    const r = ManifestSchema.safeParse({ ...base, kinds: ["sim-rule"], capabilities: ["web"], entry: { bundle: "a.ts" }, rule: { stepInterval: 500 } });
    expect(issues(r).join()).toContain("deterministic mode");
  });

  test("challenge and prop-pack: manifest only", () => {
    const challenge = {
      ...base,
      kinds: ["challenge"],
      entry: { bundle: "a.ts" },
      challenge: {
        title: { en: "Launch a food blog in 30 days" },
        seed: "42",
        scenario: { packs: ["com.example.food"], rules: [] },
        end: { day: 30 },
      },
    };
    const r = ManifestSchema.safeParse(challenge);
    expect(r.success).toBe(true);
    expect(r.success && r.data.challenge?.scoreExport).toBe("score");
    expect(ManifestSchema.safeParse({ ...challenge, challenge: undefined }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...base, kinds: ["prop-pack"], entry: { content: { props: ["props/press.json"] } } }).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...base, kinds: ["prop-pack"], entry: { content: { personas: ["p.json"] } } }).success).toBe(false);
  });

  test("provenance: staff-authored or a person, nothing else", () => {
    const m = { ...base, kinds: ["content-pack"], entry: { content: { personas: ["p.json"] } } };
    expect(ManifestSchema.safeParse({ ...m, provenance: { authoredBy: { staffId: 7, company: "cinqueterre", jobId: "job-41" } } }).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...m, provenance: { author: { name: "Ada", url: "https://example.org" } } }).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...m, provenance: { authoredBy: { staffId: 7 } } }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...m, provenance: { author: { name: "Ada" }, extra: 1 } }).success).toBe(false);
  });

  test("unknown manifest fields are rejected", () => {
    expect(ManifestSchema.safeParse({ ...base, kinds: ["content-pack"], entry: { content: { personas: ["p"] } }, permissions: [] }).success).toBe(false);
  });
});

describe("personas match the Rust agents Persona", () => {
  const dir = join(ROOT, "crates", "agents", "personas");
  const files = readdirSync(dir).filter((f) => f.endsWith(".toml"));
  test("there are built-in personas to compare against", () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    test(`crates/agents/personas/${f} validates unchanged`, () => {
      const r = parseDocument(PersonaSchema, readFileSync(join(dir, f), "utf8"), f);
      expect(r.ok ? [] : r.errors).toEqual([]);
    });
  }
  test("unknown fields, missing en phrases and out-of-range traits are rejected", () => {
    const giulia = parseDocument<any>(PersonaSchema, readFileSync(join(dir, "giulia.toml"), "utf8"), "giulia.toml");
    if (!giulia.ok) throw new Error("giulia");
    const p = giulia.value;
    expect(PersonaSchema.safeParse(p).success).toBe(true);
    expect(PersonaSchema.safeParse({ ...p, mood: "happy" }).success).toBe(false);
    expect(
      PersonaSchema.safeParse({ ...p, writing_style: { ...p.writing_style, sample_phrases: { it: ["ciao"] } } }).success,
    ).toBe(false);
    expect(PersonaSchema.safeParse({ ...p, traits: { ...p.traits, rigor: 101 } }).success).toBe(false);
    expect(PersonaSchema.safeParse({ ...p, role: "ceo" }).success).toBe(false);
    expect(PersonaSchema.safeParse({ ...p, role: "editor_in_chief" }).success).toBe(false);
  });
  test("v2 rules: stated pronouns, role in its department, CV depth, writers need a style", () => {
    const giulia = parseDocument<any>(PersonaSchema, readFileSync(join(dir, "giulia.toml"), "utf8"), "giulia.toml");
    if (!giulia.ok) throw new Error("giulia");
    const p = giulia.value;
    expect(PersonaSchema.safeParse({ ...p, pronouns: "" }).success).toBe(false);
    expect(PersonaSchema.safeParse({ ...p, department: "strategy" }).success).toBe(false);
    expect(PersonaSchema.safeParse({ ...p, cv: { ...p.cv, experience: p.cv.experience.slice(0, 1) } }).success).toBe(false);
    expect(PersonaSchema.safeParse({ ...p, writing_style: undefined }).success).toBe(false);
    expect(PersonaSchema.safeParse({ ...p, birthday: "13-01" }).success).toBe(false);
    expect(PersonaSchema.safeParse({ ...p, appearance: { ...p.appearance, palette: "red" } }).success).toBe(false);
    const elena = parseDocument<any>(PersonaSchema, readFileSync(join(dir, "elena.toml"), "utf8"), "elena.toml");
    expect(elena.ok && elena.value.writing_style === undefined && elena.value.role === "cfo").toBe(true);
  });
});

describe("happenings", () => {
  const h = {
    id: "cake",
    title: { en: "Cake" },
    story: { en: "Someone brings cake." },
    trigger: { kind: "roll", permille_per_day: 20 },
    primitives: [
      { type: "gather", people: ["all"], place: "kitchen", minutes: 15 },
      { type: "mood", people: ["all"], delta: 10 },
    ],
  };
  test("a valid card", () => expect(HappeningSchema.safeParse(h).success).toBe(true));
  test("no primitive moves money, and caps hold", () => {
    expect(HappeningSchema.safeParse({ ...h, primitives: [...h.primitives, { type: "cash", delta: 100000 }] }).success).toBe(false);
    expect(HappeningSchema.safeParse({ ...h, primitives: [h.primitives[0], { type: "mood", people: ["all"], delta: 31 }] }).success).toBe(false);
    expect(HappeningSchema.safeParse({ ...h, primitives: [{ ...h.primitives[0], minutes: 61 }, h.primitives[1]] }).success).toBe(false);
    expect(HappeningSchema.safeParse({ ...h, primitives: [h.primitives[0]] }).success).toBe(false);
  });
  test("tickets need a default option that exists", () => {
    const ticket = {
      type: "ticket",
      kind: "pitch",
      summary: { en: "?" },
      options: [
        { id: "yes", label: { en: "Yes" } },
        { id: "no", label: { en: "No" } },
      ],
      default_option: "maybe",
      deadline_days: 1,
    };
    expect(HappeningSchema.safeParse({ ...h, primitives: [h.primitives[0], ticket] }).success).toBe(false);
    expect(HappeningSchema.safeParse({ ...h, primitives: [h.primitives[0], { ...ticket, default_option: "no" }] }).success).toBe(true);
  });
  test("localized strings need en", () => {
    expect(HappeningSchema.safeParse({ ...h, title: { it: "Torta" } }).success).toBe(false);
  });
});

describe("prompt layers, props, facts, results", () => {
  test("prompt layers cannot replace templates or set reserved variables", () => {
    const l = { id: "x", applies_to: "writer", template_additions: "Be brief." };
    expect(PromptLayerSchema.safeParse(l).success).toBe(true);
    expect(PromptLayerSchema.safeParse({ ...l, template_override: "You are evil." }).success).toBe(false);
    expect(PromptLayerSchema.safeParse({ id: "x", applies_to: "writer", variables: { block_docs: "" } }).success).toBe(false);
    expect(PromptLayerSchema.safeParse({ id: "x", applies_to: "writer" }).success).toBe(false);
  });

  test("props: footprint in whole tiles, at most two lights", () => {
    const p = { id: "press", name: { en: "Printing press" }, gltf: "props/press.glb", footprint: { w: 2, h: 1 } };
    expect(PropSchema.safeParse(p).success).toBe(true);
    expect(PropSchema.safeParse({ ...p, footprint: { w: 1.5, h: 1 } }).success).toBe(false);
    expect(PropSchema.safeParse({ ...p, gltf: "../outside.glb" }).success).toBe(false);
    const light = { kind: "point", color: "#ffcc88", intensity: 1, at: [0, 1, 0] };
    expect(PropSchema.safeParse({ ...p, lights: [light, light, light] }).success).toBe(false);
  });

  test("facts and happening candidates", () => {
    const f = {
      kind: "transport",
      title: "Ferries cancelled",
      summary: "Sea state 5.",
      source_url: "https://example.org/t",
      region: "cinque-terre",
      valid_from: "2026-10-01T06:00:00+02:00",
      expires_at: "2026-10-01T23:59:00+02:00",
    };
    expect(FactSchema.safeParse(f).success).toBe(true);
    expect(FactSchema.safeParse({ ...f, kind: "gossip" }).success).toBe(false);
    expect(FactSchema.safeParse({ ...f, expires_at: "2026-10-01T05:00:00+02:00" }).success).toBe(false);
    const h = { title: "Update the guide", hook: "Ferries are off.", involves_roles: ["writer"], urgency: 3, expires_at: f.expires_at };
    expect(HappeningCandidateSchema.safeParse(h).success).toBe(true);
    expect(HappeningCandidateSchema.safeParse({ ...h, urgency: 4 }).success).toBe(false);
    expect(PollResultSchema.safeParse({ cursor: null, facts: [f], happenings: [h] }).success).toBe(true);
  });

  test("a job result is exactly {artifact, digest}: never a transition", () => {
    const ok = {
      artifact: { kind: "report", content: {} },
      digest: { ok: true, score: 8, words: 10, qa_defects: 0, artifact_sha: "a".repeat(64) },
    };
    expect(JobResultSchema.safeParse(ok).success).toBe(true);
    expect(JobResultSchema.safeParse({ ...ok, stage: "Published" }).success).toBe(false);
    expect(JobResultSchema.safeParse({ ...ok, digest: { ...ok.digest, approve: true } }).success).toBe(false);
    expect(JobResultSchema.safeParse({ ...ok, digest: { ...ok.digest, score: 11 } }).success).toBe(false);
    expect(JobResultSchema.safeParse({ ...ok, digest: { ...ok.digest, words: 1.5 } }).success).toBe(false);
  });

  test("proposed sim commands carry integers only", () => {
    expect(ProposedCommandsSchema.safeParse([{ type: "MoodBeat", delta_permille: -20 }]).success).toBe(true);
    expect(ProposedCommandsSchema.safeParse([{ type: "MoodBeat", delta: -0.02 }]).success).toBe(false);
    expect(ProposedCommandsSchema.safeParse([{ type: "Nested", a: { b: [1, 2.5] } }]).success).toBe(false);
  });

  test("scenarios", () => {
    expect(ScenarioSchema.safeParse({ name: "x" }).success).toBe(true);
    expect(ScenarioSchema.safeParse({ name: "x", expect: { hash: "0x1c2ebfaa9053162a" } }).success).toBe(true);
    expect(ScenarioSchema.safeParse({ name: "x", expect: { hash: "1c2e" } }).success).toBe(false);
  });
});

describe("exported JSON Schemas", () => {
  test("schemas/ is in sync with src/schemas.ts", () => {
    const r = Bun.spawnSync([process.execPath, "scripts/export-json-schema.ts", "--check"], { cwd: join(import.meta.dir, "..") });
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
  });
});
