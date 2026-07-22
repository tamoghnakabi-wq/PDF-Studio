import type { Worker } from "tesseract.js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { ProgressFn } from "../types";
import { clamp, sanitizeWinAnsi } from "../utils";
import { loadPdf, renderPageToCanvas } from "./engine";

/** Per-recognition progress hook, fed by the worker-level logger. */
let currentLogger: ((frac: number) => void) | null = null;
let workerPromise: Promise<Worker> | null = null;

/**
 * All assets are bundled with the app (public/tesseract + public/tessdata),
 * so OCR runs fully offline.
 */
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      // lazy: tesseract.js only loads when OCR is actually used
      const { createWorker } = await import("tesseract.js");
      // absolute URLs: tesseract bootstraps from a blob worker, where relative
      // paths have no base to resolve against
      const abs = (p: string) => new URL(p, window.location.href).toString();
      return createWorker("eng", 1, {
        workerPath: abs("/tesseract/worker.min.js"),
        corePath: abs("/tesseract/"),
        langPath: abs("/tessdata"),
        gzip: true,
        logger: (m) => {
          if (m.status === "recognizing text" && currentLogger) {
            currentLogger(m.progress ?? 0);
          }
        },
      });
    })();
  }
  return workerPromise;
}

export interface OcrResult {
  /** Original PDF with an invisible, selectable text layer. */
  searchablePdf: Uint8Array;
  /** Plain text of all pages. */
  text: string;
}

export async function ocrPdf(
  data: Uint8Array,
  progress: ProgressFn,
  dpi = 200,
): Promise<OcrResult> {
  progress(0.01, "Loading OCR engine");
  const worker = await getWorker();

  const src = await loadPdf(data);
  const total = src.numPages;
  const outDoc = await PDFDocument.load(data, { ignoreEncryption: true });
  const font = await outDoc.embedFont(StandardFonts.Helvetica);
  const pageTexts: string[] = [];

  for (let p = 1; p <= total; p++) {
    const baseFrac = (p - 1) / total;
    progress(baseFrac, `Recognizing page ${p} of ${total}`);

    // Render the page as a bitmap for Tesseract; cap the longest edge so a
    // huge page can't allocate a gigantic canvas.
    const probe = await src.getPage(p);
    const vp = probe.getViewport({ scale: 1 });
    probe.cleanup();
    let scale = dpi / 72;
    const maxEdge = 4200;
    scale = Math.min(scale, maxEdge / Math.max(vp.width, vp.height));
    const { canvas, widthPts, heightPts } = await renderPageToCanvas(src, p, scale);

    currentLogger = (frac) =>
      progress(baseFrac + (frac * 0.96) / total, `Recognizing page ${p} of ${total}`);
    const result = await worker.recognize(canvas);
    currentLogger = null;
    canvas.width = 0;

    pageTexts.push(result.data.text.trim());

    // Lay each recognized word invisibly over the original page so the PDF
    // becomes selectable/searchable without changing how it looks.
    const page = outDoc.getPage(p - 1);
    const kx = widthPts / Math.max(1, Math.floor(vp.width * scale));
    const ky = heightPts / Math.max(1, Math.floor(vp.height * scale));
    const words = result.data.words ?? [];
    for (const word of words) {
      const text = sanitizeWinAnsi(word.text).trim();
      if (!text || word.confidence < 35) continue;
      const { x0, y0, y1 } = word.bbox;
      const h = (y1 - y0) * ky;
      const size = clamp(h * 0.92, 3, 96);
      page.drawText(text, {
        x: x0 * kx,
        y: heightPts - y1 * ky + h * 0.18,
        size,
        font,
        opacity: 0,
      });
    }
  }

  await src.destroy();
  progress(0.985, "Writing searchable PDF");
  const searchablePdf = await outDoc.save({ useObjectStreams: true });
  return { searchablePdf, text: pageTexts.join("\n\n") };
}

export async function disposeOcr(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise.catch(() => null);
    workerPromise = null;
    await w?.terminate().catch(() => {});
  }
}
