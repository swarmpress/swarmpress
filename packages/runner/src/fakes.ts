/**
 * Test doubles for the sandbox host: a scripted FakeLlm, fixture-backed web,
 * live web, and a recorded fake HTTP server behind a credential proxy
 * (publish targets: the secret is injected here, outside the sandbox).
 */
import { dirname, join } from "node:path";
import { CREDENTIAL_HEADER } from "@swarm-press/sdk";
import type { HostLlm, HostWeb, HostWebRequest, HostWebResponse } from "@swarm-press/sandbox";
import { readText } from "./host.ts";
import { RunnerError } from "./wasm.ts";

/** Scripted LLM: returns the responses in order; running out fails loudly (rule 11). */
export class FakeLlm {
  readonly calls: Array<{ tier: string; system?: string; prompt: string }> = [];
  private i = 0;
  private readonly script: string[];
  constructor(script: string[]) {
    this.script = script;
  }
  readonly host: HostLlm = async (req) => {
    this.calls.push({ tier: req.tier, system: req.system, prompt: req.prompt });
    if (this.i >= this.script.length)
      throw new Error(`FakeLlm: no scripted response left (call ${this.i + 1}); add one to the scenario's llm[]`);
    const text = this.script[this.i++];
    return { text, model: "fake", tokens_in: req.prompt.length, tokens_out: text.length };
  };
}

export interface WebFixture {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  file?: string;
}

/** `fetch` answered from fixtures (by exact URL). Unknown URLs fail loudly. */
export function fixtureWeb(fixtures: Record<string, WebFixture>, baseDir: string, log?: string[]): HostWeb {
  return async (req) => {
    log?.push(`${req.method} ${req.url}`);
    const f = fixtures[req.url];
    if (!f) throw new Error(`fixture web: no fixture for ${req.method} ${req.url}`);
    const body =
      f.file !== undefined
        ? await readText(join(baseDir, f.file))
        : typeof f.body === "string"
          ? f.body
          : JSON.stringify(f.body ?? null);
    return { status: f.status, headers: f.headers, body, url: req.url };
  };
}

/** Real network (`swarmpress run --web live`). */
export const liveWeb: HostWeb = async (req) => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body ?? undefined });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k] = v));
  return { status: res.status, headers, body: await res.text(), url: res.url };
};

export interface HttpExchange {
  method: string;
  url: string;
  expectHeaders: Record<string, string>;
  expectBody?: unknown;
  status: number;
  body?: unknown;
}

export interface CredentialSpec {
  kind: "bearer" | "basic" | "header" | "ghost-admin";
  header?: string;
}

/** Deep subset match: every field of `want` is present and equal in `got`. */
export function subset(want: unknown, got: unknown): boolean {
  if (want === null || typeof want !== "object") return want === got;
  if (Array.isArray(want)) return Array.isArray(got) && want.length === got.length && want.every((w, i) => subset(w, got[i]));
  if (got === null || typeof got !== "object") return false;
  return Object.entries(want as Record<string, unknown>).every(([k, v]) => subset(v, (got as Record<string, unknown>)[k]));
}

/**
 * A recorded fake server behind the credential proxy. The proxy takes the
 * opaque `X-SwarmPress-Credential` header off the request, looks the reference
 * up, and sets the real `Authorization` (or custom) header; the bundle never
 * sees the secret.
 */
export class FakeHttpServer {
  readonly transcript: Array<{ method: string; url: string; status: number }> = [];
  private used = new Set<number>();
  private readonly exchanges: HttpExchange[];
  private readonly credential: CredentialSpec;
  private readonly secrets: Record<string, string>;
  constructor(exchanges: HttpExchange[], credential: CredentialSpec, secrets: Record<string, string>) {
    this.exchanges = exchanges;
    this.credential = credential;
    this.secrets = secrets;
  }

  private inject(req: HostWebRequest): Record<string, string> {
    const headers: Record<string, string> = {};
    let ref: string | undefined;
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase() === CREDENTIAL_HEADER.toLowerCase()) ref = v;
      else if (k.toLowerCase() === "authorization") throw new Error("credential proxy: the bundle may not set Authorization itself");
      else headers[k.toLowerCase()] = v;
    }
    if (ref === undefined) return headers;
    const secret = this.secrets[ref];
    if (secret === undefined) throw new Error(`credential proxy: unknown credential reference ${JSON.stringify(ref)}`);
    switch (this.credential.kind) {
      case "bearer":
        headers.authorization = `Bearer ${secret}`;
        break;
      case "basic":
        headers.authorization = `Basic ${secret}`;
        break;
      case "ghost-admin":
        // Production signs a short-lived JWT from the Admin API key; the fake passes the key through.
        headers.authorization = `Ghost ${secret}`;
        break;
      case "header":
        headers[(this.credential.header ?? "x-api-key").toLowerCase()] = secret;
        break;
    }
    return headers;
  }

  readonly host: HostWeb = async (req): Promise<HostWebResponse> => {
    const headers = this.inject(req);
    const idx = this.exchanges.findIndex((x, i) => !this.used.has(i) && x.method === req.method && x.url === req.url);
    if (idx < 0) throw new Error(`fake server: unexpected ${req.method} ${req.url}`);
    const x = this.exchanges[idx];
    this.used.add(idx);
    for (const [k, v] of Object.entries(x.expectHeaders)) {
      if (headers[k.toLowerCase()] !== v)
        throw new Error(`fake server: ${req.method} ${req.url} expected header ${k}: ${v}, got ${headers[k.toLowerCase()] ?? "(none)"}`);
    }
    if (x.expectBody !== undefined) {
      let body: unknown;
      try {
        body = JSON.parse(req.body ?? "null");
      } catch {
        body = req.body;
      }
      if (!subset(x.expectBody, body))
        throw new Error(`fake server: ${req.method} ${req.url} body does not match expectBody: ${req.body?.slice(0, 400)}`);
    }
    this.transcript.push({ method: req.method, url: req.url, status: x.status });
    return {
      status: x.status,
      headers: { "content-type": "application/json" },
      body: typeof x.body === "string" ? x.body : JSON.stringify(x.body ?? {}),
      url: req.url,
    };
  };

  unused(): HttpExchange[] {
    return this.exchanges.filter((_, i) => !this.used.has(i));
  }
}

export function scenarioDir(file: string): string {
  return dirname(file);
}

export function fail(message: string): never {
  throw new RunnerError(message);
}
