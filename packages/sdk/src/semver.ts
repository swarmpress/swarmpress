/**
 * Minimal semver (2.0.0) for manifest checks: versions, and ranges built from
 * `^`, `~`, comparators (`>=`, `>`, `<=`, `<`, `=`), `x`/`*` wildcards,
 * space-separated AND sets and `||` alternatives. Pre-release versions only
 * satisfy comparators that name the same `major.minor.patch` (npm rule).
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

const VERSION_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const SEMVER_PATTERN = VERSION_RE.source;

export function parseVersion(v: string): SemVer | null {
  const m = VERSION_RE.exec(v.trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split(".") : [] };
}

export function compare(a: SemVer, b: SemVer): number {
  for (const k of ["major", "minor", "patch"] as const) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1; // a release ranks above its pre-releases
  if (b.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return +x < +y ? -1 : 1;
    if (nx) return -1;
    if (ny) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

type Op = ">=" | ">" | "<=" | "<" | "=";
interface Comparator {
  op: Op;
  v: SemVer;
}

const PARTIAL_RE = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/;

function partial(s: string): { major?: number; minor?: number; patch?: number; pre: string[] } | null {
  const m = PARTIAL_RE.exec(s);
  if (!m) return null;
  const n = (x?: string) => (x === undefined || /^[xX*]$/.test(x) ? undefined : +x);
  const major = n(m[1]);
  const minor = major === undefined ? undefined : n(m[2]);
  const patch = minor === undefined ? undefined : n(m[3]);
  return { major, minor, patch, pre: m[4] && patch !== undefined ? m[4].split(".") : [] };
}

const V = (major: number, minor: number, patch: number, pre: string[] = []): SemVer => ({ major, minor, patch, pre });

function expand(token: string): Comparator[] | null {
  if (token === "*" || token === "x" || token === "X" || token === "") return [];
  const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(token);
  if (!m) return null;
  const op = m[1] ?? "";
  const p = partial(m[2]);
  if (!p) return null;
  const { major, minor, patch, pre } = p;
  if (major === undefined) return op === "" || op === "=" || op === ">=" || op === "<=" ? [] : null;
  if (op === "^") {
    const lo = V(major, minor ?? 0, patch ?? 0, pre);
    const hi =
      major > 0 || minor === undefined
        ? V(major + 1, 0, 0)
        : minor > 0 || patch === undefined
          ? V(0, minor + 1, 0)
          : V(0, 0, patch + 1);
    return [{ op: ">=", v: lo }, { op: "<", v: { ...hi, pre: ["0"] } }];
  }
  if (op === "~") {
    const lo = V(major, minor ?? 0, patch ?? 0, pre);
    const hi = minor === undefined ? V(major + 1, 0, 0) : V(major, minor + 1, 0);
    return [{ op: ">=", v: lo }, { op: "<", v: { ...hi, pre: ["0"] } }];
  }
  if (minor === undefined || patch === undefined) {
    // x-range: 1 → >=1.0.0 <2.0.0-0 ; 1.2 → >=1.2.0 <1.3.0-0
    const lo = V(major, minor ?? 0, 0);
    const hi = minor === undefined ? V(major + 1, 0, 0, ["0"]) : V(major, minor + 1, 0, ["0"]);
    switch (op) {
      case "":
      case "=":
        return [{ op: ">=", v: lo }, { op: "<", v: hi }];
      case ">=":
        return [{ op: ">=", v: lo }];
      case "<":
        return [{ op: "<", v: { ...lo, pre: ["0"] } }];
      case ">":
        return [{ op: ">=", v: hi }];
      case "<=":
        return [{ op: "<", v: hi }];
    }
  }
  return [{ op: (op === "" ? "=" : op) as Op, v: V(major, minor!, patch!, pre) }];
}

function parseRange(range: string): Comparator[][] | null {
  const sets: Comparator[][] = [];
  for (const alt of range.split("||")) {
    // hyphen ranges are not supported; join "op version" written with a space
    const tokens = alt.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1").split(/\s+/).filter(Boolean);
    const set: Comparator[] = [];
    for (const t of tokens) {
      const c = expand(t);
      if (!c) return null;
      set.push(...c);
    }
    sets.push(set);
  }
  return sets;
}

export function validRange(range: string): boolean {
  return range.trim() !== "" && parseRange(range) !== null;
}

function test(c: Comparator, v: SemVer): boolean {
  const r = compare(v, c.v);
  switch (c.op) {
    case ">=":
      return r >= 0;
    case ">":
      return r > 0;
    case "<=":
      return r <= 0;
    case "<":
      return r < 0;
    case "=":
      return r === 0;
  }
}

/** Whether `version` satisfies `range`. Invalid input never satisfies. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  const sets = parseRange(range);
  if (!v || !sets) return false;
  return sets.some((set) => {
    if (!set.every((c) => test(c, v))) return false;
    if (v.pre.length === 0) return true;
    // pre-releases only match comparators on the same [major, minor, patch] tuple
    const synthetic = (c: Comparator) => c.op === "<" && c.v.pre.length === 1 && c.v.pre[0] === "0";
    return set.some(
      (c) =>
        c.v.pre.length > 0 &&
        !synthetic(c) &&
        c.v.major === v.major &&
        c.v.minor === v.minor &&
        c.v.patch === v.patch,
    );
  });
}
