/**
 * Loads the unmodified wasm-bindgen `web` build of `crates/client-wasm`
 * (`cargo xtask wasm`) — the same module the browser runs.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PROTO_VERSION } from "@simpress/sdk";
import type { WorldView } from "@simpress/sdk/runtime";
import { exists, readBytes } from "./host.ts";

/** The subset of the wasm `Sim` the runner uses (see `crates/client-wasm/pkg/client_wasm.d.ts`). */
export interface WasmSim {
  hash(): bigint;
  step(): bigint;
  day(): number;
  minute_of_day(): number;
  steps_per_day(): bigint;
  cash_cents(): bigint;
  advance(steps: number): void;
  render_state_json(): string;
  free(): void;
}

export interface SimModule {
  version(): string;
  demo(seed: bigint): WasmSim;
  empty(seed: bigint): WasmSim;
  pkgDir: string;
}

export class RunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerError";
  }
}

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..", "..", "..");

/** `$SIMPRESS_WASM_PKG`, else `<repo>/crates/client-wasm/pkg`. */
export function pkgDir(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SIMPRESS_WASM_PKG;
  return env ? resolve(env) : join(REPO_ROOT, "crates", "client-wasm", "pkg");
}

let loaded: Promise<SimModule> | undefined;

export function loadSim(): Promise<SimModule> {
  loaded ??= (async () => {
    const dir = pkgDir();
    const js = join(dir, "client_wasm.js");
    const wasm = join(dir, "client_wasm_bg.wasm");
    if (!(await exists(js)) || !(await exists(wasm))) {
      throw new RunnerError(
        `client-wasm is not built: ${dir} has no client_wasm.js/client_wasm_bg.wasm.\n` +
          `  Build it from the repo root with:  cargo xtask wasm   (or set SIMPRESS_WASM_PKG)`,
      );
    }
    const mod = await import(pathToFileURL(js).href);
    await mod.default({ module_or_path: await readBytes(wasm) });
    const version: string = mod.version();
    const m = /proto v(\d+)/.exec(version);
    if (!m || Number(m[1]) !== PROTO_VERSION) {
      throw new RunnerError(
        `client-wasm reports "${version}" but this SDK speaks proto v${PROTO_VERSION}; rebuild with cargo xtask wasm or update the runner`,
      );
    }
    return {
      version: () => version,
      demo: (seed: bigint) => mod.Sim.demo(seed) as WasmSim,
      empty: (seed: bigint) => new mod.Sim(seed) as WasmSim,
      pkgDir: dir,
    };
  })();
  return loaded;
}

export function hex(h: bigint): string {
  return `0x${h.toString(16).padStart(16, "0")}`;
}

/** Midnight UTC, 2026-01-01: day 0 of the runner's pinned `Date` in deterministic mode. */
export const SIM_EPOCH_MS = Date.UTC(2026, 0, 1);

export function simNowMs(sim: WasmSim): number {
  return SIM_EPOCH_MS + sim.day() * 86_400_000 + sim.minute_of_day() * 60_000;
}

/** The integer-only JSON view sim rules and challenge scores see. */
export function worldView(sim: WasmSim, seed: bigint): WorldView {
  const rs = JSON.parse(sim.render_state_json()) as {
    rooms?: Array<{ id: string; kind: string; light: string; occupancy: number; capacity: number }>;
    devices?: Array<{ id: string; kind: string; state: string; room: string }>;
    staff?: Array<{ id: string; name: string; role: string; activity: string; fatigue: number; morale: number }>;
  };
  return {
    seed: seed.toString(),
    step: Number(sim.step()),
    day: sim.day(),
    minute: sim.minute_of_day(),
    cash_cents: Number(sim.cash_cents()),
    rooms: (rs.rooms ?? []).map((r) => ({ id: r.id, kind: r.kind, light: r.light, occupancy: r.occupancy, capacity: r.capacity })),
    devices: (rs.devices ?? []).map((d) => ({ id: d.id, kind: d.kind, state: d.state, room: d.room })),
    staff: (rs.staff ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      activity: s.activity,
      fatigue: s.fatigue,
      morale: s.morale,
    })),
  };
}
