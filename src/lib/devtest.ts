/**
 * Dev-only smoke harness: window.__pdfStudioSmoke() runs every PDF operation
 * against synthetic documents and reports pass/fail. Loaded only when
 * import.meta.env.DEV — tree-shaken out of release builds.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { canvasToBytes, extractText, getPageCount } from "./pdf/engine";
import {
  addPageNumbers,
  compressPdf,
  deletePages,
  extractPages,
  imagesToPdf,
  imageWeightOf,
  mergePdfs,
  pdfToImages,
  rearrangePdf,
  rotatePdf,
  splitPdf,
  watermarkPdf,
} from "./pdf/ops";
import { ocrPdf } from "./pdf/ocr";
import { wordToPdf } from "./pdf/wordToPdf";
import { pdfToWord } from "./pdf/pdfToWord";
import { burnAnnotations, type AnnMap } from "./pdf/annotate";

async function makePdf(pages: string[], fontSize = 24): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([612, 792]);
    page.drawText(text, { x: 60, y: 700, size: fontSize, font });
  }
  return doc.save();
}

interface SmokeResult {
  name: string;
  ok: boolean;
  info: string;
}

async function runCase(
  results: SmokeResult[],
  name: string,
  fn: () => Promise<string>,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__smokeProgress = name;
  console.log("[devtest] running:", name);
  try {
    results.push({ name, ok: true, info: await fn() });
    console.log("[devtest] PASS", name);
  } catch (e) {
    results.push({ name, ok: false, info: e instanceof Error ? e.message : String(e) });
    console.log("[devtest] FAIL", name, e);
  }
}

const noop = () => {};

async function smoke(includeOcr = false): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [];
  const base = await makePdf(["Alpha page one", "Bravo page two", "Charlie page three"]);

  await runCase(results, "merge", async () => {
    const [out] = await mergePdfs(
      [
        { name: "a.pdf", data: base },
        { name: "b.pdf", data: base },
      ],
      noop,
    );
    const n = await getPageCount(out.data);
    if (n !== 6) throw new Error(`expected 6 pages, got ${n}`);
    return `6 pages, ${out.data.length} bytes`;
  });

  await runCase(results, "split", async () => {
    const outs = await splitPdf("doc.pdf", base, [[1], [2, 3]], noop);
    if (outs.length !== 2) throw new Error(`expected 2 outputs, got ${outs.length}`);
    const n2 = await getPageCount(outs[1].data);
    if (n2 !== 2) throw new Error(`part 2 should have 2 pages, got ${n2}`);
    return outs.map((o) => o.name).join(" | ");
  });

  await runCase(results, "rotate", async () => {
    const out = await rotatePdf(base, 90, "all");
    const doc = await PDFDocument.load(out);
    const angle = doc.getPage(0).getRotation().angle;
    if (angle !== 90) throw new Error(`expected rotation 90, got ${angle}`);
    return "all pages rotated 90°";
  });

  await runCase(results, "extract", async () => {
    const out = await extractPages(base, [2]);
    const text = await extractText(out);
    if (!text.includes("Bravo")) throw new Error(`wrong page extracted: ${text}`);
    return "page 2 extracted";
  });

  await runCase(results, "delete", async () => {
    const out = await deletePages(base, [1]);
    const n = await getPageCount(out);
    const text = await extractText(out);
    if (n !== 2 || text.includes("Alpha")) throw new Error("page 1 still present");
    return "page 1 deleted, 2 remain";
  });

  await runCase(results, "rearrange", async () => {
    const out = await rearrangePdf(base, [3, 2, 1]);
    const text = await extractText(out);
    if (text.indexOf("Charlie") > text.indexOf("Alpha"))
      throw new Error("order unchanged");
    return "reversed order verified";
  });

  await runCase(results, "watermark", async () => {
    const out = await watermarkPdf(base, {
      text: "CONFIDENTIAL",
      fontSize: 48,
      opacity: 0.3,
      position: "diagonal",
      color: { r: 0.9, g: 0.3, b: 0.3 },
      pages: "all",
    });
    const text = await extractText(out);
    if (!text.includes("CONFIDENTIAL")) throw new Error("watermark text missing");
    return "diagonal watermark on 3 pages";
  });

  await runCase(results, "page numbers", async () => {
    const out = await addPageNumbers(base, {
      format: "{n} / {N}",
      position: "bottom-center",
      fontSize: 11,
      start: 1,
      margin: 28,
    });
    const text = await extractText(out);
    if (!text.includes("1 / 3") || !text.includes("3 / 3"))
      throw new Error(`numbers missing: ${text.slice(-80)}`);
    return "1/3 … 3/3 stamped";
  });

  await runCase(results, "pdf → text", async () => {
    const text = await extractText(base);
    if (!/Alpha[\s\S]*Bravo[\s\S]*Charlie/.test(text)) throw new Error(text);
    return `${text.length} chars`;
  });

  let jpgBytes: Uint8Array | null = null;
  await runCase(results, "pdf → jpg", async () => {
    const outs = await pdfToImages(
      "doc.pdf",
      base,
      { format: "jpeg", dpi: 96, quality: 0.8 },
      noop,
    );
    if (outs.length !== 3) throw new Error(`expected 3 images, got ${outs.length}`);
    if (outs[0].data[0] !== 0xff || outs[0].data[1] !== 0xd8)
      throw new Error("not a JPEG");
    jpgBytes = outs[0].data;
    return outs.map((o) => o.name).join(" | ");
  });

  await runCase(results, "pdf → png", async () => {
    const outs = await pdfToImages(
      "doc.pdf",
      base,
      { format: "png", dpi: 96, quality: 1 },
      noop,
    );
    if (outs[0].data[0] !== 0x89 || outs[0].data[1] !== 0x50)
      throw new Error("not a PNG");
    return `${outs.length} PNGs`;
  });

  await runCase(results, "jpg → pdf", async () => {
    if (!jpgBytes) throw new Error("no jpg from previous step");
    const outs = await imagesToPdf(
      [{ name: "page.jpg", data: jpgBytes }],
      { pageSize: "a4", margin: 24, combine: true },
      noop,
    );
    const n = await getPageCount(outs[0].data);
    if (n !== 1) throw new Error(`expected 1 page, got ${n}`);
    return "A4 PDF from JPG";
  });

  // photo-like (smoothly compressible) multi-page JPEG document
  const makeImageHeavyPdf = async (pages = 2): Promise<Uint8Array> => {
    const imgs: { name: string; data: Uint8Array }[] = [];
    for (let i = 0; i < pages; i++) {
      const c = document.createElement("canvas");
      c.width = 900;
      c.height = 1200;
      const g = c.getContext("2d")!;
      const grad = g.createLinearGradient(0, 0, 900, 1200);
      grad.addColorStop(0, "#ff8844");
      grad.addColorStop(0.5, "#2266cc");
      grad.addColorStop(1, "#11aa66");
      g.fillStyle = grad;
      g.fillRect(0, 0, 900, 1200);
      for (let k = 0; k < 240; k++) {
        g.fillStyle = `hsl(${(k * 37 + i * 90) % 360} 70% ${30 + (k % 50)}%)`;
        g.beginPath();
        g.arc((k * 131) % 900, (k * 197) % 1200, 8 + (k % 60), 0, Math.PI * 2);
        g.fill();
      }
      imgs.push({ name: `p${i}.jpg`, data: await canvasToBytes(c, "image/jpeg", 0.95) });
    }
    const [out] = await imagesToPdf(imgs, { pageSize: "a4", margin: 0, combine: true }, noop);
    return out.data;
  };

  await runCase(results, "compress: text-only never larger (all levels)", async () => {
    const sizes: string[] = [];
    for (const level of ["low", "medium", "high"] as const) {
      const r = await compressPdf(base, level, noop);
      if (r.after > r.before) throw new Error(`${level}: GREW ${r.before} → ${r.after}`);
      if (r.data.byteLength !== r.after) throw new Error(`${level}: size mismatch`);
      if (r.alreadyOptimized !== (r.after === r.before))
        throw new Error(`${level}: alreadyOptimized flag inconsistent`);
      if (!r.alreadyOptimized && (await getPageCount(r.data)) !== 3)
        throw new Error(`${level}: page count changed`);
      sizes.push(`${level}: ${r.before}→${r.after}${r.alreadyOptimized ? " (kept)" : ` (${r.method})`}`);
    }
    return sizes.join(" | ");
  });

  await runCase(results, "compress: image-heavy shrinks (medium & high)", async () => {
    const src = await makeImageHeavyPdf();
    const doc = await PDFDocument.load(src);
    const fraction = imageWeightOf(doc, src.byteLength);
    if (fraction < 0.5) throw new Error(`fixture not image-heavy enough (${fraction.toFixed(2)})`);
    const sizes: string[] = [];
    for (const level of ["medium", "high"] as const) {
      const r = await compressPdf(src, level, noop);
      if (r.after >= r.before)
        throw new Error(`${level}: image-heavy PDF did not shrink (${r.before} → ${r.after})`);
      if ((await getPageCount(r.data)) !== 2) throw new Error(`${level}: page count changed`);
      sizes.push(`${level}: ${Math.round((1 - r.after / r.before) * 100)}% smaller`);
    }
    return `imageWeight=${fraction.toFixed(2)} | ${sizes.join(" | ")}`;
  });

  await runCase(results, "compress: already-optimized detected", async () => {
    const first = await compressPdf(base, "low", noop);
    const second = await compressPdf(first.data, "low", noop);
    if (second.after > second.before) throw new Error("second pass grew the file");
    if (!second.alreadyOptimized)
      throw new Error(`expected already-optimized, got ${second.before} → ${second.after}`);
    return `2nd pass kept original ${second.before} bytes (message path verified)`;
  });

  await runCase(results, "edit (burn annotations)", async () => {
    // a tiny 2x2 red PNG for the image annotation
    const c = document.createElement("canvas");
    c.width = c.height = 2;
    const g = c.getContext("2d")!;
    g.fillStyle = "#ff0000";
    g.fillRect(0, 0, 2, 2);
    const anns: AnnMap = {
      0: [
        { id: "t1", kind: "text", x: 60, y: 200, w: 200, h: 20, text: "Inserted by editor\nsecond line", size: 14, color: "#1144cc" },
        { id: "h1", kind: "highlight", x: 55, y: 80, w: 220, h: 26, color: "#ffe066" },
        {
          id: "d1", kind: "draw", x: 100, y: 300, w: 50, h: 30, baseW: 50, baseH: 30,
          points: [[{ x: 0, y: 0 }, { x: 25, y: 30 }, { x: 50, y: 0 }]], color: "#e5484d", width: 2,
        },
        {
          id: "s1", kind: "signature", x: 300, y: 600, w: 120, h: 40, baseW: 240, baseH: 80,
          points: [[{ x: 0, y: 40 }, { x: 80, y: 10 }, { x: 240, y: 60 }]], color: "#111111", width: 2.5,
        },
        { id: "i1", kind: "image", x: 400, y: 100, w: 40, h: 40, dataUrl: c.toDataURL("image/png") },
      ],
    };
    const out = await burnAnnotations(base, anns, noop);
    const text = await extractText(out);
    if (!text.includes("Inserted by editor") || !text.includes("second line"))
      throw new Error(`text annotation missing: ${text.slice(0, 100)}`);
    if (out.length <= base.length) throw new Error("output suspiciously small");
    // original content must survive
    if (!text.includes("Alpha")) throw new Error("original content lost");
    return `text+highlight+draw+signature+image burned, ${out.length} bytes`;
  });

  await runCase(results, "pdf → word (round trip)", async () => {
    const docx = await pdfToWord(base, noop);
    if (docx[0] !== 0x50 || docx[1] !== 0x4b) throw new Error("not a ZIP/docx container");
    // full circle: the generated .docx must convert back to a PDF with the text intact
    const backToPdf = await wordToPdf(docx, noop);
    const text = await extractText(backToPdf);
    for (const word of ["Alpha", "Bravo", "Charlie"]) {
      if (!text.includes(word)) throw new Error(`round trip lost "${word}": ${text.slice(0, 80)}`);
    }
    return `docx ${docx.length} bytes; PDF→Word→PDF text intact`;
  });

  await runCase(results, "pdf → word (scanned page → image)", async () => {
    const scan = await makePdf(["SCAN FIXTURE"], 48);
    const [img] = await pdfToImages("s.pdf", scan, { format: "jpeg", dpi: 120, quality: 0.9 }, noop);
    const [rasterPdf] = await imagesToPdf(
      [{ name: img.name, data: img.data }],
      { pageSize: "fit", margin: 0, combine: true },
      noop,
    );
    const docx = await pdfToWord(rasterPdf.data, noop);
    if (docx[0] !== 0x50 || docx[1] !== 0x4b) throw new Error("not a ZIP/docx container");
    if (docx.length < 5000) throw new Error(`suspiciously small for an embedded page image: ${docx.length}`);
    return `scanned page embedded as image, ${docx.length} bytes`;
  });

  await runCase(results, "word → pdf", async () => {
    const resp = await fetch("/sample.docx");
    if (!resp.ok) return "fixture not present — skipped";
    const docx = new Uint8Array(await resp.arrayBuffer());
    const out = await wordToPdf(docx, noop);
    const text = await extractText(out);
    if (!text.includes("Quarterly Report") || !text.includes("bold"))
      throw new Error(`content missing: ${text.slice(0, 80)}`);
    return `converted, ${out.length} bytes, text verified`;
  });

  if (includeOcr) {
    await runCase(results, "ocr", async () => {
      const scan = await makePdf(["HELLO WORLD 42"], 48);
      // strip the text layer by rasterizing first, so OCR has real work to do
      const [img] = await pdfToImages(
        "scan.pdf",
        scan,
        { format: "jpeg", dpi: 150, quality: 0.9 },
        noop,
      );
      const [rasterPdf] = await imagesToPdf(
        [{ name: img.name, data: img.data }],
        { pageSize: "fit", margin: 0, combine: true },
        noop,
      );
      const before = await extractText(rasterPdf.data);
      if (before.trim()) throw new Error("raster PDF unexpectedly has text");
      const result = await ocrPdf(rasterPdf.data, noop);
      if (!/HELLO/i.test(result.text))
        throw new Error(`OCR missed text: "${result.text.slice(0, 60)}"`);
      const after = await extractText(result.searchablePdf);
      if (!/HELLO/i.test(after))
        throw new Error("searchable layer missing from PDF");
      return `recognized: "${result.text.trim().slice(0, 40)}"`;
    });

    await runCase(results, "compress: OCR-generated PDF never larger", async () => {
      const scan = await makePdf(["OCR COMPRESS FIXTURE"], 48);
      const [img] = await pdfToImages("scan.pdf", scan, { format: "jpeg", dpi: 150, quality: 0.9 }, noop);
      const [rasterPdf] = await imagesToPdf(
        [{ name: img.name, data: img.data }],
        { pageSize: "fit", margin: 0, combine: true },
        noop,
      );
      const { searchablePdf } = await ocrPdf(rasterPdf.data, noop);
      const sizes: string[] = [];
      for (const level of ["low", "medium", "high"] as const) {
        const r = await compressPdf(searchablePdf, level, noop);
        if (r.after > r.before) throw new Error(`${level}: GREW ${r.before} → ${r.after}`);
        sizes.push(`${level}: ${r.before}→${r.after}${r.alreadyOptimized ? " (kept)" : ""}`);
      }
      return sizes.join(" | ");
    });
  }

  return results;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__pdfStudioSmoke = smoke;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__makeEditTestPdf = async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__editTestPdf = await makePdf([
    "Alpha page one",
    "Bravo page two",
  ]);
  return "ok";
};
console.log("[devtest] window.__pdfStudioSmoke(includeOcr?) ready");
