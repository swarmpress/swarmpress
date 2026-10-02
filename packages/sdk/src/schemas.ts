/**
 * Zod source of every SDK document schema. `scripts/export-json-schema.ts`
 * writes the JSON Schemas in `schemas/` from these (the same pattern as
 * `@swarm-press/content-schema`); `pnpm --filter @swarm-press/sdk check` fails on drift.
 */
import { z } from "zod";
import { validRange, SEMVER_PATTERN } from "./semver.ts";

// ---------------------------------------------------------------- primitives

export const EXTENSION_ID_PATTERN = "^[a-z0-9-]+(\\.[a-z0-9-]+)+$";
export const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export const LocalizedStringSchema = z
  .object({ en: z.string().min(1) })
  .catchall(z.string())
  .describe("Language code → text; `en` is required");

const Int = z.number().int();
const Slug = z.string().regex(SLUG, "lower-case slug (a-z, 0-9, -)");
const Rfc3339 = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, "RFC 3339 timestamp");
/** A relative path inside the extension folder (no `..`, not absolute). */
const RelPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.includes("\\") && !p.split("/").includes(".."), "relative path inside the extension");

// ---------------------------------------------------------------- manifest

export const KINDS = [
  "content-pack",
  "sim-rule",
  "skill",
  "panel",
  "context-provider",
  "publish-target",
  "challenge",
  "prop-pack",
] as const;
export const KindSchema = z.enum(KINDS);
export type Kind = z.infer<typeof KindSchema>;

/** Kinds whose code is a JS bundle run in the sandbox. */
export const BUNDLE_KINDS: readonly Kind[] = ["sim-rule", "skill", "panel", "context-provider", "publish-target", "challenge"];

export const LLM_TIERS = ["low", "mid", "high", "agency"] as const;
export const CAPABILITY_PATTERN = "^(web|credits|ui|llm:(low|mid|high|agency)|store:[a-z][a-z0-9_]{0,31})$";
export const CapabilitySchema = z
  .string()
  .regex(new RegExp(CAPABILITY_PATTERN), "capability: web | credits | ui | llm:<low|mid|high|agency> | store:<table>");

export const ProvenanceSchema = z.union([
  z
    .object({
      authoredBy: z
        .object({
          staffId: z.union([Int.nonnegative(), z.string().min(1)]),
          company: z.string().min(1),
          jobId: z.string().min(1),
        })
        .strict(),
    })
    .strict()
    .describe("Written by a staff member's author_extension job; installed only after CEO approval (ADR-0043)"),
  z
    .object({
      author: z.object({ name: z.string().min(1), url: z.string().url().optional() }).strict(),
    })
    .strict()
    .describe("Written by a person"),
]);

export const CredentialSchema = z
  .object({
    kind: z.enum(["bearer", "basic", "header", "ghost-admin"]),
    /** For `kind: "header"`: the header the host sets. */
    header: z.string().regex(/^[A-Za-z0-9-]+$/).optional(),
    scopes: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .refine((c) => c.kind !== "header" || !!c.header, "credential.kind=header needs credential.header");

export const ChallengeSpecSchema = z
  .object({
    title: LocalizedStringSchema,
    /** World seed (u64, decimal string). */
    seed: z.string().regex(/^\d{1,20}$/),
    scenario: z
      .object({
        base: z.enum(["demo", "empty"]).default("demo"),
        packs: z.array(z.string().regex(new RegExp(EXTENSION_ID_PATTERN))).default([]),
        rules: z.array(z.string().regex(new RegExp(EXTENSION_ID_PATTERN))).default([]),
      })
      .strict(),
    /** Export of the bundle that computes `score(worldView) → integer`. */
    scoreExport: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/).default("score"),
    end: z
      .object({ day: Int.min(1).max(3650), bankrupt: z.boolean().default(true) })
      .strict()
      .describe("The run ends at this game day, or earlier on bankruptcy"),
  })
  .strict();

export const ManifestSchema = z
  .object({
    $schema: z.string().optional(),
    id: z.string().regex(new RegExp(EXTENSION_ID_PATTERN), "reverse-DNS id, e.g. com.example.harvest-season"),
    name: z.string().min(1).max(80),
    version: z.string().regex(new RegExp(SEMVER_PATTERN), "semver version"),
    sdk: z.string().refine(validRange, "semver range, e.g. ^0.1.0"),
    description: z.string().max(500).optional(),
    kinds: z
      .array(KindSchema)
      .min(1)
      .refine((k) => new Set(k).size === k.length, "kinds must be unique"),
    capabilities: z
      .array(CapabilitySchema)
      .default([])
      .refine((c) => new Set(c).size === c.length, "capabilities must be unique"),
    entry: z
      .object({
        /** Source entry of the JS bundle (TS or JS), built by `swarmpress build`. */
        bundle: RelPath.optional(),
        content: z
          .object({
            personas: z.array(RelPath).optional(),
            happenings: z.array(RelPath).optional(),
            prompt_layers: z.array(RelPath).optional(),
            props: z.array(RelPath).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .default({}),
    /** `sim-rule`: how often `onStep` runs, in steps (12,000 steps per game day, so 500 = one game hour). */
    rule: z.object({ stepInterval: Int.min(1).max(1_000_000) }).strict().optional(),
    /** `context-provider`: polling cadence (enforced by the host) and regions. */
    poll: z
      .object({
        cadenceMinutes: Int.min(5).max(10_080),
        regions: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/)).min(1),
      })
      .strict()
      .optional(),
    /** `publish-target` (and optional for any `web` user): the only origins `fetch` may reach. */
    origins: z
      .array(z.string().regex(/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/, "an origin: scheme://host[:port], no path"))
      .optional(),
    credential: CredentialSchema.optional(),
    panel: z
      .object({ title: LocalizedStringSchema, slot: z.enum(["sidebar", "drawer", "modal"]).default("drawer") })
      .strict()
      .optional(),
    challenge: ChallengeSpecSchema.optional(),
    provenance: ProvenanceSchema.optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const has = (k: Kind) => m.kinds.includes(k);
    const caps = new Set(m.capabilities);
    const need = (cond: boolean, path: (string | number)[], message: string) => {
      if (!cond) ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    };
    const content = m.entry.content ?? {};
    const contentFiles = Object.values(content).reduce((n, a) => n + (a?.length ?? 0), 0);
    if (m.kinds.some((k) => BUNDLE_KINDS.includes(k)))
      need(!!m.entry.bundle, ["entry", "bundle"], `kinds ${m.kinds.filter((k) => BUNDLE_KINDS.includes(k)).join(", ")} need entry.bundle`);
    if (has("content-pack")) need(contentFiles > 0, ["entry", "content"], "content-pack needs at least one entry.content file");
    if (has("prop-pack")) need((content.props?.length ?? 0) > 0, ["entry", "content", "props"], "prop-pack needs entry.content.props");
    if (has("sim-rule")) need(!!m.rule, ["rule"], "sim-rule needs rule.stepInterval");
    if (has("context-provider")) {
      need(!!m.poll, ["poll"], "context-provider needs poll.cadenceMinutes and poll.regions");
      need(caps.has("web"), ["capabilities"], "context-provider needs the web capability");
    }
    if (has("publish-target")) {
      need((m.origins?.length ?? 0) > 0, ["origins"], "publish-target needs origins[] (the fetch allowlist)");
      need(!!m.credential, ["credential"], "publish-target needs credential {kind, scopes}");
      need(caps.has("web"), ["capabilities"], "publish-target needs the web capability");
    }
    if (has("panel")) {
      need(!!m.panel, ["panel"], "panel needs panel.title");
      need(caps.has("ui"), ["capabilities"], "panel needs the ui capability");
    }
    if (has("challenge")) need(!!m.challenge, ["challenge"], "challenge needs a challenge block");
    if (m.origins) need(caps.has("web"), ["origins"], "origins without the web capability");
    if (caps.has("llm:agency")) need(caps.has("credits"), ["capabilities"], "llm:agency spends credits: request credits too");
    if (has("sim-rule") || has("challenge")) {
      const io = [...caps].filter((c) => c === "web" || c === "credits" || c.startsWith("llm:"));
      need(
        io.length === 0 || m.kinds.some((k) => k === "skill" || k === "context-provider" || k === "publish-target"),
        ["capabilities"],
        `sim rules and challenges run in deterministic mode and cannot use ${io.join(", ")}`,
      );
    }
  });
export type Manifest = z.infer<typeof ManifestSchema>;

// ---------------------------------------------------------------- personas (crates/agents/src/personas.rs)

/** Persona schema version (`agents::personas::SCHEMA_VERSION`). */
export const PERSONA_SCHEMA_VERSION = 2;

/** Staff role → department (`agents::Role::department`, organization.md §2). */
export const ROLE_DEPARTMENTS = {
  cfo: "executive-office",
  secretary: "executive-office",
  strategist: "strategy",
  analyst: "strategy",
  "data-scientist": "strategy",
  "editor-in-chief": "editorial",
  editor: "editorial",
  writer: "editorial",
  translator: "editorial",
  "fact-checker": "editorial",
  "photo-editor": "photo-video",
  photographer: "photo-video",
  "video-producer": "photo-video",
  "art-director": "web-development",
  "web-developer": "web-development",
  "ux-designer": "web-development",
  "it-engineer": "it-operations",
  "dev-ops": "it-operations",
  "seo-specialist": "seo-marketing",
  "marketing-manager": "seo-marketing",
  "social-media-manager": "seo-marketing",
} as const;
export type AgentRole = keyof typeof ROLE_DEPARTMENTS;
/** Every staff role (`agents::Role::staff()`, kebab-case), in org-chart order. */
export const AGENT_ROLES = Object.keys(ROLE_DEPARTMENTS) as [AgentRole, ...AgentRole[]];
export const DEPARTMENTS = [
  "executive-office",
  "strategy",
  "editorial",
  "photo-video",
  "web-development",
  "it-operations",
  "seo-marketing",
] as const;
export const SENIORITIES = ["junior", "mid", "senior", "star"] as const;

const Trait = Int.min(0).max(100);
const Text = z.string().min(1);
const Texts = (min: number) => z.array(Text).min(min);
const MonthDay = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/, "MM-DD");

/**
 * Exactly the shape of `agents::Persona` v2 (serde, deny_unknown_fields;
 * organization.md §3), so a pack persona deserializes into the Rust type
 * unchanged. TOML files use the same keys as `crates/agents/personas/*.toml`.
 * Mirrors `agents::personas::persona_json_schema()`; a Rust test
 * (`crates/agents/tests/personas.rs`) fails when the committed
 * `schemas/persona.schema.json` drifts from it in keys or enums. The host
 * still runs the full Rust validation on load (salary within the role's
 * band, CV year ranges, non-partisan `world`, relationship targets).
 */
export const PersonaSchema = z
  .object({
    slug: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/, "2–32 chars of a-z, 0-9 and '-'"),
    id: Int.min(1).max(65535),
    name: Text,
    pronouns: z.string().regex(/^[^/\n]+\/[^\n]+$/, 'stated like "she/her"'),
    age: Int.min(18).max(80),
    hometown: Text,
    department: z.enum(DEPARTMENTS),
    role: z.enum(AGENT_ROLES),
    title: Text,
    seniority: z.enum(SENIORITIES),
    salary_eur_month: Int.min(1),
    languages: Texts(1),
    affinities: Texts(1),
    pitch: Text.max(160),
    birthday: MonthDay,
    name_day: MonthDay.optional(),
    bio: Text,
    cv: z
      .object({
        education: z.array(z.object({ years: Text, what: Text, where: Text }).strict()).min(1),
        experience: z
          .array(z.object({ years: Text, role: Text, org: Text, highlights: Texts(1) }).strict())
          .min(2),
        skills: Texts(1),
        awards: Texts(0).default([]),
      })
      .strict(),
    life: z
      .object({
        hobbies: Texts(1),
        interests: Texts(1),
        quirks: Texts(1),
        likes: Texts(1),
        dislikes: Texts(1),
        work_style: Text,
        values: Texts(2).max(4),
      })
      .strict(),
    traits: z
      .object({ rigor: Trait, speed: Trait, creativity: Trait, sociability: Trait, resilience: Trait, ambition: Trait })
      .strict(),
    writing_style: z
      .object({
        tone: z.string().optional(),
        vocabulary_level: z.string().optional(),
        sentence_length: z.string().optional(),
        formality: z.string().optional(),
        humor: z.string().optional(),
        emoji_usage: z.string().optional(),
        perspective: z.string().optional(),
        descriptive_style: z.string().optional(),
        voice: Texts(0).optional(),
        preferences: z
          .object({
            opening_style: Text,
            structure_preference: Text,
            closing_style: Text,
            favorite_topics: Texts(0),
            avoid_topics: Texts(0),
          })
          .strict()
          .optional(),
        sample_phrases: z
          .record(z.string().regex(/^[a-z]{2}$/), Texts(1))
          .refine((p) => Object.keys(p).length === 0 || Array.isArray(p.en), "sample_phrases.en is required (fallback)")
          .optional(),
      })
      .strict()
      .optional(),
    relationships: z.object({ friends: Texts(0).optional(), friction: Texts(0).optional() }).strict().optional(),
    family: z.object({ household: Text, key_people: Texts(0).default([]) }).strict(),
    traditions: z
      .record(z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case occasion"), Text)
      .refine((t) => Object.keys(t).length >= 2, "traditions needs at least 2 occasions"),
    world: z
      .object({ news_interest: z.enum(["low", "medium", "high"]), topics: Texts(1), tone_on_current_events: Text })
      .strict(),
    appearance: z.object({ palette: z.string().regex(/^#[0-9a-fA-F]{6}$/, "#rrggbb"), description: Text }).strict(),
  })
  .strict()
  .refine((p) => ROLE_DEPARTMENTS[p.role] === p.department, {
    message: "department must be the role's department",
    path: ["department"],
  })
  .refine((p) => p.writing_style !== undefined || !["writer", "editor", "editor-in-chief"].includes(p.role), {
    message: "writers and editors need writing_style",
    path: ["writing_style"],
  });
export type Persona = z.infer<typeof PersonaSchema>;

// ---------------------------------------------------------------- happenings (authored event cards)

/** Who a primitive involves: everyone, anyone, a role, or a persona by name. */
const Selector = z
  .string()
  .regex(/^(all|any|role:[a-z][a-z_-]*|persona:[A-Za-z][A-Za-z' -]{0,39})$/, "all | any | role:<role> | persona:<name>");
const Place = Slug.describe("a room kind, e.g. newsroom, meeting-room, kitchen");
const Permille30 = Int.min(-30).max(30).describe("permille; |delta| ≤ 30 ‰ per beat (day-director §3)");
const EMOTES = ["laugh", "cheer", "think", "surprise", "applause", "phone_call", "wave", "sigh"] as const;

/**
 * The effect primitives of ADR-0037 / day-director §7. There is deliberately
 * no primitive that moves money, hires, sets priorities, answers tickets or
 * publishes.
 */
export const PrimitiveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("gather"), people: z.array(Selector).min(1), place: Place, minutes: Int.min(1).max(60) }).strict(),
  z.object({ type: z.literal("emote"), person: Selector, kind: z.enum(EMOTES) }).strict(),
  z
    .object({ type: z.literal("prop"), kind: Slug, place: Place, ttl_days: Int.min(1).max(14), label: LocalizedStringSchema })
    .strict(),
  z
    .object({
      type: z.literal("guest"),
      role: LocalizedStringSchema.describe("role-described, never a real private person"),
      place: Place,
      minutes: Int.min(1).max(120),
    })
    .strict(),
  z
    .object({
      type: z.literal("ambience"),
      kind: z.enum(["music", "lights_dim", "storm_flicker", "crowd_cheer", "rain"]),
      minutes: Int.min(1).max(120),
    })
    .strict(),
  z.object({ type: z.literal("memory"), people: z.array(Selector).min(1), text: LocalizedStringSchema }).strict(),
  z.object({ type: z.literal("mood"), people: z.array(Selector).min(1), delta: Permille30 }).strict(),
  z
    .object({ type: z.literal("affinity"), pairs: z.array(z.tuple([Selector, Selector])).min(1), delta: Permille30 })
    .strict(),
  z
    .object({ type: z.literal("proposal"), kind: Slug, title: LocalizedStringSchema, brief: LocalizedStringSchema })
    .strict()
    .describe("A plan proposal: goes through the normal gates, never auto-publishes"),
  z
    .object({
      type: z.literal("ticket"),
      kind: Slug,
      summary: LocalizedStringSchema,
      options: z.array(z.object({ id: Slug, label: LocalizedStringSchema }).strict()).min(2).max(4),
      default_option: Slug,
      deadline_days: Int.min(1).max(7),
    })
    .strict()
    .describe("A CEO ticket; default_option must be one of options[].id (rule 10)"),
  z.object({ type: z.literal("spotlight"), line: LocalizedStringSchema }).strict(),
  z.object({ type: z.literal("narration"), text: LocalizedStringSchema }).strict(),
]);

export const TriggerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("roll"),
      permille_per_day: Int.min(1).max(1000),
      from_day: Int.min(0).optional(),
      to_day: Int.min(0).optional(),
    })
    .strict()
    .describe("Seeded daily roll from the world RNG"),
  z.object({ kind: z.literal("day"), day: Int.min(0) }).strict(),
  z.object({ kind: z.literal("every"), days: Int.min(1), offset: Int.min(0).default(0) }).strict(),
]);

export const HappeningSchema = z
  .object({
    id: Slug,
    title: LocalizedStringSchema,
    story: LocalizedStringSchema,
    trigger: TriggerSchema,
    cooldown_days: Int.min(0).default(0),
    primitives: z.array(PrimitiveSchema).min(2).max(12),
  })
  .strict()
  .superRefine((h, ctx) => {
    h.primitives.forEach((p, i) => {
      if (p.type === "ticket" && !p.options.some((o) => o.id === p.default_option))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["primitives", i, "default_option"], message: "default_option must be one of options[].id" });
    });
    if (h.trigger.kind === "roll" && h.trigger.from_day !== undefined && h.trigger.to_day !== undefined && h.trigger.to_day < h.trigger.from_day)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["trigger", "to_day"], message: "to_day must be ≥ from_day" });
  });
export type Happening = z.infer<typeof HappeningSchema>;

// ---------------------------------------------------------------- prompt layers (crates/agents/src/prompts.rs)

export const PROMPT_TEMPLATES = ["writer", "editor", "editor_in_chief", "meeting_speaker", "qa_coherence"] as const;
/** Variables the host derives (persona, house style, schema docs); packs cannot set them. */
export const RESERVED_PROMPT_VARIABLES = [
  "agent_name",
  "agent_role",
  "persona_block",
  "writing_style_block",
  "work_style",
  "house_style",
  "block_docs",
] as const;

/**
 * A level-2 (site) layer over a company template: appends instructions, adds
 * examples, overrides variables. Packs cannot replace a template
 * (`template_override` is not allowed) and cannot set reserved variables.
 */
export const PromptLayerSchema = z
  .object({
    id: Slug,
    applies_to: z.enum(PROMPT_TEMPLATES),
    template_additions: z.string().min(1).optional(),
    examples: z.array(z.unknown()).optional(),
    variables: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine((l) => !!l.template_additions || (l.examples?.length ?? 0) > 0 || Object.keys(l.variables ?? {}).length > 0, "a prompt layer must add something")
  .refine(
    (l) => !Object.keys(l.variables ?? {}).some((k) => (RESERVED_PROMPT_VARIABLES as readonly string[]).includes(k)),
    `reserved variables (${RESERVED_PROMPT_VARIABLES.join(", ")}) cannot be set by a pack`,
  );
export type PromptLayer = z.infer<typeof PromptLayerSchema>;

// ---------------------------------------------------------------- prop packs (ADR-0043, types only in v0)

const Vec2 = z.tuple([z.number(), z.number()]);
const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export const PropSchema = z
  .object({
    id: Slug,
    name: LocalizedStringSchema,
    gltf: RelPath.refine((p) => /\.(glb|gltf)$/.test(p), "a .glb or .gltf file"),
    textures: z.array(RelPath.refine((p) => /\.ktx2$/.test(p), "a .ktx2 file")).default([]),
    /** In whole tiles; the only geometry the sim knows. */
    footprint: z.object({ w: Int.min(1).max(8), h: Int.min(1).max(8) }).strict(),
    slots: z
      .array(z.object({ id: Slug, kind: z.enum(["sit", "stand", "use", "look"]), at: Vec2, facing: z.number().optional() }).strict())
      .default([]),
    lights: z
      .array(
        z
          .object({
            kind: z.enum(["point", "spot", "area"]),
            color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
            intensity: z.number().min(0),
            at: Vec3,
          })
          .strict(),
      )
      .max(2)
      .default([]),
  })
  .strict();
export type Prop = z.infer<typeof PropSchema>;

// ---------------------------------------------------------------- context providers (ADR-0043)

export const FactSchema = z
  .object({
    kind: z.enum(["weather", "transport", "event", "closure", "news"]),
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(600),
    source_url: z.string().url(),
    region: z.string().min(1),
    valid_from: Rfc3339,
    expires_at: Rfc3339,
  })
  .strict()
  .refine((f) => Date.parse(f.expires_at) > Date.parse(f.valid_from), "expires_at must be after valid_from");

export const HappeningCandidateSchema = z
  .object({
    title: z.string().min(1).max(120),
    hook: z.string().min(1).max(600),
    involves_roles: z.array(z.enum(AGENT_ROLES)).min(1),
    urgency: Int.min(0).max(3),
    expires_at: Rfc3339,
  })
  .strict();

export const PollResultSchema = z
  .object({
    cursor: z.string().max(1024).nullable(),
    facts: z.array(FactSchema).max(50),
    happenings: z.array(HappeningCandidateSchema).max(10),
  })
  .strict();

// ---------------------------------------------------------------- skills

export const DigestSchema = z
  .object({
    ok: z.boolean(),
    score: Int.min(0).max(10),
    words: Int.min(0).max(4_294_967_295),
    qa_defects: Int.min(0).max(65_535),
    artifact_sha: z.string().regex(/^[0-9a-f]{64}$/, "lower-case hex SHA-256 of canonicalJson(artifact)"),
  })
  .strict();

/** Exactly `{artifact, digest}`: any other key (a stage, an approval) is rejected (rule 3). */
export const JobResultSchema = z
  .object({
    artifact: z.object({ kind: z.string().min(1), content: z.unknown() }).strict(),
    digest: DigestSchema,
  })
  .strict();

// ---------------------------------------------------------------- sim rules

const integersOnly = (v: unknown): boolean =>
  typeof v === "number"
    ? Number.isSafeInteger(v)
    : Array.isArray(v)
      ? v.every(integersOnly)
      : v !== null && typeof v === "object"
        ? Object.values(v).every(integersOnly)
        : true;

export const ProposedCommandSchema = z
  .object({ type: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/) })
  .passthrough()
  .refine(integersOnly, "sim commands carry integers only (no floats: rule 1)");
export const ProposedCommandsSchema = z.array(ProposedCommandSchema).max(64);

// ---------------------------------------------------------------- publish targets

export const OpenDraftResultSchema = z
  .object({ ref: z.string().min(1), headSha: z.string().min(1), previewUrl: z.string().url().optional() })
  .strict();
export const MergeResultSchema = z.object({ mergedSha: z.string().min(1) }).strict();
export const StatusResultSchema = z.object({ state: z.enum(["open", "merged", "deployed", "failed"]) }).strict();

// ---------------------------------------------------------------- scenarios (`swarmpress test`)

const WebFixture = z
  .object({
    status: Int.min(100).max(599).default(200),
    headers: z.record(z.string()).default({}),
    body: z.unknown().optional(),
    /** Read the body from this file (relative to the scenario file). */
    file: RelPath.optional(),
  })
  .strict();

const HttpExchange = z
  .object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: z.string().url(),
    /** Headers the request must carry when it reaches the server (after the credential proxy). */
    expectHeaders: z.record(z.string()).default({}),
    /** Fields the JSON request body must contain (deep subset match). */
    expectBody: z.unknown().optional(),
    status: Int.min(100).max(599).default(200),
    body: z.unknown().optional(),
  })
  .strict();

const U64 = z.union([Int.min(0), z.string().regex(/^\d{1,20}$/)]);

export const ScenarioSchema = z
  .object({
    $schema: z.string().optional(),
    name: z.string().min(1),
    seed: U64.default(42),
    days: Int.min(0).max(3650).default(1),
    world: z.enum(["demo", "empty"]).default("demo"),
    expect: z
      .object({
        /** `0x` + 16 hex digits, or "replay" (run twice, hashes must match). */
        hash: z.union([z.string().regex(/^0x[0-9a-f]{16}$/), z.literal("replay")]).optional(),
        day: Int.min(0).optional(),
      })
      .strict()
      .default({}),
    content: z
      .object({
        expect: z
          .object({ personas: Int.optional(), happenings: Int.optional(), prompt_layers: Int.optional(), props: Int.optional() })
          .strict(),
      })
      .strict()
      .optional(),
    jobs: z
      .array(
        z
          .object({
            kind: z.string().min(1),
            input: z.unknown(),
            revision: Int.min(0).default(0),
            llm: z.array(z.string()).default([]),
            web: z.record(WebFixture).default({}),
            expect: z
              .object({
                digest: DigestSchema.partial().optional(),
                artifactKind: z.string().optional(),
                error: z.string().optional(),
              })
              .strict()
              .default({}),
          })
          .strict(),
      )
      .default([]),
    tools: z
      .array(
        z
          .object({
            tool: z.string().min(1),
            input: z.unknown(),
            web: z.record(WebFixture).default({}),
            expect: z.object({ output: z.unknown().optional(), error: z.string().optional() }).strict().default({}),
          })
          .strict(),
      )
      .default([]),
    rules: z
      .object({
        expect: z
          .object({
            /** The exact proposed-command log, or "replay" (run twice, logs must match). */
            commands: z.union([z.array(z.unknown()), z.literal("replay")]).optional(),
            count: Int.min(0).optional(),
          })
          .strict(),
      })
      .strict()
      .optional(),
    polls: z
      .array(
        z
          .object({
            region: z.string().min(1),
            now: Rfc3339,
            cursor: z.string().nullable().default(null),
            web: z.record(WebFixture).default({}),
            expect: z
              .object({
                facts: Int.min(0).optional(),
                happenings: Int.min(0).optional(),
                cursor: z.string().nullable().optional(),
                factKinds: z.array(z.string()).optional(),
                error: z.string().optional(),
              })
              .strict()
              .default({}),
          })
          .strict(),
      )
      .default([]),
    publish: z
      .object({
        credential: z.object({ ref: z.string().min(1), secret: z.string().min(1) }).strict(),
        draft: z
          .object({ contentId: z.string(), path: z.string(), page: z.unknown(), message: z.string() })
          .strict(),
        server: z.array(HttpExchange).min(1),
        expect: z
          .object({ state: z.enum(["open", "merged", "deployed", "failed"]).optional(), ref: z.string().optional(), error: z.string().optional() })
          .strict()
          .default({}),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Scenario = z.infer<typeof ScenarioSchema>;

/** Every exported JSON Schema: file name → zod schema. */
export const JSON_SCHEMAS = {
  "manifest.schema.json": ManifestSchema,
  "persona.schema.json": PersonaSchema,
  "happening.schema.json": HappeningSchema,
  "prompt-layer.schema.json": PromptLayerSchema,
  "prop.schema.json": PropSchema,
  "fact.schema.json": FactSchema,
  "happening-candidate.schema.json": HappeningCandidateSchema,
  "poll-result.schema.json": PollResultSchema,
  "job-result.schema.json": JobResultSchema,
  "scenario.schema.json": ScenarioSchema,
} as const;
