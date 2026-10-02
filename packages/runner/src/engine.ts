/**
 * The headless host: the wasm sim plus extensions, which run ONLY inside
 * `@simpress/sandbox` (the same QuickJS sandbox the browser uses).
 */
import {
  JobResultSchema,
  MergeResultSchema,
  OpenDraftResultSchema,
  PollResultSchema,
  ProposedCommandsSchema,
  StatusResultSchema,
  artifactSha,
  formatIssues,
  type JobResult,
  type PollResult,
  type ProposedCommand,
} from "@simpress/sdk";
import { MemoryStore, createSandbox, type HostLlm, type HostLog, type HostWeb, type Sandbox } from "@simpress/sandbox";
import { packFiles, type Extension } from "./extension.ts";
import { FakeHttpServer, FakeLlm, type CredentialSpec, type HttpExchange } from "./fakes.ts";
import { RunnerError, hex, loadSim, simNowMs, worldView, type WasmSim } from "./wasm.ts";

export interface DayRecord {
  day: number;
  step: number;
  minute: number;
  hash: string;
  cash_cents: number;
}

export interface CommandLogEntry {
  step: number;
  day: number;
  ext: string;
  hook: string;
  command: ProposedCommand;
  /** v0: the wasm `Sim` has no JSON command entry point yet, so rule output is logged, not applied. */
  status: "proposed";
}

export interface SimulationResult {
  seed: string;
  world: "demo" | "empty";
  stepsPerDay: number;
  start: { step: number; hash: string };
  days: DayRecord[];
  final: DayRecord;
  commands: CommandLogEntry[];
  version: string;
}

export interface Logger {
  lines: string[];
  host(ext: string): HostLog;
}

export function logger(echo?: (line: string) => void): Logger {
  const lines: string[] = [];
  return {
    lines,
    host: (ext) => (level, message) => {
      const line = `[${ext}] ${level}: ${message}`;
      lines.push(line);
      echo?.(line);
    },
  };
}

type Schema = { safeParse(v: unknown): { success: true; data: unknown } | { success: false; error: any } };

function validate<T>(schema: Schema, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new RunnerError(`${what} is invalid:\n${formatIssues(r.error).map((l) => `  ${l}`).join("\n")}`);
  return r.data as T;
}

// ---------------------------------------------------------------- sim rules

export interface RuleInstance {
  ext: Extension;
  sandbox: Sandbox;
  exports: string[];
  interval: number;
}

export async function startRule(ext: Extension, bundle: string, log: Logger, seed: bigint): Promise<RuleInstance> {
  const sandbox = await createSandbox({
    capabilities: ext.manifest.capabilities,
    deterministic: { seed: `${seed}:${ext.manifest.id}`, nowMs: 0 },
    host: { store: new MemoryStore(await packFiles(ext)), log: log.host(ext.manifest.id) },
  });
  await sandbox.load(bundle, `${ext.manifest.id}.js`);
  const exports = await sandbox.exports();
  if (!["onStep", "onDayStart", "onEvent"].some((h) => exports.includes(h)))
    throw new RunnerError(`${ext.manifest.id}: a sim-rule bundle must export onStep, onDayStart or onEvent (did you use defineRule?)`);
  return { ext, sandbox, exports, interval: ext.manifest.rule?.stepInterval ?? 500 };
}

async function callHook(rule: RuleInstance, hook: string, sim: WasmSim, seed: bigint, out: CommandLogEntry[]): Promise<void> {
  if (!rule.exports.includes(hook)) return;
  const step = Number(sim.step());
  const result = await rule.sandbox.call(hook, worldView(sim, seed), {
    seed: `${seed}:${rule.ext.manifest.id}:${step}:${hook}`,
    nowMs: simNowMs(sim),
  });
  const cmds = validate<ProposedCommand[]>(ProposedCommandsSchema, result ?? [], `${rule.ext.manifest.id} ${hook}() at step ${step}`);
  for (const command of cmds) out.push({ step, day: sim.day(), ext: rule.ext.manifest.id, hook, command, status: "proposed" });
}

/** Runs the sim for `days` game days, calling rule hooks at step boundaries. */
export async function simulate(opts: {
  seed: bigint;
  days: number;
  world?: "demo" | "empty";
  rules?: RuleInstance[];
  onDay?: (d: DayRecord) => void;
}): Promise<SimulationResult> {
  const mod = await loadSim();
  const world = opts.world ?? "demo";
  const sim = world === "demo" ? mod.demo(opts.seed) : mod.empty(opts.seed);
  const rules = opts.rules ?? [];
  const commands: CommandLogEntry[] = [];
  try {
    const spd = Number(sim.steps_per_day());
    const rec = (): DayRecord => ({
      day: sim.day(),
      step: Number(sim.step()),
      minute: sim.minute_of_day(),
      hash: hex(sim.hash()),
      cash_cents: Number(sim.cash_cents()),
    });
    const start = { step: Number(sim.step()), hash: hex(sim.hash()) };
    const days: DayRecord[] = [];
    const stepping = rules.filter((r) => r.exports.includes("onStep"));
    const chunk = stepping.length ? Math.min(spd, ...stepping.map((r) => r.interval)) : spd;
    for (let d = 0; d < opts.days; d++) {
      for (const r of rules) await callHook(r, "onDayStart", sim, opts.seed, commands);
      let left = spd;
      while (left > 0) {
        const n = Math.min(chunk, left);
        sim.advance(n);
        left -= n;
        const step = Number(sim.step());
        for (const r of stepping) if (step % r.interval === 0) await callHook(r, "onStep", sim, opts.seed, commands);
      }
      const r = rec();
      days.push(r);
      opts.onDay?.(r);
    }
    const final = rec();
    return { seed: opts.seed.toString(), world, stepsPerDay: spd, start, days, final, commands, version: mod.version() };
  } finally {
    sim.free();
  }
}

// ---------------------------------------------------------------- skills

export interface JobRun {
  result: JobResult;
  llmCalls: number;
  storeWrites: string[];
}

async function skillSandbox(ext: Extension, bundle: string, host: { web?: HostWeb; llm?: HostLlm; log: HostLog }) {
  const store = new MemoryStore(await packFiles(ext));
  const before = new Set(store.files.keys());
  const sandbox = await createSandbox({
    capabilities: ext.manifest.capabilities,
    origins: ext.manifest.origins,
    host: { store, web: host.web, llm: host.llm, log: host.log },
  });
  await sandbox.load(bundle, `${ext.manifest.id}.js`);
  return { sandbox, store, before };
}

export async function runJob(
  ext: Extension,
  bundle: string,
  job: { kind: string; input?: unknown; revision?: number; llm?: string[] },
  host: { web?: HostWeb; log: HostLog },
): Promise<JobRun> {
  const llm = new FakeLlm(job.llm ?? []);
  const { sandbox, store, before } = await skillSandbox(ext, bundle, { web: host.web, llm: llm.host, log: host.log });
  try {
    const raw = await sandbox.call("runJob", {
      job: { job_id: `job-${job.kind}-1`, kind: job.kind, revision: job.revision ?? 0, input: job.input },
    });
    const result = validate<JobResult>(JobResultSchema, raw, `${ext.manifest.id} job ${job.kind} result (only {artifact, digest}; never a transition)`);
    const sha = artifactSha(result.artifact);
    if (result.digest.artifact_sha !== sha)
      throw new RunnerError(`${ext.manifest.id} job ${job.kind}: digest.artifact_sha ${result.digest.artifact_sha} != sha256(canonicalJson(artifact)) ${sha}`);
    return { result, llmCalls: llm.calls.length, storeWrites: [...store.files.keys()].filter((k) => !before.has(k)).sort() };
  } finally {
    sandbox.dispose();
  }
}

export async function runTool(
  ext: Extension,
  bundle: string,
  tool: { tool: string; input?: unknown },
  host: { web?: HostWeb; log: HostLog },
): Promise<unknown> {
  const { sandbox } = await skillSandbox(ext, bundle, { web: host.web, log: host.log });
  try {
    return await sandbox.call("runTool", tool);
  } finally {
    sandbox.dispose();
  }
}

export async function describeSkill(ext: Extension, bundle: string, log: HostLog): Promise<any> {
  const { sandbox } = await skillSandbox(ext, bundle, { log });
  try {
    return await sandbox.call("describe");
  } finally {
    sandbox.dispose();
  }
}

// ---------------------------------------------------------------- context providers

/** Enforces the manifest's polling cadence (ADR-0043). */
export class PollScheduler {
  private last = new Map<string, number>();
  private readonly cadenceMinutes: number;
  constructor(cadenceMinutes: number) {
    this.cadenceMinutes = cadenceMinutes;
  }
  allow(region: string, nowMs: number): boolean {
    const prev = this.last.get(region);
    if (prev !== undefined && nowMs - prev < this.cadenceMinutes * 60_000) return false;
    this.last.set(region, nowMs);
    return true;
  }
}

export async function poll(
  ext: Extension,
  bundle: string,
  input: { now: string; region: string; cursor: string | null },
  host: { web: HostWeb; log: HostLog },
): Promise<PollResult> {
  const regions = ext.manifest.poll?.regions ?? [];
  if (!regions.includes(input.region)) throw new RunnerError(`${ext.manifest.id}: region ${input.region} is not in poll.regions (${regions.join(", ")})`);
  const sandbox = await createSandbox({
    capabilities: ext.manifest.capabilities,
    origins: ext.manifest.origins,
    host: { store: new MemoryStore(await packFiles(ext)), web: host.web, log: host.log },
  });
  try {
    await sandbox.load(bundle, `${ext.manifest.id}.js`);
    const raw = await sandbox.call("poll", input);
    const res = validate<PollResult>(PollResultSchema, raw, `${ext.manifest.id} poll() result`);
    for (const f of res.facts)
      if (f.region !== input.region) throw new RunnerError(`${ext.manifest.id}: fact "${f.title}" is for region ${f.region}, polled ${input.region}`);
    return res;
  } finally {
    sandbox.dispose();
  }
}

// ---------------------------------------------------------------- publish targets

export interface PublishRun {
  draft: { ref: string; headSha: string; previewUrl?: string };
  merged: { mergedSha: string };
  status: { state: string };
  transcript: Array<{ method: string; url: string; status: number }>;
}

/** Drives openDraft → merge → status against a recorded fake server behind the credential proxy. */
export async function publishCycle(
  ext: Extension,
  bundle: string,
  spec: {
    credential: { ref: string; secret: string };
    draft: { contentId: string; path: string; page?: unknown; message: string };
    server: HttpExchange[];
  },
  log: HostLog,
): Promise<PublishRun> {
  const cred = ext.manifest.credential as CredentialSpec | undefined;
  if (!cred) throw new RunnerError(`${ext.manifest.id}: no credential in the manifest`);
  const server = new FakeHttpServer(spec.server, cred, { [spec.credential.ref]: spec.credential.secret });
  const sandbox = await createSandbox({
    capabilities: ext.manifest.capabilities,
    origins: ext.manifest.origins,
    host: { store: new MemoryStore(await packFiles(ext)), web: server.host, log },
  });
  const context = { credentialRef: spec.credential.ref };
  try {
    await sandbox.load(bundle, `${ext.manifest.id}.js`);
    const draft = validate<PublishRun["draft"]>(OpenDraftResultSchema, await sandbox.call("openDraft", { input: spec.draft, context }), "openDraft() result");
    const merged = validate<PublishRun["merged"]>(
      MergeResultSchema,
      await sandbox.call("merge", { input: { ref: draft.ref, headSha: draft.headSha }, context }),
      "merge() result",
    );
    const status = validate<PublishRun["status"]>(StatusResultSchema, await sandbox.call("status", { input: { ref: draft.ref }, context }), "status() result");
    const unused = server.unused();
    if (unused.length) throw new RunnerError(`fake server: ${unused.length} recorded exchange(s) never requested: ${unused.map((x) => `${x.method} ${x.url}`).join(", ")}`);
    return { draft, merged, status, transcript: server.transcript };
  } finally {
    sandbox.dispose();
  }
}
