import type { Paragraph } from "docx";
import type { ProgressFn } from "../types";
import { canvasToBytes, loadPdf, renderPageToCanvas } from "./engine";

/**
 * PDF → Word. pdf.js gives positioned text fragments; we reconstruct lines
 * from Y clusters, paragraphs from vertical gaps, and headings from font
 * size. Pages with (almost) no text — scans — are embedded as page images.
 */

/** Simplified positioned text fragment (PDF text space, y points UP). */
export interface TFrag {
  str: string;
  x: number;
  y: number;
  size: number;
  width: number;
}

export interface TLine {
  y: number;
  size: number;
  text: string;
}

export interface TPara {
  text: string;
  size: number;
}

/** Cluster fragments into visual lines (top-to-bottom, left-to-right). */
export function groupLines(frags: TFrag[]): TLine[] {
  const items = frags.filter((f) => f.str.trim().length > 0);
  if (!items.length) return [];
  // top-to-bottom = descending y in PDF space
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; size: number; parts: TFrag[] }[] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    const tolerance = Math.max(last?.size ?? item.size, item.size) * 0.45;
    if (last && Math.abs(last.y - item.y) <= tolerance) {
      last.parts.push(item);
      last.size = Math.max(last.size, item.size);
    } else {
      lines.push({ y: item.y, size: item.size, parts: [item] });
    }
  }
  return lines.map((line) => {
    const parts = [...line.parts].sort((a, b) => a.x - b.x);
    let text = "";
    let prevEnd: number | null = null;
    for (const p of parts) {
      if (prevEnd !== null) {
        const gap = p.x - prevEnd;
        if (gap > line.size * 0.25 && !text.endsWith(" ")) text += " ";
      }
      text += p.str;
      prevEnd = p.x + p.width;
    }
    return { y: line.y, size: line.size, text: text.replace(/\s+/g, " ").trim() };
  });
}

/** Merge consecutive lines into paragraphs based on leading and size shifts. */
export function groupParagraphs(lines: TLine[]): TPara[] {
  const paras: TPara[] = [];
  let current: { texts: string[]; size: number } | null = null;
  let prev: TLine | null = null;
  for (const line of lines) {
    if (!line.text) continue;
    const gap = prev ? prev.y - line.y : 0;
    const newPara =
      !current ||
      !prev ||
      gap > Math.max(prev.size, line.size) * 1.8 ||
      Math.abs(line.size - current.size) > current.size * 0.18;
    if (newPara) {
      if (current) paras.push({ text: current.texts.join(" "), size: current.size });
      current = { texts: [line.text], size: line.size };
    } else {
      current!.texts.push(line.text);
    }
    prev = line;
  }
  if (current) paras.push({ text: current.texts.join(" "), size: current.size });
  return paras;
}

/** Classify a paragraph's font size against the document's body size. */
export function headingFor(
  size: number,
  bodySize: number,
): "h1" | "h2" | "h3" | null {
  if (bodySize <= 0) return null;
  const ratio = size / bodySize;
  if (ratio >= 1.9) return "h1";
  if (ratio >= 1.5) return "h2";
  if (ratio >= 1.25) return "h3";
  return null;
}

/** Median of the size distribution weighted by text length — the body size. */
export function bodySizeOf(paras: TPara[]): number {
  const weighted: number[] = [];
  for (const p of paras) {
    const w = Math.max(1, Math.min(40, Math.round(p.text.length / 10)));
    for (let i = 0; i < w; i++) weighted.push(p.size);
  }
  if (!weighted.length) return 11;
  weighted.sort((a, b) => a - b);
  return weighted[Math.floor(weighted.length / 2)];
}

export async function pdfToWord(
  data: Uint8Array,
  progress: ProgressFn,
): Promise<Uint8Array> {
  // lazy: docx only loads when a conversion actually runs
  const { Document, HeadingLevel, ImageRun, PageBreak, Packer, Paragraph, TextRun } =
    await import("docx");
  const HEADING_MAP = {
    h1: HeadingLevel.HEADING_1,
    h2: HeadingLevel.HEADING_2,
    h3: HeadingLevel.HEADING_3,
  } as const;

  const pdf = await loadPdf(data);
  const children: Paragraph[] = [];

  // First pass: text per page (so the body size is computed globally).
  const pageParas: (TPara[] | null)[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    progress(((p - 1) / pdf.numPages) * 0.45, `Reading page ${p} of ${pdf.numPages}`);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const frags: TFrag[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const t = item.transform as number[];
      frags.push({
        str: item.str,
        x: t[4],
        y: t[5],
        size: Math.hypot(t[0], t[1]) || 10,
        // width can be undefined on malformed PDFs — NaN would silently
        // poison the gap detection and eat inter-word spaces
        width: Number.isFinite(item.width) ? item.width : 0,
      });
    }
    const paras = groupParagraphs(groupLines(frags));
    const charCount = paras.reduce((a, q) => a + q.text.length, 0);
    pageParas.push(charCount >= 5 ? paras : null); // null ⇒ treat as scanned
    page.cleanup();
  }

  const bodySize = bodySizeOf(pageParas.flatMap((q) => q ?? []));

  // Second pass: build docx children (scanned pages render as images).
  for (let p = 1; p <= pdf.numPages; p++) {
    progress(0.45 + ((p - 1) / pdf.numPages) * 0.45, `Converting page ${p} of ${pdf.numPages}`);
    if (p > 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
    const paras = pageParas[p - 1];
    if (paras === null) {
      const { canvas, widthPts, heightPts } = await renderPageToCanvas(pdf, p, 150 / 72);
      const png = await canvasToBytes(canvas, "image/png");
      canvas.width = 0;
      // fit within ~6.2in of usable page width (96 px/in in docx land)
      const w = Math.round(6.2 * 96);
      const h = Math.round((heightPts / widthPts) * w);
      children.push(
        new Paragraph({
          children: [
            new ImageRun({ type: "png", data: png, transformation: { width: w, height: h } }),
          ],
        }),
      );
      continue;
    }
    for (const para of paras) {
      const heading = headingFor(para.size, bodySize);
      children.push(
        new Paragraph({
          ...(heading ? { heading: HEADING_MAP[heading] } : {}),
          children: [
            new TextRun({
              text: para.text,
              ...(heading ? {} : { size: Math.round(para.size * 2) }), // half-points
            }),
          ],
          spacing: { after: 120 },
        }),
      );
    }
  }
  await pdf.destroy();

  progress(0.95, "Writing .docx");
  const doc = new Document({
    creator: "PDF Studio",
    sections: [{ properties: {}, children }],
  });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}
