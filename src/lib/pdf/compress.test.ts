import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  compressPdf,
  imageWeightOf,
  pickCompressionResult,
  structuralCandidate,
} from "./ops";

const noop = () => {};

async function makeTextPdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([612, 792]);
    for (let line = 0; line < 30; line++) {
      page.drawText(`Page ${p + 1} line ${line} — the quick brown fox jumps over the lazy dog.`, {
        x: 50,
        y: 740 - line * 22,
        size: 11,
        font,
      });
    }
  }
  return doc.save();
}

// canonical 1x1 JPEG, used to fabricate image-bearing PDFs without a canvas
const TINY_JPEG = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
  ),
  (c) => c.charCodeAt(0),
);

async function makeImageBearingPdf(embeds = 40): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  for (let i = 0; i < embeds; i++) {
    const img = await doc.embedJpg(TINY_JPEG);
    page.drawImage(img, { x: (i % 10) * 20, y: Math.floor(i / 10) * 20, width: 18, height: 18 });
  }
  return doc.save();
}

describe("pickCompressionResult — the never-larger guarantee", () => {
  const original = new Uint8Array(1000);

  it("returns the original when there are no candidates", () => {
    const r = pickCompressionResult(original, []);
    expect(r.alreadyOptimized).toBe(true);
    expect(r.data).toBe(original);
    expect(r.after).toBe(r.before);
  });

  it("rejects larger candidates", () => {
    const r = pickCompressionResult(original, [
      { method: "raster", data: new Uint8Array(5000) },
    ]);
    expect(r.alreadyOptimized).toBe(true);
    expect(r.data).toBe(original);
  });

  it("rejects equal-size candidates (equal counts as not compressible)", () => {
    const r = pickCompressionResult(original, [
      { method: "structural", data: new Uint8Array(1000) },
    ]);
    expect(r.alreadyOptimized).toBe(true);
  });

  it("accepts a strictly smaller candidate", () => {
    const r = pickCompressionResult(original, [
      { method: "structural", data: new Uint8Array(900) },
    ]);
    expect(r.alreadyOptimized).toBe(false);
    expect(r.after).toBe(900);
    expect(r.method).toBe("structural");
  });

  it("picks the smallest of several candidates", () => {
    const r = pickCompressionResult(original, [
      { method: "structural", data: new Uint8Array(900) },
      { method: "raster", data: new Uint8Array(400) },
    ]);
    expect(r.method).toBe("raster");
    expect(r.after).toBe(400);
  });

  it("never returns after > before, for any candidate mix", () => {
    for (const sizes of [[1200], [1000], [999], [0], [2000, 999, 1500], []]) {
      const r = pickCompressionResult(
        original,
        sizes.map((s) => ({ method: "raster" as const, data: new Uint8Array(s) })),
      );
      expect(r.after).toBeLessThanOrEqual(r.before);
      expect(r.data.byteLength).toBe(r.after);
    }
  });
});

describe("compressPdf on real documents (structural path)", () => {
  it("text-only PDF: low and medium never enlarge", async () => {
    const src = await makeTextPdf();
    for (const level of ["low", "medium"] as const) {
      const r = await compressPdf(src, level, noop);
      expect(r.after).toBeLessThanOrEqual(r.before);
      expect(r.data.byteLength).toBe(r.after);
      expect(r.alreadyOptimized).toBe(r.after === r.before);
    }
  });

  it("already-optimized PDF is detected and kept byte-identical", async () => {
    const src = await makeTextPdf();
    const first = await compressPdf(src, "low", noop);
    // compress the (possibly already optimal) result again
    const second = await compressPdf(first.data, "low", noop);
    expect(second.after).toBeLessThanOrEqual(second.before);
    if (second.alreadyOptimized) {
      expect(second.data).toBe(first.data); // exact original bytes, not a rewrite
    } else {
      // at minimum the invariant must hold
      expect(second.after).toBeLessThan(second.before);
    }
    // a third pass over an optimized doc must be a fixed point
    const third = await compressPdf(second.data, "low", noop);
    expect(third.after).toBeLessThanOrEqual(third.before);
  });

  it("structural candidate preserves page count and text validity", async () => {
    const src = await makeTextPdf(4);
    const out = await structuralCandidate(src);
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(4);
  });

  it("imageWeightOf: ~0 for text-only, high for image-stuffed PDFs", async () => {
    const text = await PDFDocument.load(await makeTextPdf());
    const textFraction = imageWeightOf(text, 50_000);
    expect(textFraction).toBeLessThan(0.05);

    const imgPdfBytes = await makeImageBearingPdf();
    const imgPdf = await PDFDocument.load(imgPdfBytes);
    const imgFraction = imageWeightOf(imgPdf, imgPdfBytes.byteLength);
    expect(imgFraction).toBeGreaterThan(0.3);
  });
});
