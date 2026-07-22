import { PDFDocument, PDFName, PDFRawStream, StandardFonts, degrees, rgb } from "pdf-lib";
import type { OutputFile, ProgressFn } from "../types";
import { sanitizeWinAnsi, stem } from "../utils";
import { canvasToBytes, loadPdf, renderPageToCanvas } from "./engine";

const SAVE_OPTS = { useObjectStreams: true } as const;

export async function pageCountOf(data: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true });
  return doc.getPageCount();
}

async function copySubset(src: PDFDocument, pages0: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages0);
  copied.forEach((p) => out.addPage(p));
  return out.save(SAVE_OPTS);
}

/* ---------------------------------- merge --------------------------------- */

export async function mergePdfs(
  files: { name: string; data: Uint8Array }[],
  progress: ProgressFn,
): Promise<OutputFile[]> {
  const out = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    progress(i / files.length, `Merging ${files[i].name}`);
    const src = await PDFDocument.load(files[i].data, { ignoreEncryption: true });
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }
  progress(0.95, "Writing merged PDF");
  return [{ name: "merged.pdf", data: await out.save(SAVE_OPTS) }];
}

/* ---------------------------------- split --------------------------------- */

export async function splitPdf(
  name: string,
  data: Uint8Array,
  groups: number[][], // 1-based page groups
  progress: ProgressFn,
): Promise<OutputFile[]> {
  const src = await PDFDocument.load(data, { ignoreEncryption: true });
  const outputs: OutputFile[] = [];
  const base = stem(name);
  for (let i = 0; i < groups.length; i++) {
    progress(i / groups.length, `Writing part ${i + 1} of ${groups.length}`);
    const pages0 = groups[i].map((p) => p - 1);
    const label =
      groups[i].length === 1
        ? `page ${groups[i][0]}`
        : `pages ${groups[i][0]}-${groups[i][groups[i].length - 1]}`;
    outputs.push({
      name: `${base} — ${label}.pdf`,
      data: await copySubset(src, pages0),
    });
  }
  return outputs;
}

/* --------------------------------- rotate --------------------------------- */

export async function rotatePdf(
  data: Uint8Array,
  angle: 90 | 180 | 270,
  pages: number[] | "all",
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true });
  const targets =
    pages === "all"
      ? doc.getPageIndices()
      : pages.map((p) => p - 1).filter((i) => i >= 0 && i < doc.getPageCount());
  for (const i of targets) {
    const page = doc.getPage(i);
    page.setRotation(degrees(((page.getRotation().angle + angle) % 360 + 360) % 360));
  }
  return doc.save(SAVE_OPTS);
}

/* ------------------------- rearrange / extract / delete ------------------- */

export async function rearrangePdf(
  data: Uint8Array,
  order: number[], // 1-based, full permutation of pages
): Promise<Uint8Array> {
  const src = await PDFDocument.load(data, { ignoreEncryption: true });
  return copySubset(src, order.map((p) => p - 1));
}

export async function extractPages(
  data: Uint8Array,
  pages: number[],
): Promise<Uint8Array> {
  const src = await PDFDocument.load(data, { ignoreEncryption: true });
  return copySubset(src, pages.map((p) => p - 1));
}

export async function deletePages(
  data: Uint8Array,
  pages: number[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true });
  const toRemove = [...new Set(pages)]
    .filter((p) => p >= 1 && p <= doc.getPageCount())
    .sort((a, b) => b - a);
  if (toRemove.length >= doc.getPageCount())
    throw new Error("Cannot delete every page of the document");
  for (const p of toRemove) doc.removePage(p - 1);
  return doc.save(SAVE_OPTS);
}

/* -------------------------------- watermark ------------------------------- */

export interface WatermarkOptions {
  text: string;
  fontSize: number;
  opacity: number; // 0..1
  position: "center" | "diagonal" | "top" | "bottom";
  color: { r: number; g: number; b: number }; // 0..1
  pages: number[] | "all";
}

export async function watermarkPdf(
  data: Uint8Array,
  opts: WatermarkOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = sanitizeWinAnsi(opts.text) || "CONFIDENTIAL";
  const targets =
    opts.pages === "all"
      ? doc.getPageIndices()
      : opts.pages.map((p) => p - 1).filter((i) => i >= 0 && i < doc.getPageCount());
  for (const i of targets) {
    const page = doc.getPage(i);
    const { width, height } = page.getSize();
    const size = opts.fontSize;
    const textWidth = font.widthOfTextAtSize(text, size);
    const color = rgb(opts.color.r, opts.color.g, opts.color.b);
    const common = { font, size, color, opacity: opts.opacity } as const;
    switch (opts.position) {
      case "diagonal": {
        const angle = Math.atan2(height, width) * (180 / Math.PI);
        page.drawText(text, {
          ...common,
          x: width / 2 - (textWidth / 2) * Math.cos((angle * Math.PI) / 180),
          y: height / 2 - (textWidth / 2) * Math.sin((angle * Math.PI) / 180),
          rotate: degrees(angle),
        });
        break;
      }
      case "center":
        page.drawText(text, {
          ...common,
          x: (width - textWidth) / 2,
          y: (height - size) / 2,
        });
        break;
      case "top":
        page.drawText(text, {
          ...common,
          x: (width - textWidth) / 2,
          y: height - size - 24,
        });
        break;
      case "bottom":
        page.drawText(text, { ...common, x: (width - textWidth) / 2, y: 24 });
        break;
    }
  }
  return doc.save(SAVE_OPTS);
}

/* ------------------------------ page numbers ------------------------------ */

export interface PageNumberOptions {
  format: string; // "{n}" and "{N}" placeholders
  position: "bottom-center" | "bottom-left" | "bottom-right" | "top-center" | "top-left" | "top-right";
  fontSize: number;
  start: number;
  margin: number;
}

export async function addPageNumbers(
  data: Uint8Array,
  opts: PageNumberOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const total = doc.getPageCount();
  for (let i = 0; i < total; i++) {
    const page = doc.getPage(i);
    const { width, height } = page.getSize();
    const label = sanitizeWinAnsi(
      opts.format
        .replaceAll("{n}", String(opts.start + i))
        .replaceAll("{N}", String(opts.start + total - 1)),
    );
    const w = font.widthOfTextAtSize(label, opts.fontSize);
    const m = opts.margin;
    const x = opts.position.endsWith("left")
      ? m
      : opts.position.endsWith("right")
        ? width - w - m
        : (width - w) / 2;
    const y = opts.position.startsWith("top") ? height - opts.fontSize - m : m;
    page.drawText(label, { x, y, size: opts.fontSize, font, color: rgb(0.25, 0.25, 0.25) });
  }
  return doc.save(SAVE_OPTS);
}

/* ------------------------------ images <-> pdf ----------------------------- */

function isPng(data: Uint8Array): boolean {
  return data.length > 4 && data[0] === 0x89 && data[1] === 0x50;
}

export interface ImagesToPdfOptions {
  pageSize: "fit" | "a4" | "letter";
  margin: number; // points
  combine: boolean; // one PDF vs one per image
}

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;

export async function imagesToPdf(
  images: { name: string; data: Uint8Array }[],
  opts: ImagesToPdfOptions,
  progress: ProgressFn,
): Promise<OutputFile[]> {
  const makeDoc = async (
    imgs: { name: string; data: Uint8Array }[],
  ): Promise<Uint8Array> => {
    const doc = await PDFDocument.create();
    for (const img of imgs) {
      const embedded = isPng(img.data)
        ? await doc.embedPng(img.data)
        : await doc.embedJpg(img.data);
      if (opts.pageSize === "fit") {
        const page = doc.addPage([embedded.width, embedded.height]);
        page.drawImage(embedded, {
          x: 0,
          y: 0,
          width: embedded.width,
          height: embedded.height,
        });
      } else {
        let [pw, ph] = PAGE_SIZES[opts.pageSize] as readonly number[] as [number, number];
        // rotate the page to match landscape images
        if (embedded.width > embedded.height) [pw, ph] = [ph, pw];
        const page = doc.addPage([pw, ph]);
        const maxW = pw - opts.margin * 2;
        const maxH = ph - opts.margin * 2;
        const k = Math.min(maxW / embedded.width, maxH / embedded.height);
        const w = embedded.width * k;
        const h = embedded.height * k;
        page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
      }
    }
    return doc.save(SAVE_OPTS);
  };

  if (opts.combine) {
    progress(0.2, "Building PDF");
    return [{ name: "images.pdf", data: await makeDoc(images) }];
  }
  const outputs: OutputFile[] = [];
  for (let i = 0; i < images.length; i++) {
    progress(i / images.length, `Converting ${images[i].name}`);
    outputs.push({ name: `${stem(images[i].name)}.pdf`, data: await makeDoc([images[i]]) });
  }
  return outputs;
}

export interface PdfToImagesOptions {
  format: "jpeg" | "png";
  dpi: number;
  quality: number; // 0..1, jpeg only
}

export async function pdfToImages(
  name: string,
  data: Uint8Array,
  opts: PdfToImagesOptions,
  progress: ProgressFn,
): Promise<OutputFile[]> {
  const doc = await loadPdf(data);
  const outputs: OutputFile[] = [];
  const ext = opts.format === "jpeg" ? "jpg" : "png";
  const base = stem(name);
  const pad = String(doc.numPages).length;
  for (let p = 1; p <= doc.numPages; p++) {
    progress((p - 1) / doc.numPages, `Rendering page ${p} of ${doc.numPages}`);
    const { canvas } = await renderPageToCanvas(doc, p, opts.dpi / 72);
    const bytes = await canvasToBytes(
      canvas,
      opts.format === "jpeg" ? "image/jpeg" : "image/png",
      opts.format === "jpeg" ? opts.quality : undefined,
    );
    outputs.push({ name: `${base} — ${String(p).padStart(pad, "0")}.${ext}`, data: bytes });
    canvas.width = 0; // release backing store eagerly
  }
  await doc.destroy();
  return outputs;
}

/* -------------------------------- compress -------------------------------- */

export type CompressLevel = "low" | "medium" | "high";

export interface CompressResult {
  data: Uint8Array;
  before: number;
  after: number;
  method: "structural" | "raster" | "original";
  /** true ⇒ no candidate beat the source; `data` IS the original bytes */
  alreadyOptimized: boolean;
}

interface Candidate {
  method: "structural" | "raster";
  data: Uint8Array;
}

/**
 * The never-larger guarantee lives here: only a candidate STRICTLY smaller
 * than the source can win; otherwise the original bytes are returned and the
 * file is reported as already optimized.
 */
export function pickCompressionResult(
  original: Uint8Array,
  candidates: Candidate[],
): CompressResult {
  const before = original.byteLength;
  let best: CompressResult = {
    data: original,
    before,
    after: before,
    method: "original",
    alreadyOptimized: true,
  };
  for (const c of candidates) {
    if (c.data.byteLength < before && c.data.byteLength < best.after) {
      best = {
        data: c.data,
        before,
        after: c.data.byteLength,
        method: c.method,
        alreadyOptimized: false,
      };
    }
  }
  return best;
}

/** Fraction of the file taken up by raw image streams (0..1). */
export function imageWeightOf(doc: PDFDocument, totalBytes: number): number {
  let imageBytes = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        if (obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) {
          imageBytes += obj.getContents().length;
        }
      } catch {
        /* malformed stream — ignore */
      }
    }
  }
  return totalBytes > 0 ? imageBytes / totalBytes : 0;
}

/**
 * Lossless candidate: re-serialize with object streams and drop dead weight
 * (XMP metadata blob, embedded page thumbnails). Content is untouched.
 * `updateMetadata: false` keeps pdf-lib from adding its own Producer string
 * and ModDate — that alone made small files grow before.
 */
export async function structuralCandidate(data: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(data, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  doc.catalog.delete(PDFName.of("Metadata"));
  for (let i = 0; i < doc.getPageCount(); i++) {
    doc.getPage(i).node.delete(PDFName.of("Thumb"));
  }
  return doc.save({ useObjectStreams: true });
}

/**
 * Lossy candidate: re-render pages as JPEGs. Only worthwhile for image-heavy
 * documents — for vector/text pages it INFLATES the file (the old behavior),
 * which pickCompressionResult now filters out.
 */
async function rasterCandidate(
  data: Uint8Array,
  dpi: number,
  quality: number,
  maxEdge: number,
  progress: ProgressFn,
): Promise<Uint8Array> {
  const src = await loadPdf(data);
  const out = await PDFDocument.create();
  out.setProducer("");
  out.setCreator("");
  for (let p = 1; p <= src.numPages; p++) {
    progress(0.1 + ((p - 1) / src.numPages) * 0.8, `Re-rendering page ${p} of ${src.numPages}`);
    const probe = await src.getPage(p);
    const vp = probe.getViewport({ scale: 1 });
    probe.cleanup();
    // cap output pixels so big-point pages can't upscale into a LARGER file
    const scale = Math.min(dpi / 72, maxEdge / Math.max(vp.width, vp.height));
    const { canvas, widthPts, heightPts } = await renderPageToCanvas(src, p, Math.max(scale, 0.1));
    const jpg = await out.embedJpg(await canvasToBytes(canvas, "image/jpeg", quality));
    const page = out.addPage([widthPts, heightPts]);
    page.drawImage(jpg, { x: 0, y: 0, width: widthPts, height: heightPts });
    canvas.width = 0;
  }
  await src.destroy();
  return out.save(SAVE_OPTS);
}

const RASTER_PRESETS: Record<"medium" | "high", { dpi: number; quality: number; maxEdge: number }> = {
  medium: { dpi: 144, quality: 0.72, maxEdge: 2400 },
  high: { dpi: 110, quality: 0.55, maxEdge: 1800 },
};

/**
 * Levels:
 *  - low:    structural cleanup only — zero quality loss.
 *  - medium: structural; image-heavy documents (≥40 % image bytes) also try
 *            a 144 dpi re-render and the smaller result wins.
 *  - high:   structural AND a 110 dpi re-render are always tried.
 * Whatever happens, the result is never larger than the input.
 */
export async function compressPdf(
  data: Uint8Array,
  level: CompressLevel,
  progress: ProgressFn,
): Promise<CompressResult> {
  const candidates: Candidate[] = [];

  progress(0.03, "Analyzing document");
  let imageFraction = 0;
  try {
    const probe = await PDFDocument.load(data, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    imageFraction = imageWeightOf(probe, data.byteLength);
  } catch {
    /* analysis is best-effort */
  }

  progress(0.06, "Rewriting document structure");
  try {
    candidates.push({ method: "structural", data: await structuralCandidate(data) });
  } catch {
    /* a broken document can still succeed via the raster path */
  }

  const wantRaster = level === "high" || (level === "medium" && imageFraction >= 0.4);
  if (wantRaster) {
    const preset = RASTER_PRESETS[level === "high" ? "high" : "medium"];
    try {
      candidates.push({
        method: "raster",
        data: await rasterCandidate(data, preset.dpi, preset.quality, preset.maxEdge, progress),
      });
    } catch {
      /* keep whatever candidates we have */
    }
  }

  progress(0.97, "Choosing smallest result");
  return pickCompressionResult(data, candidates);
}
