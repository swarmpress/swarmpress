/**
 * The part of the SDK that extension bundles import (`@swarm-press/sdk/runtime`).
 *
 * Everything here runs INSIDE the QuickJS sandbox (ADR-0042), so it must not
 * depend on anything the sandbox does not grant: no `TextEncoder`, no
 * `crypto`, no Node or Bun modules, no zod. The only ambient APIs it touches
 * are the sandbox globals `Bun.file`, `Bun.write`, `fetch`, `console` and
 * `swarmpress.llm`, and only when a handler actually calls a facade.
 */

// ---------------------------------------------------------------- shared shapes

/** Language code → text. `en` is required (CLAUDE.md rule 12). */
export interface LocalizedString {
  en: string;
  [lang: string]: string;
}

/**
 * The digest of a finished job: the only part of a skill's work that enters
 * the sim (`Cmd::JobCompleted{digest}`, rule 2). Mirrors `sim_core::JobDigest`.
 */
export interface JobDigest {
  ok: boolean;
  /** Editor-style score 0..=10 (integer). */
  score: number;
  /** Word count of the artifact (integer ≥ 0). */
  words: number;
  /** QA defects found (integer ≥ 0). */
  qa_defects: number;
  /** Lower-case hex SHA-256 of `canonicalJson(artifact)` (64 chars). The sim keeps the first 16 bytes. */
  artifact_sha: string;
}

/** What a job produces. The host validates it; it never changes a stage. */
export interface Artifact {
  /** e.g. `"fact-check-report"`, `"page"`. */
  kind: string;
  /** JSON content. Pages are JSON blocks with `LocalizedString`s, never Markdown. */
  content: unknown;
}

/** A job handler's return value. Exactly these two keys: never a transition (rule 3). */
export interface JobResult {
  artifact: Artifact;
  digest: JobDigest;
}

/** The job request a handler receives (from the orchestrator's `Effect::RequestJob`). */
export interface JobRequest {
  job_id: string;
  kind: string;
  revision: number;
  input: unknown;
}

// ---------------------------------------------------------------- facades

export interface StoreTable {
  get<T = unknown>(key: string): Promise<T | null>;
  put(key: string, value: unknown): Promise<void>;
}

/** Capability-gated store: `store.table("notes")` needs `store:notes`. */
export interface StoreFacade {
  table(name: string): StoreTable;
}

export interface LlmRequest {
  /** Model tier; needs the `llm:<tier>` capability. */
  tier: "low" | "mid" | "high" | "agency";
  system?: string;
  prompt: string;
  max_tokens?: number;
}

export interface LlmResponse {
  text: string;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
}

export interface LlmFacade {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export interface WebResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null; has(name: string): boolean };
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export interface WebRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** `fetch`, granted only with the `web` capability (and only to declared origins). */
export interface WebFacade {
  fetch(url: string, init?: WebRequestInit): Promise<WebResponse>;
}

export interface Log {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * `code` (ADR-0076): runs a program in a fresh sandbox without capabilities
 * and returns its `ext.run(arg)` result. Pure computation: the program reaches
 * nothing but `arg`.
 */
export interface CodeFacade {
  run(program: string, arg: unknown): Promise<unknown>;
}

/** What every handler gets. Facades throw `CapabilityError` when not granted. */
export interface HostContext {
  store: StoreFacade;
  llm: LlmFacade;
  web: WebFacade;
  code: CodeFacade;
  log: Log;
}

export interface JobContext extends HostContext {
  job: JobRequest;
}

// ---------------------------------------------------------------- skill

export interface ToolDef<I = any, O = any> {
  description: string;
  /** JSON Schema of the tool input (shown to the model). */
  input: Record<string, unknown>;
  run(input: I, ctx: HostContext): Promise<O> | O;
}

export interface JobDef {
  description: string;
  handler(ctx: JobContext): Promise<JobResult> | JobResult;
  /** Demo input (and scripted FakeLlm replies) the runner uses for `swarmpress run`. */
  example?: { input: unknown; revision?: number; llm?: string[] };
}

export interface SkillDef {
  tools?: Record<string, ToolDef>;
  jobs?: Record<string, JobDef>;
}

/** The bundle's `globalThis.ext` for a skill. The host calls `runJob`/`runTool`. */
export interface SkillExport extends SkillDef {
  kind: "skill";
  describe(): { tools: Record<string, { description: string; input: unknown }>; jobs: Record<string, { description: string; example?: unknown }> };
  runJob(arg: { job: JobRequest }): Promise<JobResult>;
  runTool(arg: { tool: string; input: unknown }): Promise<unknown>;
}

// ---------------------------------------------------------------- sim rule

/**
 * Read-only world view handed to sim-rule hooks and challenge scores (JSON;
 * integers and strings only, never floats). Built from the sim's render state.
 */
export interface WorldView {
  /** World seed (u64, decimal string). */
  seed: string;
  step: number;
  day: number;
  minute: number;
  cash_cents: number;
  rooms: Array<{ id: string; kind: string; light: string; occupancy: number; capacity: number }>;
  devices: Array<{ id: string; kind: string; state: string; room: string }>;
  /** `fatigue`/`morale` in permille. */
  staff: Array<{ id: string; name: string; role: string; activity: string; fatigue: number; morale: number }>;
}

/**
 * A command a rule proposes. The host validates it (`validate_command`) and
 * appends accepted ones to the command log; replay re-applies the log and
 * never re-runs the JS.
 */
export interface ProposedCommand {
  type: string;
  [field: string]: unknown;
}

export interface RuleDef {
  onStep?(view: WorldView): ProposedCommand[] | void;
  onDayStart?(view: WorldView): ProposedCommand[] | void;
  onEvent?(arg: { view: WorldView; event: { kind: string; [k: string]: unknown } }): ProposedCommand[] | void;
}

export interface RuleExport extends RuleDef {
  kind: "sim-rule";
}

// ---------------------------------------------------------------- context provider (ADR-0043)

export type FactKind = "weather" | "transport" | "event" | "closure" | "news";

export interface Fact {
  kind: FactKind;
  title: string;
  summary: string;
  source_url: string;
  region: string;
  /** RFC 3339 timestamp. */
  valid_from: string;
  /** RFC 3339 timestamp. */
  expires_at: string;
}

export interface HappeningCandidate {
  title: string;
  hook: string;
  involves_roles: string[];
  /** 0 (whenever) … 3 (today). */
  urgency: 0 | 1 | 2 | 3;
  expires_at: string;
}

export interface PollInput {
  /** RFC 3339 timestamp of the poll (the host's clock). */
  now: string;
  region: string;
  cursor: string | null;
}

export interface PollResult {
  cursor: string | null;
  facts: Fact[];
  happenings: HappeningCandidate[];
}

export interface ContextProviderDef {
  poll(input: PollInput, ctx: HostContext): Promise<PollResult> | PollResult;
}

export interface ContextProviderExport {
  kind: "context-provider";
  poll(arg: PollInput): Promise<PollResult>;
}

// ---------------------------------------------------------------- publish target (ADR-0043)

export interface OpenDraftInput {
  contentId: string;
  path: string;
  /** Page JSON (blocks). */
  page: unknown;
  message: string;
}
export interface OpenDraftResult {
  ref: string;
  headSha: string;
  previewUrl?: string;
}
export interface MergeInput {
  ref: string;
  headSha: string;
}
export interface MergeResult {
  mergedSha: string;
}
export interface StatusInput {
  ref: string;
}
export interface StatusResult {
  state: "open" | "merged" | "deployed" | "failed";
}

/**
 * Publish-target context. `credentialRef` is opaque: send it as the
 * `X-SwarmPress-Credential` header and the host's credential proxy swaps it for
 * the real secret outside the sandbox.
 */
export interface PublishContext extends HostContext {
  credentialRef: string;
}

export interface PublishTargetDef {
  openDraft(input: OpenDraftInput, ctx: PublishContext): Promise<OpenDraftResult>;
  merge(input: MergeInput, ctx: PublishContext): Promise<MergeResult>;
  status(input: StatusInput, ctx: PublishContext): Promise<StatusResult>;
}

export interface PublishTargetExport {
  kind: "publish-target";
  openDraft(arg: { input: OpenDraftInput; context: { credentialRef: string } }): Promise<OpenDraftResult>;
  merge(arg: { input: MergeInput; context: { credentialRef: string } }): Promise<MergeResult>;
  status(arg: { input: StatusInput; context: { credentialRef: string } }): Promise<StatusResult>;
}

/** Header that carries the opaque credential reference to the host. */
export const CREDENTIAL_HEADER = "X-SwarmPress-Credential";

// ---------------------------------------------------------------- panel, challenge (types only in v0)

export interface PanelDef {
  /** Called in the panel iframe with read-only views; returns nothing. */
  mount(arg: { view: WorldView }): void;
}

export interface ChallengeDef {
  /** Deterministic score over the final world view (integer). */
  score(view: WorldView): number;
}

// ---------------------------------------------------------------- facades over sandbox globals

declare const Bun: {
  file(path: string): { text(): Promise<string>; json(): Promise<any>; exists(): Promise<boolean> };
  write(path: string, data: string): Promise<number>;
};
declare const swarmpress:
  | { llm?: { complete(req: LlmRequest): Promise<LlmResponse> }; code?: { run(program: string, arg: unknown): Promise<unknown> } }
  | undefined;

class CapabilityMissing extends Error {
  constructor(what: string) {
    super(`capability not granted: ${what}`);
    this.name = "CapabilityError";
  }
}

const g: any = globalThis as any;

function storeFacade(): StoreFacade {
  return {
    table(name: string): StoreTable {
      const path = (key: string) => `store/${name}/${key}.json`;
      return {
        async get(key) {
          const f = Bun.file(path(key));
          return (await f.exists()) ? await f.json() : null;
        },
        async put(key, value) {
          await Bun.write(path(key), JSON.stringify(value));
        },
      };
    },
  };
}

function webFacade(credentialRef?: string): WebFacade {
  return {
    async fetch(url, init) {
      if (typeof g.fetch !== "function") throw new CapabilityMissing("web");
      const headers: Record<string, string> = { ...(init?.headers ?? {}) };
      if (credentialRef) headers[CREDENTIAL_HEADER] = credentialRef;
      return g.fetch(url, { ...init, headers });
    },
  };
}

function llmFacade(): LlmFacade {
  return {
    async complete(req) {
      if (typeof swarmpress === "undefined" || !swarmpress?.llm) throw new CapabilityMissing(`llm:${req.tier}`);
      return swarmpress.llm.complete(req);
    },
  };
}

function codeFacade(): CodeFacade {
  return {
    async run(program, arg) {
      if (typeof swarmpress === "undefined" || !swarmpress?.code) throw new CapabilityMissing("code");
      return swarmpress.code.run(program, arg);
    },
  };
}

const log: Log = {
  info: (...a) => console.log(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

/** Builds the host context from the sandbox globals. */
export function hostContext(): HostContext {
  return { store: storeFacade(), llm: llmFacade(), web: webFacade(), code: codeFacade(), log };
}

// ---------------------------------------------------------------- define* helpers

/** Identity helper for typing a manifest object in TS (the file on disk is `swarmpress.ext.json`). */
export function defineExtension<T>(manifest: T): T {
  return manifest;
}

/** An agent skill: tools for the model, jobs for the orchestrator. */
export function defineSkill(def: SkillDef): SkillExport {
  const tools = def.tools ?? {};
  const jobs = def.jobs ?? {};
  return {
    kind: "skill",
    tools,
    jobs,
    describe() {
      const t: Record<string, { description: string; input: unknown }> = {};
      for (const k of Object.keys(tools).sort()) t[k] = { description: tools[k].description, input: tools[k].input };
      const j: Record<string, { description: string; example?: unknown }> = {};
      for (const k of Object.keys(jobs).sort()) j[k] = { description: jobs[k].description, example: jobs[k].example };
      return { tools: t, jobs: j };
    },
    async runJob({ job }) {
      const def = jobs[job.kind];
      if (!def) throw new Error(`no job handler for kind ${JSON.stringify(job.kind)}`);
      return await def.handler({ ...hostContext(), job });
    },
    async runTool({ tool, input }) {
      const def = tools[tool];
      if (!def) throw new Error(`no tool ${JSON.stringify(tool)}`);
      return await def.run(input, hostContext());
    },
  };
}

/** A sim rule: deterministic hooks that propose commands. */
export function defineRule(def: RuleDef): RuleExport {
  return { kind: "sim-rule", ...def };
}

/** A context provider (ADR-0043): real-world feed → facts and happening candidates. */
export function defineContextProvider(def: ContextProviderDef): ContextProviderExport {
  return {
    kind: "context-provider",
    poll: async (arg) => await def.poll(arg, hostContext()),
  };
}

/** A publish target (ADR-0043): a gateway adapter for a non-GitHub CMS. */
export function definePublishTarget(def: PublishTargetDef): PublishTargetExport {
  const ctx = (c: { credentialRef: string }): PublishContext => ({
    ...hostContext(),
    web: webFacade(c.credentialRef),
    credentialRef: c.credentialRef,
  });
  return {
    kind: "publish-target",
    openDraft: async ({ input, context }) => await def.openDraft(input, ctx(context)),
    merge: async ({ input, context }) => await def.merge(input, ctx(context)),
    status: async ({ input, context }) => await def.status(input, ctx(context)),
  };
}

/** Content packs are data; this types a pack assembled in code (tests, generators). */
export interface ContentPack {
  personas?: unknown[];
  happenings?: unknown[];
  prompt_layers?: unknown[];
  props?: unknown[];
}
export function defineContentPack<T extends ContentPack>(pack: T): T {
  return pack;
}

// ---------------------------------------------------------------- digest helpers

/** JSON with object keys sorted (stable input for hashing). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

function utf8(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
];

/** SHA-256 of bytes (pure JS, so it also runs inside the sandbox). */
export function sha256HexBytes(bytes: ArrayLike<number>): string {
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total);
  for (let i = 0; i < len; i++) m[i] = bytes[i];
  m[len] = 0x80;
  const bits = len * 8;
  const hi = Math.floor(bits / 0x100000000);
  const lo = bits >>> 0;
  m[total - 8] = hi >>> 24;
  m[total - 7] = (hi >>> 16) & 255;
  m[total - 6] = (hi >>> 8) & 255;
  m[total - 5] = hi & 255;
  m[total - 4] = lo >>> 24;
  m[total - 3] = (lo >>> 16) & 255;
  m[total - 2] = (lo >>> 8) & 255;
  m[total - 1] = lo & 255;
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((m[j] << 24) | (m[j + 1] << 16) | (m[j + 2] << 8) | m[j + 3]) | 0;
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g2, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g2);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g2;
      g2 = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g2) | 0;
    h[7] = (h[7] + hh) | 0;
  }
  return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

/** SHA-256 of a string's UTF-8 bytes, lower-case hex. */
export function sha256Hex(text: string): string {
  return sha256HexBytes(utf8(text));
}

/** The digest hash of an artifact: `sha256(canonicalJson(artifact))`. */
export function artifactSha(artifact: Artifact): string {
  return sha256Hex(canonicalJson(artifact));
}

/** Whitespace-separated word count over every string in a JSON value. */
export function countWords(value: unknown): number {
  if (typeof value === "string") {
    const t = value.trim();
    return t === "" ? 0 : t.split(/\s+/).length;
  }
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + countWords(v), 0);
  if (value && typeof value === "object") {
    return Object.keys(value as object)
      .sort()
      .reduce((n, k) => n + countWords((value as Record<string, unknown>)[k]), 0);
  }
  return 0;
}

/** Builds a `JobResult` with `words` and `artifact_sha` computed from the artifact. */
export function jobResult(artifact: Artifact, d: { ok: boolean; score: number; qa_defects?: number; words?: number }): JobResult {
  return {
    artifact,
    digest: {
      ok: d.ok,
      score: d.score,
      words: d.words ?? countWords(artifact.content),
      qa_defects: d.qa_defects ?? 0,
      artifact_sha: artifactSha(artifact),
    },
  };
}
