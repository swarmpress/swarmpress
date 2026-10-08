/**
 * The program the code sandbox runs for n8n JavaScript (ADR-0076): Code,
 * Function and Function Item nodes, expressions, the Date & Time node and a
 * sort's comparator.
 *
 * It runs in a fresh QuickJS sandbox with no capabilities (the `code`
 * facility of `@swarm-press/sandbox`): no fetch, no model, no store, no
 * modules; only the items it is given. Its globals are n8n's:
 *
 * - `$json`, `$input` (`all()`, `first()`, `last()`, `item`), `items`, `item`,
 *   `$('Node')` (`all()`, `first()`, `last()`, `item`, `itemMatching(i)`),
 *   `$node["Node"].json`, `$items()`, `$itemIndex`, `$runIndex`, `$workflow`,
 *   `$execution`, `$vars`, `$if`, `$ifEmpty`, `$max`, `$min`;
 * - `$now`, `$today` and `DateTime` / `Duration`: a Luxon subset in UTC;
 * - n8n's helper methods on strings, numbers, arrays and objects
 *   (`isEmpty()`, `toTitleCase()`, `extractDomain()`, `sum()`, `pluck()`, `round()`…).
 *
 * `$env`, `$jmespath`, `require` and `this.helpers` fail with a reason: a
 * tool reaches the world only through its nodes. Values cross back as JSON
 * (`undefined` as `{"$undefined": true}`, a DateTime as its ISO text).
 */
export const N8N_PRELUDE = String.raw`(function () {
"use strict";
var UNDEF = { $undefined: true };
var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
var isObj = function (v) { return v !== null && typeof v === "object" && !Array.isArray(v); };
var clone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
var fail = function (m) { throw new Error(m); };

// ------------------------------------------------------------ DateTime (Luxon subset, UTC)
var UNITS = { year: "years", years: "years", quarter: "quarters", quarters: "quarters", month: "months", months: "months", week: "weeks", weeks: "weeks", day: "days", days: "days", hour: "hours", hours: "hours", minute: "minutes", minutes: "minutes", second: "seconds", seconds: "seconds", millisecond: "milliseconds", milliseconds: "milliseconds" };
var MS = { weeks: 604800000, days: 86400000, hours: 3600000, minutes: 60000, seconds: 1000, milliseconds: 1 };
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
var pad = function (n, w) { var s = String(Math.abs(n)); while (s.length < w) s = "0" + s; return (n < 0 ? "-" : "") + s; };

function Duration(values) { this.values = values || {}; }
Duration.fromObject = function (o) { var v = {}; Object.keys(o || {}).forEach(function (k) { var u = UNITS[k]; if (!u) fail("Duration: unknown unit " + k); v[u] = Number(o[k]); }); return new Duration(v); };
Duration.fromMillis = function (ms) { return new Duration({ milliseconds: ms }); };
Duration.prototype.toMillis = function () { var t = 0, v = this.values; Object.keys(v).forEach(function (u) { if (MS[u] === undefined) fail("Duration: " + u + " has no fixed length"); t += v[u] * MS[u]; }); return t; };
Duration.prototype.as = function (unit) { var u = UNITS[unit]; if (!u) fail("Duration: unknown unit " + unit); if (hasOwn(this.values, u) && Object.keys(this.values).length === 1) return this.values[u]; if (u === "months" || u === "years" || u === "quarters") { var d = this.toMillis() / MS.days; return u === "years" ? d / 365.25 : u === "quarters" ? d / 91.3125 : d / 30.4375; } return this.toMillis() / MS[u]; };
Duration.prototype.toObject = function () { return clone(this.values); };
Duration.prototype.toJSON = function () { return this.values; };
["years", "quarters", "months", "weeks", "days", "hours", "minutes", "seconds", "milliseconds"].forEach(function (u) { Object.defineProperty(Duration.prototype, u, { get: function () { return this.values[u] || 0; } }); });

function DateTime(ms) { this.ts = ms; }
var mkDate = function (ms) { return new DateTime(ms); };
DateTime.now = function () { return mkDate(Date.now()); };
DateTime.utc = function () { if (!arguments.length) return DateTime.now(); var a = Array.prototype.slice.call(arguments); return mkDate(Date.UTC(a[0], (a[1] || 1) - 1, a[2] || 1, a[3] || 0, a[4] || 0, a[5] || 0, a[6] || 0)); };
DateTime.local = DateTime.utc;
DateTime.fromMillis = function (ms) { return mkDate(Number(ms)); };
DateTime.fromSeconds = function (s) { return mkDate(Number(s) * 1000); };
DateTime.fromJSDate = function (d) { return mkDate(d.getTime()); };
DateTime.fromISO = function (s) { var t = Date.parse(String(s)); return mkDate(t); };
DateTime.fromSQL = function (s) { return DateTime.fromISO(String(s).replace(" ", "T")); };
DateTime.fromRFC2822 = function (s) { return mkDate(Date.parse(String(s))); };
DateTime.fromHTTP = DateTime.fromRFC2822;
DateTime.fromObject = function (o) { o = o || {}; return mkDate(Date.UTC(o.year || 1970, (o.month || 1) - 1, o.day || 1, o.hour || 0, o.minute || 0, o.second || 0, o.millisecond || 0)); };
DateTime.fromFormat = function (s, fmt) { fail("DateTime.fromFormat is not available: use DateTime.fromISO"); };
DateTime.isDateTime = function (v) { return v instanceof DateTime; };
DateTime.max = function () { var a = Array.prototype.slice.call(arguments); return a.reduce(function (x, y) { return y.ts > x.ts ? y : x; }); };
DateTime.min = function () { var a = Array.prototype.slice.call(arguments); return a.reduce(function (x, y) { return y.ts < x.ts ? y : x; }); };
var P = DateTime.prototype;
var d8 = function (dt) { return new Date(dt.ts); };
Object.defineProperty(P, "isValid", { get: function () { return isFinite(this.ts); } });
Object.defineProperty(P, "year", { get: function () { return d8(this).getUTCFullYear(); } });
Object.defineProperty(P, "month", { get: function () { return d8(this).getUTCMonth() + 1; } });
Object.defineProperty(P, "quarter", { get: function () { return Math.floor(d8(this).getUTCMonth() / 3) + 1; } });
Object.defineProperty(P, "day", { get: function () { return d8(this).getUTCDate(); } });
Object.defineProperty(P, "hour", { get: function () { return d8(this).getUTCHours(); } });
Object.defineProperty(P, "minute", { get: function () { return d8(this).getUTCMinutes(); } });
Object.defineProperty(P, "second", { get: function () { return d8(this).getUTCSeconds(); } });
Object.defineProperty(P, "millisecond", { get: function () { return d8(this).getUTCMilliseconds(); } });
Object.defineProperty(P, "weekday", { get: function () { var w = d8(this).getUTCDay(); return w === 0 ? 7 : w; } });
Object.defineProperty(P, "weekdayLong", { get: function () { return DAYS[this.weekday - 1]; } });
Object.defineProperty(P, "weekdayShort", { get: function () { return DAYS[this.weekday - 1].slice(0, 3); } });
Object.defineProperty(P, "monthLong", { get: function () { return MONTHS[this.month - 1]; } });
Object.defineProperty(P, "monthShort", { get: function () { return MONTHS[this.month - 1].slice(0, 3); } });
Object.defineProperty(P, "ordinal", { get: function () { return Math.floor((this.ts - Date.UTC(this.year, 0, 1)) / MS.days) + 1; } });
Object.defineProperty(P, "daysInMonth", { get: function () { return new Date(Date.UTC(this.year, this.month, 0)).getUTCDate(); } });
Object.defineProperty(P, "weekNumber", { get: function () { var d = new Date(Date.UTC(this.year, this.month - 1, this.day)); var n = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - n + 3); var first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d - first) / MS.days - 3 + ((first.getUTCDay() + 6) % 7)) / 7); } });
Object.defineProperty(P, "zoneName", { get: function () { return "UTC"; } });
Object.defineProperty(P, "offset", { get: function () { return 0; } });
P.valueOf = function () { return this.ts; };
P.toMillis = function () { return this.ts; };
P.toSeconds = function () { return this.ts / 1000; };
P.toUnixInteger = function () { return Math.floor(this.ts / 1000); };
P.toJSDate = function () { return new Date(this.ts); };
P.toISO = function () { if (!this.isValid) return null; return new Date(this.ts).toISOString().replace("Z", "+00:00"); };
P.toISODate = function () { return this.isValid ? new Date(this.ts).toISOString().slice(0, 10) : null; };
P.toISOTime = function () { return this.isValid ? new Date(this.ts).toISOString().slice(11, 23) + "+00:00" : null; };
P.toSQLDate = P.toISODate;
P.toSQL = function () { return this.isValid ? new Date(this.ts).toISOString().slice(0, 23).replace("T", " ") : null; };
P.toHTTP = function () { return new Date(this.ts).toUTCString(); };
P.toRFC2822 = P.toHTTP;
P.toJSON = function () { return this.toISO(); };
P.toString = function () { return this.isValid ? this.toISO() : "Invalid DateTime"; };
P.toLocaleString = function () { return this.toFormat("M/d/yyyy, h:mm:ss a"); };
P.setZone = function () { return this; };
P.toUTC = function () { return this; };
P.toLocal = function () { return this; };
P.setLocale = function () { return this; };
P.equals = function (o) { return o instanceof DateTime && o.ts === this.ts; };
var addUnits = function (dt, dur, sign) {
  var o = dur instanceof Duration ? dur.values : typeof dur === "number" ? { milliseconds: dur } : Duration.fromObject(dur).values;
  var d = new Date(dt.ts);
  if (o.years) d.setUTCFullYear(d.getUTCFullYear() + sign * o.years);
  if (o.quarters) d.setUTCMonth(d.getUTCMonth() + sign * 3 * o.quarters);
  if (o.months) d.setUTCMonth(d.getUTCMonth() + sign * o.months);
  var t = d.getTime();
  ["weeks", "days", "hours", "minutes", "seconds", "milliseconds"].forEach(function (u) { if (o[u]) t += sign * o[u] * MS[u]; });
  return mkDate(t);
};
P.plus = function (dur) { return addUnits(this, dur, 1); };
P.minus = function (dur) { return addUnits(this, dur, -1); };
P.startOf = function (unit) {
  var u = UNITS[unit] || fail("startOf: unknown unit " + unit), d = new Date(this.ts);
  var y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate(), h = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds();
  switch (u) {
    case "years": return mkDate(Date.UTC(y, 0, 1));
    case "quarters": return mkDate(Date.UTC(y, m - (m % 3), 1));
    case "months": return mkDate(Date.UTC(y, m, 1));
    case "weeks": return mkDate(Date.UTC(y, m, day) - (this.weekday - 1) * MS.days);
    case "days": return mkDate(Date.UTC(y, m, day));
    case "hours": return mkDate(Date.UTC(y, m, day, h));
    case "minutes": return mkDate(Date.UTC(y, m, day, h, mi));
    case "seconds": return mkDate(Date.UTC(y, m, day, h, mi, s));
    default: return this;
  }
};
P.endOf = function (unit) { var u = UNITS[unit]; var o = {}; o[u === "quarters" ? "months" : u] = u === "quarters" ? 3 : 1; return this.startOf(unit).plus(o).minus(1); };
P.set = function (o) { var d = new Date(this.ts); o = o || {};
  if (o.year !== undefined) d.setUTCFullYear(o.year); if (o.month !== undefined) d.setUTCMonth(o.month - 1); if (o.day !== undefined) d.setUTCDate(o.day);
  if (o.hour !== undefined) d.setUTCHours(o.hour); if (o.minute !== undefined) d.setUTCMinutes(o.minute); if (o.second !== undefined) d.setUTCSeconds(o.second); if (o.millisecond !== undefined) d.setUTCMilliseconds(o.millisecond);
  return mkDate(d.getTime()); };
P.get = function (unit) { return this[unit]; };
P.diff = function (other, unit) { var ms = this.ts - asDate(other).ts; var units = unit === undefined ? ["milliseconds"] : Array.isArray(unit) ? unit : [unit]; if (units.length === 1) { var u = UNITS[units[0]]; var v = {}; v[u] = new Duration({ milliseconds: ms }).as(u); return new Duration(v); } var out = {}, rest = ms; units.map(function (x) { return UNITS[x]; }).sort(function (a, b) { return (MS[b] || 0) - (MS[a] || 0); }).forEach(function (u) { var size = MS[u] || (u === "months" ? 30.4375 * MS.days : u === "years" ? 365.25 * MS.days : 91.3125 * MS.days); out[u] = Math.trunc(rest / size); rest -= out[u] * size; }); return new Duration(out); };
P.diffNow = function (unit) { return this.diff(DateTime.now(), unit); };
P.hasSame = function (other, unit) { return this.startOf(unit).ts === asDate(other).startOf(unit).ts; };
var TOKENS = /'[^']*'|yyyy|yy|y|MMMM|MMM|MM|M|LLLL|LLL|LL|L|dd|d|EEEE|EEE|E|cccc|ccc|c|HH|H|hh|h|mm|m|ss|s|SSS|S|a|ZZZ|ZZ|Z|ooo|o|kkkk|kk|WW|W|q|X|x/g;
P.toFormat = function (fmt) { var dt = this; if (!dt.isValid) return "Invalid DateTime";
  return String(fmt).replace(TOKENS, function (t) {
    switch (t) {
      case "yyyy": case "kkkk": return pad(dt.year, 4); case "yy": case "kk": return pad(dt.year % 100, 2); case "y": return String(dt.year);
      case "MMMM": case "LLLL": return dt.monthLong; case "MMM": case "LLL": return dt.monthShort; case "MM": case "LL": return pad(dt.month, 2); case "M": case "L": return String(dt.month);
      case "dd": return pad(dt.day, 2); case "d": return String(dt.day);
      case "EEEE": case "cccc": return dt.weekdayLong; case "EEE": case "ccc": return dt.weekdayShort; case "E": case "c": return String(dt.weekday);
      case "HH": return pad(dt.hour, 2); case "H": return String(dt.hour);
      case "hh": return pad(((dt.hour + 11) % 12) + 1, 2); case "h": return String(((dt.hour + 11) % 12) + 1);
      case "mm": return pad(dt.minute, 2); case "m": return String(dt.minute); case "ss": return pad(dt.second, 2); case "s": return String(dt.second);
      case "SSS": return pad(dt.millisecond, 3); case "S": return String(dt.millisecond); case "a": return dt.hour < 12 ? "AM" : "PM";
      case "ZZZ": return "+0000"; case "ZZ": return "+00:00"; case "Z": return "+0";
      case "ooo": return pad(dt.ordinal, 3); case "o": return String(dt.ordinal); case "WW": return pad(dt.weekNumber, 2); case "W": return String(dt.weekNumber);
      case "q": return String(dt.quarter); case "X": return String(dt.toUnixInteger()); case "x": return String(dt.ts);
      default: return t.slice(1, -1);
    }
  }); };
var asDate = function (v) {
  if (v instanceof DateTime) return v;
  if (v instanceof Date) return mkDate(v.getTime());
  if (typeof v === "number") return mkDate(v);
  if (typeof v === "string") { var t = Date.parse(v); if (!isFinite(t) && /^\d+$/.test(v)) t = Number(v); return mkDate(t); }
  fail("not a date: " + JSON.stringify(v));
};

// ------------------------------------------------------------ n8n's helper methods
var def = function (proto, name, fn) { if (!hasOwn(proto, name)) Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true, enumerable: false }); };
var S = String.prototype, A = Array.prototype, N = Number.prototype, O = Object.prototype, B = Boolean.prototype;
var words = function (s) { return String(s).replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean); };
def(S, "isEmpty", function () { return this.length === 0; });
def(S, "isNotEmpty", function () { return this.length > 0; });
def(S, "isBlank", function () { return this.trim().length === 0; });
def(S, "toTitleCase", function () { return this.toLowerCase().replace(/(^|[\s-])(\S)/g, function (m, a, b) { return a + b.toUpperCase(); }); });
def(S, "toSentenceCase", function () { var s = this.toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); });
def(S, "toSnakeCase", function () { return words(this).join("_").toLowerCase(); });
def(S, "toKebabCase", function () { return words(this).join("-").toLowerCase(); });
def(S, "toCamelCase", function () { return words(this).map(function (w, i) { w = w.toLowerCase(); return i ? w.charAt(0).toUpperCase() + w.slice(1) : w; }).join(""); });
def(S, "extractDomain", function () { var m = /^(?:[a-z]+:\/\/)?(?:[^@\/]+@)?([^:\/?#]+)/i.exec(this.trim()); return m ? m[1].replace(/^www\./, "") : undefined; });
def(S, "extractEmail", function () { var m = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(this); return m ? m[0] : undefined; });
def(S, "extractUrl", function () { var m = /https?:\/\/[^\s"'<>]+/.exec(this); return m ? m[0] : undefined; });
def(S, "extractUrlPath", function () { var m = /^[a-z]+:\/\/[^\/]+(\/[^?#]*)?/i.exec(this); return m ? m[1] || "/" : undefined; });
def(S, "isEmail", function () { return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(this); });
def(S, "isUrl", function () { return /^https?:\/\/[^\s]+$/.test(this); });
def(S, "isDomain", function () { return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(this); });
def(S, "isNumeric", function () { return this.trim() !== "" && isFinite(Number(this)); });
def(S, "toNumber", function () { var n = Number(this); if (isNaN(n)) fail("cannot convert " + JSON.stringify(String(this)) + " to a number"); return n; });
def(S, "toFloat", S.toNumber);
def(S, "toInt", function () { var n = parseInt(this, 10); if (isNaN(n)) fail("cannot convert " + JSON.stringify(String(this)) + " to an integer"); return n; });
def(S, "toBoolean", function () { return !/^(false|no|0|)$/i.test(this.trim()); });
def(S, "toDateTime", function () { return asDate(String(this)); });
def(S, "toDate", S.toDateTime);
def(S, "toJsonString", function () { return JSON.stringify(String(this)); });
def(S, "parseJson", function () { return JSON.parse(this); });
def(S, "urlEncode", function (all) { return all ? encodeURIComponent(this) : encodeURI(this); });
def(S, "urlDecode", function (all) { return all ? decodeURIComponent(this) : decodeURI(this); });
def(S, "removeTags", function () { return this.replace(/<[^>]*>/g, ""); });
def(S, "removeMarkdown", function () { return this.replace(/[#*_>~\x60]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); });
def(S, "replaceSpecialChars", function () { return this.normalize("NFD").replace(/[̀-ͯ]/g, ""); });
def(S, "quote", function (q) { q = q || '"'; return q + this.split(q).join("\\" + q) + q; });
def(A, "first", function () { return this[0]; });
def(A, "last", function () { return this[this.length - 1]; });
def(A, "isEmpty", function () { return this.length === 0; });
def(A, "isNotEmpty", function () { return this.length > 0; });
def(A, "sum", function () { return this.reduce(function (a, b) { return a + Number(b); }, 0); });
def(A, "max", function () { return Math.max.apply(null, this.map(Number)); });
def(A, "min", function () { return Math.min.apply(null, this.map(Number)); });
def(A, "average", function () { return this.length ? this.sum() / this.length : 0; });
def(A, "removeDuplicates", function (key) { var seen = {}; return this.filter(function (x) { var k = JSON.stringify(key && isObj(x) ? x[key] : x); if (hasOwn(seen, k)) return false; seen[k] = 1; return true; }); });
def(A, "unique", A.removeDuplicates);
def(A, "compact", function () { return this.filter(function (x) { return x !== null && x !== undefined && x !== "" && !(isObj(x) && !Object.keys(x).length); }); });
def(A, "pluck", function () { var f = Array.prototype.slice.call(arguments); return this.map(function (x) { if (!isObj(x)) return undefined; if (f.length === 1) return x[f[0]]; var o = {}; f.forEach(function (k) { o[k] = x[k]; }); return o; }); });
def(A, "chunk", function (n) { var out = []; for (var i = 0; i < this.length; i += n) out.push(this.slice(i, i + n)); return out; });
def(A, "difference", function (o) { var s = (o || []).map(function (x) { return JSON.stringify(x); }); return this.filter(function (x) { return s.indexOf(JSON.stringify(x)) < 0; }); });
def(A, "intersection", function (o) { var s = (o || []).map(function (x) { return JSON.stringify(x); }); return this.filter(function (x) { return s.indexOf(JSON.stringify(x)) >= 0; }).removeDuplicates(); });
def(A, "union", function (o) { return this.concat(o || []).removeDuplicates(); });
def(A, "append", function () { return this.concat(Array.prototype.slice.call(arguments)); });
def(A, "smartJoin", function (k, v) { var o = {}; this.forEach(function (x) { if (isObj(x)) o[x[k]] = x[v]; }); return o; });
def(A, "toJsonString", function () { return JSON.stringify(this); });
def(A, "randomItem", function () { return this[Math.floor(Math.random() * this.length)]; });
def(N, "round", function (d) { var f = Math.pow(10, d || 0); return Math.round(this * f) / f; });
def(N, "floor", function () { return Math.floor(this); });
def(N, "ceil", function () { return Math.ceil(this); });
def(N, "abs", function () { return Math.abs(this); });
def(N, "isEven", function () { return this % 2 === 0; });
def(N, "isOdd", function () { return Math.abs(this % 2) === 1; });
def(N, "isInteger", function () { return Number.isInteger(Number(this)); });
def(N, "toInt", function () { return Math.trunc(this); });
def(N, "toFloat", function () { return Number(this); });
def(N, "toBoolean", function () { return Number(this) !== 0; });
def(N, "toDateTime", function (f) { return f === "s" || f === "seconds" ? DateTime.fromSeconds(Number(this)) : DateTime.fromMillis(Number(this)); });
def(N, "format", function () { var p = String(this).split("."); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); return p.join("."); });
def(B, "toInt", function () { return this.valueOf() ? 1 : 0; });
def(B, "toNumber", B.toInt);
def(O, "isEmpty", function () { return Object.keys(this).length === 0; });
def(O, "isNotEmpty", function () { return Object.keys(this).length > 0; });
def(O, "hasField", function (k) { return hasOwn(this, k); });
def(O, "removeField", function (k) { var o = clone(this); delete o[k]; return o; });
def(O, "removeFieldsContaining", function (s) { var o = {}, t = this; Object.keys(t).forEach(function (k) { if (String(t[k]).indexOf(s) < 0) o[k] = t[k]; }); return o; });
def(O, "keepFieldsContaining", function (s) { var o = {}, t = this; Object.keys(t).forEach(function (k) { if (String(t[k]).indexOf(s) >= 0) o[k] = t[k]; }); return o; });
def(O, "compact", function () { var o = {}, t = this; Object.keys(t).forEach(function (k) { if (t[k] !== null && t[k] !== undefined && t[k] !== "") o[k] = t[k]; }); return o; });
def(O, "toJsonString", function () { return JSON.stringify(this); });
def(O, "keys", function () { return Object.keys(this); });
def(O, "values", function () { return Object.keys(this).map(function (k) { return this[k]; }, this); });
def(O, "urlEncode", function () { var t = this; return Object.keys(t).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(String(t[k])); }).join("&"); });

// ------------------------------------------------------------ the environment
var NAMES = ["$json", "$input", "$", "$node", "$items", "$item", "$itemIndex", "$runIndex", "$now", "$today", "$workflow", "$execution", "$vars", "$env", "$jmespath", "$prevNode", "$if", "$ifEmpty", "$max", "$min", "$binary", "DateTime", "Duration", "items", "item", "require"];
var envFor = function (task, i) {
  var list = task.items;
  var wrap = function (json) { return { json: json, binary: {} }; };
  var nodeAccess = function (name) {
    if (!hasOwn(task.nodes || {}, name)) fail("the node " + JSON.stringify(name) + " is not in this tool, or has not run before this one");
    var its = task.nodes[name];
    return {
      all: function () { return its.map(wrap); },
      first: function () { return its.length ? wrap(its[0]) : undefined; },
      last: function () { return its.length ? wrap(its[its.length - 1]) : undefined; },
      get item() { var x = its[i] !== undefined ? its[i] : its[0]; return x === undefined ? undefined : wrap(x); },
      itemMatching: function (k) { return its[k] === undefined ? undefined : wrap(its[k]); },
      pairedItem: function (k) { return this.itemMatching(k === undefined ? i : k); },
      params: {},
      isExecuted: true,
    };
  };
  var nodeProxy = new Proxy({}, { get: function (_, name) { if (typeof name !== "string") return undefined; var a = nodeAccess(name), it = a.item; return { json: it ? it.json : {}, binary: {}, parameter: {}, runIndex: 0, context: {} }; } });
  var now = DateTime.now();
  var cur = list[i] === undefined ? {} : list[i];
  return {
    $json: cur,
    $input: { all: function () { return list.map(wrap); }, first: function () { return list.length ? wrap(list[0]) : undefined; }, last: function () { return list.length ? wrap(list[list.length - 1]) : undefined; }, item: wrap(cur), params: {}, context: {} },
    $: nodeAccess,
    $node: nodeProxy,
    $items: function (name) { return name === undefined ? list.map(wrap) : nodeAccess(name).all(); },
    $item: function (k) { return { $json: list[k], $node: nodeProxy }; },
    $itemIndex: i,
    $runIndex: 0,
    $now: now,
    $today: now.startOf("day"),
    $workflow: { id: task.workflow.id, name: task.workflow.name, active: true },
    $execution: { id: "swarmpress", mode: "production", resumeUrl: "", customData: { set: function () {}, get: function () {}, setAll: function () {}, getAll: function () { return {}; } } },
    $vars: {},
    $env: new Proxy({}, { get: function () { fail("$env is not available in swarm.press: a tool reads only its items"); } }),
    $jmespath: function () { fail("$jmespath is not available in swarm.press"); },
    $prevNode: { name: "", outputIndex: 0, runIndex: 0 },
    $if: function (c, a, b) { return c ? a : b; },
    $ifEmpty: function (v, alt) { return v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length) ? alt : v; },
    $max: function () { return Math.max.apply(null, arguments); },
    $min: function () { return Math.min.apply(null, arguments); },
    $binary: {},
    DateTime: DateTime,
    Duration: Duration,
    items: list.map(wrap),
    item: cur,
    require: function (m) { fail("require(" + JSON.stringify(m) + ") is not available: a Code node in swarm.press runs without modules"); },
  };
};
var THIS = { helpers: new Proxy({}, { get: function (_, k) { return function () { fail("this.helpers." + String(k) + " is not available: use an HTTP Request node for requests"); }; } }), getNodeParameter: function () { fail("this.getNodeParameter is not available"); }, getWorkflowStaticData: function () { return {}; } };
var argsOf = function (env) { return NAMES.map(function (n) { return env[n]; }); };
var compiled = {};
var compile = function (key, body) { if (!hasOwn(compiled, key)) compiled[key] = Function.apply(null, NAMES.concat([body])); return compiled[key]; };

var out = function (v) {
  if (v === undefined) return UNDEF;
  if (v instanceof DateTime) return v.toISO();
  if (v instanceof Duration) return v.toObject();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "function") return UNDEF;
  if (typeof v === "number" && !isFinite(v)) return null;
  return JSON.parse(JSON.stringify(v));
};
var text = function (v) {
  if (v === undefined || v === null) return "";
  if (v instanceof DateTime) return v.toISO();
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
};
var exprs = function (task) {
  return task.items.map(function (_, i) {
    var env = envFor(task, i), args = argsOf(env);
    return task.templates.map(function (t) {
      var values = t.parts.filter(function (p) { return typeof p !== "string"; }).map(function (p) {
        try { return compile("e:" + p.js, "return (" + p.js + "\n);").apply(THIS, args); }
        catch (e) { fail("the expression {{ " + p.js + " }} (item " + i + "): " + (e && e.message ? e.message : String(e))); }
      });
      if (t.single) return out(values[0]);
      var k = 0;
      return t.parts.map(function (p) { return typeof p === "string" ? p : text(values[k++]); }).join("");
    });
  });
};
var toItems = function (v, where) {
  if (v === undefined || v === null) fail(where + " returned nothing: return the items (an array of { json })");
  var list = Array.isArray(v) ? v : [v];
  return list.map(function (x, k) {
    var j = isObj(x) && hasOwn(x, "json") ? x.json : x;
    if (!isObj(j)) fail(where + ": item " + k + " is not an object (return { json: {…} })");
    return out(j);
  });
};
var code = async function (task) {
  var body = "return (async function () {\n" + task.source + "\n}).call(this);";
  var fn = compile("c:" + task.mode + ":" + task.source, body);
  if (task.mode === "each" || task.mode === "functionItem") {
    var res = [];
    for (var i = 0; i < task.items.length; i++) {
      var env = envFor(task, i);
      var r = await fn.apply(THIS, argsOf(env));
      if (task.mode === "functionItem" && r === undefined) r = env.item;
      if (r === null || r === undefined) continue;
      res = res.concat(toItems(r, "the code (item " + i + ")"));
    }
    return res;
  }
  var env0 = envFor(task, 0);
  var all = await fn.apply(THIS, argsOf(env0));
  return toItems(all, "the code");
};
var sortCode = function (task) {
  var env = envFor(task, 0), names = NAMES.concat(["a", "b"]);
  var cmp = Function.apply(null, names.concat([task.source]));
  var list = task.items.map(function (j) { return { json: j }; });
  list.sort(function (a, b) { return Number(cmp.apply(THIS, argsOf(env).concat([a, b]))) || 0; });
  return list.map(function (x) { return x.json; });
};
var setField = function (o, name, v) { o[name] = out(v); return o; };
var dateTime = function (task) {
  return task.items.map(function (item, i) {
    var p = task.params[i] || {}, opts = p.options || {};
    var res = opts.includeInputFields ? clone(item) : {};
    var field = function (d) { return p.outputFieldName || d; };
    switch (p.operation || "getCurrentDate") {
      case "getCurrentDate": { var n = DateTime.now(); return setField(res, field("currentDate"), p.includeTime === false ? n.startOf("day") : n); }
      case "addToDate": case "subtractFromDate": {
        var o = {}; o[UNITS[p.timeUnit || "days"] || "days"] = Number(p.duration || 0);
        var d = asDate(p.magnitude);
        return setField(res, field("newDate"), p.operation === "addToDate" ? d.plus(o) : d.minus(o));
      }
      case "formatDate": {
        var dd = asDate(p.date), f = p.format === "custom" || p.format === undefined ? p.customFormat || "yyyy-MM-dd" : p.format;
        return setField(res, field("formattedDate"), dd.toFormat(f));
      }
      case "roundDate": {
        var r = asDate(p.date), unit = p.toNearest || p.to || "day";
        return setField(res, field("roundedDate"), (p.mode || "roundDown") === "roundUp" ? r.endOf(unit).plus(1).startOf(unit) : r.startOf(unit));
      }
      case "getTimeBetweenDates": {
        var units = Array.isArray(p.units) && p.units.length ? p.units : ["day"];
        return setField(res, field("timeDifference"), asDate(p.endDate).diff(asDate(p.startDate), units).toObject());
      }
      case "extractDate": {
        var part = p.part || "month", x = asDate(p.date);
        return setField(res, field("datePart"), part === "week" ? x.weekNumber : x[part]);
      }
      default: fail("the Date & Time operation " + JSON.stringify(p.operation) + " is not supported");
    }
  });
};

globalThis.ext = {
  run: async function (task) {
    switch (task.op) {
      case "exprs": return exprs(task);
      case "code": return code(task);
      case "sort": return sortCode(task);
      case "dateTime": return dateTime(task);
      default: fail("unknown task " + task.op);
    }
  },
};
})();`;
