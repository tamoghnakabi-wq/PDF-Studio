import { describe, expect, it } from "vitest";
import {
  basename,
  chunkPages,
  dirname,
  extOf,
  formatBytes,
  pagesToRangeText,
  parsePageRanges,
  parseRangeGroups,
  sanitizeWinAnsi,
  stem,
  uniqueName,
} from "./utils";

describe("parsePageRanges", () => {
  it("parses singles and ranges", () => {
    expect(parsePageRanges("1-3, 5, 8-10", 12)).toEqual([1, 2, 3, 5, 8, 9, 10]);
  });
  it("supports open ends", () => {
    expect(parsePageRanges("-3", 6)).toEqual([1, 2, 3]);
    expect(parsePageRanges("4-", 6)).toEqual([4, 5, 6]);
  });
  it("keeps descending order", () => {
    expect(parsePageRanges("7-5", 10)).toEqual([7, 6, 5]);
  });
  it("drops out-of-range singles, clamps range ends, dedupes", () => {
    expect(parsePageRanges("2, 2, 90", 5)).toEqual([2]);
    expect(parsePageRanges("3-90", 5)).toEqual([3, 4, 5]);
    expect(parsePageRanges("0-2", 5)).toEqual([1, 2]);
  });
  it("skips ranges that start beyond the document", () => {
    expect(parsePageRanges("5-", 3)).toEqual([]);
    expect(parsePageRanges("4-9", 3)).toEqual([]);
    expect(parsePageRanges("4-9, 2", 3)).toEqual([2]);
  });
  it("ignores empty segments", () => {
    expect(parsePageRanges(" 1 , , 2 ", 5)).toEqual([1, 2]);
  });
  it("throws on junk", () => {
    expect(() => parsePageRanges("abc", 5)).toThrow();
    expect(() => parsePageRanges("1; 2", 5)).toThrow();
    expect(() => parsePageRanges("-", 5)).toThrow();
  });
});

describe("parseRangeGroups", () => {
  it("builds one group per segment", () => {
    expect(parseRangeGroups("1-2, 3-4, 6", 6)).toEqual([[1, 2], [3, 4], [6]]);
  });
});

describe("pagesToRangeText", () => {
  it("collapses consecutive runs", () => {
    expect(pagesToRangeText([1, 2, 3, 5, 7, 8])).toBe("1-3, 5, 7-8");
  });
  it("sorts and dedupes first", () => {
    expect(pagesToRangeText([3, 1, 2, 2])).toBe("1-3");
  });
  it("handles empty", () => {
    expect(pagesToRangeText([])).toBe("");
  });
});

describe("chunkPages", () => {
  it("chunks evenly with remainder", () => {
    expect(chunkPages(5, 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("treats n<1 as 1", () => {
    expect(chunkPages(2, 0)).toEqual([[1], [2]]);
  });
});

describe("uniqueName", () => {
  it("appends counters before the extension", () => {
    const taken = new Set(["a.pdf", "a (2).pdf"]);
    expect(uniqueName(taken, "a.pdf")).toBe("a (3).pdf");
    expect(uniqueName(taken, "b.pdf")).toBe("b.pdf");
  });
});

describe("path helpers", () => {
  it("basename / dirname / stem / extOf", () => {
    expect(basename("/x/y/report.pdf")).toBe("report.pdf");
    expect(dirname("/x/y/report.pdf")).toBe("/x/y");
    expect(stem("report.final.pdf")).toBe("report.final");
    expect(extOf("report.PDF")).toBe("pdf");
    expect(extOf("noext")).toBe("");
  });
});

describe("formatBytes", () => {
  it("formats human-readable sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("sanitizeWinAnsi", () => {
  it("maps typographic punctuation to ASCII", () => {
    expect(sanitizeWinAnsi("“hi” — it’s…")).toBe('"hi" - it\'s...');
  });
  it("drops unencodable characters but keeps newlines", () => {
    expect(sanitizeWinAnsi("a→b\nc")).toBe("ab\nc");
  });
});
