/**
 * n8n expressions (ADR-0076): a parameter string starting with `=` is a
 * template whose `{{ … }}` parts are JavaScript. A template that is exactly
 * one `{{ … }}` yields that part's value (a number stays a number); any other
 * template is text, its parts rendered as n8n renders them (objects as JSON,
 * `null` and `undefined` as nothing, dates as ISO text).
 *
 * A part that only reads the current item (`$json.a.b`, `$json["a b"][0]`,
 * `$input.item.json.a`) is read natively. Every other part is JavaScript and
 * runs in the code sandbox (`prelude.ts`): one call per node evaluates all its
 * templates for all its items. Sandbox-safe: no eval here.
 */

export type Item = Record<string, unknown>;
export type Part = string | { js: string };

export interface Template {
  parts: Part[];
  /** Exactly one `{{ … }}` and nothing else: the part's value, not text. */
  single: boolean;
}

/** `undefined` across the JSON boundary of the code sandbox. */
export const UNDEFINED = { $undefined: true } as const;
export const decodeValue = (v: unknown): unknown =>
  v !== null && typeof v === "object" && !Array.isArray(v) && (v as Record<string, unknown>).$undefined === true && Object.keys(v).length === 1 ? undefined : v;

/** The end of a `{{ … }}` part starting after `{{` at `from`: braces, strings and template literals balanced. */
function partEnd(s: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      if (depth === 0 && s[i + 1] === "}") return i;
      depth = Math.max(0, depth - 1);
    }
  }
  return -1;
}

/** The template of a parameter value, or `null` when it is a literal. Throws on an unclosed `{{`. */
export function parseTemplate(raw: unknown): Template | null {
  if (typeof raw !== "string" || !raw.startsWith("=")) return null;
  const s = raw.slice(1);
  const parts: Part[] = [];
  let at = 0;
  for (;;) {
    const open = s.indexOf("{{", at);
    if (open < 0) {
      if (at < s.length) parts.push(s.slice(at));
      break;
    }
    if (open > at) parts.push(s.slice(at, open));
    const end = partEnd(s, open + 2);
    if (end < 0) throw new Error(`the expression ${JSON.stringify(raw)} has an unclosed {{`);
    parts.push({ js: s.slice(open + 2, end).trim() });
    at = end + 2;
  }
  const single = parts.length === 1 && typeof parts[0] !== "string";
  return { parts, single };
}

const NATIVE = /^(?:\$json|\$input\.item\.json)((?:\.[A-Za-z_$][\w$]*|\[\d+\]|\[\s*"[^"\\]*"\s*\]|\[\s*'[^'\\]*'\s*\])*)$/;
const STEP = /\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\[\s*"([^"\\]*)"\s*\]|\[\s*'([^'\\]*)'\s*\]/g;

/** A part that only reads the current item, as its steps; `null` when it needs JavaScript. */
export function nativeSteps(js: string): Array<string | number> | null {
  const m = NATIVE.exec(js.trim());
  if (!m) return null;
  const steps: Array<string | number> = [];
  for (const s of m[1].matchAll(STEP)) steps.push(s[1] ?? (s[2] !== undefined ? Number(s[2]) : (s[3] ?? s[4])));
  return steps;
}

function read(item: unknown, steps: Array<string | number>): unknown {
  let v = item;
  for (const s of steps) {
    if (v === null || typeof v !== "object") return undefined;
    v = (v as Record<string | number, unknown>)[s];
  }
  return v;
}

/** How n8n renders a value inside text. */
export function renderText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** The template's value from its parts' values. */
export function renderTemplate(t: Template, values: unknown[]): unknown {
  if (t.single) return values[0];
  let k = 0;
  return t.parts.map((p) => (typeof p === "string" ? p : renderText(values[k++]))).join("");
}

/** Every template in a parameter tree, with its path. */
export function templatesOf(params: unknown, path: Array<string | number> = [], out: Array<{ path: Array<string | number>; t: Template }> = []) {
  if (typeof params === "string") {
    const t = parseTemplate(params);
    if (t) out.push({ path, t });
  } else if (Array.isArray(params)) params.forEach((v, i) => templatesOf(v, [...path, i], out));
  else if (params && typeof params === "object") for (const k of Object.keys(params)) templatesOf((params as Record<string, unknown>)[k], [...path, k], out);
  return out;
}

/** Whether a template reads only the current item. */
export const isNative = (t: Template) => t.parts.every((p) => typeof p === "string" || nativeSteps(p.js) !== null);

/** The template's value for one item, natively (only for {@link isNative} templates). */
export function evalNative(t: Template, item: Item): unknown {
  const values = t.parts.filter((p): p is { js: string } => typeof p !== "string").map((p) => read(item, nativeSteps(p.js)!));
  return renderTemplate(t, values);
}

/** Node names an expression or code refers to (`$('X')`, `$node["X"]`, `$node.X`, `$items("X")`). */
export function referencedNodes(src: string): string[] {
  const out = new Set<string>();
  const res = [
    /\$\(\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1\s*\)/g,
    /\$node\[\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1\s*\]/g,
    /\$items\(\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/g,
  ];
  for (const re of res) for (const m of src.matchAll(re)) out.add(m[2].replace(/\\(.)/g, "$1"));
  for (const m of src.matchAll(/\$node\.([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  return [...out].sort();
}

function setAt(root: unknown, path: Array<string | number>, v: unknown): unknown {
  if (!path.length) return v;
  const [head, ...rest] = path;
  const container = root as Record<string | number, unknown>;
  container[head] = setAt(container[head], rest, v);
  return root;
}

/** What the code sandbox evaluates for a node: its non-native templates for every item. */
export interface ExprTask {
  op: "exprs";
  items: Item[];
  templates: Template[];
  nodes: Record<string, Item[]>;
  node: string;
  workflow: { id: string; name: string };
}

/**
 * The node's parameters for each item (`max(1, items.length)` of them), every
 * template replaced by its value. `js` evaluates the templates that need
 * JavaScript; it is not called when every template is native.
 */
export async function resolveParams(
  params: Record<string, unknown>,
  items: Item[],
  js: (task: ExprTask) => Promise<unknown[][]>,
  ctx: { nodes: Record<string, Item[]>; node: string; workflow: { id: string; name: string } },
): Promise<Array<Record<string, unknown>>> {
  const list = items.length ? items : [{}];
  const found = templatesOf(params);
  if (!found.length) return list.map(() => params);
  const foreign = found.filter((f) => !isNative(f.t));
  let values: unknown[][] = [];
  if (foreign.length) {
    const refs = new Set<string>();
    for (const f of foreign) for (const p of f.t.parts) if (typeof p !== "string") referencedNodes(p.js).forEach((n) => refs.add(n));
    const nodes: Record<string, Item[]> = {};
    for (const n of refs) if (ctx.nodes[n]) nodes[n] = ctx.nodes[n];
    values = await js({ op: "exprs", items: list, templates: foreign.map((f) => f.t), nodes, node: ctx.node, workflow: ctx.workflow });
  }
  return list.map((item, i) => {
    const out = JSON.parse(JSON.stringify(params)) as Record<string, unknown>;
    let k = 0;
    for (const f of found) {
      const v = isNative(f.t) ? evalNative(f.t, item) : decodeValue(values[i]?.[k++]);
      setAt(out, f.path, v);
    }
    return out;
  });
}
