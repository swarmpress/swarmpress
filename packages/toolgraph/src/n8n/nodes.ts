/**
 * The n8n nodes swarm.press runs, with n8n's item semantics (ADR-0076): a
 * node reads lists of items (JSON objects) on its inputs and writes a list on
 * each output; an output with no items does not run what follows it. Node
 * parameters are resolved per item (`expr.ts`); JavaScript runs in the code
 * sandbox (`prelude.ts`), requests and model calls through the tool's host,
 * under the tool's manifest and run limits.
 *
 * Differences from n8n, by design: no binary data; time is UTC; HTTP
 * pagination, multipart bodies and Python are refused with a reason; a type
 * mismatch in a condition compares loosely instead of failing.
 *
 * Sandbox-safe: no Zod, no Node or Bun modules.
 */
import { parseFeed } from "../interpret.ts";
import { type ExprTask, type Item, resolveParams, referencedNodes } from "./expr.ts";

/** An `n8n` node of a tool graph. */
export interface N8nNode {
  kind: "n8n";
  id: string;
  /** The node's name in the workflow (`$('Name')` refers to it). */
  name: string;
  type: string;
  version?: number;
  parameters: Record<string, unknown>;
  inputs: number;
  outputs: number;
  credential?: string;
  tool?: string;
  on_error?: "stop" | "continue";
  returns?: string;
}

export interface HttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  credential?: string;
}
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface N8nContext {
  node: N8nNode;
  /** Items on each input, by index. */
  inputs: Item[][];
  /** Items each node before this one wrote (all outputs), by n8n name. */
  nodes: Record<string, Item[]>;
  workflow: { id: string; name: string };
  /** The code sandbox: runs a prelude task, returns its JSON result. */
  js(task: Record<string, unknown>): Promise<unknown>;
  request(req: HttpRequest): Promise<HttpResponse>;
  llm(prompt: string): Promise<string>;
  tool(id: string, input: unknown): Promise<unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const str = (v: unknown, d = ""): string => (v === undefined || v === null ? d : typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map((x) => str(x)) : str(v).split(","))
    .map((s) => s.trim())
    .filter(Boolean);

/** A value as n8n items: a list of objects stays, an object is one item, anything else is `{ data }`. */
export function toItems(v: unknown): Item[] {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => (isObj(x) ? (isObj(x.json) && Object.keys(x).every((k) => k === "json" || k === "binary" || k === "pairedItem") ? clone(x.json) : clone(x)) : { data: clone(x) }));
}

/** `a.b.c` inside an item (dot notation, as n8n reads field names). */
export function getField(item: unknown, field: string, dot = true): unknown {
  if (!dot) return isObj(item) ? item[field] : undefined;
  let v: unknown = item;
  for (const k of field.split(".")) {
    if (Array.isArray(v) && /^\d+$/.test(k)) v = v[Number(k)];
    else if (isObj(v)) v = v[k];
    else return undefined;
  }
  return v;
}

export function setField(item: Record<string, unknown>, field: string, value: unknown, dot = true): void {
  if (!dot || !field.includes(".")) {
    item[field] = value;
    return;
  }
  const keys = field.split(".");
  let cur: Record<string, unknown> = item;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(cur[k])) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

const kv = (rows: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const r of Array.isArray(rows) ? rows : []) if (isObj(r) && str(r.name)) out[str(r.name)] = str(r.value);
  return out;
};
const jsonParam = (v: unknown, what: string): unknown => {
  if (typeof v !== "string") return v;
  if (!v.trim()) return {};
  try {
    return JSON.parse(v);
  } catch (e) {
    throw new Error(`${what} is not JSON: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------- conditions

const loweredIf = (v: unknown, ci: boolean) => (ci && typeof v === "string" ? v.toLowerCase() : v);
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "boolean" ? Number(v) : NaN);
const time = (v: unknown) => (typeof v === "number" ? v : Date.parse(str(v)));
const isEmptyValue = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);
const regex = (p: unknown): RegExp => {
  const s = str(p);
  const m = /^\/(.*)\/([gimsuy]*)$/s.exec(s);
  return m ? new RegExp(m[1], m[2]) : new RegExp(s);
};
const same = (a: unknown, b: unknown) => (isObj(a) || Array.isArray(a) ? JSON.stringify(a) === JSON.stringify(b) : a == b); // eslint-disable-line eqeqeq

/** One condition of an IF, Filter or Switch v3 (`conditions.conditions[]`). */
export function conditionV2(c: Record<string, unknown>, caseSensitive = true): boolean {
  const op = (isObj(c.operator) ? c.operator : {}) as { type?: string; operation?: string };
  const type = op.type ?? "string";
  const operation = op.operation ?? "equals";
  const ci = !caseSensitive;
  const a = loweredIf(c.leftValue, ci);
  const b = loweredIf(c.rightValue, ci);
  switch (operation) {
    case "exists":
      return a !== undefined && a !== null;
    case "notExists":
      return a === undefined || a === null;
    case "empty":
      return isEmptyValue(a);
    case "notEmpty":
      return !isEmptyValue(a);
    case "true":
      return a === true || a === "true";
    case "false":
      return a === false || a === "false";
  }
  if (type === "number") {
    const x = num(a);
    const y = num(b);
    switch (operation) {
      case "equals":
        return x === y;
      case "notEquals":
        return x !== y;
      case "gt":
        return x > y;
      case "lt":
        return x < y;
      case "gte":
        return x >= y;
      case "lte":
        return x <= y;
    }
  }
  if (type === "dateTime") {
    const x = time(a);
    const y = time(b);
    switch (operation) {
      case "equals":
        return x === y;
      case "notEquals":
        return x !== y;
      case "after":
        return x > y;
      case "before":
        return x < y;
      case "afterOrEquals":
        return x >= y;
      case "beforeOrEquals":
        return x <= y;
    }
  }
  if (type === "array") {
    const arr = Array.isArray(a) ? a : [];
    switch (operation) {
      case "contains":
        return arr.some((x) => same(loweredIf(x, ci), b));
      case "notContains":
        return !arr.some((x) => same(loweredIf(x, ci), b));
      case "lengthEquals":
        return arr.length === num(b);
      case "lengthNotEquals":
        return arr.length !== num(b);
      case "lengthGt":
        return arr.length > num(b);
      case "lengthLt":
        return arr.length < num(b);
      case "lengthGte":
        return arr.length >= num(b);
      case "lengthLte":
        return arr.length <= num(b);
    }
  }
  const sa = str(a);
  const sb = str(b);
  switch (operation) {
    case "equals":
      return type === "boolean" ? String(a) === String(b) : same(a, b);
    case "notEquals":
      return type === "boolean" ? String(a) !== String(b) : !same(a, b);
    case "contains":
      return sa.includes(sb);
    case "notContains":
      return !sa.includes(sb);
    case "startsWith":
      return sa.startsWith(sb);
    case "notStartsWith":
      return !sa.startsWith(sb);
    case "endsWith":
      return sa.endsWith(sb);
    case "notEndsWith":
      return !sa.endsWith(sb);
    case "regex":
      return regex(c.rightValue).test(str(c.leftValue));
    case "notRegex":
      return !regex(c.rightValue).test(str(c.leftValue));
    case "gt":
      return num(a) > num(b);
    case "lt":
      return num(a) < num(b);
    case "gte":
      return num(a) >= num(b);
    case "lte":
      return num(a) <= num(b);
  }
  throw new Error(`the condition ${type}/${operation} is not supported`);
}

/** The `conditions` block of an IF, Filter or Switch v3 rule. */
export function conditionsV2(block: unknown, opts: Record<string, unknown> = {}): boolean {
  const b = isObj(block) ? block : {};
  const options = isObj(b.options) ? b.options : {};
  const ci = options.caseSensitive === false || opts.ignoreCase === true;
  const conds = Array.isArray(b.conditions) ? (b.conditions as Record<string, unknown>[]) : [];
  const results = conds.map((c) => conditionV2(c, !ci));
  return (b.combinator ?? "and") === "or" ? results.some(Boolean) : results.every(Boolean);
}

/** One v1 comparison (`IF` v1, `Switch` v1/v2 rules). */
export function compareV1(type: string, operation: string, a: unknown, b: unknown): boolean {
  switch (operation) {
    case "isEmpty":
      return isEmptyValue(a);
    case "isNotEmpty":
      return !isEmptyValue(a);
  }
  if (type === "number") {
    const x = num(a);
    const y = num(b);
    switch (operation) {
      case "equal":
        return x === y;
      case "notEqual":
        return x !== y;
      case "smaller":
        return x < y;
      case "smallerEqual":
        return x <= y;
      case "larger":
        return x > y;
      case "largerEqual":
        return x >= y;
    }
  }
  if (type === "dateTime") {
    if (operation === "after") return time(a) > time(b);
    if (operation === "before") return time(a) < time(b);
  }
  if (type === "boolean") {
    if (operation === "equal") return Boolean(a) === Boolean(b);
    if (operation === "notEqual") return Boolean(a) !== Boolean(b);
  }
  const sa = str(a);
  const sb = str(b);
  switch (operation) {
    case "equal":
      return sa === sb;
    case "notEqual":
      return sa !== sb;
    case "contains":
      return sa.includes(sb);
    case "notContains":
      return !sa.includes(sb);
    case "startsWith":
      return sa.startsWith(sb);
    case "notStartsWith":
      return !sa.startsWith(sb);
    case "endsWith":
      return sa.endsWith(sb);
    case "notEndsWith":
      return !sa.endsWith(sb);
    case "regex":
      return regex(b).test(sa);
    case "notRegex":
      return !regex(b).test(sa);
  }
  throw new Error(`the comparison ${type}/${operation} is not supported`);
}

function conditionsV1(p: Record<string, unknown>): boolean {
  const c = isObj(p.conditions) ? p.conditions : {};
  const results: boolean[] = [];
  for (const type of ["string", "number", "boolean", "dateTime"]) {
    for (const r of Array.isArray(c[type]) ? (c[type] as Record<string, unknown>[]) : []) {
      results.push(compareV1(type, str(r.operation, type === "string" ? "equal" : type === "dateTime" ? "after" : "equal"), r.value1, r.value2));
    }
  }
  return (p.combineOperation ?? "all") === "any" ? results.some(Boolean) : results.every(Boolean);
}

const usesV2 = (n: N8nNode) => (n.version ?? 1) >= 2;

// ---------------------------------------------------------------- merge and lists

function mergeByFields(a: Item[], b: Item[], pairs: Array<[string, string]>, joinMode: string, from: string): Item[] {
  const key = (it: Item, side: 0 | 1) => JSON.stringify(pairs.map((p) => getField(it, p[side])));
  const index = new Map<string, Item[]>();
  for (const it of b) index.set(key(it, 1), [...(index.get(key(it, 1)) ?? []), it]);
  const matchedB = new Set<Item>();
  const out: Item[] = [];
  const unmatchedA: Item[] = [];
  for (const x of a) {
    const ms = index.get(key(x, 0)) ?? [];
    if (!ms.length) {
      unmatchedA.push(x);
      if (joinMode === "enrichInput1") out.push(clone(x));
      continue;
    }
    for (const y of ms) {
      matchedB.add(y);
      if (joinMode === "keepMatches" || joinMode === "keepEverything" || joinMode === "enrichInput1" || joinMode === "enrichInput2")
        out.push(joinMode === "keepMatches" && from === "input1" ? clone(x) : joinMode === "keepMatches" && from === "input2" ? clone(y) : { ...clone(x), ...clone(y) });
    }
  }
  const unmatchedB = b.filter((y) => !matchedB.has(y));
  if (joinMode === "keepNonMatches") return [...(from === "input2" ? [] : unmatchedA), ...(from === "input1" ? [] : unmatchedB)].map(clone);
  if (joinMode === "keepEverything") return [...out, ...unmatchedA.map(clone), ...unmatchedB.map(clone)];
  if (joinMode === "enrichInput2") return [...out, ...unmatchedB.map(clone)];
  return out;
}

function mergeNode(n: N8nNode, p: Record<string, unknown>, ins: Item[][]): Item[] {
  const [a = [], b = []] = ins;
  const v = n.version ?? 1;
  const opts = isObj(p.options) ? p.options : {};
  const position = (include: boolean) => {
    const len = include ? Math.max(a.length, b.length) : Math.min(a.length, b.length);
    return Array.from({ length: len }, (_, i) => ({ ...clone(a[i] ?? {}), ...clone(b[i] ?? {}) }));
  };
  const all = () => a.flatMap((x) => b.map((y) => ({ ...clone(x), ...clone(y) })));
  const fieldPairs = (): Array<[string, string]> => {
    if (typeof p.fieldsToMatchString === "string") return list(p.fieldsToMatchString).map((f) => [f, f]);
    const adv = isObj(p.mergeByFields) && Array.isArray(p.mergeByFields.values) ? (p.mergeByFields.values as Record<string, unknown>[]) : [];
    return adv.map((r) => [str(r.field1), str(r.field2)]);
  };
  if (v < 2) {
    switch (p.mode ?? "append") {
      case "append":
        return ins.flat().map(clone);
      case "mergeByIndex":
        return position(str(p.join, "left") !== "inner");
      case "mergeByKey":
      case "keepKeyMatches":
      case "removeKeyMatches": {
        const pairs: Array<[string, string]> = [[str(p.propertyName1), str(p.propertyName2)]];
        if (p.mode === "keepKeyMatches") return mergeByFields(a, b, pairs, "keepMatches", "input1");
        if (p.mode === "removeKeyMatches") return mergeByFields(a, b, pairs, "keepNonMatches", "input1");
        return mergeByFields(a, b, pairs, "enrichInput1", "both");
      }
      case "multiplex":
        return all();
      case "passThrough":
        return (p.output === "input2" ? b : a).map(clone);
      case "wait":
        return [];
    }
    throw new Error(`the Merge mode ${str(p.mode)} is not supported`);
  }
  const mode = str(p.mode, "append");
  if (mode === "append") return ins.flat().map(clone);
  if (mode === "chooseBranch") {
    const which = str(p.output, str(p.chooseBranchMode === "waitForAll" ? "specifiedInput" : "input1"));
    if (which === "empty") return [{}];
    if (which === "input2") return b.map(clone);
    if (which === "specifiedInput") return (ins[Number(p.useDataOfInput ?? 1) - 1] ?? []).map(clone);
    return a.map(clone);
  }
  if (mode === "combineBySql") throw new Error("Merge by SQL query is not supported: use Merge by fields");
  const by = mode === "combine" ? str(p.combineBy ?? p.combinationMode, "combineByFields") : mode;
  switch (by) {
    case "combineByPosition":
    case "mergeByPosition":
      return position(opts.includeUnpaired === true);
    case "combineAll":
    case "multiplex":
      return all();
    case "combineByFields":
    case "mergeByFields":
      return mergeByFields(a, b, fieldPairs(), str(p.joinMode, "keepMatches"), str(p.outputDataFrom, "both"));
  }
  throw new Error(`the Merge mode ${by} is not supported`);
}

function sortSimple(items: Item[], fields: Array<{ fieldName?: string; order?: string }>, dot: boolean): Item[] {
  const cmp = (x: unknown, y: unknown) => {
    if (x === y) return 0;
    if (x === undefined || x === null) return 1;
    if (y === undefined || y === null) return -1;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return str(x) < str(y) ? -1 : str(x) > str(y) ? 1 : 0;
  };
  return items
    .map((it, i) => ({ it, i }))
    .sort((p, q) => {
      for (const f of fields) {
        const c = cmp(getField(p.it, str(f.fieldName), dot), getField(q.it, str(f.fieldName), dot));
        if (c) return f.order === "descending" ? -c : c;
      }
      return p.i - q.i;
    })
    .map((x) => clone(x.it));
}

function removeDuplicates(items: Item[], p: Record<string, unknown>): Item[] {
  if (p.operation && p.operation !== "removeDuplicateInputItems") throw new Error(`Remove Duplicates "${str(p.operation)}" keeps state between runs, which a tool does not`);
  const compare = str(p.compare, "allFields");
  const fieldNames = (v: unknown) => (isObj(v) && Array.isArray(v.fields) ? (v.fields as Record<string, unknown>[]).map((f) => str(f.fieldName)) : list(v));
  const seen = new Set<string>();
  return items.filter((it) => {
    let k: unknown = it;
    if (compare === "selectedFields") k = fieldNames(p.fieldsToCompare).map((f) => getField(it, f));
    else if (compare === "allFieldsExcept") {
      const drop = new Set(fieldNames(p.fieldsToExclude));
      k = Object.keys(it)
        .filter((f) => !drop.has(f))
        .sort()
        .map((f) => [f, it[f]]);
    } else k = Object.keys(it).sort().map((f) => [f, it[f]]);
    const s = JSON.stringify(k);
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

function splitOut(items: Item[], p: Record<string, unknown>): Item[] {
  const fields = list(p.fieldToSplitOut);
  if (!fields.length) throw new Error("Split Out needs a field to split out");
  const include = str(p.include, "noOtherFields");
  const opts = isObj(p.options) ? p.options : {};
  const dest = str(opts.destinationFieldName);
  const keep = list(isObj(p.fieldsToInclude) && Array.isArray(p.fieldsToInclude.fields) ? (p.fieldsToInclude.fields as Record<string, unknown>[]).map((f) => f.fieldName) : p.fieldsToInclude);
  const out: Item[] = [];
  for (const it of items) {
    const arrays = fields.map((f) => {
      const v = getField(it, f);
      return Array.isArray(v) ? v : v === undefined ? [] : isObj(v) ? Object.values(v) : [v];
    });
    const len = Math.max(0, ...arrays.map((a) => a.length));
    for (let i = 0; i < len; i++) {
      let base: Item = {};
      if (include === "allOtherFields") base = Object.fromEntries(Object.entries(clone(it)).filter(([k]) => !fields.includes(k)));
      if (include === "selectedOtherFields") for (const k of keep) setField(base, k, clone(getField(it, k)));
      if (fields.length === 1 && !dest && isObj(arrays[0][i])) out.push({ ...base, ...clone(arrays[0][i] as Item) });
      else {
        fields.forEach((f, k) => setField(base, fields.length === 1 && dest ? dest : f, clone(arrays[k][i]), false));
        out.push(base);
      }
    }
  }
  return out;
}

function aggregate(items: Item[], p: Record<string, unknown>): Item[] {
  const opts = isObj(p.options) ? p.options : {};
  if (str(p.aggregate, "aggregateIndividualFields") === "aggregateAllItemData") {
    const include = str(p.include, "allFields");
    const fields = list(p.fieldsToInclude ?? p.fieldsToExclude);
    const pick = (it: Item) =>
      include === "specifiedFields"
        ? Object.fromEntries(fields.map((f) => [f, clone(getField(it, f))]))
        : include === "allFieldsExcept"
          ? Object.fromEntries(Object.entries(clone(it)).filter(([k]) => !fields.includes(k)))
          : clone(it);
    return [{ [str(p.destinationFieldName, "data")]: items.map(pick) }];
  }
  const rows = isObj(p.fieldsToAggregate) && Array.isArray(p.fieldsToAggregate.fieldToAggregate) ? (p.fieldsToAggregate.fieldToAggregate as Record<string, unknown>[]) : [];
  const out: Item = {};
  for (const r of rows) {
    const field = str(r.fieldToAggregate);
    const name = r.renameField ? str(r.outputFieldName, field) : field;
    let values = items.map((it) => getField(it, field, opts.disableDotNotation !== true));
    if (opts.keepMissing !== true) values = values.filter((v) => v !== undefined && v !== null);
    if (opts.mergeLists === true) values = values.flatMap((v) => (Array.isArray(v) ? v : [v]));
    setField(out, name, clone(values), false);
  }
  return [out];
}

function summarize(items: Item[], p: Record<string, unknown>): Item[] {
  const rows = isObj(p.fieldsToSummarize) && Array.isArray(p.fieldsToSummarize.values) ? (p.fieldsToSummarize.values as Record<string, unknown>[]) : [];
  const by = list(p.fieldsToSplitBy);
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const k = JSON.stringify(by.map((f) => getField(it, f)));
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const out: Item[] = [];
  for (const [k, group] of groups) {
    const res: Item = {};
    const keys = JSON.parse(k) as unknown[];
    by.forEach((f, i) => (res[f] = keys[i]));
    for (const r of rows) {
      const agg = str(r.aggregation, "count");
      const field = str(r.field);
      const vals = group.map((it) => getField(it, field)).filter((v) => v !== undefined && v !== null && v !== "");
      const nums = vals.map(num).filter((x) => !Number.isNaN(x));
      let v: unknown;
      switch (agg) {
        case "count":
          v = vals.length;
          break;
        case "countUnique":
          v = new Set(vals.map((x) => JSON.stringify(x))).size;
          break;
        case "sum":
          v = nums.reduce((s, x) => s + x, 0);
          break;
        case "average":
          v = nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : null;
          break;
        case "min":
          v = nums.length ? Math.min(...nums) : null;
          break;
        case "max":
          v = nums.length ? Math.max(...nums) : null;
          break;
        case "append":
          v = clone(vals);
          break;
        case "concatenate":
          v = vals.map((x) => str(x)).join(r.separateBy === "other" ? str(r.customSeparator) : r.separateBy === "newLine" ? "\n" : ",");
          break;
        default:
          throw new Error(`Summarize "${agg}" is not supported`);
      }
      res[`${agg}_${field}`] = v;
    }
    out.push(res);
  }
  return out;
}

// ---------------------------------------------------------------- http

function withQuery(url: string, q: Record<string, unknown>): string {
  const pairs = Object.entries(q).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(str(v))}`);
  if (!pairs.length) return url;
  return url + (url.includes("?") ? "&" : "?") + pairs.join("&");
}

function httpRequestOf(n: N8nNode, p: Record<string, unknown>): HttpRequest & { format: string; full: boolean; neverError: boolean; dataField: string } {
  const v = n.version ?? 1;
  const opts = isObj(p.options) ? p.options : {};
  let method: string;
  let query: Record<string, unknown> = {};
  let headers: Record<string, string> = {};
  let body: string | null = null;
  let format = "autodetect";
  let full = false;
  let neverError = false;
  let dataField = "data";
  if (opts.pagination) throw new Error("HTTP Request pagination is not supported: request each page with its own node, or use a Code node");
  if (v >= 3) {
    method = str(p.method, "GET").toUpperCase();
    if (p.sendQuery) query = p.specifyQuery === "json" ? (jsonParam(p.jsonQuery, "the query") as Record<string, unknown>) : kv(isObj(p.queryParameters) ? p.queryParameters.parameters : []);
    if (p.sendHeaders) headers = p.specifyHeaders === "json" ? (jsonParam(p.jsonHeaders, "the headers") as Record<string, string>) : kv(isObj(p.headerParameters) ? p.headerParameters.parameters : []);
    if (p.sendBody) {
      const ct = str(p.contentType, "json");
      if (ct === "json") {
        body = JSON.stringify(p.specifyBody === "json" ? jsonParam(p.jsonBody, "the body") : kv(isObj(p.bodyParameters) ? p.bodyParameters.parameters : []));
        headers["content-type"] ??= "application/json";
      } else if (ct === "form-urlencoded") {
        const f = kv(isObj(p.bodyParameters) ? p.bodyParameters.parameters : []);
        body = Object.entries(f).map(([k, x]) => `${encodeURIComponent(k)}=${encodeURIComponent(x)}`).join("&");
        headers["content-type"] ??= "application/x-www-form-urlencoded";
      } else if (ct === "raw") {
        body = str(p.body);
        headers["content-type"] ??= str(p.rawContentType, "text/plain");
      } else throw new Error(`an HTTP body of type ${ct} is not supported (no binary data in a tool)`);
    }
    const resp = isObj(opts.response) && isObj(opts.response.response) ? opts.response.response : {};
    format = str(resp.responseFormat, "autodetect");
    full = resp.fullResponse === true;
    neverError = resp.neverError === true;
    dataField = str(resp.outputPropertyName, "data");
  } else {
    method = str(p.requestMethod, "GET").toUpperCase();
    if (p.jsonParameters) {
      query = jsonParam(p.queryParametersJson ?? "{}", "the query") as Record<string, unknown>;
      headers = jsonParam(p.headerParametersJson ?? "{}", "the headers") as Record<string, string>;
      if (method !== "GET" && p.bodyParametersJson !== undefined) body = JSON.stringify(jsonParam(p.bodyParametersJson, "the body"));
    } else {
      query = kv(isObj(p.queryParametersUi) ? p.queryParametersUi.parameter : []);
      headers = kv(isObj(p.headerParametersUi) ? p.headerParametersUi.parameter : []);
      const b = kv(isObj(p.bodyParametersUi) ? p.bodyParametersUi.parameter : []);
      if (method !== "GET" && Object.keys(b).length) body = JSON.stringify(b);
    }
    if (body !== null) headers["content-type"] ??= "application/json";
    format = str(p.responseFormat, "json") === "string" ? "text" : str(p.responseFormat, "json");
    full = opts.fullResponse === true;
    dataField = str(p.dataPropertyName, "data");
  }
  if (format === "file") throw new Error("an HTTP response as a file is not supported (no binary data in a tool)");
  const auth = str(p.authentication, "none");
  if (auth !== "none" && !n.credential) throw new Error(`the request uses ${auth} authentication: name the credential on the node`);
  return {
    url: withQuery(str(p.url), query),
    method,
    headers,
    body,
    ...(auth !== "none" && n.credential ? { credential: n.credential } : {}),
    format,
    full,
    neverError,
    dataField,
  };
}

function responseItems(r: HttpResponse, req: { format: string; full: boolean; dataField: string }): Item[] {
  let body: unknown = r.body;
  if (req.format !== "text") {
    try {
      body = r.body.trim() === "" ? {} : JSON.parse(r.body);
    } catch (e) {
      if (req.format === "json") throw new Error(`the response is not JSON: ${(e as Error).message}`);
      body = r.body;
    }
  }
  if (req.full) return [{ body: body as never, headers: r.headers, statusCode: r.status, statusMessage: "" }];
  if (typeof body === "string") return [{ [req.dataField]: body }];
  return toItems(body);
}

// ---------------------------------------------------------------- the node

/** Runs one n8n node; resolves with the items of each output (by index). */
export async function runN8n(ctx: N8nContext): Promise<Item[][]> {
  const n = ctx.node;
  const ins = ctx.inputs;
  const items = ins[0] ?? [];
  const js = (task: ExprTask) => ctx.js(task as unknown as Record<string, unknown>) as Promise<unknown[][]>;
  const params = (its: Item[] = items) => resolveParams(n.parameters, its, js, { nodes: ctx.nodes, node: n.name, workflow: ctx.workflow });
  const one = (xs: Item[]): Item[][] => [xs];
  const refs = (src: string) => {
    const out: Record<string, Item[]> = {};
    for (const name of referencedNodes(src)) if (ctx.nodes[name]) out[name] = ctx.nodes[name];
    return out;
  };
  /** Per item, with the node's "continue on fail" setting. */
  const perItem = async (fn: (p: Record<string, unknown>, it: Item, i: number) => Promise<Item[]>): Promise<Item[]> => {
    const ps = await params();
    const out: Item[] = [];
    for (let i = 0; i < ps.length; i++) {
      try {
        out.push(...(await fn(ps[i], items[i] ?? {}, i)));
      } catch (e) {
        if (n.on_error !== "continue") throw e;
        out.push({ error: (e as Error).message });
      }
    }
    return out;
  };

  switch (n.type) {
    case "n8n-nodes-base.noOp":
      return one(items.map(clone));
    case "n8n-nodes-base.wait": {
      const p = (await params())[0];
      const resume = str(p.resume, "timeInterval");
      if (resume === "webhook" || resume === "form") throw new Error(`Wait "${resume}" needs a running workflow to resume: a tool runs to the end`);
      return one(items.map(clone));
    }
    case "n8n-nodes-base.stopAndError": {
      const p = (await params())[0];
      throw new Error(p.errorType === "errorObject" ? str(p.errorObject) : str(p.errorMessage, "Stop and Error"));
    }
    case "n8n-nodes-base.httpRequest":
      return one(
        await perItem(async (p) => {
          const req = httpRequestOf(n, p);
          const res = await ctx.request({ url: req.url, method: req.method, headers: req.headers, body: req.body, ...(req.credential ? { credential: req.credential } : {}) });
          if ((res.status < 200 || res.status >= 300) && !req.neverError) throw new Error(`${req.method} ${req.url}: HTTP ${res.status}`);
          return responseItems(res, req);
        }),
      );
    case "n8n-nodes-base.rssFeedRead":
      return one(
        await perItem(async (p) => {
          const url = str(p.url);
          const res = await ctx.request({ url, method: "GET", headers: {}, body: null });
          if (res.status < 200 || res.status >= 300) throw new Error(`GET ${url}: HTTP ${res.status}`);
          return parseFeed(res.body).map((f) => {
            const iso = f.published && Number.isFinite(Date.parse(f.published)) ? new Date(Date.parse(f.published)).toISOString() : undefined;
            return {
              title: f.title,
              link: f.link,
              ...(f.published ? { pubDate: f.published } : {}),
              ...(f.summary ? { content: f.summary, contentSnippet: f.summary.replace(/<[^>]*>/g, "").trim() } : {}),
              guid: f.link,
              ...(iso ? { isoDate: iso } : {}),
            } as Item;
          });
        }),
      );
    case "n8n-nodes-base.set": {
      const v = n.version ?? 1;
      return one(
        await perItem(async (p, it) => {
          const opts = isObj(p.options) ? p.options : {};
          const dot = opts.dotNotation !== false;
          if (v < 3) {
            const res: Item = p.keepOnlySet === true ? {} : clone(it);
            const values = isObj(p.values) ? p.values : {};
            for (const type of Object.keys(values)) {
              for (const r of Array.isArray(values[type]) ? (values[type] as Record<string, unknown>[]) : []) {
                const x = type === "number" ? num(r.value) : type === "boolean" ? r.value === true || r.value === "true" : r.value;
                setField(res, str(r.name), x, dot);
              }
            }
            return [res];
          }
          const include = v >= 3.3 ? (p.includeOtherFields === true ? str(p.include, "all") : "none") : str(p.include, "none");
          let res: Item = {};
          if (include === "all") res = clone(it);
          else if (include === "selected") for (const f of list(p.includeFields)) setField(res, f, clone(getField(it, f)), dot);
          else if (include === "except") {
            res = clone(it);
            for (const f of list(p.excludeFields)) delete res[f];
          }
          if (str(p.mode, "manual") === "raw") {
            const raw = jsonParam(p.jsonOutput, "the JSON output");
            if (!isObj(raw)) throw new Error("Edit Fields (JSON) must produce an object");
            return [{ ...res, ...raw }];
          }
          const rows = isObj(p.assignments) && Array.isArray(p.assignments.assignments) ? (p.assignments.assignments as Record<string, unknown>[]) : isObj(p.fields) && Array.isArray(p.fields.values) ? (p.fields.values as Record<string, unknown>[]) : [];
          for (const r of rows) {
            const type = str(r.type, "string");
            let x: unknown = r.value !== undefined ? r.value : r[`${type}Value`];
            if (type === "number") x = num(x);
            else if (type === "boolean") x = x === true || x === "true";
            else if ((type === "array" || type === "object") && typeof x === "string") x = jsonParam(x, `the field ${str(r.name)}`);
            else if (type === "string" && x !== undefined && typeof x !== "string") x = str(x);
            setField(res, str(r.name), x, dot);
          }
          return [res];
        }),
      );
    }
    case "n8n-nodes-base.renameKeys":
      return one(
        await perItem(async (p, it) => {
          const res = clone(it);
          const rows = isObj(p.keys) && Array.isArray(p.keys.key) ? (p.keys.key as Record<string, unknown>[]) : [];
          for (const r of rows) {
            const v = getField(res, str(r.currentKey));
            if (v === undefined) continue;
            delete res[str(r.currentKey)];
            setField(res, str(r.newKey), v);
          }
          return [res];
        }),
      );
    case "n8n-nodes-base.if": {
      const ps = await params();
      const yes: Item[] = [];
      const no: Item[] = [];
      ps.forEach((p, i) => (((usesV2(n) ? conditionsV2(p.conditions, isObj(p.options) ? p.options : {}) : conditionsV1(p)) ? yes : no).push(clone(items[i] ?? {}))));
      return [yes, no];
    }
    case "n8n-nodes-base.filter": {
      const ps = await params();
      const kept = ps.flatMap((p, i) => ((usesV2(n) ? conditionsV2(p.conditions, isObj(p.options) ? p.options : {}) : conditionsV1(p)) ? [clone(items[i] ?? {})] : []));
      return [kept];
    }
    case "n8n-nodes-base.switch": {
      const ps = await params();
      const outs: Item[][] = Array.from({ length: Math.max(1, n.outputs) }, () => []);
      const route = (k: number, it: Item) => {
        if (k >= 0 && k < outs.length) outs[k].push(clone(it));
      };
      const v = n.version ?? 1;
      ps.forEach((p, i) => {
        const it = items[i] ?? {};
        const opts = isObj(p.options) ? p.options : {};
        if (str(p.mode, "rules") === "expression") return route(Number(p.output ?? 0), it);
        if (v >= 3) {
          const rules = isObj(p.rules) && Array.isArray(p.rules.values) ? (p.rules.values as Record<string, unknown>[]) : [];
          const hits = rules.map((r, k) => (conditionsV2(r.conditions, opts) ? k : -1)).filter((k) => k >= 0);
          if (hits.length) return (opts.allMatchingOutputs === true ? hits : hits.slice(0, 1)).forEach((k) => route(k, it));
          const fb = opts.fallbackOutput;
          if (fb === "extra") route(rules.length, it);
          else if (fb !== undefined && fb !== "none") route(Number(fb), it);
          return;
        }
        const rules = isObj(p.rules) && Array.isArray(p.rules.rules) ? (p.rules.rules as Record<string, unknown>[]) : [];
        const type = str(p.dataType, "number");
        const hit = rules.find((r) => compareV1(type, str(r.operation, "equal"), p.value1, r.value2));
        if (hit) route(Number(hit.output ?? 0), it);
        else if (p.fallbackOutput !== undefined && Number(p.fallbackOutput) >= 0) route(Number(p.fallbackOutput), it);
      });
      return outs;
    }
    case "n8n-nodes-base.merge": {
      const p = (await params(ins.flat()))[0];
      return one(mergeNode(n, p, ins));
    }
    case "n8n-nodes-base.limit": {
      const p = (await params())[0];
      const max = Math.max(0, Number(p.maxItems ?? 1));
      return one((p.keep === "lastItems" ? items.slice(Math.max(0, items.length - max)) : items.slice(0, max)).map(clone));
    }
    case "n8n-nodes-base.sort": {
      const p = (await params())[0];
      const type = str(p.type, "simple");
      if (type === "random") {
        const a = items.map(clone);
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return one(a);
      }
      if (type === "code") return one((await ctx.js({ op: "sort", items, source: str(p.code), nodes: refs(str(p.code)), node: n.name, workflow: ctx.workflow })) as Item[]);
      const fields = isObj(p.sortFieldsUi) && Array.isArray(p.sortFieldsUi.sortField) ? (p.sortFieldsUi.sortField as Array<{ fieldName?: string; order?: string }>) : [];
      return one(sortSimple(items, fields, !(isObj(p.options) && p.options.disableDotNotation === true)));
    }
    case "n8n-nodes-base.removeDuplicates":
      return one(removeDuplicates(items, (await params())[0]));
    case "n8n-nodes-base.splitOut":
      return one(splitOut(items, (await params())[0]));
    case "n8n-nodes-base.aggregate":
      return one(aggregate(items, (await params())[0]));
    case "n8n-nodes-base.summarize":
      return one(summarize(items, (await params())[0]));
    case "n8n-nodes-base.itemLists": {
      const p = (await params())[0];
      switch (str(p.operation, "splitOutItems")) {
        case "splitOutItems":
          return one(splitOut(items, p));
        case "aggregateItems":
          return one(aggregate(items, p));
        case "concatenateItems":
          return one(aggregate(items, { ...p, aggregate: "aggregateAllItemData" }));
        case "removeDuplicates":
          return one(removeDuplicates(items, { ...p, operation: undefined }));
        case "sort":
          return one(sortSimple(items, isObj(p.sortFieldsUi) && Array.isArray(p.sortFieldsUi.sortField) ? (p.sortFieldsUi.sortField as Array<{ fieldName?: string; order?: string }>) : [], true));
        case "limit":
          return one(p.keep === "lastItems" ? items.slice(-Number(p.maxItems ?? 1)) : items.slice(0, Number(p.maxItems ?? 1)));
        case "summarize":
          return one(summarize(items, p));
      }
      throw new Error(`Item Lists "${str(p.operation)}" is not supported`);
    }
    case "n8n-nodes-base.dateTime": {
      if ((n.version ?? 1) < 2) throw new Error("Date & Time v1 uses Moment formats: replace it with Date & Time v2");
      const ps = await params();
      return one((await ctx.js({ op: "dateTime", items: items.length ? items : [{}], params: ps })) as Item[]);
    }
    case "n8n-nodes-base.code":
    case "n8n-nodes-base.function":
    case "n8n-nodes-base.functionItem": {
      const p = n.parameters;
      let mode: string;
      let source: string;
      if (n.type === "n8n-nodes-base.code") {
        const lang = str(p.language, "javaScript");
        if (lang !== "javaScript") throw new Error(`a ${lang} Code node is not supported: swarm.press runs JavaScript only`);
        mode = str(p.mode, "runOnceForAllItems") === "runOnceForEachItem" ? "each" : "all";
        source = str(p.jsCode);
      } else {
        mode = n.type === "n8n-nodes-base.function" ? "function" : "functionItem";
        source = str(p.functionCode);
      }
      return one((await ctx.js({ op: "code", mode, source, items: items.length ? items : [{}], nodes: refs(source), node: n.name, workflow: ctx.workflow })) as Item[]);
    }
    case "n8n-nodes-base.respondToWebhook": {
      const p = (await params())[0];
      switch (str(p.respondWith, "firstIncomingItem")) {
        case "allIncomingItems":
          return one(items.map(clone));
        case "firstIncomingItem":
          return one(items.slice(0, 1).map(clone));
        case "json":
          return one(toItems(jsonParam(p.responseBody, "the response body")));
        case "text":
          return one([{ data: str(p.responseBody) }]);
        case "noData":
          return one([{}]);
      }
      throw new Error(`Respond to Webhook "${str(p.respondWith)}" is not supported`);
    }
    case "n8n-nodes-base.executeWorkflow": {
      if (!n.tool) throw new Error("Execute Workflow names no tool: choose the site tool the sub-workflow became");
      const p = (await params())[0];
      const call = async (its: Item[]) => {
        const r = await ctx.tool(n.tool!, { request: its });
        if (!isObj(r)) return toItems(r);
        const ports = Object.keys(r).sort();
        return ports.length === 1 ? toItems(r[ports[0]]) : toItems(r);
      };
      if (str(p.mode, "once") === "each") return one((await Promise.all(items.map((it) => call([it])))).flat());
      return one(await call(items));
    }
    case "@n8n/n8n-nodes-langchain.chainLlm":
      return one(
        await perItem(async (p, it) => {
          const auto = str(p.promptType, (n.version ?? 1) >= 1.4 ? "auto" : "define") === "auto";
          const prompt = auto ? str(it.chatInput ?? p.text ?? p.prompt) : str(p.text ?? p.prompt);
          if (!prompt.trim()) throw new Error("the LLM chain has no prompt");
          const sys = isObj(p.messages) && Array.isArray(p.messages.messageValues) ? (p.messages.messageValues as Record<string, unknown>[]).map((m) => str(m.message)).filter(Boolean) : [];
          const text = await ctx.llm([...sys, prompt].join("\n\n"));
          return [{ text }];
        }),
      );
    case "@n8n/n8n-nodes-langchain.openAi":
      return one(
        await perItem(async (p) => {
          const resource = str(p.resource, "text");
          const op = str(p.operation, "message");
          if (resource !== "text" || op !== "message") throw new Error(`OpenAI ${resource}/${op} is not supported: only "Message a model"`);
          const msgs = isObj(p.messages) && Array.isArray(p.messages.values) ? (p.messages.values as Record<string, unknown>[]) : [];
          const prompt = msgs.map((m) => (str(m.role, "user") === "user" ? str(m.content) : `(${str(m.role)}) ${str(m.content)}`)).join("\n\n");
          if (!prompt.trim()) throw new Error("the OpenAI node has no message");
          const reply = await ctx.llm(prompt);
          let content: unknown = reply;
          if (p.jsonOutput === true) content = jsonParam(reply.trim().replace(/^```[a-z]*\s*|\s*```$/g, ""), "the model's reply");
          return [{ index: 0, message: { role: "assistant", content }, logprobs: null, finish_reason: "stop" }];
        }),
      );
  }
  throw new Error(`the n8n node type ${n.type} is not supported (a sealed step)`);
}
