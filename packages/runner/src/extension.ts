/**
 * Loading an extension folder: manifest, content documents, the pack hash,
 * capability sanity, and building the JS bundle (`Bun.build`).
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUNDLE_KINDS,
  CONTENT_SCHEMAS,
  MANIFEST_FILE,
  ManifestSchema,
  SDK_VERSION,
  canonicalJson,
  formatIssues,
  parseDocument,
  satisfies,
  sha256Hex,
  type ContentSection,
  type Manifest,
} from "@swarm-press/sdk";
import { exists, isBun, listFiles, readText, writeFile } from "./host.ts";
import { RunnerError } from "./wasm.ts";

export interface ContentDoc {
  section: ContentSection;
  file: string;
  value: any;
}

export interface Extension {
  dir: string;
  manifest: Manifest;
  content: ContentDoc[];
  /** SHA-256 over the canonical JSON of every content document (part of the world config). */
  packHash: string;
  /** Every file of the extension (relative paths), served to the sandbox as read-only `pack/…`. */
  files: string[];
}

export interface Diagnostics {
  errors: string[];
  warnings: string[];
}

export function diagnostics(): Diagnostics {
  return { errors: [], warnings: [] };
}

/** Reads and validates an extension folder. Problems go to `diag`; returns null when unusable. */
export async function loadExtension(dirArg: string, diag: Diagnostics): Promise<Extension | null> {
  const dir = resolve(dirArg);
  const mpath = join(dir, MANIFEST_FILE);
  if (!(await exists(mpath))) {
    diag.errors.push(`${dirArg}: no ${MANIFEST_FILE} (scaffold one with: swarmpress new <kind> ${dirArg})`);
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readText(mpath));
  } catch (e) {
    diag.errors.push(`${MANIFEST_FILE}: not valid JSON: ${(e as Error).message}`);
    return null;
  }
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of formatIssues(parsed.error)) diag.errors.push(`${MANIFEST_FILE}: ${i}`);
    return null;
  }
  const manifest = parsed.data;
  if (!satisfies(SDK_VERSION, manifest.sdk)) {
    diag.errors.push(
      `${MANIFEST_FILE}: sdk range "${manifest.sdk}" does not accept this runner's SDK ${SDK_VERSION} (the runner refuses mismatched ranges)`,
    );
  }

  const content: ContentDoc[] = [];
  const hashes: string[] = [];
  const sections = manifest.entry.content ?? {};
  for (const section of Object.keys(CONTENT_SCHEMAS) as ContentSection[]) {
    for (const file of sections[section] ?? []) {
      const p = join(dir, file);
      if (!(await exists(p))) {
        diag.errors.push(`entry.content.${section}: ${file} does not exist`);
        continue;
      }
      if (!/\.(json|toml)$/.test(file)) {
        diag.errors.push(`${file}: content documents are .json or .toml`);
        continue;
      }
      const r = parseDocument<any>(CONTENT_SCHEMAS[section], await readText(p), file);
      if (!r.ok) {
        for (const e of r.errors) diag.errors.push(`${file}: ${e}`);
        continue;
      }
      content.push({ section, file, value: r.value });
      hashes.push(`${section}/${file}:${sha256Hex(canonicalJson(r.value))}`);
    }
  }
  checkContent(content, diag);
  const files = await listFiles(dir);
  if (manifest.kinds.includes("prop-pack")) {
    for (const d of content.filter((c) => c.section === "props")) {
      for (const asset of [d.value.gltf, ...(d.value.textures ?? [])] as string[]) {
        if (!files.includes(asset)) diag.errors.push(`${d.file}: asset ${asset} is not in the extension folder`);
      }
    }
  }
  checkCapabilities(manifest, diag);
  if (manifest.entry.bundle && !files.includes(manifest.entry.bundle))
    diag.errors.push(`entry.bundle: ${manifest.entry.bundle} does not exist`);
  if ("authoredBy" in (manifest.provenance ?? {}))
    diag.warnings.push("provenance: staff-authored; installing needs the CEO's approval ticket (ADR-0043, default: reject)");

  return { dir, manifest, content, packHash: sha256Hex(hashes.sort().join("\n")), files };
}

function checkContent(content: ContentDoc[], diag: Diagnostics): void {
  const seen = new Map<string, string>();
  for (const d of content) {
    const key = d.section === "personas" ? `persona:${d.value.name}` : `${d.section}:${d.value.id}`;
    const prev = seen.get(key);
    if (prev) diag.errors.push(`${d.file}: duplicate ${key} (also in ${prev})`);
    else seen.set(key, d.file);
  }
  const personas = new Set(content.filter((d) => d.section === "personas").map((d) => d.value.name as string));
  for (const d of content.filter((c) => c.section === "happenings")) {
    const selectors: string[] = [];
    for (const p of d.value.primitives as any[]) {
      if (p.people) selectors.push(...p.people);
      if (p.person) selectors.push(p.person);
      if (p.pairs) for (const pair of p.pairs) selectors.push(...pair);
    }
    for (const s of selectors) {
      if (s.startsWith("persona:") && !personas.has(s.slice(8)))
        diag.warnings.push(`${d.file}: ${s} is not a persona in this pack; the happening is skipped when nobody matches`);
    }
  }
}

function checkCapabilities(m: Manifest, diag: Diagnostics): void {
  const caps = new Set(m.capabilities);
  const code = m.kinds.some((k) => BUNDLE_KINDS.includes(k));
  if (!code && caps.size > 0)
    diag.warnings.push(`capabilities ${[...caps].join(", ")} are requested but kinds ${m.kinds.join(", ")} run no code`);
  if (caps.has("credits") && !caps.has("web") && !caps.has("llm:agency"))
    diag.warnings.push("credits is requested but nothing here spends credits (web or llm:agency)");
  if (caps.has("ui") && !m.kinds.includes("panel")) diag.warnings.push("ui is requested but there is no panel");
  if (caps.has("web") && !m.origins && !m.kinds.includes("context-provider"))
    diag.warnings.push("web without origins[]: consider declaring origins so players see where it connects");
}

// ---------------------------------------------------------------- bundling

export const BUNDLE_OUT = "dist/ext.bundle.js";

const sdkRuntime = fileURLToPath(new URL("../../sdk/src/runtime.ts", import.meta.url));

/**
 * Bundles `entry.bundle` into one IIFE script that assigns `globalThis.ext`
 * (no externals). `@swarm-press/sdk` and `@swarm-press/sdk/runtime` always resolve
 * to this runner's SDK runtime, so scaffolds outside the monorepo build too.
 */
export async function buildBundle(ext: Extension): Promise<{ code: string; sha256: string }> {
  const entry = ext.manifest.entry.bundle;
  if (!entry) throw new RunnerError(`${ext.manifest.id}: no entry.bundle to build`);
  if (!isBun) {
    const prebuilt = join(ext.dir, BUNDLE_OUT);
    if (await exists(prebuilt)) {
      const code = await readText(prebuilt);
      return { code, sha256: sha256Hex(code) };
    }
    throw new RunnerError(
      `building ${ext.manifest.id} needs Bun (Bun.build). Run "bun packages/runner/src/cli.ts build ${ext.dir}" once, then Node can reuse ${BUNDLE_OUT}`,
    );
  }
  const BunApi = (globalThis as any).Bun;
  const tmp = join(ext.dir, ".swarmpress-build");
  const wrapper = join(tmp, "entry.js");
  await writeFile(
    wrapper,
    `import * as m from ${JSON.stringify(join(ext.dir, entry))};\nglobalThis.ext = m.default ?? m;\n`,
  );
  try {
    const result = await BunApi.build({
      entrypoints: [wrapper],
      format: "iife",
      target: "browser",
      minify: false,
      sourcemap: "none",
      plugins: [
        {
          name: "swarmpress-sdk",
          setup(b: any) {
            b.onResolve({ filter: /^@swarmpress\/sdk(\/runtime)?$/ }, () => ({ path: sdkRuntime }));
          },
        },
      ],
    });
    if (!result.success) {
      throw new RunnerError(`bundling ${entry} failed:\n${result.logs.map((l: unknown) => `  ${String(l)}`).join("\n")}`);
    }
    const code: string = await result.outputs[0].text();
    return { code, sha256: sha256Hex(code) };
  } finally {
    const { rm } = await import("node:fs/promises");
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Pack files exposed read-only to the sandbox as `pack/<path>` (text files ≤ 256 KiB). */
export async function packFiles(ext: Extension): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of ext.files) {
    if (!/\.(json|toml|txt|md|html|csv|xml)$/.test(f)) continue;
    const text = await readText(join(ext.dir, f));
    if (text.length <= 256 * 1024) out[`pack/${f}`] = text;
  }
  return out;
}
