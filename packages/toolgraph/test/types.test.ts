import { describe, expect, test } from "bun:test";
import { TypeRegistry, TypeSchemaError, parseTypeExpr, readPath } from "../src/types.ts";
import { siteTypes } from "./helpers.ts";

const reg = TypeRegistry.withSite(siteTypes());

describe("the type subset at runtime", () => {
  test("type expressions parse as in types.rs", () => {
    expect(parseTypeExpr("Article[]?")).toEqual({ name: "Article", list: true, optional: true });
    for (const bad of ["", "[]", "Article?[]", "a-b", "Ärticle", "Article[][]"]) expect(() => parseTypeExpr(bad)).toThrow(TypeSchemaError);
  });

  test("built-ins and site types are known", () => {
    for (const n of ["string", "integer", "number", "boolean", "LocalizedString", "Media", "Page", "Article", "Village", "Trail", "Transport", "Category", "FeedItem", "SearchResult", "FerryRow", "Weather"])
      expect(reg.knows(n)).toBe(true);
    expect(reg.knows("Nope")).toBe(false);
  });

  test("a fitting value has no issues", () => {
    expect(reg.validate({ departures: [{ stop: "vernazza", dep: "09:05", dest: "Monterosso" }] }, "FerryTimetable")).toEqual([]);
    expect(reg.validate([], "FerryRow[]")).toEqual([]);
    expect(reg.validate(null, "Weather?")).toEqual([]);
    expect(reg.validate(21, "number")).toEqual([]);
  });

  test("validation errors carry field paths", () => {
    const issues = reg.validate({ departures: [{ stop: "vernazza", dep: 905, dest: "Monterosso", pier: 2 }, { stop: "x" }] }, "FerryTimetable");
    expect(issues).toEqual([
      { path: "$.departures[0].dep", message: "expected a string, found an integer" },
      { path: "$.departures[0].pier", message: "not a field of this type" },
      { path: "$.departures[1].dep", message: "missing" },
      { path: "$.departures[1].dest", message: "missing" },
    ]);
  });

  test("integer must be an integer; number takes both", () => {
    expect(reg.validate(1.5, "integer")).toEqual([{ path: "$", message: "expected an integer, found a number" }]);
    expect(reg.validate(2, "integer")).toEqual([]);
    expect(reg.validate("2", "number")).toHaveLength(1);
  });

  test("LocalizedString needs en; a plain string is accepted too", () => {
    const page = { id: "p", path: "x", page_type: "blog-article", route: "/x" };
    expect(reg.validate({ ...page, title: { en: "Hi", it: "Ciao" } }, "Page")).toEqual([]);
    expect(reg.validate({ ...page, title: "Hi" }, "Page")).toEqual([]);
    expect(reg.validate({ ...page, title: { it: "Ciao" } }, "Page")).toEqual([{ path: "$.title.en", message: "missing (a LocalizedString needs en)" }]);
    expect(reg.validate({ ...page, title: { en: 3 } }, "Page")).toEqual([{ path: "$.title.en", message: "expected a string, found an integer" }]);
  });

  test("closed objects, nested refs and enums", () => {
    const r = TypeRegistry.withSite({
      Sky: { enum: ["sun", "rain"] },
      Card: { type: "object", additionalProperties: false, required: ["sky", "hero"], properties: { sky: { $ref: "Sky" }, hero: { $ref: "#/types/Media" } } },
    });
    expect(r.validate({ sky: "sun", hero: { id: "m1", url: "https://x/y.jpg" } }, "Card")).toEqual([]);
    expect(r.validate({ sky: "snow", hero: { id: "m1", url: "u", alt: { en: "a" }, extra: true } }, "Card")).toEqual([
      { path: "$.hero.extra", message: "not a field of this type" },
      { path: "$.sky", message: "expected one of rain, sun, found a string" },
    ]);
  });

  test("the subset is enforced for site types", () => {
    const bad = (v: unknown) => () => TypeRegistry.withSite({ X: v });
    expect(bad({ type: "object", properties: {} })).toThrow(TypeSchemaError);
    expect(bad({ oneOf: [] })).toThrow(TypeSchemaError);
    expect(bad({ type: "string", pattern: "x" })).toThrow(TypeSchemaError);
    expect(bad({ $ref: "Missing" })).toThrow("Missing, which is not a type");
    expect(() => TypeRegistry.withSite({ Article: { type: "string" } })).toThrow("built-in");
  });

  test("the JSON Schema of a type inlines references", () => {
    expect(reg.jsonSchema("FerryTimetable")).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["departures"],
      properties: {
        departures: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["dep", "dest", "stop"],
            properties: { dep: { type: "string" }, dest: { type: "string" }, stop: { type: "string" } },
          },
        },
      },
    });
  });
});

describe("the path language", () => {
  const v = { a: { b: 1 }, items: [{ name: "x", tags: ["p"] }, { name: "y" }, { other: 1 }] };
  test("$, fields, indexes, each", () => {
    expect(readPath(v, "$")).toBe(v);
    expect(readPath(v, "$.a.b")).toBe(1);
    expect(readPath(v, "$.items[0].name")).toBe("x");
    expect(readPath(v, "$.items[1]")).toEqual({ name: "y" });
    expect(readPath(v, "$.items[].name")).toEqual(["x", "y"]);
    expect(readPath(v, "$.items[]")).toEqual(v.items);
    expect(readPath(v, "$.items[0].tags[0]")).toBe("p");
  });
  test("missing steps read as undefined", () => {
    expect(readPath(v, "$.a.c")).toBeUndefined();
    expect(readPath(v, "$.items[9].name")).toBeUndefined();
    expect(readPath(v, "$.a[0]")).toBeUndefined();
    expect(readPath(v, "$.toString")).toBeUndefined();
  });
  test("bad paths throw (never eval)", () => {
    for (const p of ["a.b", "$..a", "$.a[x]", "$.a[0", "$a"]) expect(() => readPath(v, p)).toThrow();
  });
});
