import { BlendMode, LineCapStyle, PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ProgressFn } from "../types";
import { hexToRgb01, sanitizeWinAnsi } from "../utils";

/**
 * Editor annotations. All geometry is stored in PDF points relative to the
 * page's TOP-LEFT corner with y pointing DOWN (screen-style). Conversion to
 * PDF's bottom-up coordinates happens once, at export time.
 */
export interface BaseAnn {
  id: string;
  /** box, in page points, y-down from top-left */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextAnn extends BaseAnn {
  kind: "text";
  text: string;
  size: number; // font size in points
  color: string; // hex
}

export interface HighlightAnn extends BaseAnn {
  kind: "highlight";
  color: string;
}

export interface StrokeAnn extends BaseAnn {
  kind: "draw" | "signature";
  /** points relative to the box, in base coordinates */
  points: { x: number; y: number }[][];
  /** the box size the points were captured at — resizing scales them */
  baseW: number;
  baseH: number;
  color: string;
  width: number; // stroke width in base coordinates
}

export interface ImageAnn extends BaseAnn {
  kind: "image";
  dataUrl: string;
}

export type Ann = TextAnn | HighlightAnn | StrokeAnn | ImageAnn;

/** page index (0-based) → annotations, bottom-most first */
export type AnnMap = Record<number, Ann[]>;

export const LINE_HEIGHT = 1.3;

/** Scale a stroke's relative points into absolute page coords (y still down). */
export function strokeToAbsolute(
  ann: StrokeAnn,
): { points: { x: number; y: number }[][]; widthScale: number } {
  const sx = ann.baseW > 0 ? ann.w / ann.baseW : 1;
  const sy = ann.baseH > 0 ? ann.h / ann.baseH : 1;
  return {
    points: ann.points.map((stroke) =>
      stroke.map((p) => ({ x: ann.x + p.x * sx, y: ann.y + p.y * sy })),
    ),
    widthScale: (sx + sy) / 2,
  };
}

/** Build an SVG path ("M … L …") from absolute y-down page coordinates. */
export function strokesToSvgPath(strokes: { x: number; y: number }[][]): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  return strokes
    .filter((s) => s.length > 0)
    .map((s) => {
      const head = `M ${r(s[0].x)} ${r(s[0].y)}`;
      if (s.length === 1) return `${head} L ${r(s[0].x + 0.1)} ${r(s[0].y)}`;
      return head + s.slice(1).map((p) => ` L ${r(p.x)} ${r(p.y)}`).join("");
    })
    .join(" ");
}

/** Compute the bounding box of raw strokes; returns null if empty. */
export function strokesBounds(
  strokes: { x: number; y: number }[][],
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes)
    for (const p of s) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; isPng: boolean } {
  const comma = dataUrl.indexOf(",");
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, isPng: dataUrl.slice(0, comma).includes("image/png") };
}

/** Stamp all annotations into the PDF and return the new document bytes. */
export async function burnAnnotations(
  data: Uint8Array,
  anns: AnnMap,
  progress: ProgressFn,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const imageCache = new Map<string, Awaited<ReturnType<typeof doc.embedPng>>>();

  const pagesWithAnns = Object.entries(anns).filter(([, list]) => list.length > 0);
  let done = 0;
  for (const [pageIdxStr, list] of pagesWithAnns) {
    const pageIdx = Number(pageIdxStr);
    if (pageIdx < 0 || pageIdx >= doc.getPageCount()) continue;
    progress(done / Math.max(1, pagesWithAnns.length), `Applying page ${pageIdx + 1}`);
    const page = doc.getPage(pageIdx);
    const H = page.getHeight();

    for (const ann of list) {
      if (ann.kind === "highlight") {
        const c = hexToRgb01(ann.color);
        page.drawRectangle({
          x: ann.x,
          y: H - ann.y - ann.h,
          width: ann.w,
          height: ann.h,
          color: rgb(c.r, c.g, c.b),
          opacity: 0.38,
          blendMode: BlendMode.Multiply,
        });
      } else if (ann.kind === "text") {
        const c = hexToRgb01(ann.color);
        const lines = sanitizeWinAnsi(ann.text).split("\n");
        lines.forEach((line, i) => {
          if (!line.trim()) return;
          page.drawText(line, {
            x: ann.x,
            // baseline ≈ cap-height below the top of the line box
            y: H - ann.y - ann.size * 0.8 - i * ann.size * LINE_HEIGHT,
            size: ann.size,
            font,
            color: rgb(c.r, c.g, c.b),
          });
        });
      } else if (ann.kind === "image") {
        let embedded = imageCache.get(ann.dataUrl);
        if (!embedded) {
          const { bytes, isPng } = dataUrlToBytes(ann.dataUrl);
          embedded = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
          imageCache.set(ann.dataUrl, embedded);
        }
        page.drawImage(embedded, {
          x: ann.x,
          y: H - ann.y - ann.h,
          width: ann.w,
          height: ann.h,
        });
      } else {
        // draw / signature strokes
        const { points, widthScale } = strokeToAbsolute(ann);
        const path = strokesToSvgPath(points);
        if (!path) continue;
        const c = hexToRgb01(ann.color);
        page.drawSvgPath(path, {
          // origin at the page's top-left; SVG y-axis already points down
          x: 0,
          y: H,
          borderColor: rgb(c.r, c.g, c.b),
          borderWidth: Math.max(0.3, ann.width * widthScale),
          borderLineCap: LineCapStyle.Round,
        });
      }
    }
    done++;
  }
  progress(0.95, "Writing PDF");
  return doc.save({ useObjectStreams: true });
}
