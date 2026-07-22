import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * pdf.js transfers the underlying ArrayBuffer to its worker, so always hand
 * it a copy — callers keep ownership of their bytes.
 */
export async function loadPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data: data.slice() }).promise;
}

export async function getPageCount(data: Uint8Array): Promise<number> {
  const doc = await loadPdf(data);
  const n = doc.numPages;
  await doc.destroy();
  return n;
}

export interface RenderedPage {
  canvas: HTMLCanvasElement;
  /** Page size in PDF points (72 dpi) */
  widthPts: number;
  heightPts: number;
}

export async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  background = "#ffffff",
): Promise<RenderedPage> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d", { alpha: false })!;
  // intent "print" renders via timeouts instead of requestAnimationFrame, so
  // batch jobs keep going while the window is hidden or minimized.
  await page.render({ canvasContext: ctx, viewport, background, intent: "print" }).promise;
  page.cleanup();
  return { canvas, widthPts: base.width, heightPts: base.height };
}

export function canvasToBytes(
  canvas: HTMLCanvasElement,
  type: "image/jpeg" | "image/png",
  quality?: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("Could not encode image"));
        blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
      },
      type,
      quality,
    );
  });
}

/** Render a page as a data-URL thumbnail of the given CSS width. */
export async function renderThumbnail(
  doc: PDFDocumentProxy,
  pageNumber: number,
  targetWidth: number,
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = (targetWidth * (window.devicePixelRatio || 1)) / vp1.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d", { alpha: false })!;
  await page
    .render({ canvasContext: ctx, viewport, background: "#ffffff", intent: "print" })
    .promise;
  page.cleanup();
  return canvas.toDataURL("image/jpeg", 0.8);
}

/** Extract the text of every page; pages joined with blank lines. */
export async function extractText(
  data: Uint8Array,
  onPage?: (page: number, total: number) => void,
): Promise<string> {
  const doc = await loadPdf(data);
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = "";
    let lastY: number | null = null;
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = (item.transform as number[])[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        text += line.trimEnd() + "\n";
        line = "";
      }
      line += item.str + (item.hasEOL ? "\n" : "");
      lastY = y;
    }
    text += line.trimEnd();
    parts.push(text.trim());
    page.cleanup();
    onPage?.(p, doc.numPages);
  }
  await doc.destroy();
  return parts.join("\n\n");
}
