/**
 * The restricted type subset at runtime (design §3.2), mirroring
 * `crates/blueprint/src/types.rs`: closed objects, arrays, scalars, enums,
 * references and `LocalizedString`; type expressions `Name`, `Name[]`,
 * `Name?`, `Name[]?`; and the path language `$`, `$.a.b`, `$.items[0]`,
 * `$.items[]`.
 *
 * Sandbox-safe: no Zod, no Node or Bun modules (it is bundled into tools).
 */

export type Ty =
  | { t: "string" }
  | { t: "integer" }
  | { t: "number" }
  | { t: "boolean" }
  | { t: "localized" }
  | { t: "enum"; values: string[] }
  | { t: "array"; items: Ty }
  | { t: "object"; fields: Record<string, { ty: Ty; required: boolean }> }
  | { t: "ref"; name: string }
  /** `Json`: any JSON value (what an n8n node passes on, ADR-0076). */
  | { t: "json" };

export interface TypeExpr {
  name: string;
  list: boolean;
  optional: boolean;
}

/** A value that does not fit a type, at a path (`$.departures[0].stop`). */
export interface TypeIssue {
  path: string;
  message: string;
}

/** A site type schema outside the subset, or a type expression that does not parse. */
export class TypeSchemaError extends Error {
  readonly issues: TypeIssue[];
  constructor(issues: TypeIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    this.name = "TypeSchemaError";
    this.issues = issues;
  }
}

const MAX_DEPTH = 16;

/** Parses `Name`, `Name[]`, `Name?` or `Name[]?` (as `TypeExpr::parse`). */
export function parseTypeExpr(s: string): TypeExpr {
  let rest = s;
  let optional = false;
  let list = false;
  if (rest.endsWith("?")) {
    optional = true;
    rest = rest.slice(0, -1);
  }
  if (rest.endsWith("[]")) {
    list = true;
    rest = rest.slice(0, -2);
  }
  if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(rest)) {
    throw new TypeSchemaError([{ path: "$", message: `${JSON.stringify(s)} is not a type expression (Name, Name[], Name? or Name[]?)` }]);
  }
  return { name: rest, list, optional };
}

const S: Ty = { t: "string" };
const LOC: Ty = { t: "localized" };
const obj = (fields: Array<[string, Ty, boolean]>): Ty => ({
  t: "object",
  fields: Object.fromEntries(fields.map(([n, ty, required]) => [n, { ty, required }])),
});

/** The built-in types (`builtins()` in types.rs). */
export function builtins(): Record<string, Ty> {
  const page: Array<[string, Ty, boolean]> = [
    ["id", S, true],
    ["path", S, true],
    ["page_type", S, true],
    ["route", S, true],
    ["title", LOC, true],
  ];
  const article: Array<[string, Ty, boolean]> = [...page, ["published_at", S, false], ["hero", { t: "ref", name: "Media" }, false]];
  const entity: Array<[string, Ty, boolean]> = [
    ["slug", S, true],
    ["name", S, true],
    ["canonical_url", S, false],
  ];
  const out: Record<string, Ty> = {
    string: { t: "string" },
    integer: { t: "integer" },
    number: { t: "number" },
    boolean: { t: "boolean" },
    LocalizedString: LOC,
    Json: { t: "json" },
    Media: obj([
      ["id", S, true],
      ["url", S, true],
      ["alt", LOC, false],
    ]),
    Page: obj(page),
    Article: obj(article),
    FeedItem: obj([
      ["title", S, true],
      ["link", S, true],
      ["published", S, false],
      ["summary", S, false],
    ]),
    SearchResult: obj([
      ["title", S, true],
      ["url", S, true],
      ["snippet", S, false],
    ]),
  };
  for (const kind of ["Village", "Trail", "Transport", "Category"]) out[kind] = obj(entity);
  return out;
}

const SCHEMA_KEYS = new Set(["type", "items", "properties", "required", "additionalProperties", "description", "title"]);

/** A JSON Schema of the subset as a {@link Ty} (`parse_schema`). */
export function parseSchema(v: unknown, path: string): Ty {
  const bad = (message: string) => new TypeSchemaError([{ path, message }]);
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw bad("a type is a JSON Schema object");
  const o = v as Record<string, unknown>;
  if ("$ref" in o) {
    const raw = typeof o.$ref === "string" ? o.$ref : "";
    const name = raw.startsWith("#/types/") ? raw.slice(8) : raw;
    parseTypeExpr(name);
    return { t: "ref", name };
  }
  if ("enum" in o) {
    const values = Array.isArray(o.enum) ? o.enum : [];
    const strs = values.filter((x): x is string => typeof x === "string");
    const set = [...new Set(strs)].sort();
    if (set.length === 0 || set.length !== values.length) throw bad("an enum lists distinct strings");
    return { t: "enum", values: set };
  }
  const unknown = Object.keys(o).find((k) => !SCHEMA_KEYS.has(k));
  if (unknown !== undefined) throw bad(`\`${unknown}\` is outside the type subset`);
  switch (o.type) {
    case "string":
    case "integer":
    case "number":
    case "boolean":
      return { t: o.type };
    case "array":
      if (!("items" in o)) throw bad("an array names its items");
      return { t: "array", items: parseSchema(o.items, `${path}/items`) };
    case "object": {
      if (o.additionalProperties !== false) throw bad('an object is closed: "additionalProperties": false');
      const required = new Set((Array.isArray(o.required) ? o.required : []).filter((x): x is string => typeof x === "string"));
      const props = o.properties && typeof o.properties === "object" && !Array.isArray(o.properties) ? (o.properties as Record<string, unknown>) : {};
      const fields: Record<string, { ty: Ty; required: boolean }> = {};
      const issues: TypeIssue[] = [];
      for (const name of Object.keys(props).sort()) {
        try {
          fields[name] = { ty: parseSchema(props[name], `${path}/properties/${name}`), required: required.has(name) };
        } catch (e) {
          if (e instanceof TypeSchemaError) issues.push(...e.issues);
          else throw e;
        }
      }
      for (const r of [...required].sort()) if (!(r in fields)) issues.push({ path, message: `required field ${r} has no property` });
      if (issues.length) throw new TypeSchemaError(issues);
      return { t: "object", fields };
    }
    case undefined:
      throw bad("a type names its `type`, `enum` or `$ref`");
    default:
      throw bad(`type ${JSON.stringify(o.type)} is outside the subset`);
  }
}

function collectRefs(t: Ty, out: Set<string>): void {
  if (t.t === "ref") out.add(t.name);
  else if (t.t === "array") collectRefs(t.items, out);
  else if (t.t === "object") for (const f of Object.values(t.fields)) collectRefs(f.ty, out);
}

/** Built-in types plus a site's own (`TypeRegistry`). */
export class TypeRegistry {
  private readonly types: Record<string, Ty>;
  private readonly builtin: Set<string>;

  private constructor(types: Record<string, Ty>, builtin: Set<string>) {
    this.types = types;
    this.builtin = builtin;
  }

  /** The built-ins only. */
  static builtins(): TypeRegistry {
    const b = builtins();
    return new TypeRegistry(b, new Set(Object.keys(b)));
  }

  /**
   * The built-ins plus `site` (name → schema, as in `blueprint/types/<Name>.json`).
   * A site type may not reuse a built-in name; every reference must resolve.
   */
  static withSite(site: Record<string, unknown>): TypeRegistry {
    const reg = TypeRegistry.builtins();
    const issues: TypeIssue[] = [];
    for (const name of Object.keys(site).sort()) {
      const path = `/types/${name}`;
      try {
        const e = parseTypeExpr(name);
        if (e.list || e.optional) throw new TypeSchemaError([{ path, message: `${JSON.stringify(name)} is a name, not an expression` }]);
      } catch (e) {
        if (!(e instanceof TypeSchemaError)) throw e;
        issues.push({ path, message: e.issues[0].message });
        continue;
      }
      if (reg.builtin.has(name)) {
        issues.push({ path, message: `${name} is a built-in type` });
        continue;
      }
      try {
        reg.types[name] = parseSchema(site[name], path);
      } catch (e) {
        if (e instanceof TypeSchemaError) issues.push(...e.issues);
        else throw e;
      }
    }
    for (const name of Object.keys(reg.types).sort()) {
      const refs = new Set<string>();
      collectRefs(reg.types[name], refs);
      for (const r of [...refs].sort())
        if (!(r in reg.types)) issues.push({ path: `/types/${name}`, message: `${name} refers to ${r}, which is not a type` });
    }
    if (issues.length) throw new TypeSchemaError(issues);
    return reg;
  }

  get(name: string): Ty | undefined {
    return Object.prototype.hasOwnProperty.call(this.types, name) ? this.types[name] : undefined;
  }

  names(): string[] {
    return Object.keys(this.types).sort();
  }

  knows(e: TypeExpr | string): boolean {
    const t = typeof e === "string" ? parseTypeExpr(e) : e;
    return this.get(t.name) !== undefined;
  }

  private resolve(t: Ty): Ty | undefined {
    let cur: Ty | undefined = t;
    for (let i = 0; i < MAX_DEPTH && cur; i++) {
      if (cur.t !== "ref") return cur;
      cur = this.get(cur.name);
    }
    return undefined;
  }

  /**
   * Field-path errors of `value` against a type expression (`"FerryRow[]"`).
   * Empty: the value fits. Closed objects reject extra fields; `integer` must
   * be an integer; a `LocalizedString` needs `en` (a plain string is accepted
   * too, as v2 text fields take either); `T?` also accepts `null`.
   */
  validate(value: unknown, typeExpr: string | TypeExpr): TypeIssue[] {
    let e: TypeExpr;
    try {
      e = typeof typeExpr === "string" ? parseTypeExpr(typeExpr) : typeExpr;
    } catch (err) {
      if (err instanceof TypeSchemaError) return err.issues;
      throw err;
    }
    const issues: TypeIssue[] = [];
    if (this.get(e.name) === undefined) return [{ path: "$", message: `${e.name} is not a type` }];
    if (e.optional && (value === null || value === undefined)) return issues;
    const base: Ty = { t: "ref", name: e.name };
    this.check(value, e.list ? { t: "array", items: base } : base, "$", 0, issues);
    return issues;
  }

  private check(v: unknown, ty: Ty, at: string, depth: number, out: TypeIssue[]): void {
    if (depth > MAX_DEPTH) {
      out.push({ path: at, message: "the value nests too deeply" });
      return;
    }
    const t = this.resolve(ty);
    if (!t) {
      out.push({ path: at, message: "a reference does not resolve" });
      return;
    }
    const want = (what: string): void => {
      out.push({ path: at, message: `expected ${what}, found ${describe(v)}` });
    };
    switch (t.t) {
      case "string":
        if (typeof v !== "string") want("a string");
        return;
      case "integer":
        if (typeof v !== "number" || !Number.isInteger(v)) want("an integer");
        return;
      case "number":
        if (typeof v !== "number" || !Number.isFinite(v)) want("a number");
        return;
      case "boolean":
        if (typeof v !== "boolean") want("a boolean");
        return;
      case "enum":
        if (typeof v !== "string" || !t.values.includes(v)) want(`one of ${t.values.join(", ")}`);
        return;
      case "localized": {
        if (typeof v === "string") return;
        if (!isObject(v)) return want("a LocalizedString");
        if (!("en" in v)) out.push({ path: `${at}.en`, message: "missing (a LocalizedString needs en)" });
        for (const k of Object.keys(v).sort()) if (typeof v[k] !== "string") out.push({ path: `${at}.${k}`, message: `expected a string, found ${describe(v[k])}` });
        return;
      }
      case "array":
        if (!Array.isArray(v)) return want("an array");
        v.forEach((item, i) => this.check(item, t.items, `${at}[${i}]`, depth + 1, out));
        return;
      case "object": {
        if (!isObject(v)) return want("an object");
        for (const name of Object.keys(t.fields).sort()) {
          const f = t.fields[name];
          const fv = v[name];
          if (fv === undefined) {
            if (f.required) out.push({ path: `${at}.${name}`, message: "missing" });
            continue;
          }
          this.check(fv, f.ty, `${at}.${name}`, depth + 1, out);
        }
        for (const k of Object.keys(v).sort()) if (!(k in t.fields)) out.push({ path: `${at}.${k}`, message: "not a field of this type" });
        return;
      }
      case "json":
        if (v === undefined) want("a JSON value");
        return;
      case "ref":
        return;
    }
  }

  /** The JSON Schema of a type expression, references inlined (for prompts and tool inputs). */
  jsonSchema(typeExpr: string | TypeExpr): Record<string, unknown> {
    const e = typeof typeExpr === "string" ? parseTypeExpr(typeExpr) : typeExpr;
    const base = this.schemaOf({ t: "ref", name: e.name }, 0);
    return e.list ? { type: "array", items: base } : base;
  }

  private schemaOf(ty: Ty, depth: number): Record<string, unknown> {
    if (depth > MAX_DEPTH) return {};
    const t = this.resolve(ty);
    if (!t) return {};
    switch (t.t) {
      case "string":
      case "integer":
      case "number":
      case "boolean":
        return { type: t.t };
      case "localized":
        return {
          type: "object",
          required: ["en"],
          properties: { en: { type: "string" } },
          additionalProperties: { type: "string" },
          description: "LocalizedString: language code → text, en required",
        };
      case "enum":
        return { enum: [...t.values] };
      case "array":
        return { type: "array", items: this.schemaOf(t.items, depth + 1) };
      case "object": {
        const names = Object.keys(t.fields).sort();
        const properties: Record<string, unknown> = {};
        for (const n of names) properties[n] = this.schemaOf(t.fields[n].ty, depth + 1);
        return { type: "object", additionalProperties: false, required: names.filter((n) => t.fields[n].required), properties };
      }
      case "json":
      case "ref":
        return {};
    }
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "nothing";
  if (Array.isArray(v)) return "an array";
  if (typeof v === "number") return Number.isInteger(v) ? "an integer" : "a number";
  return typeof v === "object" ? "an object" : `a ${typeof v}`;
}

// ---------------------------------------------------------------- the path language

type Step = { k: "field"; name: string } | { k: "index"; i: number } | { k: "each" };

/** Path syntax error. */
export class PathError extends Error {
  constructor(path: string, why: string) {
    super(`${JSON.stringify(path)} is not a path: ${why}`);
    this.name = "PathError";
  }
}

/** Parses `$`, `$.a.b`, `$.items[0].name`, `$.items[]` into steps. */
export function parsePath(path: string): Step[] {
  if (!path.startsWith("$")) throw new PathError(path, "a path starts with $");
  const steps: Step[] = [];
  let rest = path.slice(1);
  while (rest.length) {
    if (rest.startsWith(".")) {
      const r = rest.slice(1);
      const m = /[.[]/.exec(r);
      const end = m ? m.index : r.length;
      const name = r.slice(0, end);
      if (!name) throw new PathError(path, "an empty field name");
      steps.push({ k: "field", name });
      rest = r.slice(end);
    } else if (rest.startsWith("[")) {
      const end = rest.indexOf("]");
      if (end < 0) throw new PathError(path, "an unclosed [");
      const idx = rest.slice(1, end);
      if (idx === "") steps.push({ k: "each" });
      else if (/^[0-9]+$/.test(idx)) steps.push({ k: "index", i: Number(idx) });
      else throw new PathError(path, `[${idx}] is not an index`);
      rest = rest.slice(end + 1);
    } else {
      throw new PathError(path, `unexpected ${JSON.stringify(rest[0])}`);
    }
  }
  return steps;
}

function walk(v: unknown, steps: Step[], i: number): unknown {
  if (i === steps.length) return v;
  const s = steps[i];
  if (v === null || v === undefined) return undefined;
  if (s.k === "field") {
    if (!isObject(v) || !Object.prototype.hasOwnProperty.call(v, s.name)) return undefined;
    return walk(v[s.name], steps, i + 1);
  }
  if (!Array.isArray(v)) return undefined;
  if (s.k === "index") return s.i < v.length ? walk(v[s.i], steps, i + 1) : undefined;
  // `[]`: the rest of the path for each item; items where it is missing are dropped.
  const out: unknown[] = [];
  for (const item of v) {
    const r = walk(item, steps, i + 1);
    if (r !== undefined) out.push(r);
  }
  return out;
}

/**
 * The value at `path` inside `value`, or `undefined` when a step is missing.
 * `[]` maps the rest of the path over each item of an array.
 */
export function readPath(value: unknown, path: string): unknown {
  return walk(value, parsePath(path), 0);
}
