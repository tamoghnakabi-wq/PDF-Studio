import { describe, expect, it } from "vitest";
import {
  bodySizeOf,
  groupLines,
  groupParagraphs,
  headingFor,
  type TFrag,
} from "./pdfToWord";

const frag = (str: string, x: number, y: number, size = 11, width = str.length * 5): TFrag => ({
  str,
  x,
  y,
  size,
  width,
});

describe("groupLines", () => {
  it("clusters fragments on the same baseline, left to right", () => {
    const lines = groupLines([
      frag("world", 60, 700),
      frag("Hello", 20, 700.5),
      frag("Next line", 20, 680),
    ]);
    expect(lines.map((l) => l.text)).toEqual(["Hello world", "Next line"]);
  });

  it("inserts spaces only across real gaps", () => {
    const lines = groupLines([
      frag("Hel", 20, 700, 11, 18),
      frag("lo", 38, 700, 11, 10), // touches previous fragment → no space
      frag("world", 70, 700, 11, 25), // 22pt gap → space
    ]);
    expect(lines[0].text).toBe("Hello world");
  });

  it("orders top-to-bottom in PDF coordinates (y up)", () => {
    const lines = groupLines([frag("bottom", 20, 100), frag("top", 20, 720)]);
    expect(lines.map((l) => l.text)).toEqual(["top", "bottom"]);
  });

  it("ignores whitespace-only fragments", () => {
    expect(groupLines([frag("  ", 10, 700), frag("a", 30, 700)])[0].text).toBe("a");
  });
});

describe("groupParagraphs", () => {
  it("merges tightly-leaded lines and splits on big gaps", () => {
    const paras = groupParagraphs([
      { y: 700, size: 11, text: "First paragraph line one" },
      { y: 686, size: 11, text: "line two." },
      { y: 640, size: 11, text: "Second paragraph." }, // 46pt gap → split
    ]);
    expect(paras.map((p) => p.text)).toEqual([
      "First paragraph line one line two.",
      "Second paragraph.",
    ]);
  });

  it("splits when the font size changes (heading boundaries)", () => {
    const paras = groupParagraphs([
      { y: 700, size: 24, text: "Title" },
      { y: 676, size: 11, text: "Body starts here" },
    ]);
    expect(paras).toHaveLength(2);
    expect(paras[0].size).toBe(24);
  });
});

describe("heading classification", () => {
  it("maps size ratios to heading levels", () => {
    expect(headingFor(22, 11)).toBe("h1");
    expect(headingFor(17, 11)).toBe("h2");
    expect(headingFor(14, 11)).toBe("h3");
    expect(headingFor(11.5, 11)).toBeNull();
    expect(headingFor(11, 0)).toBeNull();
  });

  it("bodySizeOf finds the dominant text size, weighted by length", () => {
    const body = bodySizeOf([
      { text: "Big title", size: 24 },
      { text: "x".repeat(400), size: 11 },
      { text: "y".repeat(400), size: 11 },
    ]);
    expect(body).toBe(11);
  });

  it("bodySizeOf falls back sanely on empty input", () => {
    expect(bodySizeOf([])).toBe(11);
  });
});
