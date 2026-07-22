import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont } from "pdf-lib";
import type { ProgressFn } from "../types";
import { sanitizeWinAnsi } from "../utils";

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
}

interface Block {
  kind: "p" | "h" | "li" | "img";
  level?: number; // heading level or list depth
  ordered?: boolean;
  index?: number; // ordinal for ordered list items
  runs: Run[];
  src?: string; // data URL for images
}

function collectRuns(node: Node, bold: boolean, italic: boolean, out: Run[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (text) out.push({ text, bold, italic });
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName;
  if (tag === "BR") {
    out.push({ text: "\n", bold, italic });
    return;
  }
  const b = bold || tag === "B" || tag === "STRONG";
  const i = italic || tag === "I" || tag === "EM";
  el.childNodes.forEach((child) => collectRuns(child, b, i, out));
}

function blocksFromHtml(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks: Block[] = [];

  const visit = (el: Element, listDepth: number, ordered: boolean) => {
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const runs: Run[] = [];
      collectRuns(el, true, false, runs);
      blocks.push({ kind: "h", level: Number(tag[1]), runs });
    } else if (tag === "P") {
      const img = el.querySelector("img[src^='data:']");
      if (img) blocks.push({ kind: "img", runs: [], src: img.getAttribute("src") ?? undefined });
      const runs: Run[] = [];
      collectRuns(el, false, false, runs);
      blocks.push({ kind: "p", runs });
    } else if (tag === "UL" || tag === "OL") {
      let n = 1;
      for (const li of Array.from(el.children)) {
        if (li.tagName !== "LI") continue;
        const runs: Run[] = [];
        for (const child of Array.from(li.childNodes)) {
          if (
            child.nodeType === Node.ELEMENT_NODE &&
            ["UL", "OL"].includes((child as Element).tagName)
          )
            continue;
          collectRuns(child, false, false, runs);
        }
        blocks.push({
          kind: "li",
          level: listDepth,
          ordered: tag === "OL",
          index: n++,
          runs,
        });
        for (const child of Array.from(li.children)) {
          if (["UL", "OL"].includes(child.tagName))
            visit(child, listDepth + 1, child.tagName === "OL");
        }
      }
    } else if (tag === "TABLE") {
      for (const tr of Array.from(el.querySelectorAll("tr"))) {
        const cells = Array.from(tr.querySelectorAll("td,th")).map((c) =>
          (c.textContent ?? "").trim(),
        );
        blocks.push({
          kind: "p",
          runs: [{ text: cells.join("   |   "), bold: tr.querySelector("th") != null, italic: false }],
        });
      }
      blocks.push({ kind: "p", runs: [] });
    } else if (tag === "IMG") {
      blocks.push({ kind: "img", runs: [], src: el.getAttribute("src") ?? undefined });
    } else if (tag === "BLOCKQUOTE") {
      const runs: Run[] = [];
      collectRuns(el, false, true, runs);
      blocks.push({ kind: "li", level: 0, ordered: false, runs }); // indented like a list
    } else {
      for (const child of Array.from(el.children)) visit(child, listDepth, ordered);
    }
  };

  for (const child of Array.from(doc.body.children)) visit(child, 0, false);
  return blocks;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 64;
const MAX_W = PAGE_W - MARGIN * 2;

export async function wordToPdf(
  docxData: Uint8Array,
  progress: ProgressFn,
): Promise<Uint8Array> {
  progress(0.05, "Reading Word document");
  // lazy: mammoth only loads when a Word conversion actually runs
  const mammothMod = await import("mammoth/mammoth.browser");
  const mammoth = mammothMod.default ?? mammothMod;
  const buf = docxData.buffer.slice(
    docxData.byteOffset,
    docxData.byteOffset + docxData.byteLength,
  ) as ArrayBuffer;
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf });
  const blocks = blocksFromHtml(html);

  progress(0.25, "Laying out PDF");
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const pickFont = (r: { bold: boolean; italic: boolean }): PDFFont =>
    r.bold && r.italic
      ? fonts.boldItalic
      : r.bold
        ? fonts.bold
        : r.italic
          ? fonts.italic
          : fonts.regular;

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const newPageIfNeeded = (need: number) => {
    if (y - need < MARGIN) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  const drawRuns = (runs: Run[], size: number, indent: number, prefix?: string) => {
    type Tok = { text: string; font: PDFFont; w: number };
    const lineH = size * 1.45;
    const maxW = MAX_W - indent;
    const toks: Tok[] = [];
    if (prefix) {
      toks.push({ text: prefix, font: fonts.regular, w: fonts.regular.widthOfTextAtSize(prefix, size) });
    }
    for (const run of runs) {
      const font = pickFont(run);
      const clean = sanitizeWinAnsi(run.text);
      for (const piece of clean.split(/(\n)/)) {
        if (piece === "\n") {
          toks.push({ text: "\n", font, w: 0 });
          continue;
        }
        for (const m of piece.match(/\S+\s*|\s+/g) ?? []) {
          toks.push({ text: m, font, w: font.widthOfTextAtSize(m, size) });
        }
      }
    }
    if (!toks.length) {
      y -= lineH * 0.6;
      return;
    }
    let line: Tok[] = [];
    let lineW = 0;
    const flush = () => {
      if (!line.length) return;
      newPageIfNeeded(lineH);
      let x = MARGIN + indent;
      for (const t of line) {
        page.drawText(t.text.replace(/\s+$/g, " "), {
          x,
          y: y - size,
          size,
          font: t.font,
          color: rgb(0.1, 0.1, 0.12),
        });
        x += t.w;
      }
      y -= lineH;
      line = [];
      lineW = 0;
    };
    for (const t of toks) {
      if (t.text === "\n") {
        flush();
        continue;
      }
      if (lineW + t.w > maxW && line.length) flush();
      line.push(t);
      lineW += t.w;
    }
    flush();
  };

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    progress(0.25 + (bi / Math.max(1, blocks.length)) * 0.7, "Laying out PDF");
    if (block.kind === "img" && block.src) {
      try {
        const comma = block.src.indexOf(",");
        const b64 = block.src.slice(comma + 1);
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const img = block.src.includes("image/png")
          ? await pdf.embedPng(bytes)
          : await pdf.embedJpg(bytes);
        const w = Math.min(img.width, MAX_W);
        const h = (img.height / img.width) * w;
        newPageIfNeeded(h + 12);
        page.drawImage(img, { x: MARGIN, y: y - h, width: w, height: h });
        y -= h + 12;
      } catch {
        // unsupported image format — skip it
      }
      continue;
    }
    if (block.kind === "h") {
      const sizes = [24, 19, 16, 14, 12.5, 11.5];
      const size = sizes[(block.level ?? 1) - 1] ?? 12;
      y -= size * 0.6;
      drawRuns(block.runs.map((r) => ({ ...r, bold: true })), size, 0);
      y -= size * 0.25;
    } else if (block.kind === "li") {
      const indent = 18 + (block.level ?? 0) * 16;
      const prefix = block.ordered ? `${block.index ?? 1}.  ` : "•  ";
      drawRuns(block.runs, 11, indent, prefix);
    } else {
      drawRuns(block.runs, 11, 0);
      y -= 4;
    }
  }

  progress(0.97, "Writing PDF");
  return pdf.save({ useObjectStreams: true });
}
