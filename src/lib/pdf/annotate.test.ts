import { describe, expect, it } from "vitest";
import {
  strokeToAbsolute,
  strokesBounds,
  strokesToSvgPath,
  type StrokeAnn,
} from "./annotate";
import { hexToRgb01 } from "../utils";

describe("strokesBounds", () => {
  it("computes the bounding box across strokes", () => {
    const b = strokesBounds([
      [{ x: 10, y: 20 }, { x: 30, y: 25 }],
      [{ x: 5, y: 40 }],
    ]);
    expect(b).toEqual({ x: 5, y: 20, w: 25, h: 20 });
  });
  it("returns null for no points", () => {
    expect(strokesBounds([])).toBeNull();
    expect(strokesBounds([[]])).toBeNull();
  });
  it("never collapses to zero size", () => {
    const b = strokesBounds([[{ x: 7, y: 7 }]]);
    expect(b!.w).toBeGreaterThanOrEqual(1);
    expect(b!.h).toBeGreaterThanOrEqual(1);
  });
});

describe("strokesToSvgPath", () => {
  it("builds M/L commands per stroke", () => {
    expect(
      strokesToSvgPath([
        [{ x: 1, y: 2 }, { x: 3, y: 4 }],
        [{ x: 5, y: 6 }, { x: 7, y: 8 }],
      ]),
    ).toBe("M 1 2 L 3 4 M 5 6 L 7 8");
  });
  it("turns single points into dots", () => {
    expect(strokesToSvgPath([[{ x: 1, y: 1 }]])).toBe("M 1 1 L 1.1 1");
  });
  it("rounds coordinates to 2 decimals", () => {
    expect(strokesToSvgPath([[{ x: 1.23456, y: 2 }, { x: 3, y: 4.999 }]])).toBe(
      "M 1.23 2 L 3 5",
    );
  });
});

describe("strokeToAbsolute", () => {
  const ann: StrokeAnn = {
    id: "a",
    kind: "draw",
    x: 100,
    y: 50,
    w: 20,
    h: 40,
    baseW: 10,
    baseH: 10,
    points: [[{ x: 0, y: 0 }, { x: 10, y: 10 }]],
    color: "#000000",
    width: 2,
  };
  it("scales relative points into page coordinates", () => {
    const { points, widthScale } = strokeToAbsolute(ann);
    expect(points[0][0]).toEqual({ x: 100, y: 50 });
    expect(points[0][1]).toEqual({ x: 120, y: 90 }); // 2x / 4x scale
    expect(widthScale).toBe(3); // (2 + 4) / 2
  });
});

describe("hexToRgb01", () => {
  it("parses hex colors", () => {
    expect(hexToRgb01("#ff0000")).toEqual({ r: 1, g: 0, b: 0 });
    expect(hexToRgb01("00ff00")).toEqual({ r: 0, g: 1, b: 0 });
  });
  it("falls back on malformed input", () => {
    const c = hexToRgb01("nope");
    expect(c.r).toBeGreaterThan(0.8);
  });
});
