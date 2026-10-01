/** The `simpress` commands. Each returns an exit code; output goes through `Out`. */
import { readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  MANIFEST_FILE,
  SDK_VERSION,
  ScenarioSchema,
  canonicalJson,
  formatIssues,
  type Kind,
  type Scenario,
} from "@simpress/sdk";
import { MemoryStore, createSandbox } from "@simpress/sandbox";
import {
  PollScheduler,
  describeSkill,
  logger,
  poll,
  publishCycle,
  runJob,
  runTool,
  simulate,
  startRule,
  type CommandLogEntry,
  type RuleInstance,
  type SimulationResult,
} from "./engine.ts";
import { BUNDLE_OUT, buildBundle, diagnostics, loadExtension, packFiles, type Extension } from "./extension.ts";
import { fixtureWeb, liveWeb, subset } from "./fakes.ts";
import { exists, isDir, listFiles, readBytes, readText, sha256, writeFile } from "./host.ts";
import { gzip, tar } from "./tar.ts";
import { TEMPLATE_KINDS, template, type TemplateKind } from "./templates.ts";
import { RunnerError, loadSim } from "./wasm.ts";

export interface Out {
  log(line: string): void;
  error(line: string): void;
}

export const consoleOut: Out = { log: (l) => console.log(l), error: (l) => console.error(l) };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------- new

export async function cmdNew(kind: string, dir: string, out: Out): Promise<number> {
  if (!(TEMPLATE_KINDS as readonly string[]).includes(kind)) {
    out.error(`simpress new: unknown kind "${kind}" (one of: ${TEMPLATE_KINDS.join(", ")})`);
    return 2;
  }
  const target = resolve(dir);
  if ((await isDir(target)) && (await readdir(target)).length > 0) {
    out.error(`simpress new: ${dir} exists and is not empty`);
    return 1;
  }
  const slug = basename(target).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "my-extension";
  const files = template(kind as TemplateKind, slug);
  for (const [p, content] of Object.entries(files)) await writeFile(join(target, p), content);
  out.log(`created ${kind} ${dir}/ (${Object.keys(files).length} files): com.example.${slug}`);
  out.log(`next:  simpress check ${dir}  →  simpress run --ext ${dir}  →  simpress test ${dir}  →  simpress pack ${dir}`);
  return 0;
}

// ---------------------------------------------------------------- check

const REQUIRED_EXPORTS: Partial<Record<Kind, string[][]>> = {
  skill: [["runJob"], ["runTool"], ["describe"]],
  "sim-rule": [["onStep", "onDayStart", "onEvent"]],
  "context-provider": [["poll"]],
  "publish-target": [["openDraft"], ["merge"], ["status"]],
  panel: [["mount"]],
};

export interface CheckResult {
  ok: boolean;
  ext: Extension | null;
  bundle: string | null;
  errors: string[];
  warnings: string[];
}

/** Manifest, schemas, SDK range, capabilities; for code kinds: build, exports, determinism replay. */
export async function check(dir: string, opts: { replay?: boolean } = {}): Promise<CheckResult> {
  const diag = diagnostics();
  const ext = await loadExtension(dir, diag);
  let bundle: string | null = null;
  if (ext && diag.errors.length === 0 && ext.manifest.entry.bundle) {
    try {
      bundle = (await buildBundle(ext)).code;
    } catch (e) {
      diag.errors.push(errMsg(e));
    }
  }
  if (ext && bundle) {
    const log = logger();
    try {
      const sb = await createSandbox({
        capabilities: ext.manifest.capabilities,
        origins: ext.manifest.origins,
        deterministic: ext.manifest.kinds.includes("sim-rule") ? { seed: 0, nowMs: 0 } : undefined,
        host: { store: new MemoryStore(await packFiles(ext)), log: log.host(ext.manifest.id) },
      });
      try {
        await sb.load(bundle, `${ext.manifest.id}.js`);
        const exported = await sb.exports();
        for (const kind of ext.manifest.kinds) {
          for (const alternatives of REQUIRED_EXPORTS[kind] ?? []) {
            if (!alternatives.some((a) => exported.includes(a)))
              diag.errors.push(`bundle: kind ${kind} needs export ${alternatives.join(" | ")} (got: ${exported.join(", ") || "nothing"})`);
          }
          if (kind === "challenge") {
            const s = ext.manifest.challenge?.scoreExport ?? "score";
            if (!exported.includes(s)) diag.errors.push(`bundle: challenge needs export ${s}(worldView) → integer`);
          }
        }
      } finally {
        sb.dispose();
      }
      if (diag.errors.length === 0 && ext.manifest.kinds.includes("skill")) {
        const d = await describeSkill(ext, bundle, log.host(ext.manifest.id));
        if (Object.keys(d.jobs ?? {}).length + Object.keys(d.tools ?? {}).length === 0)
          diag.errors.push("skill: defines no jobs and no tools");
      }
      if (diag.errors.length === 0 && ext.manifest.kinds.includes("sim-rule") && opts.replay !== false) {
        const a = await runWithRules([ext], [bundle], 42n, 1);
        const b = await runWithRules([ext], [bundle], 42n, 1);
        if (canonicalJson(a.commands) !== canonicalJson(b.commands) || a.final.hash !== b.final.hash)
          diag.errors.push("determinism replay: two runs of seed 42 for 1 day proposed different commands");
      }
    } catch (e) {
      diag.errors.push(`bundle: ${errMsg(e)}`);
    }
  }
  return { ok: diag.errors.length === 0, ext, bundle, errors: diag.errors, warnings: diag.warnings };
}

function summarize(ext: Extension): string {
  const counts = new Map<string, number>();
  for (const c of ext.content) counts.set(c.section, (counts.get(c.section) ?? 0) + 1);
  const parts = [...counts].map(([k, n]) => `${n} ${k.replace("_", " ")}`);
  const m = ext.manifest;
  return `${m.id} ${m.version} [${m.kinds.join(", ")}] caps: ${m.capabilities.join(", ") || "none"}${parts.length ? `; ${parts.join(", ")}` : ""}`;
}

export async function cmdCheck(dir: string, out: Out): Promise<number> {
  const r = await check(dir);
  for (const w of r.warnings) out.log(`warning: ${w}`);
  for (const e of r.errors) out.error(`error: ${e}`);
  if (!r.ok || !r.ext) {
    out.error(`✗ ${dir}: ${r.errors.length} error(s)`);
    return 1;
  }
  out.log(`✓ ${summarize(r.ext)}`);
  const pack = r.ext.content.length ? `; pack sha256 ${r.ext.packHash}` : "";
  out.log(`  sdk ${r.ext.manifest.sdk} accepts ${SDK_VERSION}${pack}${r.bundle ? `; bundle ${r.bundle.length} bytes` : ""}`);
  return 0;
}

// ---------------------------------------------------------------- run

async function runWithRules(exts: Extension[], bundles: string[], seed: bigint, days: number, onDay?: Parameters<typeof simulate>[0]["onDay"], world?: "demo" | "empty") {
  const log = logger();
  const rules: RuleInstance[] = [];
  try {
    for (let i = 0; i < exts.length; i++) rules.push(await startRule(exts[i], bundles[i], log, seed));
    return await simulate({ seed, days, rules, onDay, world });
  } finally {
    for (const r of rules) r.sandbox.dispose();
  }
}

/** The first scenario in the extension that has the given block (demo fixtures for `run`). */
async function firstScenario(ext: Extension, key: "polls" | "publish" | "jobs"): Promise<{ file: string; sc: Scenario } | null> {
  for (const f of ext.files.filter((f) => f.endsWith(".scenario.json"))) {
    const r = ScenarioSchema.safeParse(JSON.parse(await readText(join(ext.dir, f))));
    if (r.success && (key === "publish" ? r.data.publish : (r.data[key] as unknown[]).length > 0)) return { file: join(ext.dir, f), sc: r.data };
  }
  return null;
}

export interface RunOptions {
  seed: bigint;
  days: number;
  exts: string[];
  json: boolean;
  web: "fixtures" | "live";
  world: "demo" | "empty";
}

export async function cmdRun(o: RunOptions, out: Out): Promise<number> {
  const report: Record<string, unknown> = { sdk: SDK_VERSION };
  const loaded: Array<{ ext: Extension; bundle: string | null }> = [];
  for (const d of o.exts) {
    const r = await check(d, { replay: false });
    if (!r.ok || !r.ext) {
      for (const e of r.errors) out.error(`error: ${d}: ${e}`);
      return 1;
    }
    loaded.push({ ext: r.ext, bundle: r.bundle });
  }
  const say = (l: string) => {
    if (!o.json) out.log(l);
  };
  const mod = await loadSim();
  say(`simpress run: ${mod.version()} · seed ${o.seed} · ${o.days} day(s) · world ${o.world}`);
  for (const { ext } of loaded) say(`  ext ${summarize(ext)}`);

  const ruleExts = loaded.filter((l) => l.ext.manifest.kinds.includes("sim-rule"));
  const sim: SimulationResult = await runWithRules(
    ruleExts.map((l) => l.ext),
    ruleExts.map((l) => l.bundle!),
    o.seed,
    o.days,
    (d) => say(`  day ${String(d.day).padStart(3)}  step ${String(d.step).padStart(8)}  ${String(d.minute / 60 | 0).padStart(2, "0")}:${String(d.minute % 60).padStart(2, "0")}  hash ${d.hash}  cash ${(d.cash_cents / 100).toFixed(2)}`),
    o.world,
  );
  report.sim = sim;
  say(`  start hash ${sim.start.hash} → final hash ${sim.final.hash} (step ${sim.final.step}, day ${sim.final.day})`);
  if (sim.commands.length) {
    say(`  proposed commands (logged; validate/apply needs a JSON command API in client-wasm):`);
    for (const c of sim.commands) say(`    step ${c.step} ${c.ext}.${c.hook}: ${JSON.stringify(c.command)}`);
  }

  const extReports: unknown[] = [];
  for (const { ext, bundle } of loaded) {
    const id = ext.manifest.id;
    const log = logger(o.json ? undefined : (l) => out.log(`    ${l}`));
    const er: Record<string, unknown> = { id, packHash: ext.packHash };
    if (ext.manifest.kinds.includes("content-pack")) {
      const by = (s: string) => ext.content.filter((c) => c.section === s);
      er.content = { personas: by("personas").map((c) => c.value.name), happenings: by("happenings").map((c) => c.value.id), prompt_layers: by("prompt_layers").map((c) => c.value.id) };
      say(`  ${id}: content pack ${ext.packHash.slice(0, 16)}… (not yet applied to the sim: needs the world-config hook in sim-core)`);
      for (const c of ext.content) say(`    ${c.section}: ${c.section === "personas" ? c.value.name : c.value.id} (${c.file})`);
    }
    if (ext.manifest.kinds.includes("skill") && bundle) {
      const d = await describeSkill(ext, bundle, log.host(id));
      const jobs: unknown[] = [];
      for (const [kind, j] of Object.entries<any>(d.jobs ?? {})) {
        if (!j.example) {
          say(`  ${id}: job ${kind}: no example input; skipped`);
          continue;
        }
        const fx = await firstScenario(ext, "jobs");
        const sj = fx?.sc.jobs.find((x) => x.kind === kind);
        const web = o.web === "live" ? liveWeb : fixtureWeb(sj?.web ?? {}, fx ? dirname(fx.file) : ext.dir);
        try {
          const r = await runJob(ext, bundle, { kind, input: j.example.input, revision: j.example.revision, llm: j.example.llm ?? sj?.llm ?? [] }, { web, log: log.host(id) });
          jobs.push({ kind, digest: r.result.digest, artifact: r.result.artifact, llmCalls: r.llmCalls, storeWrites: r.storeWrites });
          say(`  ${id}: job ${kind} → digest ${JSON.stringify(r.result.digest)} (FakeLlm calls ${r.llmCalls})`);
        } catch (e) {
          out.error(`error: ${id}: job ${kind}: ${errMsg(e)}`);
          return 1;
        }
      }
      er.jobs = jobs;
    }
    if (ext.manifest.kinds.includes("context-provider") && bundle) {
      const fx = await firstScenario(ext, "polls");
      const polls: unknown[] = [];
      const sched = new PollScheduler(ext.manifest.poll!.cadenceMinutes);
      for (const region of ext.manifest.poll!.regions) {
        const p = fx?.sc.polls.find((x) => x.region === region);
        const now = p?.now ?? new Date().toISOString();
        if (!sched.allow(region, Date.parse(now))) continue;
        const web = o.web === "live" ? liveWeb : fixtureWeb(p?.web ?? {}, fx ? dirname(fx.file) : ext.dir);
        try {
          const r = await poll(ext, bundle, { now, region, cursor: p?.cursor ?? null }, { web, log: log.host(id) });
          polls.push({ region, ...r });
          say(`  ${id}: poll ${region} @ ${now} (${o.web}) → ${r.facts.length} fact(s), ${r.happenings.length} happening(s), cursor ${JSON.stringify(r.cursor)}`);
          for (const f of r.facts) say(`    fact [${f.kind}] ${f.title} — ${f.summary} (until ${f.expires_at}; ${f.source_url})`);
          for (const h of r.happenings) say(`    happening (urgency ${h.urgency}) ${h.title} — ${h.hook} [${h.involves_roles.join(", ")}]`);
        } catch (e) {
          out.error(`error: ${id}: poll ${region}: ${errMsg(e)}`);
          return 1;
        }
      }
      er.polls = polls;
    }
    if (ext.manifest.kinds.includes("publish-target") && bundle) {
      const fx = await firstScenario(ext, "publish");
      if (!fx?.sc.publish) say(`  ${id}: publish target: no scenario with a recorded server; skipped`);
      else {
        try {
          const r = await publishCycle(ext, bundle, fx.sc.publish, log.host(id));
          er.publish = r;
          say(`  ${id}: openDraft → ref ${r.draft.ref} head ${r.draft.headSha}${r.draft.previewUrl ? ` preview ${r.draft.previewUrl}` : ""}`);
          say(`  ${id}: merge → ${r.merged.mergedSha}; status → ${r.status.state} (fake server, ${r.transcript.length} request(s))`);
        } catch (e) {
          out.error(`error: ${id}: publish cycle: ${errMsg(e)}`);
          return 1;
        }
      }
    }
    for (const k of ["challenge", "prop-pack", "panel"] as const)
      if (ext.manifest.kinds.includes(k)) say(`  ${id}: ${k}: manifest valid (runtime support comes after SDK v0)`);
    extReports.push(er);
  }
  report.extensions = extReports;
  if (o.json) out.log(JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  return 0;
}

// ---------------------------------------------------------------- test

export interface ScenarioOutcome {
  file: string;
  name: string;
  ok: boolean;
  failures: string[];
  ms: number;
}

const commandsView = (c: CommandLogEntry[]) => c.map((x) => ({ day: x.day, step: x.step, hook: x.hook, command: x.command }));

export async function runScenario(ext: Extension | null, bundle: string | null, file: string): Promise<ScenarioOutcome> {
  const t0 = Date.now();
  const failures: string[] = [];
  let name = basename(file);
  const fail = (m: string) => failures.push(m);
  try {
    const parsed = ScenarioSchema.safeParse(JSON.parse(await readText(file)));
    if (!parsed.success) throw new RunnerError(`invalid scenario:\n${formatIssues(parsed.error).map((l) => `  ${l}`).join("\n")}`);
    const sc = parsed.data;
    name = sc.name;
    const seed = BigInt(sc.seed);
    const base = dirname(file);
    const isRule = !!ext && !!bundle && ext.manifest.kinds.includes("sim-rule");
    const rulesOf = isRule ? [ext!] : [];
    const bundlesOf = isRule ? [bundle!] : [];
    const needSim = sc.days > 0 || sc.expect.hash !== undefined || sc.expect.day !== undefined || sc.rules;
    if (needSim) {
      const a = await runWithRules(rulesOf, bundlesOf, seed, sc.days, undefined, sc.world);
      const replay = sc.expect.hash === "replay" || sc.rules?.expect.commands === "replay";
      const b = replay ? await runWithRules(rulesOf, bundlesOf, seed, sc.days, undefined, sc.world) : null;
      if (sc.expect.hash === "replay" && canonicalJson(a.days) !== canonicalJson(b!.days))
        fail(`replay: per-day hashes differ (${a.final.hash} vs ${b!.final.hash})`);
      else if (sc.expect.hash && sc.expect.hash !== "replay" && a.final.hash !== sc.expect.hash)
        fail(`hash after ${sc.days} day(s): expected ${sc.expect.hash}, got ${a.final.hash}`);
      if (sc.expect.day !== undefined && a.final.day !== sc.expect.day) fail(`day: expected ${sc.expect.day}, got ${a.final.day}`);
      const ce = sc.rules?.expect;
      if (ce?.commands === "replay" && canonicalJson(a.commands) !== canonicalJson(b!.commands)) fail("replay: rule commands differ between two runs");
      if (Array.isArray(ce?.commands) && canonicalJson(commandsView(a.commands)) !== canonicalJson(ce!.commands))
        fail(`rule commands: expected ${JSON.stringify(ce!.commands)}, got ${JSON.stringify(commandsView(a.commands))}`);
      if (ce?.count !== undefined && a.commands.length !== ce.count) fail(`rule commands: expected ${ce.count}, got ${a.commands.length}`);
    }
    if (sc.content) {
      for (const [section, n] of Object.entries(sc.content.expect)) {
        const got = ext?.content.filter((c) => c.section === section).length ?? 0;
        if (got !== n) fail(`content: expected ${n} ${section}, got ${got}`);
      }
    }
    const log = logger();
    const id = ext?.manifest.id ?? "?";
    const needBundle = (what: string) => {
      if (!ext || !bundle) throw new RunnerError(`${what} needs an extension with a bundle`);
      return { ext, bundle };
    };
    for (const j of sc.jobs) {
      const { ext: e, bundle: bnd } = needBundle(`job ${j.kind}`);
      try {
        const r = await runJob(e, bnd, j, { web: fixtureWeb(j.web, base), log: log.host(id) });
        if (j.expect.error) fail(`job ${j.kind}: expected error ~ "${j.expect.error}", got a result`);
        if (j.expect.digest && !subset(j.expect.digest, r.result.digest))
          fail(`job ${j.kind}: digest ${JSON.stringify(r.result.digest)} does not match ${JSON.stringify(j.expect.digest)}`);
        if (j.expect.artifactKind && r.result.artifact.kind !== j.expect.artifactKind)
          fail(`job ${j.kind}: artifact.kind ${r.result.artifact.kind} != ${j.expect.artifactKind}`);
      } catch (e) {
        if (!j.expect.error || !errMsg(e).includes(j.expect.error)) fail(`job ${j.kind}: ${errMsg(e)}`);
      }
    }
    for (const t of sc.tools) {
      const { ext: e, bundle: bnd } = needBundle(`tool ${t.tool}`);
      try {
        const output = await runTool(e, bnd, t, { web: fixtureWeb(t.web, base), log: log.host(id) });
        if (t.expect.error) fail(`tool ${t.tool}: expected error ~ "${t.expect.error}"`);
        if (t.expect.output !== undefined && canonicalJson(output) !== canonicalJson(t.expect.output))
          fail(`tool ${t.tool}: output ${JSON.stringify(output)} != ${JSON.stringify(t.expect.output)}`);
      } catch (e) {
        if (!t.expect.error || !errMsg(e).includes(t.expect.error)) fail(`tool ${t.tool}: ${errMsg(e)}`);
      }
    }
    for (const p of sc.polls) {
      const { ext: e, bundle: bnd } = needBundle(`poll ${p.region}`);
      try {
        const r = await poll(e, bnd, { now: p.now, region: p.region, cursor: p.cursor }, { web: fixtureWeb(p.web, base), log: log.host(id) });
        const x = p.expect;
        if (x.error) fail(`poll ${p.region}: expected error ~ "${x.error}"`);
        if (x.facts !== undefined && r.facts.length !== x.facts) fail(`poll ${p.region}: expected ${x.facts} fact(s), got ${r.facts.length}`);
        if (x.happenings !== undefined && r.happenings.length !== x.happenings)
          fail(`poll ${p.region}: expected ${x.happenings} happening(s), got ${r.happenings.length}`);
        if (x.cursor !== undefined && r.cursor !== x.cursor) fail(`poll ${p.region}: cursor ${JSON.stringify(r.cursor)} != ${JSON.stringify(x.cursor)}`);
        if (x.factKinds && canonicalJson(r.facts.map((f) => f.kind)) !== canonicalJson(x.factKinds))
          fail(`poll ${p.region}: fact kinds ${r.facts.map((f) => f.kind).join(",")} != ${x.factKinds.join(",")}`);
      } catch (e) {
        if (!p.expect.error || !errMsg(e).includes(p.expect.error)) fail(`poll ${p.region}: ${errMsg(e)}`);
      }
    }
    if (sc.publish) {
      const { ext: e, bundle: bnd } = needBundle("publish");
      try {
        const r = await publishCycle(e, bnd, sc.publish, log.host(id));
        const x = sc.publish.expect;
        if (x.error) fail(`publish: expected error ~ "${x.error}", got state ${r.status.state}`);
        if (x.state && r.status.state !== x.state) fail(`publish: state ${r.status.state} != ${x.state}`);
        if (x.ref && r.draft.ref !== x.ref) fail(`publish: ref ${r.draft.ref} != ${x.ref}`);
      } catch (e) {
        if (!sc.publish.expect.error || !errMsg(e).includes(sc.publish.expect.error)) fail(`publish: ${errMsg(e)}`);
      }
    }
  } catch (e) {
    fail(errMsg(e));
  }
  return { file, name, ok: failures.length === 0, failures, ms: Date.now() - t0 };
}

export async function cmdTest(dir: string, out: Out): Promise<number> {
  const target = resolve(dir);
  const hasManifest = await exists(join(target, MANIFEST_FILE));
  let ext: Extension | null = null;
  let bundle: string | null = null;
  if (hasManifest) {
    const r = await check(dir, { replay: false });
    if (!r.ok) {
      for (const e of r.errors) out.error(`error: ${e}`);
      out.error(`✗ ${dir}: fix the check errors first`);
      return 1;
    }
    ext = r.ext;
    bundle = r.bundle;
  }
  const files = (await isDir(target) ? await listFiles(target) : []).filter((f) => f.endsWith(".scenario.json"));
  if (files.length === 0) {
    out.error(`✗ ${dir}: no *.scenario.json files`);
    return 1;
  }
  let failed = 0;
  for (const f of files) {
    const r = await runScenario(ext, bundle, join(target, f));
    if (r.ok) out.log(`✓ ${r.name} (${f}, ${r.ms} ms)`);
    else {
      failed++;
      out.error(`✗ ${r.name} (${f})`);
      for (const m of r.failures) out.error(`    ${m}`);
    }
  }
  out.log(`${files.length - failed}/${files.length} scenario(s) passed`);
  return failed ? 1 : 0;
}

// ---------------------------------------------------------------- build, pack

export async function cmdBuild(dir: string, out: Out): Promise<number> {
  const diag = diagnostics();
  const ext = await loadExtension(dir, diag);
  if (!ext || diag.errors.length) {
    for (const e of diag.errors) out.error(`error: ${e}`);
    return 1;
  }
  if (!ext.manifest.entry.bundle) {
    out.error(`simpress build: ${ext.manifest.id} has no entry.bundle (content packs need no build)`);
    return 1;
  }
  const b = await buildBundle(ext);
  await writeFile(join(ext.dir, BUNDLE_OUT), b.code);
  await writeFile(join(ext.dir, `${BUNDLE_OUT}.sha256`), `${b.sha256}  ext.bundle.js\n`);
  out.log(`✓ ${relative(process.cwd(), join(ext.dir, BUNDLE_OUT))}: ${b.code.length} bytes, sha256 ${b.sha256}`);
  return 0;
}

export async function cmdPack(dir: string, out: Out, outFile?: string): Promise<number> {
  const r = await check(dir);
  for (const w of r.warnings) out.log(`warning: ${w}`);
  if (!r.ok || !r.ext) {
    for (const e of r.errors) out.error(`error: ${e}`);
    out.error(`✗ ${dir}: pack refuses an extension that fails check`);
    return 1;
  }
  const ext = r.ext;
  const files: Array<{ path: string; data: Uint8Array }> = [];
  for (const f of ext.files) files.push({ path: f, data: await readBytes(join(ext.dir, f)) });
  if (r.bundle) files.push({ path: BUNDLE_OUT, data: new TextEncoder().encode(r.bundle) });
  const integrity = {
    algorithm: "sha256",
    id: ext.manifest.id,
    version: ext.manifest.version,
    sdk: ext.manifest.sdk,
    packHash: ext.packHash,
    bundle: r.bundle ? BUNDLE_OUT : null,
    files: Object.fromEntries(await Promise.all(files.map(async (f) => [f.path, await sha256(f.data)] as const))),
  };
  files.push({ path: "simpress.integrity.json", data: new TextEncoder().encode(JSON.stringify(integrity, null, 2) + "\n") });
  const archive = await gzip(tar(files));
  const dest = outFile ? resolve(outFile) : join(ext.dir, "dist", `${ext.manifest.id}-${ext.manifest.version}.simpress.tgz`);
  await writeFile(dest, archive);
  out.log(`✓ ${relative(process.cwd(), dest)}: ${files.length} files, ${archive.length} bytes, sha256 ${await sha256(archive)}`);
  return 0;
}
