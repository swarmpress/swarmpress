import { describe, expect, test } from "bun:test";
import { compare, parseVersion, satisfies, validRange } from "../src/semver.ts";

describe("semver", () => {
  test("parses versions", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
    expect(parseVersion("0.1.0-alpha.1+build")).toEqual({ major: 0, minor: 1, patch: 0, pre: ["alpha", "1"] });
    expect(parseVersion("01.2.3")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
  });

  test("orders pre-releases below releases", () => {
    expect(compare(parseVersion("1.0.0-rc.1")!, parseVersion("1.0.0")!)).toBe(-1);
    expect(compare(parseVersion("1.0.0-alpha")!, parseVersion("1.0.0-alpha.1")!)).toBe(-1);
    expect(compare(parseVersion("1.0.0-2")!, parseVersion("1.0.0-10")!)).toBe(-1);
  });

  const cases: Array<[string, string, boolean]> = [
    ["0.1.0", "^0.1.0", true],
    ["0.1.5", "^0.1.0", true],
    ["0.2.0", "^0.1.0", false],
    ["1.4.0", "^1.2.0", true],
    ["2.0.0", "^1.2.0", false],
    ["0.0.3", "^0.0.3", true],
    ["0.0.4", "^0.0.3", false],
    ["1.2.9", "~1.2.3", true],
    ["1.3.0", "~1.2.3", false],
    ["0.1.0", ">=0.1.0 <1.0.0", true],
    ["1.0.0", ">=0.1.0 <1.0.0", false],
    ["0.1.0", "0.x", true],
    ["1.0.0", "0.x || 1.x", true],
    ["3.0.0", "*", true],
    ["0.1.0", "=0.1.0", true],
    ["0.1.0-rc.1", "^0.1.0", false],
    ["0.1.0-rc.2", ">=0.1.0-rc.1 <0.2.0", true],
  ];
  for (const [v, r, ok] of cases) {
    test(`${v} ${ok ? "satisfies" : "does not satisfy"} ${r}`, () => expect(satisfies(v, r)).toBe(ok));
  }

  test("rejects malformed ranges", () => {
    expect(validRange("^0.1.0")).toBe(true);
    expect(validRange("")).toBe(false);
    expect(validRange("banana")).toBe(false);
    expect(satisfies("0.1.0", "banana")).toBe(false);
  });
});
